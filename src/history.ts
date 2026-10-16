/*
 * Dziennik akcji binear — co ta aplikacja ZAPISALA do Bitriksa.
 *
 * Po co: zmiany ida do wspolnego portalu, na ktorym pracuje caly zespol, a
 * czesc z nich odpala jeszcze automatyzacje po stronie Bitriksa. Gdy pozniej
 * cos jest nie tak, pierwsze pytanie brzmi "czy to ja to zrobilem, i kiedy".
 * Dziennik Bitriksa odpowiada na to tylko czesciowo: nie wie, ktore zmiany
 * poszly stad, a przy nieudanym wywolaniu nie ma po sobie zadnego sladu.
 *
 * Zakres: WYLACZNIE zapisy. Odczytow nie logujemy — jest ich tysiace i
 * niczego nie zmieniaja.
 *
 * Zapisujemy tez PROBY NIEUDANE. To zwykle one sa powodem, dla ktorego ktos w
 * ogole otwiera dziennik.
 */

/**
 * Jak daleko wstecz siega dziennik. To jest REGULA WLASCIWA: pytanie „czy to ja
 * i kiedy" zawsze dotyczy ostatnich dni, a nie setnego wpisu wstecz. Przy limicie
 * liczonym w sztukach jeden pracowity dzien wymiatal caly poprzedni tydzien.
 */
import { emojiOf } from './reactions';

export const HISTORY_DAYS = 7;

/**
 * Bezpiecznik, nie regula. Jedna operacja zbiorcza na dwustu zadaniach potrafi w
 * minute dopisac dwiescie wpisow, a `localStorage` ma okolo 5 MB na origin — po
 * przekroczeniu zapis przepada po cichu i dziennik przestaje dzialac dokladnie
 * wtedy, gdy dzieje sie najwiecej. Przy tym pulapie zajmujemy okolo megabajta.
 */
export const HISTORY_LIMIT = 2000;

const KEY = 'binear.history.v1';

export interface HistoryEntry {
  /** Znacznik czasu w milisekundach — sortowanie i grupowanie po dniach. */
  at: number;
  /** Metoda REST, np. `tasks.task.update`. Zostaje surowa: to jedyny pewny slad. */
  method: string;
  /** Zadanie, ktorego dotyczyla akcja — o ile dalo sie je wyczytac z parametrow. */
  taskId: number | null;
  /** Czytelny opis, np. „etap → 4681”. Skladany przy zapisie, nie przy wyswietlaniu. */
  label: string;
  /** Komunikat bledu, gdy wywolanie sie nie powiodlo. `null` = poszlo. */
  error: string | null;
  /**
   * Odchudzone parametry wywolania — po to, zeby przy WYSWIETLANIU dalo sie
   * zamienic identyfikatory na nazwy („etap → 4681" na „etap → W toku").
   *
   * Nazw nie da sie wpisac przy zapisie: `logAction` wola `bitrix.ts`, ktory nie
   * ma dostepu do stanu aplikacji ani do slownikow etapow i osob. A gdy pozniej
   * ktos skasuje etap albo odejdzie z firmy, `label` i tak zostaje — dlatego
   * jest zapisany na stale, a to tutaj sluzy wylacznie do jego wzbogacenia.
   */
  params?: Record<string, unknown>;
  /**
   * MIGAWKA tozsamosci zadania z chwili akcji: kod („IT-899") i tytul.
   *
   * Zapisane W WPISIE, a nie dociagane z listy zadan po `taskId`. Dziennik ma
   * dzialac wtedy, kiedy jest potrzebny — a potrzebny jest wlasnie po tym, jak
   * zadanie zniknelo: skasowane, przeniesione do innego projektu albo chwilowo
   * wypadniete z `tasks.task.list`, ktore po zapisie potrafi nie widziec zadania
   * przez kilka minut. Wiazanie po id dawalo wtedy goly „#116459" zamiast nazwy,
   * czyli gubilo tresc dokladnie w tych wpisach, po ktore ktos tu przychodzi.
   */
  code?: string | null;
  title?: string;
  /**
   * Wartosci SPRZED zapisu, po polach REST — zeby wpis mowil „z czego na co",
   * a nie tylko „na co". Bez tego „etap → W toku" nie odpowiada na pytanie,
   * ktore sie tu zadaje: czy to ja cos zepsulem i co tam bylo wczesniej.
   */
  before?: Record<string, unknown>;
  /**
   * `bitrix` = zmiana, ktorej binear NIE zrobil — zauwazona przy odswiezeniu,
   * bo przychodzace dane rozjechaly sie z tym, co mielismy. Brak pola znaczy
   * „nasz zapis", czyli domyslna i najczestsza tresc dziennika.
   */
  source?: 'bitrix';
  /** Kto zmienil — tylko przy `source: 'bitrix'` i tylko gdy udalo sie ustalic. */
  by?: string;
}

/*
 * Ktora wlasciwosc zadania odpowiada ktoremu polu REST.
 *
 * Stoi TUTAJ, obok `describe`, bo to ta sama wiedza: jedno miejsce wie, ze
 * `STAGE_ID` to etap. Gdyby tabela mieszkala przy `mutate`, slownik pol zylby
 * w dwoch plikach i rozjechalby sie przy pierwszej zmianie.
 */
/**
 * Pola, ktore zapis zmienia — w nazwach REST, niezaleznie od metody.
 *
 * `task.stages.movetask` nie ma `fields`: niesie gole `stageId`. Bez tej
 * normalizacji dziennik nie znalby dla niego wartosci „przed" i pokazywal samo
 * „etap → X", a skladanie wejscia do sprintu nie rozpoznawaloby tego kroku.
 */
export function fieldsOf(method: string, params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  if (method === 'task.stages.movetask') return { STAGE_ID: params.stageId };
  return (params.fields ?? {}) as Record<string, unknown>;
}

const PREV_OF: Record<string, string> = {
  STAGE_ID: 'stageId',
  RESPONSIBLE_ID: 'responsibleId',
  STATUS: 'status',
  PRIORITY: 'priority',
  DEADLINE: 'deadline',
  TITLE: 'title',
  TAGS: 'tags',
  entityId: 'sprintId',
  storyPoints: 'storyPoints',
  epicId: 'epicId',
};

/**
 * Pola, ktorych zmiane U INNYCH warto odnotowac — i ich nazwa po stronie REST.
 *
 * Celowo waski zbior. `changedDate` czy licznik komentarzy rusza sie bez przerwy
 * i zalalby dziennik szumem; tu chodzi o rzeczy, przez ktore zadanie zmienia
 * ZNACZENIE: kto je robi, na jakim jest etapie, do kiedy i w ktorym sprincie.
 */
const WATCHED: Record<string, string> = {
  stageId: 'STAGE_ID',
  responsibleId: 'RESPONSIBLE_ID',
  status: 'STATUS',
  priority: 'PRIORITY',
  deadline: 'DEADLINE',
  title: 'TITLE',
  sprintId: 'entityId',
};

/*
 * Rejestr WLASNYCH zapisow — wylacznie do odsiewania ich z „zmian z zewnatrz".
 *
 * Pinezka (`applyPins`) zyje 5 minut i broni EKRANU przed cofnieciem przez
 * przeterminowana liste. Tu chodzi o co innego i dlatego nie da sie tego oprzec
 * na czasie: `tasks.task.list` nadgania MINUTAMI po zapisie, a wejscie do sprintu
 * jest kolejkowane (do minuty na zadanie), wiec przy wrzuceniu kilkunastu zadan
 * naraz wlasna zmiana wraca dlugo po wygasnieciu pinezki. Dziennik oglaszal ja
 * wtedy jako CUDZA — czyli dokladnie odwrotnie, niz bylo.
 *
 * Dopasowujemy po WARTOSCI: jesli przyszlo dokladnie to, co sami zapisalismy, to
 * nasze — nizaleznie od tego, ile portal to trawil. Wpis KONSUMUJEMY, wiec
 * pozniejsza, prawdziwie cudza zmiana na te sama wartosc zostanie zauwazona.
 */
const MINE_TTL_MS = 60 * 60_000;
const mineWrites = new Map<string, { at: number; value: unknown }>();

const mineKey = (taskId: number, prop: string) => `${taskId}|${prop}`;

/** Woalne przez `mutate` tuz przed zapisem — patchem w ksztalcie `Task`. */
export function noteMine(taskId: number, patch: Record<string, unknown>): void {
  const now = Date.now();
  for (const [k, v] of mineWrites) if (now - v.at > MINE_TTL_MS) mineWrites.delete(k);
  for (const [prop, value] of Object.entries(patch)) {
    mineWrites.set(mineKey(taskId, prop), { at: now, value });
  }
}

/** Czy ta wartosc to nasz wlasny zapis, ktory wlasnie wrocil. Dopasowanie ZUZYWA wpis. */
function wasMine(taskId: number, prop: string, value: unknown): boolean {
  const key = mineKey(taskId, prop);
  const hit = mineWrites.get(key);
  if (!hit || Date.now() - hit.at > MINE_TTL_MS) return false;
  /* Luzne porownanie: lista oddaje `status`/`priority` jako napisy, a piszemy liczby. */
  if (String(hit.value) !== String(value)) return false;
  mineWrites.delete(key);
  return true;
}

/** Jedna zauwazona zmiana z zewnatrz, w ksztalcie, ktory rozumie `describe`. */
export interface Incoming {
  taskId: number;
  fields: Record<string, unknown>;
  before: Record<string, unknown>;
}

/**
 * Porownuje to, co MIELISMY, z tym, co WLASNIE PRZYSZLO, i zwraca zmiany, ktorych
 * nie zrobilismy sami.
 *
 * Trzy rzeczy sa tu wazne:
 *  - zadania NOWE i ZNIKNIETE pomijamy — to nie sa zmiany pola, a dziennik ma
 *    mowic o zmianach;
 *  - pole z PINEZKA pomijamy, bo pinezka znaczy „to nasz wlasny, swiezy zapis,
 *    ktorego lista jeszcze nie potwierdza" — bez tego kazdy nasz zapis wracalby
 *    do dziennika drugi raz, udajac cudzy;
 *  - porownujemy po wartosci, nie po tozsamosci, bo `tags` to tablica.
 */
export function diffTasks(
  prev: Map<number, Record<string, unknown>>,
  next: Record<string, unknown>[],
  isPinned: (taskId: number, prop: string) => boolean,
): Incoming[] {
  const out: Incoming[] = [];
  for (const t of next) {
    const id = Number(t.id);
    const was = prev.get(id);
    if (!was) continue;

    let fields: Record<string, unknown> | undefined;
    let before: Record<string, unknown> | undefined;
    for (const [prop, rest] of Object.entries(WATCHED)) {
      if (isPinned(id, prop)) continue;
      const a = was[prop];
      const b = t[prop];
      if (a === b || (a == null && b == null)) continue;
      /*
       * `undefined` po stronie „przed" znaczy, ze punkt odniesienia w ogole nie
       * mial tego pola — czyli MY o nim nie wiedzielismy. Pojawienie sie wiedzy
       * to nie jest zmiana, ktora ktos zrobil, a dziennik ma mowic o zmianach.
       */
      if (a === undefined) continue;
      if (wasMine(id, prop, b)) continue;
      (fields ??= {})[rest] = b;
      (before ??= {})[rest] = a;
    }
    if (fields && before) out.push({ taskId: id, fields, before });
  }
  return out;
}

/*
 * Stan zadania sprzed zapisu, zlozony przez `mutate` tuz PRZED optymistyczna
 * zmiana. Krotkotrwaly: po `PREV_TTL_MS` uznajemy go za nieaktualny, zeby nie
 * doklejal sie do pozniejszego, niezwiazanego zapisu.
 */
const PREV_TTL_MS = 30_000;
const prevState = new Map<number, { at: number; task: Record<string, unknown> }>();

/*
 * Co binear wie o nazwach zadan W TEJ CHWILI. Wypelnia to warstwa widoku
 * (`setTaskNames`), bo `bitrix.ts` — gdzie powstaje wpis — nie ma dostepu do
 * stanu aplikacji. To jedyne miejsce, w ktorym dziennik zaglada na zewnatrz, i
 * robi to RAZ, przy zapisie: dalej wpis zyje wlasnym zyciem.
 */
let taskNames = new Map<number, { code: string | null; title: string }>();

/*
 * Nasluchujacy (panel dziennika). Trzymamy ich w module, bo wpis powstaje w
 * `bitrix.ts` — daleko od Reacta — a panel ma sie odswiezyc od razu, bez
 * odpytywania w petli.
 */
const listeners = new Set<() => void>();

/** Zwraca funkcje odpinajaca — do sprzatania w `useEffect`. */
export function onHistoryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Odczyt calego dziennika, od najnowszego.
 *
 * Kazdy blad (tryb prywatny, uszkodzony wpis, inny ksztalt po aktualizacji)
 * konczy sie pusta lista. Dziennik jest wygoda, nie danymi — nie ma prawa
 * wywalic aplikacji.
 */
/**
 * Wyrzuca ECHA wlasnych wejsc do sprintu — wpisy „z zewnatrz", ktore opisuja
 * zmiane, ktora sami zrobilismy chwile wczesniej.
 *
 * Kasujemy TYLKO te, ktore da sie udowodnic: obok musi lezec nasz wlasny
 * `kanban.addTask` dla TEGO SAMEGO zadania i w tym samym oknie czasu. Echo bez
 * takiego dowodu zostaje — brak dowodu, ze cos bylo nasze, nie jest dowodem, ze
 * bylo (a audyt, ktory po cichu kasuje cudze zmiany, jest gorszy niz halasliwy).
 *
 * Nowe echa juz nie powstaja (patrz `noteMine`); to sprzatanie po tym, co zdazylo
 * sie zapisac wczesniej.
 */
function dropEchoes(items: HistoryEntry[]): HistoryEntry[] {
  const ours = items.filter(
    (e) => e.method === 'tasks.api.scrum.kanban.addTask' && !e.error && e.taskId !== null,
  );
  if (!ours.length) return items;

  return items.filter(
    (e) =>
      !sprintEcho(e) ||
      !ours.some((o) => o.taskId === e.taskId && Math.abs(e.at - o.at) <= ECHO_WINDOW_MS),
  );
}

export function readHistory(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const since = Date.now() - HISTORY_DAYS * 86_400_000;
    const kept = raw.filter(
      (e): e is HistoryEntry =>
        Boolean(e) &&
        typeof e.at === 'number' &&
        typeof e.method === 'string' &&
        /*
         * Okno liczymy takze PRZY ODCZYCIE, nie tylko przy zapisie. Przyciecie
         * dzieje sie w `logAction`, wiec po kilku dniach bez zadnego zapisu w
         * pamieci lezalyby wpisy sprzed tygodnia — a naglowek obiecuje „ostatnie
         * HISTORY_DAYS dni". Lepiej, zeby obietnica byla prawdziwa niezaleznie od
         * tego, kiedy ktos ostatnio cos zapisal.
         */
        e.at >= since,
    );

    /*
     * Odsiewamy przy ODCZYCIE i NIE zapisujemy z powrotem.
     *
     * Pierwsza wersja nadpisywala pamiec, zeby sprzatanie zdarzylo sie raz — ale
     * `readHistory` wolaja wszystkie otwarte karty, wiec zapis jedej z nich
     * potrafi skasowac wpis, ktory druga wlasnie dopisala. Dziennik jest zapisem
     * tego, co zrobilismy; funkcja, ktora go CZYTA, nie ma prawa go skrocic.
     *
     * Kosztem jest kilka niewidocznych wpisow lezacych w pamieci. Nowe i tak juz
     * nie powstaja (patrz `noteMine`), a stare wygasna razem z oknem 7 dni.
     */
    return dropEchoes(kept);
  } catch {
    return [];
  }
}

/**
 * Podaje dziennikowi aktualne nazwy zadan — i UZUPELNIA nimi wpisy, ktore ich
 * jeszcze nie mialy.
 *
 * Uzupelnienie jest potrzebne, bo numer IT-NNN nadaje automatyzacja Bitriksa
 * DOPIERO po naszym zapisie: w chwili logowania wejscia do sprintu zadanie
 * numeru jeszcze nie ma. Pierwsze odswiezenie po tej akcji przynosi nazwe i
 * wtedy wpis ja dostaje — raz, na stale. Pozniejsze zmiany tytulu juz nim nie
 * ruszaja, bo wpis ma pokazywac stan z chwili akcji.
 */
export function setTaskNames(names: Map<number, { code: string | null; title: string }>): void {
  taskNames = names;

  const items = readHistory();
  let touched = false;
  for (const e of items) {
    if (e.taskId === null || e.title) continue;
    const known = names.get(e.taskId);
    if (!known) continue;
    e.code = known.code;
    e.title = known.title;
    touched = true;
  }
  if (!touched) return;
  save(items);
  listeners.forEach((fn) => fn());
}

/** Co zostaje: z ostatniego tygodnia i nie wiecej niz `HISTORY_LIMIT`. */
function trim(items: HistoryEntry[]): HistoryEntry[] {
  const since = Date.now() - HISTORY_DAYS * 86_400_000;
  return items.filter((e) => e.at >= since).slice(0, HISTORY_LIMIT);
}

/**
 * Zapis z ostatnia deska ratunku.
 *
 * Gdy `localStorage` odmawia (najczesciej brak miejsca), nie poddajemy sie po
 * cichu — tniemy dziennik do polowy i probujemy raz jeszcze. Lepiej stracic
 * najstarsze wpisy niz wszystkie nowe.
 */
function save(items: HistoryEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    return true;
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(items.slice(0, Math.floor(items.length / 2))));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Zapamietuje stan zadania SPRZED zapisu. Wola to `mutate`, zanim nalozy zmiane
 * optymistycznie — pozniej `data.tasks` niesie juz nowa wartosc i starej nie ma
 * skad wziac.
 */
export function notePrevious(taskId: number, task: Record<string, unknown>): void {
  prevState.set(taskId, { at: Date.now(), task });
}

/**
 * Dopisuje autora do wpisow o zmianach z zewnatrz — raz, na stale.
 *
 * Wolane przez panel dziennika, a nie przez odswiezanie: nazwisko wymaga jednego
 * wywolania NA ZADANIE, wiec dociaganie go w tle przy kazdej zmianie to prosta
 * droga do wyczerpania limitu webhooka. Kto patrzy, ten placi.
 */
export function noteAuthor(taskId: number, by: string): void {
  const items = readHistory();
  let touched = false;
  for (const e of items) {
    if (e.source !== 'bitrix' || e.taskId !== taskId || e.by) continue;
    e.by = by;
    touched = true;
  }
  if (!touched) return;
  save(items);
  listeners.forEach((fn) => fn());
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // trudno; i tak zaraz powiadomimy panel
  }
  listeners.forEach((fn) => fn());
}

/**
 * Dopisuje wpis na poczatek i ucina ogon do `HISTORY_LIMIT`.
 *
 * Bufor jest pierscieniowy przez zwykle `slice`: przy stu wpisach to setki
 * bajtow i kilka mikrosekund, a kod zostaje taki, ze widac z niego wszystko.
 */
export function logAction(entry: HistoryEntry): void {
  const prev = readHistory();

  /*
   * Tozsamosc zadania wchodzi do wpisu TERAZ — potem moze juz jej nie byc.
   *
   * Gdy rejestr jej nie zna, pytamy WLASNY dziennik: wczesniejszy wpis o tym
   * samym zadaniu zna nazwe, bo powstal, kiedy zadanie jeszcze bylo. Bez tego
   * najwazniejszy wpis w calym dzienniku — usuniecie — zapisywal sie bez nazwy:
   * `removeTask` zdejmuje zadanie z listy OPTYMISTYCZNIE, jeszcze przed
   * wywolaniem REST, wiec w chwili logowania rejestr byl juz pusty.
   */
  let known = entry.taskId !== null ? taskNames.get(entry.taskId) : undefined;
  if (!known && entry.taskId !== null) {
    const earlier = prev.find((e) => e.taskId === entry.taskId && e.title);
    if (earlier) known = { code: earlier.code ?? null, title: earlier.title as string };
  }

  /*
   * Wartosci sprzed zapisu — tylko dla pol, ktore ten zapis naprawde rusza, i
   * tylko ze swiezej migawki. Po uzyciu podmieniamy ja na wartosci wlasnie
   * zapisane, zeby kolejny zapis tego samego pola pokazal wlasciwe „z czego"
   * (wejscie do sprintu zmienia etap dwa razy pod rzad).
   */
  let before: Record<string, unknown> | undefined;
  /*
   * Migawka z `mutate` dotyczy WYLACZNIE naszych zapisow. Wpis o zmianie z
   * zewnatrz przynosi wlasne `before` (z porownania danych) — gdybysmy tu
   * wyliczyli swoje, nadpisaloby prawdziwe wartosci stanem sprzed naszego
   * ostatniego zapisu, a przy okazji przestawiloby migawke na cudze wartosci.
   */
  const snap =
    entry.before || entry.taskId === null ? undefined : prevState.get(entry.taskId);
  if (snap && Date.now() - snap.at <= PREV_TTL_MS) {
    const fields = fieldsOf(entry.method, entry.params);
    for (const k of Object.keys(fields)) {
      const prop = PREV_OF[k];
      if (!prop || !(prop in snap.task)) continue;
      (before ??= {})[k] = snap.task[prop];
      snap.task[prop] = fields[k];
    }
  }

  const full: HistoryEntry = {
    ...entry,
    ...(known ? { code: known.code, title: known.title } : {}),
    ...(before ? { before } : {}),
  };
  save(trim([full, ...prev]));
  listeners.forEach((fn) => fn());
}

/*
 * Metody, ktore COS ZMIENIAJA. Lista jest jawna, a nie zgadywana z nazwy:
 * `tasks.api.scrum.task.update` zmienia, `tasks.api.scrum.task.get` nie, a
 * roznica to trzy znaki na koncu. Zgadywanie po „update" w nazwie przegapiloby
 * `task.stages.movetask` i `task.checklistitem.complete`.
 */
export const WRITE_METHODS = new Set([
  'tasks.task.update',
  'tasks.task.delete',
  'tasks.api.scrum.task.update',
  'tasks.api.scrum.kanban.addTask',
  'task.stages.movetask',
  'task.item.update',
  'task.commentitem.add',
  'task.commentitem.update',
  'im.v2.Chat.Message.update',
  'task.commentitem.delete',
  'im.v2.Chat.Message.delete',
  'im.v2.Chat.Message.Reaction.add',
  'im.v2.Chat.Message.Reaction.delete',
  /* Zalaczniki komentarza — patrz `addCommentWithFiles`. Musza byc TUTAJ, a nie
     tylko na allregule proxy: `call` kieruje wszystko spoza tej listy do
     laczenia odczytow, wiec zapis zostalby potraktowany jak zapytanie. */
  'disk.folder.uploadfile',
  'im.disk.file.commit',
  /* Zalozenie kolejnego sprintu z widoku planowania. Tak jak wyzej: bez wpisu
     tutaj `call` potraktowalby to jak odczyt i wpuscil do laczenia zapytan. */
  'tasks.api.scrum.sprint.add',
  /* Epiki projektu — okno „Tagi i epiki". */
  'tasks.api.scrum.epic.add',
  'tasks.api.scrum.epic.update',
  'tasks.api.scrum.epic.delete',
  'task.checklistitem.complete',
  'task.checklistitem.renew',
]);

/**
 * Termin po ludzku: „17.09.2026", a nie surowe „2026-09-17T23:00…".
 *
 * Godzine pokazujemy tylko wtedy, gdy NIE jest to nasze umowne 23:00. Wybierajac
 * termin wskazuje sie DZIEN — godzine dokladamy sami, zeby data nie przeskoczyla
 * przy roznicy stref (patrz `DateField`). Wypisywanie jej z powrotem kazaloby
 * uzytkownikowi zgadywac, skad sie wziela.
 */
function dateLabel(v: unknown): string {
  const raw = str(v);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return raw;
  const [, y, mo, d, hh, mm] = m;
  const day = `${d}.${mo}.${y}`;
  return !hh || (hh === '23' && mm === '00') ? day : `${day}, ${hh}:${mm}`;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Czego dotyczy identyfikator — po to, zeby panel wiedzial, w ktorym slowniku szukac. */
export type IdKind = 'stage' | 'person' | 'status' | 'priority' | 'sprint';

/** Zamiana identyfikatora na nazwe. Brak odpowiedzi = zostaje sam identyfikator. */
export type Resolve = (kind: IdKind, id: string) => string | undefined;

/*
 * Znaczniki, ktorymi opis oznacza swoje czesci skladowe, zeby widok mogl dolozyc
 * do nich ikony i kolory. Wchodza TYLKO przy wyswietlaniu (gdy podano `resolve`)
 * — zapisany `label` zostaje czystym tekstem i nigdy ich nie widzi.
 */
export const MARK = '';
export const SEP = '';

/**
 * Parametry przyciete do zapisu.
 *
 * Do wzbogacenia opisu potrzebne sa tylko pola i dwa identyfikatory z wierzchu.
 * Reszta bywa ogromna (opis zadania!), a dziennik trzyma sto wpisow w
 * `localStorage` — dlatego napisy tniemy, a tablice ograniczamy do dlugosci,
 * bo tylko ona wchodzi do opisu.
 */
export function slimParams(params: Record<string, unknown>): Record<string, unknown> {
  const cutVal = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.slice(0, 50);
    if (typeof v === 'string') return v.length > 120 ? v.slice(0, 120) : v;
    return v;
  };
  const fields = params.fields as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {};
  if (fields && typeof fields === 'object') {
    out.fields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, cutVal(v)]));
  }
  if ('sprintId' in params) out.sprintId = params.sprintId;
  if ('stageId' in params) out.stageId = params.stageId;
  return out;
}

/**
 * Czytelny opis akcji, skladany Z PARAMETROW wywolania.
 *
 * Robimy to W MOMENCIE ZAPISU, a nie przy wyswietlaniu: parametry sa wtedy pod
 * reka w calosci, a wpis zostaje zrozumialy nawet po zmianie kodu, ktory go
 * wygenerowal. Wartosci skracamy — dziennik ma sie czytac, nie byc zrzutem.
 */
export function describe(
  method: string,
  params: Record<string, unknown>,
  /*
   * Podany TYLKO przy wyswietlaniu. Przy zapisie go nie ma, wiec w `label`
   * ladują surowe identyfikatory — i dobrze: to one sa trwalym sladem, nazwy
   * potrafia sie zmienic albo zniknac razem z etapem czy kontem.
   */
  resolve?: Resolve,
  /** Wartosci sprzed zapisu — wtedy opis mowi „z czego na co". */
  before?: Record<string, unknown>,
): string {
  const fields = (params.fields ?? {}) as Record<string, unknown>;
  const cut = (v: unknown, n = 40) => {
    const s = str(v);
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  /*
   * Oznacza kawalek zdania RODZAJEM, zeby widok mogl dolozyc do niego ikone.
   * Poza trybem wyswietlania (brak `resolve`) zwraca goly tekst — zapisany
   * `label` ma zostac czystym napisem.
   */
  const mark = (kind: string, id: string, text: string) =>
    resolve ? `${MARK}${kind}${SEP}${id}${SEP}${text}${MARK}` : text;

  /*
   * „pole: STARE → NOWE", gdy znamy poprzednia wartosc i faktycznie sie rozni.
   * Rowne wartosci pomijamy: zapis, ktory niczego nie zmienil, ma sie czytac
   * jako jeden stan, a nie jako strzalka w kolko.
   */
  const arrow = (
    label: string,
    key: string,
    fmt: (x: unknown) => string,
    v: unknown,
    /* Rodzaj gramatyczny idzie za nazwa pola: „termin zdjęty", „pointy zdjęte". */
    gone = `${label} zdjęty`,
  ) => {
    const now = fmt(v);
    /*
     * Tylko przy WYSWIETLANIU. Zapisywany `label` ma byc surowym zapisem tego,
     * co wyslalismy — poprzednia wartosc lezy osobno, w polu `before`, i to ona
     * jest zrodlem prawdy. Inaczej ten sam wpis mialby dwa sprzeczne opisy.
     */
    if (!resolve || !before || !(key in before)) return `${label} → ${now}`;
    const was = fmt(before[key]);
    if (!was || was === now) return `${label} → ${now}`;
    /* Zdjecie wartosci to tez zmiana — i wlasnie wtedy najbardziej chce sie
       wiedziec, co tam bylo. */
    if (!now) return `${gone} (było ${was})`;
    return `${label}: ${was} → ${now}`;
  };

  /*
   * Nazwa, a gdy slownik jej nie zna — identyfikator z krzyzykiem, zeby bylo
   * widac, ze to id, a nie nazwa.
   *
   * Bez slownika (czyli przy ZAPISIE) zostaje samo id, bez krzyzyka: krzyzyk
   * znaczy „szukalismy i nie ma", a tam nawet nie probujemy. Inaczej trwaly
   * `label` niosby falszywy sygnal do konca zycia wpisu.
   */
  const name = (kind: IdKind, v: unknown) => {
    const id = str(v);
    if (!id || !resolve) return id;
    return mark(kind, id, resolve(kind, id) ?? `#${id}`);
  };

  switch (method) {
    case 'tasks.task.update': {
      /* Jedna metoda obsluguje wszystko, wiec o tresci akcji mowia dopiero POLA. */
      const parts = Object.entries(fields).map(([k, v]) => {
        if (k === 'STAGE_ID') return arrow('etap', k, (x) => name('stage', x), v);
        if (k === 'RESPONSIBLE_ID') return arrow('odpowiedzialny', k, (x) => name('person', x), v);
        if (k === 'STATUS') return arrow('status', k, (x) => name('status', x), v);
        if (k === 'DEADLINE')
          return mark('deadline', '', arrow('termin', k, dateLabel, v));
        if (k === 'TITLE') return mark('title', '', `tytuł → „${cut(v)}”`);
        if (k === 'PRIORITY') return arrow('priorytet', k, (x) => name('priority', x), v);
        /*
         * Pola SCRUMA moga trafic tu razem z polami zadania, choc Bitrix zapisuje
         * je inna metoda. Dzieje sie tak przy zmianach Z ZEWNATRZ: `diffTasks`
         * porownuje wiersze zadan i nazywa pola tak, jak nazywa je API, a caly
         * wpis sklada pod `tasks.task.update`. Bez tych trzech linijek sprint
         * czytal sie jako gole „entityId → 381".
         */
        if (k === 'entityId') return arrow('sprint', k, (x) => name('sprint', x), v);
        if (k === 'storyPoints')
          return arrow('story pointy', k, str, v, 'story pointy zdjęte');
        if (k === 'epicId') return arrow('epik', k, str, v);
        if (k === 'TAGS') return mark('tags', '', `tagi (${Array.isArray(v) ? v.length : 0})`);
        /* Pusty string kasuje pole — patrz `updateParticipants`. */
        if (k === 'AUDITORS')
          return mark(
            'people',
            '',
            v === '' ? 'obserwatorzy wyczyszczeni' : `obserwatorzy (${Array.isArray(v) ? v.length : 0})`,
          );
        if (k === 'ACCOMPLICES')
          return mark(
            'people',
            '',
            v === ''
              ? 'współwykonawcy wyczyszczeni'
              : `współwykonawcy (${Array.isArray(v) ? v.length : 0})`,
          );
        return `${k} → ${cut(v, 20)}`;
      });
      return parts.length ? parts.join(', ') : 'zmiana zadania';
    }
    case 'tasks.task.delete':
      return mark('delete', '', 'usunięcie zadania');
    case 'tasks.api.scrum.epic.add':
      return mark('epic', '', `epik dodany: „${cut(fields.name)}”`);
    case 'tasks.api.scrum.epic.update':
      return mark('epic', '', `epik #${str(params.id)} zmieniony${fields.name ? `: „${cut(fields.name)}”` : ''}`);
    case 'tasks.api.scrum.epic.delete':
      return mark('delete', '', `epik #${str(params.id)} usunięty`);
    case 'tasks.api.scrum.task.update':
      if ('entityId' in fields)
        return arrow('sprint', 'entityId', (x) => name('sprint', x), fields.entityId);
      if ('storyPoints' in fields)
        return mark(
          'points',
          '',
          arrow('story pointy', 'storyPoints', str, fields.storyPoints, 'story pointy zdjęte'),
        );
      if ('epicId' in fields) return mark('epic', '', `epik → ${str(fields.epicId) || 'brak'}`);
      return 'zmiana pól scruma';
    case 'tasks.api.scrum.kanban.addTask':
      /* Krok, bez ktorego reguly kolumny nie odpalaja — patrz `moveToSprint`. */
      return `karta na tablicę ${name('sprint', params.sprintId)}, etap ${name('stage', params.stageId)}`;
    case 'task.stages.movetask':
      return arrow('etap', 'STAGE_ID', (x) => name('stage', x), params.stageId);
    case 'task.item.update':
      return mark('related', '', 'powiązane zadania');
    case 'task.commentitem.add':
      return mark('comment', '', 'komentarz');
    /* Dwie metody, jedna czynnosc — forum i czat to tylko miejsce, w ktorym
       komentarz lezy (patrz `editComment`). Dziennik mowi o czynnosci. */
    case 'task.commentitem.update':
    case 'im.v2.Chat.Message.update':
      return mark('comment', '', 'komentarz zmieniony');
    case 'task.commentitem.delete':
    case 'im.v2.Chat.Message.delete':
      return mark('delete', '', 'komentarz usunięty');
    case 'im.v2.Chat.Message.Reaction.add':
      return mark('comment', '', `reakcja ${emojiOf(String(params.reaction))} pod komentarzem`);
    case 'im.v2.Chat.Message.Reaction.delete':
      return mark('comment', '', `reakcja ${emojiOf(String(params.reaction))} zdjęta`);
    /* Wgranie pliku to KROK, nie czynnosc — dla czytajacego dziennik liczy sie
       dopiero komentarz, ktory z niego powstal. */
    case 'disk.folder.uploadfile':
      return mark('comment', '', 'wgranie załącznika');
    case 'im.disk.file.commit':
      return mark('comment', '', 'komentarz z załącznikiem');
    case 'task.checklistitem.complete':
      return mark('check', '', 'checklista — odhaczone');
    case 'task.checklistitem.renew':
      return mark('check', '', 'checklista — cofnięte');
    default:
      return method;
  }
}

/**
 * Numer zadania z parametrow. Kazda metoda nazywa go inaczej (`taskId`, `id`,
 * `TASKID`, `TASK_ID`), a bez niego wpis nie ma o czym mowic.
 */
export function taskIdOf(params: Record<string, unknown>): number | null {
  const raw = params.taskId ?? params.TASKID ?? params.TASK_ID ?? params.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/*
 * ZWIJANIE wejscia do sprintu w jedna pozycje.
 *
 * `moveToSprint` robi cztery zapisy: przynaleznosc, karta na tablicy, kolumna
 * wejsciowa (tam wisi automatyzacja nadajaca IT-NNN) i dopiero kolumna docelowa.
 * Dla czlowieka to bylo JEDNO przeciagniecie, a dziennik pokazywal cztery
 * wiersze — czyli slad wywolan REST zamiast zamiaru.
 *
 * Warunkiem zwiniecia jest obecnosc `kanban.addTask`, ktore wystepuje WYLACZNIE
 * na tej sciezce. Celowo NIE zwijamy po samym „ten sam task w oknie kilku
 * sekund": taka regula sklejalaby tez dwie niezalezne decyzje (zmiane etapu i
 * zaraz potem priorytetu) w jedna, ktorej nikt nie podjal.
 */
const FOLD_WINDOW_MS = 15_000;

/** Czy wpis moze byc czescia wejscia do sprintu, a nie przypadkowym sasiadem. */
function partOfSprintEntry(e: HistoryEntry): boolean {
  /* Nieudana proba NIGDY nie wpada do grupy — po nia sie tu przychodzi. */
  if (e.error || e.taskId === null) return false;
  const fields = (e.params?.fields ?? {}) as Record<string, unknown>;
  if (e.method === 'tasks.api.scrum.kanban.addTask') return true;
  if (e.method === 'tasks.api.scrum.task.update') return 'entityId' in fields;
  /* Sam etap i nic wiecej — inaczej wciagnelibysmy obok lezaca zmiane tytulu. */
  if (e.method === 'tasks.task.update')
    return 'STAGE_ID' in fields && Object.keys(fields).length === 1;
  /* Przejscie do kolumny docelowej idzie juz przez `movetask` — patrz `moveToStage`. */
  if (e.method === 'task.stages.movetask') return true;
  return false;
}

/*
 * ECHO wlasnego wejscia do sprintu. `tasks.task.list` nadganiala z opoznieniem i
 * ta sama zmiana wracala kilkadziesiat sekund pozniej jako „z zewnatrz" — obok
 * trzech wierszy, ktore wlasnie ja opisaly.
 *
 * Od teraz takie echo w ogole nie powstaje (patrz `noteMine`), ale wpisy zapisane
 * WCZESNIEJ zostaja: dziennik jest zapisem tego, co widzielismy, i nie przepisuje
 * sie wstecz. Dlatego echa nie kasujemy — skladamy je z grupa, do ktorej naleza.
 *
 * Okno jest osobne i szerokie, bo opoznienie listy jest nieprzewidywalne; 15
 * sekund od `FOLD_WINDOW_MS` opisuje tempo NASZYCH trzech zapisow, a nie to.
 */
const ECHO_WINDOW_MS = 10 * 60_000;

function sprintEcho(e: HistoryEntry): boolean {
  if (e.source !== 'bitrix' || e.error || e.taskId === null) return false;
  if (e.method !== 'tasks.task.update') return false;
  const keys = Object.keys((e.params?.fields ?? {}) as Record<string, unknown>);
  /* Wylacznie pola, ktore niesie wejscie do sprintu — nic obok. */
  return keys.length > 0 && keys.every((k) => k === 'STAGE_ID' || k === 'entityId');
}

/**
 * Dzieli dziennik (od najnowszego) na pozycje: pojedyncze wpisy albo grupy.
 * Grupa ma zawsze wiecej niz jeden wpis i zawiera `kanban.addTask`.
 */
export function foldEntries(items: HistoryEntry[]): HistoryEntry[][] {
  const out: HistoryEntry[][] = [];
  for (let i = 0; i < items.length; ) {
    const head = items[i];
    let j = i;
    if (partOfSprintEntry(head)) {
      while (
        j + 1 < items.length &&
        partOfSprintEntry(items[j + 1]) &&
        items[j + 1].taskId === head.taskId &&
        head.at - items[j + 1].at <= FOLD_WINDOW_MS
      ) {
        j += 1;
      }
    }
    const run = items.slice(i, j + 1);
    if (run.length > 1 && run.some((e) => e.method === 'tasks.api.scrum.kanban.addTask')) {
      out.push(run);
    } else {
      for (const e of run) out.push([e]);
    }
    i = j + 1;
  }
  return out;
}


