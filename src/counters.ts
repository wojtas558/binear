/*
 * Tagi procesu IT, gotowosc do startu i dzienna historia kafelkow.
 *
 * Wbudowane liczniki zastapily wlasne kafelki (zapisane widoki). Ich dawne zasady — rozbicie „Poza sprintem"
 * na Do wywiadu / Czeka / Do analizy odpowiedzi / Do wyceny / Gotowe, bez odlozonych, KONCEPCJA i folderow —
 * siedza teraz w filtrach domyslnego zestawu (`public/binear-kafelki-IT.json`). Tu zostaje to, czego filtr sam
 * nie wyrazi: gotowosc do startu (`readiness`, filtry „Gotowość" i „Brakuje"), fakty z czatow, odpowiedzi
 * zglaszajacych i historia dzien po dniu.
 *
 * Modul jest czysty (bez Reacta i bez zapytan), zeby dalo sie go przetestowac.
 */
import type { Task } from './bitrix';

export const TAG_DO_STARTU = 'DO-STARTU';
export const TAG_CZEKA = 'OCZEKUJE-NA-ODPOWIEDZ';
export const TAG_WYWIAD = 'DO-WYWIADU';
export const TAG_BUG = 'BUG';
/**
 * Pomysl, a nie zadanie do zrobienia — temat na etapie koncepcji (reguly zadan: tag KONCEPCJA).
 * Nie ma drugiego tagu o tym znaczeniu; `KONCEPT` nie istnieje ani w regulach, ani w Bitriksie.
 */
export const TAG_KONCEPCJA = 'KONCEPCJA';

/**
 * Zadanie przeszlo niedokonczone z poprzedniego sprintu. Tag nadaje audyt na podstawie historii zadania,
 * a binear wyroznia go na liscie (`carryOverCount` liczy, ile razy).
 */
export const TAG_PRZENIESIONE = 'PRZENIESIONE';

/** Bitrix nie rozroznia wielkosci liter w tagach — „do-startu" to ten sam tag. */
export const hasTag = (t: Pick<Task, 'tags'>, tag: string): boolean =>
  t.tags.some((g) => g.toUpperCase() === tag);

/**
 * Wartosc zadania z NAJNOWSZEJ wiadomosci WARTOŚĆ w czacie (patrz `latestValue`):
 *  - `kwota` — „WARTOŚĆ: oszczędność 1 000 zł / mies."; `wyliczenie` to linia „Wyliczenie: …", jesli jest,
 *  - `bez-kwoty` — samo uzasadnienie, kwoty nie da sie podac,
 *  - `wymog` — prawo, umowa albo kontrahent; wchodzi wedlug terminu,
 *  - `zwrot` — starsza wiadomosc z okresem zwrotu; nadal liczy sie jako wartosc, tylko bez kwoty,
 *  - `inna` — kazda inna wiadomosc zaczynajaca sie od „WARTOŚĆ" (dawne warianty) — tez wartosc, bez kwoty.
 */
export type TaskValue =
  | { kind: 'kwota'; zl: number; wyliczenie: string | null }
  | { kind: 'bez-kwoty' | 'wymog' | 'zwrot' | 'inna'; wyliczenie?: undefined };

/**
 * Co wiemy z czatow zadan:
 *  - `recon` — dopisek rozpoznania w wiadomosci WYCENA (rozpoznanie albo analiza bledu do 4 h),
 *  - `value` — najnowsza wiadomosc WARTOŚĆ zadania (brak wpisu = brak takiej wiadomosci),
 *  - `read` — zadania, ktorych czat udalo sie przeczytac. Reszta jest NIEZNANA — readiness() oddaje dla
 *    nich `null` zamiast zgadywac „brak wartosci".
 */
export interface ChatFacts {
  recon: ReadonlySet<number>;
  value: ReadonlyMap<number, TaskValue>;
  read: ReadonlySet<number>;
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

/**
 * Status „Odlozone" (6). Audyt odlozonych nie rusza — leza poza kolejka, dopoki ktos
 * ich swiadomie nie wznowi — wiec nie wchodza do „Poza sprintem" ani do zadnego stanu.
 */
export const DEFERRED_STATUS = '6';

/**
 * Rozpoznanie miesci sie w 4 godzinach (`gotowe.mjs --rozpoznanie`). Poznajemy je po dopisku w
 * wiadomosci WYCENA albo — jak w kolejce audytu — po tytule („rozpoznanie…", „weryfikacja…") przy wycenie do 4 h.
 */
export const RECON_MAX_HOURS = 4;
export const isReconByTitle = (t: Pick<CounterTask, 'title' | 'storyPoints'>): boolean =>
  t.storyPoints != null && t.storyPoints <= RECON_MAX_HOURS && /rozpoznani|weryfikacj/i.test(t.title);

/**
 * Komplet z SAMEJ listy zadan (bez czatu): wycena i termin w polu „Termin" albo rozpoznanie po tytule.
 * Pozostale zadania kompletuje dopiero czat (wiadomosc WARTOŚĆ albo dopisek rozpoznania w WYCENA).
 */
export const isCompleteByTask = (t: Pick<CounterTask, 'title' | 'storyPoints' | 'deadline'>): boolean =>
  t.storyPoints != null && (t.deadline != null || isReconByTitle(t));

/** Zadanie, ktorego kompletnosc rozstrzyga czat: ma wycene, ale nie jest kompletne z samej listy. */
export const needsChat = (t: Pick<CounterTask, 'title' | 'storyPoints' | 'deadline'>): boolean =>
  t.storyPoints != null && !isCompleteByTask(t);

/** Czego brakuje zadaniu do kompletu — do filtra „Brakuje" (patrz `readiness`). */
export type Missing = 'sp' | 'wartosc';

export const MISSING_LABEL: Record<Missing, string> = {
  sp: 'Story points',
  wartosc: 'Wartość (WARTOŚĆ, termin albo rozpoznanie)',
};

/**
 * Gotowosc zadania do startu — ta sama definicja kompletu co kolejka audytu (krok 2):
 * wycena (story points) + wartosc, czyli dowolna wiadomosc WARTOŚĆ, termin w polu „Termin" albo
 * rozpoznanie do 4 h (tytul albo dopisek w wiadomosci WYCENA). Litera A–D do kompletu nie nalezy.
 *
 * `ready: null` = rozstrzyga czat, a ten nie zostal jeszcze przeczytany — zadanie nie jest ani gotowe, ani
 * niegotowe, a `missing` podaje to, czego brakuje na pewno.
 */
export function readiness(t: CounterTask, chat: ChatFacts | null): { ready: boolean | null; missing: Missing[] } {
  const missing: Missing[] = [];
  if (t.storyPoints == null) missing.push('sp');
  if (t.deadline != null || isReconByTitle(t)) return { ready: missing.length === 0, missing };

  const known = chat?.read.has(t.id) ?? false;
  if (!known) return { ready: missing.length ? false : null, missing };
  const recon = (chat?.recon.has(t.id) ?? false) && t.storyPoints != null && t.storyPoints <= RECON_MAX_HOURS;
  if (!recon && !(chat?.value.has(t.id) ?? false)) missing.push('wartosc');
  return { ready: missing.length === 0, missing };
}


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

/**
 * Dopisek w wiadomości WYCENA przy rozpoznaniu i analizie błędu (`gotowe.mjs --rozpoznanie`):
 * „Rozpoznanie — bez okresu zwrotu". Starsze wyceny nie mają dopisku, tylko uzasadnienie zaczynające
 * się od „Rozpoznanie / Weryfikacja / Przegląd kodu / Sprawdzenie" — audyt czyta obie postaci, więc
 * my też. Po nich krok 9 audytu pomija zadanie, a binear uznaje je za komplet (do 4 h) bez wiadomosci WARTOŚĆ.
 */
export const RECON_MARKER =
  /rozpoznanie\s*[-–—]\s*bez okresu zwrotu|co obejmuje ta wycena\s*(?:rozpoznanie|weryfikacja|przegl[ąa]d kodu|sprawdzenie)/i;

/** Czy któraś z wiadomości (system pomijamy) oznacza zadanie jako rozpoznanie. */
export function hasReconMarker(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.authorId > 0 && RECON_MARKER.test(plainBody(m.text)));
}

/**
 * Wiadomosc „WARTOŚĆ" w czacie zadania — poczatek wiadomosci po zdjeciu znacznikow, bez wzgledu na
 * wielkosc liter i polskie znaki. Ta sama regula co w kolejce audytu.
 */
export const VALUE_MESSAGE = /^warto[śs][ćc](?=$|[\s:.,;\-–—])/i;

/** Pierwsza linia z kwota: „WARTOŚĆ: oszczędność 1 000 zł / mies." (spacja albo twarda spacja dzieli tysiace). */
const SAVINGS_LINE = /^warto[śs][ćc]\s*:?\s*oszcz[ęe]dno[śs][ćc]\s+(\d[\d   ]*(?:[.,]\d+)?)\s*z[łl]/i;

/** Kwota zapisana po polsku: „1 000", „1 000,50", „840" → liczba. */
export function parseAmount(s: string): number {
  return Number(s.replace(/[\s  ]/g, '').replace(',', '.'));
}

/** Tresc bez wzmianek i znacznikow BBCode, ale z podzialem na linie. */
function plainLines(text: string): string[] {
  return text
    .replace(/\[USER=\d+\][\s\S]*?\[\/USER\]/gi, ' ')
    .replace(/\[\/?[A-Za-z]+(?:=[^\]]*)?\]/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
}

/** Jedna wiadomosc → wartosc zadania; `null`, gdy to nie jest wiadomosc WARTOŚĆ. */
export function parseValueMessage(text: string): TaskValue | null {
  if (!VALUE_MESSAGE.test(plainBody(text))) return null;
  const lines = plainLines(text);
  const first = lines[0] ?? '';
  const amount = first.match(SAVINGS_LINE);
  if (amount) {
    const zl = parseAmount(amount[1]);
    if (Number.isFinite(zl)) {
      const calc = lines.find((l) => /^wyliczenie\s*:/i.test(l));
      return { kind: 'kwota', zl, wyliczenie: calc ? calc.replace(/^wyliczenie\s*:\s*/i, '') : null };
    }
  }
  const rest = first.replace(/^warto[śs][ćc]\s*[:\-–—]?\s*/i, '');
  if (/^bez kwoty/i.test(rest)) return { kind: 'bez-kwoty' };
  if (/^wym[óo]g/i.test(rest)) return { kind: 'wymog' };
  if (/^zwrot/i.test(rest)) return { kind: 'zwrot' };
  return { kind: 'inna' };
}

/** Najnowsza wiadomosc WARTOŚĆ (wpisy systemowe pomijamy) — liczy sie tylko ona. `null`, gdy zadnej nie ma. */
export function latestValue(messages: ChatMessage[]): TaskValue | null {
  let best: { id: number; v: TaskValue } | null = null;
  for (const m of messages) {
    if (m.authorId <= 0) continue;
    const v = parseValueMessage(m.text);
    if (v && (!best || m.id > best.id)) best = { id: m.id, v };
  }
  return best?.v ?? null;
}

/** Oszczednosc w zl / mies. z wartosci zadania albo `null` (bez kwoty, brak wiadomosci). */
export const savingsOf = (v: TaskValue | null | undefined): number | null => (v?.kind === 'kwota' ? v.zl : null);


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
/** Wartosci dnia: kafelki (`t:<id>`), sumy grup (`g:`/`gs:`); starsze klucze dawnych licznikow zostaja w zapisie. */
export type DaySnapshot = Partial<Record<string, number>>;
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

/** Kwota po polsku: „1 200 zł", „1 050,5 zł". */
export const formatZl = (zl: number): string => `${zl.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`;

/** Krotki opis wartosci zadania do panelu szczegolow. */
export function valueLabel(v: TaskValue): string {
  switch (v.kind) {
    case 'kwota':
      return `oszczędność ${formatZl(v.zl)} / mies.`;
    case 'bez-kwoty':
      return 'bez kwoty (uzasadnienie w czacie)';
    case 'wymog':
      return 'wymóg (według terminu)';
    case 'zwrot':
      return 'dawny okres zwrotu, bez kwoty';
    default:
      return 'jest, bez kwoty';
  }
}
