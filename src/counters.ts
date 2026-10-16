/*
 * Liczniki nad lista — „co mam dzis do zrobienia" w rejestrze zadan.
 *
 * Liczby sa GLOBALNE — licza cala grupe, niezaleznie od zakresu, przelacznikow
 * („Tylko moje", „Zakonczone") i filtrow. Inaczej „ile mamy poza sprintem" zmienialoby
 * sie od tego, jak akurat patrzysz, a o to pytanie chodzi: czy jest 200, czy 220.
 *
 * ROZBICIE „POZA SPRINTEM"
 * Otwarte zadania spoza aktywnego sprintu, BEZ odlozonych, dziela sie na stany, ktore
 * sie wykluczaja i razem daja dokladnie „Poza sprintem":
 *
 *   DO-STARTU, z wyceną, kategorią
 *     i okresem zwrotu              → Gotowe do startu
 *   DO-STARTU, bez któregokolwiek
 *     z tych trzech                 → Do wyceny
 *   OCZEKUJE-NA-ODPOWIEDZ + wpis    → Do analizy odpowiedzi
 *   OCZEKUJE-NA-ODPOWIEDZ           → Czeka na odpowiedz
 *   cala reszta                     → Do wywiadu (DO-WYWIADU albo brak tagu gotowosci)
 *
 * „Do wywiadu" jest dopelnieniem, wiec suma zgadza sie z definicji — takze gdy zadanie
 * ma dwa tagi gotowosci (pierwszenstwo: DO-STARTU, potem OCZEKUJE) albo tag spoza
 * listy (BUG, Wysoki). Zadanie nowe, bez zadnego tagu gotowosci, to zadanie, o ktore
 * trzeba dopiero zapytac.
 *
 * FOLDERY leza POZA rejestrem: zadanie, ktore ma otwarte podzadanie, jest tylko kontenerem — praca
 * siedzi w podzadaniach, wiec liczenie rodzica obok dzieci liczyloby ten sam temat dwa razy (tak samo
 * jak kolejka audytu, ktora folderow nie pokazuje). Folder, ktorego wszystkie podzadania sa zamkniete,
 * wraca do zwyklego rejestru. Ani do „Poza sprintem", ani do zadnego stanu (w tym „Do wywiadu") —
 * pokazuje je tylko osobny kafelek „Foldery".
 *
 * KONCEPCJA lezy POZA rejestrem: to pomysly na zbyt wczesnym etapie, zeby je wliczac —
 * ani do „Poza sprintem", ani do zadnego stanu (w tym „Do wywiadu"). Pokazuje je tylko osobny
 * kafelek „Koncept". Zadanie z koncepcja, ktore trafilo do aktywnego sprintu, zostaje w „W sprincie".
 *
 * Odlozone (status 6) leza poza kolejka audytu i poza suma; pokazuje je osobna,
 * wyszarzona notka pod kafelkami.
 *
 * BUG to CECHA, nie stan: zadanie z tagiem BUG jest jednoczesnie w jednym ze stanow,
 * wiec jego kafelek stoi za pionowym separatorem, poza rozbiciem, i nie dodaje sie do sumy.
 *
 * Modul jest czysty (bez Reacta i bez zapytan), zeby dalo sie go przetestowac.
 */
import type { Task } from './bitrix';
import { isImportant } from './taskView';

export type CounterKey =
  | 'poza'
  | 'wywiad'
  | 'czeka'
  | 'odpowiedzi'
  | 'wycena'
  | 'gotowe'
  | 'sprint'
  | 'wazne'
  | 'koncept'
  | 'foldery'
  | 'odlozone';

export const TAG_DO_STARTU = 'DO-STARTU';
export const TAG_CZEKA = 'OCZEKUJE-NA-ODPOWIEDZ';
export const TAG_WYWIAD = 'DO-WYWIADU';
export const TAG_BUG = 'BUG';
/**
 * Pomysl, a nie zadanie do zrobienia — temat na etapie koncepcji (reguly zadan: tag KONCEPCJA).
 * Nie ma drugiego tagu o tym znaczeniu; `KONCEPT` nie istnieje ani w regulach, ani w Bitriksie.
 */
export const TAG_KONCEPCJA = 'KONCEPCJA';

/*
 * Kategoria korzyści zadania — jeden tag na zadanie. `BUG` jest kategorią „naprawa błędu"
 * i już istnieje jako tag; pozostałe to nowe tagi z zasad wartości zadań.
 */
export const TAG_WYMOG = 'WYMOG';
export const TAGS_KATEGORIA = [
  TAG_BUG,
  'OSZCZEDNOSC',
  'PRZYCHOD',
  'RYZYKO',
  'ANALITYKA',
  'UTRZYMANIE',
  TAG_WYMOG,
];

/**
 * PULA zadania — z czyjego budżetu godzin ono jest: ciągłość (utrzymanie), rdzeń (rozwój produktu)
 * albo dział (zamówione przez dział). Obowiązkowa: bez puli zadanie nigdy nie jest kompletne.
 * Kolejność listy rozstrzyga, gdy zadanie ma dwie — liczy się pierwsza.
 */
export const TAGS_PULA = ['CIAGLOSC', 'RDZEN', 'DZIAL'] as const;
export type Pula = (typeof TAGS_PULA)[number];

/** Pula zadania albo `null`. Zadanie ma najwyżej jedną; przy dwóch wygrywa pierwsza z `TAGS_PULA`. */
export const pula = (t: Pick<Task, 'tags'>): Pula | null => TAGS_PULA.find((g) => hasTag(t, g)) ?? null;

/** Bitrix nie rozroznia wielkosci liter w tagach — „do-startu" to ten sam tag. */
export const hasTag = (t: Pick<Task, 'tags'>, tag: string): boolean =>
  t.tags.some((g) => g.toUpperCase() === tag);

export interface CounterCtx {
  sprintId: number | null;
  /** Statusy uznawane za zamkniete (CLOSED_STATUSES z bitrix.ts). */
  closed: ReadonlySet<string>;
  /** Zadania OCZEKUJE-NA-ODPOWIEDZ z odpowiedzia po naszych pytaniach; `null` = jeszcze liczymy. */
  answered: ReadonlySet<number> | null;
  /**
   * Fakty, które widać tylko w czacie zadania; `null` = jeszcze czytamy czaty. Czytamy je wyłącznie
   * dla zadań, którym do kompletu brakuje czegoś, co może tam być (patrz `needsChat`).
   */
  chat: ChatFacts | null;
  /** Zadania-FOLDERY: maja otwarte podzadanie (patrz `foldersOf`). Liczone z CALEJ listy zadan. */
  folders: ReadonlySet<number>;
}

/**
 * Co wiemy z czatów zadań DO-STARTU:
 *  - `recon` — oznaczone jako rozpoznanie albo analiza błędu (dopisek w wiadomości WYCENA); takie
 *    zadanie jest gotowe bez kategorii i bez okresu zwrotu, bo wartość liczymy dopiero przy właściwym
 *    zadaniu, które z niego powstanie,
 *  - `value` — zadania z wiadomością WARTOŚĆ (pierwsza linia np. „WARTOŚĆ: rdzeń", „WARTOŚĆ: zwrot …",
 *    „WARTOŚĆ: wymóg"). Dla puli RDZEN to jedyny ślad wartości, bo takie zadanie nie ma ani
 *    kategorii, ani tagu ZWROT.
 */
export interface ChatFacts {
  recon: ReadonlySet<number>;
  value: ReadonlySet<number>;
}

type CounterTask = Pick<
  Task,
  'id' | 'title' | 'status' | 'sprintId' | 'tags' | 'storyPoints' | 'epicId' | 'deadline' | 'priority'
>;

/**
 * Identyfikatory zadan, ktore sa FOLDERAMI: otwarte zadanie ma co najmniej jedno OTWARTE podzadanie.
 * „Otwarte" = niezamkniete (odlozone tez sie liczy — praca nadal wisi). Wymaga CALEJ listy, bo dziecko
 * moze lezec w innym sprincie niz rodzic.
 */
export function foldersOf(
  tasks: readonly Pick<Task, 'id' | 'parentId' | 'status'>[],
  closed: ReadonlySet<string>,
): Set<number> {
  const folders = new Set<number>();
  for (const t of tasks) if (t.parentId !== null && !closed.has(t.status)) folders.add(t.parentId);
  return folders;
}


export interface CounterDef {
  key: CounterKey;
  label: string;
  /** Po co ta karta — w dymku, zeby liczba nie wymagala znajomosci audytu. */
  hint: string;
  match: (t: CounterTask, ctx: CounterCtx) => boolean;
  /** Liczba zalezy od story pointow — dopoki nie doszly, jest niepewna. */
  needsMeta?: boolean;
  /** Liczba zalezy tez od rozpoznan (dopisek w wiadomosci WYCENA w czacie) — niepewna, dopoki czaty sie czytaja. */
  needsChatFacts?: boolean;
  /** Karta istnieje tylko w projekcie ze sprintami (scrum). */
  needsSprint?: boolean;
  /**
   * Poza suma „Poza sprintem" z innego powodu niz cecha: odlozone nie sa w ogole
   * liczone do rejestru. Kafelek stoi w grupie „Poza sumą", jako pierwszy.
   */
  note?: boolean;
  /** Cecha, nie stan: kafelek stoi w grupie „Poza sumą", poza rozbiciem „Poza sprintem". */
  separate?: boolean;
  /**
   * Cecha, ktora przecina OBA swiaty: liczy zadania i ze sprintu, i spoza niego (np. bledy). Nie
   * pasuje wiec ani do grupy „Sprint", ani do „Poza sumą" — stoi sama, bez podpisu, miedzy nimi.
   */
  standalone?: boolean;
  /** Stan, ktory wchodzi do SUMY „Poza sprintem" — kafelki z tym znacznikiem sumuja sie do niej. */
  inSum?: boolean;
  /** Wzrost to zla wiadomosc (wiecej roboty). Dla sprintu kierunek nic nie znaczy. */
  riseIsBad: boolean;
}

const isOpen = (t: CounterTask, ctx: CounterCtx) => !ctx.closed.has(t.status);
/**
 * Status „Odlozone" (6). Audyt odlozonych nie rusza — leza poza kolejka, dopoki ktos
 * ich swiadomie nie wznowi — wiec nie wchodza do „Poza sprintem" ani do zadnego stanu.
 */
export const DEFERRED_STATUS = '6';
/** Otwarte i nieodlozone — to, czym audyt sie zajmuje. */
const inAudit = (t: CounterTask, ctx: CounterCtx) => isOpen(t, ctx) && t.status !== DEFERRED_STATUS;
const inSprint = (t: CounterTask, ctx: CounterCtx) =>
  ctx.sprintId !== null && t.sprintId === ctx.sprintId;
/** Pomysl na zbyt wczesnym etapie (KONCEPCJA) — nie jest czescia rejestru do przerobienia. */
const isKoncept = (t: CounterTask) => hasTag(t, TAG_KONCEPCJA);
/** Folder: kontener na podzadania, a nie praca do przerobienia — patrz `foldersOf`. */
const isFolder = (t: CounterTask, ctx: CounterCtx) => ctx.folders.has(t.id);
/** Rejestr do przerobienia: otwarte, nieodlozone, spoza aktywnego sprintu, nie-koncepcje i nie-foldery. */
const outside = (t: CounterTask, ctx: CounterCtx) =>
  inAudit(t, ctx) && !inSprint(t, ctx) && !isKoncept(t) && !isFolder(t, ctx);

const isStartu = (t: CounterTask) => hasTag(t, TAG_DO_STARTU);
/** DO-STARTU ma pierwszenstwo — zadanie z dwoma tagami gotowosci liczy sie raz. */
const isCzeka = (t: CounterTask) => !isStartu(t) && hasTag(t, TAG_CZEKA);
const wasAnswered = (t: CounterTask, ctx: CounterCtx) => ctx.answered?.has(t.id) ?? false;

/** Ma tag kategorii korzyści (jeden z `TAGS_KATEGORIA`) — widać to z samej listy zadań. */
export const hasCategory = (t: Pick<CounterTask, 'tags'>): boolean =>
  TAGS_KATEGORIA.some((g) => hasTag(t, g));

/** Wymóg nie ma okresu zwrotu — ma termin. */
export const needsPayback = (t: Pick<CounterTask, 'tags'>): boolean => !hasTag(t, TAG_WYMOG);

/**
 * Komplet z SAMEJ listy zadań (bez czatu): pula, wycena i — dla CIAGLOSC i DZIAL — kategoria oraz
 * tag okresu zwrotu albo termin.
 *
 *  - bez puli: nigdy,
 *  - CIAGLOSC / DZIAL: kategoria + tag okresu zwrotu (ZWROT-3 / ZWROT-6 / ZWROT-12 / ZWROT-12+),
 *    który `wartosc.mjs` kopiuje z przedziału w wiadomości WARTOŚĆ; WYMOG ma zamiast zwrotu termin
 *    (pole „Termin" zadania) — wymóg nie ma rankingu, ma datę,
 *  - RDZEN: z tagów sam się nie kompletuje — wartość siedzi w wiadomości WARTOŚĆ w czacie
 *    (`ChatFacts.value`), kategoria i ZWROT nie są wymagane.
 */
export const isCompleteByTags = (t: CounterTask): boolean => {
  const p = pula(t);
  return (
    p !== null &&
    p !== 'RDZEN' &&
    t.storyPoints != null &&
    hasCategory(t) &&
    (needsPayback(t) ? paybackBand(t) !== null : t.deadline != null)
  );
};

/**
 * Rozpoznanie mieści się w 4 godzinach (`gotowe.mjs --rozpoznanie`). Poznajemy je po dopisku w
 * wiadomości WYCENA albo — jak w audycie — po tytule („rozpoznanie…", „weryfikacja…") przy wycenie do 4 h.
 */
export const RECON_MAX_HOURS = 4;
export const isReconByTitle = (t: Pick<CounterTask, 'title' | 'storyPoints' | 'tags'>): boolean =>
  pula(t) !== null &&
  t.storyPoints != null &&
  t.storyPoints <= RECON_MAX_HOURS &&
  /rozpoznani|weryfikacj/i.test(t.title);

/**
 * Zadanie, którego kompletność rozstrzyga czat: może być rozpoznaniem albo — z pulą RDZEN —
 * mieć wiadomość WARTOŚĆ. Bez puli czat niczego nie zmienia (zadanie i tak nie jest kompletne).
 */
export const needsChat = (t: CounterTask): boolean =>
  t.storyPoints != null &&
  pula(t) !== null &&
  !isReconByTitle(t) &&
  !isCompleteByTags(t) &&
  (t.storyPoints <= RECON_MAX_HOURS || pula(t) === 'RDZEN');

/**
 * Czy zadanie z DO-STARTU ma komplet: kompletne w tagach, rozpoznanie (po tytule albo z czatu) albo
 * RDZEN z wiadomością WARTOŚĆ — zawsze z pulą i wyceną. Dopóki czaty się czytają (`chat === null`), zadanie, które od nich zależy,
 * nie jest jeszcze ani kompletne, ani niekompletne — kafelki dostają wtedy znak „liczę" (`needsChatFacts`).
 */
const isComplete = (t: CounterTask, ctx: CounterCtx) =>
  isCompleteByTags(t) ||
  (pula(t) !== null &&
    t.storyPoints != null &&
    (isReconByTitle(t) ||
      (ctx.chat?.recon.has(t.id) ?? false) ||
      (pula(t) === 'RDZEN' && (ctx.chat?.value.has(t.id) ?? false))));

/*
 * Kolejnosc = kolejnosc pracy w audycie: skala rejestru, potem stany od „trzeba zapytac"
 * po „gotowe", na koncu sprint jako punkt odniesienia i notka o odlozonych.
 */
export const COUNTERS: CounterDef[] = [
  {
    key: 'poza',
    label: 'Poza sprintem',
    hint:
      'Otwarte zadania spoza aktywnego sprintu, bez odłożonych, KONCEPCJA i folderów — cały rejestr, niezależnie ' +
      'od widoku i filtrów. Kafelki obok rozbijają tę liczbę co do sztuki.',
    match: (t, ctx) => outside(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'wywiad',
    inSum: true,
    label: 'Do wywiadu',
    hint:
      'Poza sprintem: z tagiem DO-WYWIADU albo jeszcze bez tagu gotowości (nowe) — ' +
      'trzeba zadać pytania.',
    match: (t, ctx) => outside(t, ctx) && !isStartu(t) && !hasTag(t, TAG_CZEKA),
    riseIsBad: true,
  },
  {
    key: 'czeka',
    inSum: true,
    label: 'Czeka na odpowiedź',
    hint:
      'Poza sprintem, z tagiem OCZEKUJE-NA-ODPOWIEDZ, a po naszych pytaniach nikt spoza IT ' +
      'jeszcze nie odpisał — piłka po stronie zgłaszającego.',
    match: (t, ctx) => outside(t, ctx) && isCzeka(t) && !wasAnswered(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'odpowiedzi',
    inSum: true,
    label: 'Do analizy odpowiedzi',
    hint:
      'OCZEKUJE-NA-ODPOWIEDZ, a po naszych pytaniach ktoś spoza IT odpisał z treścią — ' +
      'daj DO-STARTU albo dopytaj.',
    match: (t, ctx) => outside(t, ctx) && isCzeka(t) && wasAnswered(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'wycena',
    inSum: true,
    label: 'Do wyceny',
    hint:
      'Poza sprintem, z tagiem DO-STARTU, ale bez kompletu. Pula obowiązkowa (CIAGLOSC / RDZEN / ' +
      'DZIAL). CIAGLOSC i DZIAL: kategoria i okres zwrotu (WYMOG: termin). RDZEN: wiadomość ' +
      'WARTOŚĆ z uzasadnieniem. Rozpoznanie: sama wycena do 4 h, z pulą.',
    match: (t, ctx) => outside(t, ctx) && isStartu(t) && !isComplete(t, ctx),
    needsMeta: true,
    needsChatFacts: true,
    riseIsBad: true,
  },
  {
    key: 'gotowe',
    inSum: true,
    label: 'Gotowe do startu',
    hint:
      'Poza sprintem, z tagiem DO-STARTU i kompletem. Pula obowiązkowa (CIAGLOSC / RDZEN / ' +
      'DZIAL). CIAGLOSC i DZIAL: kategoria i okres zwrotu (WYMOG: termin). RDZEN: wiadomość ' +
      'WARTOŚĆ z uzasadnieniem. Rozpoznanie: sama wycena do 4 h, z pulą — można je wziąć do sprintu.',
    match: (t, ctx) => outside(t, ctx) && isStartu(t) && isComplete(t, ctx),
    needsMeta: true,
    needsChatFacts: true,
    // Wiecej gotowych to dobra wiadomosc — nie kolorujemy wzrostu na bursztynowo.
    riseIsBad: false,
  },
  {
    key: 'sprint',
    label: 'W sprincie',
    hint: 'Wszystkie zadania aktywnego sprintu, także zakończone, i suma ich story pointów.',
    match: (t, ctx) => inSprint(t, ctx),
    needsSprint: true,
    riseIsBad: false,
  },
  {
    /*
     * Klucz `wazne`, nie dawny `bug`: kafelek liczy teraz tez plomienie, a historia dzienna jest
     * zapisywana po kluczu. Pod starym kluczem wczorajsza liczba (same tagi BUG) porownana z dzisiejsza
     * pokazalaby falszywy czerwony wzrost; pod nowym pierwszy dzien ma „—", a potem porownuje juz rowno.
     */
    key: 'wazne',
    label: 'Ważne',
    hint:
      'Otwarte zadania z płomieniem (wysoki priorytet w Bitriksie) albo z tagiem BUG, bez ' +
      'odłożonych — w sprincie i poza nim, każde liczone raz. To cecha, a nie stan: takie zadanie ' +
      'jest też w jednym ze stanów obok (poza KONCEPCJA i folderami, których stany nie liczą), więc kafelek nie ' +
      'wchodzi do sumy. Na listach mają czerwony płomień i/albo robaka w miejscu checkboxa.',
    match: (t, ctx) => inAudit(t, ctx) && isImportant(t),
    separate: true,
    standalone: true,
    riseIsBad: true,
  },
  {
    key: 'koncept',
    label: 'Koncept',
    hint:
      'Otwarte zadania z tagiem KONCEPCJA, bez odłożonych — w sprincie i ' +
      'poza nim. To pomysły na zbyt wczesnym etapie, więc poza sprintem NIE wchodzą do „Poza ' +
      'sprintem" ani do żadnego stanu (także „Do wywiadu") — ze stanów liczy je tylko ten kafelek.',
    match: (t, ctx) => inAudit(t, ctx) && isKoncept(t),
    separate: true,
    riseIsBad: false,
  },
  {
    key: 'foldery',
    label: 'Foldery',
    hint:
      'Zadania spoza sprintu, które mają otwarte podzadanie — to kontenery, praca siedzi w ' +
      'podzadaniach, więc nie wchodzą do „Poza sprintem" ani do żadnego stanu (także „Do wywiadu"), ' +
      'tak jak w kolejce audytu. Folder, którego wszystkie podzadania są zamknięte, wraca do rejestru.',
    match: (t, ctx) => inAudit(t, ctx) && !inSprint(t, ctx) && !isKoncept(t) && isFolder(t, ctx),
    separate: true,
    riseIsBad: false,
  },
  {
    key: 'odlozone',
    label: 'Odłożone',
    hint: 'Zadania odłożone (status „Odłożone”) spoza sprintu — nie wchodzą do sumy „Poza sprintem”.',
    match: (t, ctx) => isOpen(t, ctx) && t.status === DEFERRED_STATUS && !inSprint(t, ctx),
    note: true,
    riseIsBad: false,
  },
];

export const counterDef = (key: CounterKey): CounterDef =>
  COUNTERS.find((c) => c.key === key) as CounterDef;

export interface CounterValue {
  count: number;
  /** Suma story pointow — tylko dla sprintu; `null` gdy nic nie jest oszacowane. */
  points: number | null;
}

export function countAll(
  tasks: CounterTask[],
  ctx: CounterCtx,
  defs: CounterDef[] = COUNTERS,
): Record<CounterKey, CounterValue> {
  const out = {} as Record<CounterKey, CounterValue>;
  for (const d of defs) {
    let count = 0;
    let points = 0;
    let any = false;
    for (const t of tasks) {
      if (!d.match(t, ctx)) continue;
      count++;
      if (t.storyPoints != null) {
        points += t.storyPoints;
        any = true;
      }
    }
    out[d.key] = { count, points: d.key === 'sprint' && any ? points : null };
  }
  return out;
}

// ─── Odpowiedzi w czacie ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  /** 0 = wpis systemowy (zmiana etapu, statusu, odpowiedzialnego). */
  authorId: number;
  /** Surowy BBCode — kotwica rozpoznawana jest po „[B]1.". */
  text: string;
}

/**
 * Pierwszy wiersz pytania w komentarzu wywiadu: „[B]1. Naglowek[/B]" — tak pisze
 * je skill wywiad-zadania. Ten sam wzorzec co w skrypcie przegladu gotowosci.
 */
export const QUESTION = /^\s*\[B\]\s*\d{1,2}\./m;

export type AnswerState = 'answered' | 'waiting' | 'no-question';

/** Ile znakow tresci (bez wzmianek i znacznikow) wystarcza za odpowiedz bez numeracji. */
export const MIN_ANSWER_CHARS = 120;

/** Tresc wiadomosci bez wzmianek „[USER=1]Imie[/USER]" i znacznikow BBCode. */
export function plainBody(text: string): string {
  return text
    .replace(/\[USER=\d+\][\s\S]*?\[\/USER\]/gi, ' ')
    .replace(/\[\/?[A-Za-z]+(?:=[^\]]*)?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Przedział okresu zwrotu, od najlepszego do najgorszego. */
export type PaybackBand = 'do3' | '3-6' | '6-12' | 'ponad12';

/**
 * Przedziały i ich tagi na zadaniu. Liczba w tagu to GÓRNA granica przedziału; `ZWROT-12+` to
 * ponad 12 miesięcy albo „nie da się policzyć". Tag jest kopią przedziału z wiadomości WARTOŚĆ
 * i to z niego czytamy — bez wchodzenia w czat.
 */
export const PAYBACK_BANDS: { key: PaybackBand; label: string; tag: string }[] = [
  { key: 'do3', label: 'do 3 mies.', tag: 'ZWROT-3' },
  { key: '3-6', label: '3–6 mies.', tag: 'ZWROT-6' },
  { key: '6-12', label: '6–12 mies.', tag: 'ZWROT-12' },
  { key: 'ponad12', label: 'ponad 12 mies.', tag: 'ZWROT-12+' },
];

/**
 * Przedział okresu zwrotu z tagów zadania. Gdyby zadanie miało dwa tagi zwrotu (skrypt podmienia
 * stary, ale ręczna zmiana potrafi zostawić oba), liczy się NAJGORSZY — lepiej nie obiecać za dużo.
 */
export function paybackBand(t: Pick<Task, 'tags'>): PaybackBand | null {
  let worst = -1;
  for (const g of t.tags) {
    const i = PAYBACK_BANDS.findIndex((b) => b.tag === g.toUpperCase());
    if (i > worst) worst = i;
  }
  return worst < 0 ? null : PAYBACK_BANDS[worst].key;
}

/**
 * Miejsce zadania w sortowaniu „po zwrocie" — mniejsza liczba idzie wyżej.
 *
 *   0    WYMOG (ma termin, wchodzi poza rankingiem, więc na początku)
 *   1–4  przedział: do 3, 3–6, 6–12, ponad 12 miesięcy
 *   5    brak okresu zwrotu (jeszcze niepoliczony, albo RDZEN) — na końcu
 */
export function paybackRank(t: Pick<Task, 'tags'>): number {
  if (hasTag(t, TAG_WYMOG)) return 0;
  const band = paybackBand(t);
  return band ? 1 + PAYBACK_BANDS.findIndex((b) => b.key === band) : PAYBACK_BANDS.length + 1;
}

/**
 * Dopisek w wiadomości WYCENA przy rozpoznaniu i analizie błędu (`gotowe.mjs --rozpoznanie`):
 * „Rozpoznanie — bez okresu zwrotu". Starsze wyceny nie mają dopisku, tylko uzasadnienie zaczynające
 * się od „Rozpoznanie / Weryfikacja / Przegląd kodu / Sprawdzenie" — audyt czyta obie postaci, więc
 * my też. Po nich krok 9 audytu pomija zadanie, a binear uznaje je za komplet bez kategorii i zwrotu.
 */
export const RECON_MARKER =
  /rozpoznanie\s*[-–—]\s*bez okresu zwrotu|co obejmuje ta wycena\s*(?:rozpoznanie|weryfikacja|przegl[ąa]d kodu|sprawdzenie)/i;

/** Czy któraś z wiadomości (system pomijamy) oznacza zadanie jako rozpoznanie. */
export function hasReconMarker(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.authorId > 0 && RECON_MARKER.test(plainBody(m.text)));
}

/**
 * Wiadomość „WARTOŚĆ" w czacie zadania — początek wiadomości po zdjęciu znaczników, bez względu na
 * wielkość liter i polskie znaki: „WARTOŚĆ: rdzeń", „[B]Wartość[/B] …". Dla puli RDZEN to jedyny
 * ślad wartości, bo takie zadanie nie ma ani kategorii, ani tagu ZWROT.
 */
export const VALUE_MESSAGE = /^warto[śs][ćc](?=$|[\s:.,;\-–—])/i;

/** Czy któraś z wiadomości (system pomijamy) to wiadomość WARTOŚĆ. */
export function hasValueMessage(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.authorId > 0 && VALUE_MESSAGE.test(plainBody(m.text)));
}

/**
 * Czy wiadomosc ma tresc odpowiedzi, a nie jest samym ping-iem.
 *
 * „Jan i Anna, czy mozecie odpowiedziec?" oraz samo „Jan Kowalski" (ktos
 * oznaczony dalej) to wiadomosci osob spoza IT, ale nie odpowiadaja na zadne
 * pytanie — bez tego zadanie wygladaloby na takie, w ktorym pilka wrocila do nas.
 * Odpowiedzia jest wiadomosc z numerowanymi punktami („1.", „2)") albo majaca co
 * najmniej MIN_ANSWER_CHARS znakow wlasnej tresci. Krotkie jednozdaniowe „tak" przy
 * pojedynczym pytaniu tego progu nie przechodzi — swiadomy kompromis.
 */
export function isSubstantiveAnswer(text: string): boolean {
  const body = plainBody(text);
  if (/(?:^|\s)\d{1,2}[.)]\s*\S/.test(body)) return true;
  return body.length >= MIN_ANSWER_CHARS;
}

/**
 * Czy po NASZYCH ostatnich pytaniach ktos spoza IT faktycznie odpowiedzial.
 *
 * Kotwica = ostatnia wiadomosc osoby z IT w formacie pytan wywiadu. Kolejna runda
 * pytan przesuwa kotwice, wiec stare odpowiedzi nie udaja nowych. Odpowiedzia jest
 * pozniejsza wiadomosc osoby spoza IT, ktora ma tresc (patrz `isSubstantiveAnswer`).
 * Wpisy systemowe i same ping-i odpadaja.
 *
 * `messages` od najstarszej do najnowszej.
 */
export function answerState(messages: ChatMessage[], isIt: (authorId: number) => boolean): AnswerState {
  let anchor = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.authorId > 0 && isIt(m.authorId) && QUESTION.test(m.text)) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) return 'no-question';
  for (let i = anchor + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.authorId > 0 && !isIt(m.authorId) && isSubstantiveAnswer(m.text)) return 'answered';
  }
  return 'waiting';
}

// ─── Historia dzien po dniu ──────────────────────────────────────────────────

/** Stan licznikow jednego dnia. Klucz `sprintPoints` = suma SP sprintu. */
export type DaySnapshot = Partial<
  Record<CounterKey | 'sprintPoints' | `t:${string}` | `g:${string}` | `gs:${string}`, number>
>;
/** Dzien (RRRR-MM-DD, czas lokalny) → stan. */
export type CounterHistory = Record<string, DaySnapshot>;

export const HISTORY_DAYS = 90;

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Zapisuje dzisiejszy stan — ostatni odczyt dnia nadpisuje wczesniejsze, wiec
 * wpis dnia to stan „na koniec dnia" (albo na teraz, jesli dzien trwa). Klucze
 * z `snap` sa scalane, a nie podmieniane: karta, ktorej wartosc jeszcze sie liczy,
 * nie kasuje tego, co juz dzis zapisano.
 */
export function recordDay(
  history: CounterHistory,
  day: string,
  snap: DaySnapshot,
  keep = HISTORY_DAYS,
): CounterHistory {
  const next: CounterHistory = { ...history, [day]: { ...history[day], ...snap } };
  const days = Object.keys(next).sort();
  for (const old of days.slice(0, Math.max(0, days.length - keep))) delete next[old];
  return next;
}

/** Ostatni zapisany dzien PRZED `day` — punkt odniesienia dla strzalki. */
export function previousDay(
  history: CounterHistory,
  day: string,
): { day: string; snap: DaySnapshot } | null {
  const earlier = Object.keys(history).filter((d) => d < day).sort();
  const last = earlier.at(-1);
  return last ? { day: last, snap: history[last] } : null;
}

const STORAGE_KEY = 'binear.counters.v1';

export function loadHistory(groupId: number): CounterHistory {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const h = all?.[groupId];
    return h && typeof h === 'object' ? h : {};
  } catch {
    return {};
  }
}

export function saveHistory(groupId: number, history: CounterHistory): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
    all[groupId] = history;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* Brak miejsca albo zablokowany storage — licznik dziala dalej, bez strzalek. */
  }
}
