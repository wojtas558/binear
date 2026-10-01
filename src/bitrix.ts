/** Klient REST Bitrix — leci przez lokalne proxy, token nigdy nie trafia do przegladarki. */

import { QUESTION, type ChatMessage } from './counters';
import { describe, logAction, slimParams, taskIdOf, WRITE_METHODS } from './history';

export class BxError extends Error {
  constructor(
    message: string,
    readonly description?: string,
  ) {
    super(message);
  }
}

/*
 * PRZEPUSTNICA. Bitrix liczy zapytania „cieknacym wiadrem": kazde podnosi licznik
 * o jeden, a licznik spada o `RATE` co sekunde. Po przekroczeniu pojemnosci
 * oddaje 503 i `QUERY_LIMIT_EXCEEDED`.
 *
 * Liczby z dokumentacji (apidocs.bitrix24.com/limits.html): pojemnosc 50 i
 * odplyw 2/s na planach innych niz Enterprise, 250 i 5/s na Enterprise.
 * Bierzemy nizsze — przekroczenie kosztuje wiecej niz chwila czekania.
 *
 * `BURST` celowo mniejszy od pojemnosci: wiadro jest WSPOLNE dla calego portalu,
 * wiec obok nas leja do niego inne integracje. Zostawiamy im zapas.
 */
const RATE = 2;
/*
 * Pojemnosc wiadra po stronie portalu to 50. Bralem 20 „na zapas dla innych" i to
 * byl zly kompromis: jednorazowe otwarcie wykresow to ~36 zapytan, wiec po 20
 * pierwszych reszta szla po 2 na sekunde i ekran wstawal kilkanascie sekund
 * dluzej. Wiadro ISTNIEJE po to, zeby pochlaniac takie zrywy — a gdyby jednak
 * zabraklo, mamy teraz ciche ponowienie i wspolna pauze, wiec przekroczenie nie
 * jest juz awaria, tylko chwila czekania.
 */
const BURST = 40;

let tokens = BURST;
let refilledAt = Date.now();
/* Pobranie zetonu musi byc SZEREGOWE, inaczej dwa rownolegle zapytania wezma ten sam. */
let gate: Promise<void> = Promise.resolve();

/*
 * Do kiedy CALY ruch stoi. Ustawiane po odmowie z limitu — i to jest istotna
 * roznica wzgledem samego oproznienia wiadra: odmowa dotyczy portalu, nie tego
 * jednego zapytania, wiec wstrzymanie tez musi byc wspolne. Inaczej zapytanie,
 * ktore oberwalo, grzecznie czeka, a dwadziescia obok niego dalej dobija portal
 * i przedluza odmowe.
 */
let pausedUntil = 0;

function refill(): void {
  const now = Date.now();
  tokens = Math.min(BURST, tokens + ((now - refilledAt) / 1000) * RATE);
  refilledAt = now;
}

function takeToken(): Promise<void> {
  const mine = gate.then(async () => {
    /* Znacznik jest BEZWZGLEDNY, wiec kolejka nie mnozy czekania: pierwszy czeka
       calosc, kolejne widza juz przeszlosc i ida dalej. */
    const pause = pausedUntil - Date.now();
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));

    refill();
    if (tokens < 1) {
      /* Ile brakuje do jednego zetonu przy stalym odplywie. */
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - tokens) / RATE) * 1000)));
      refill();
    }
    tokens -= 1;
  });
  gate = mine.catch(() => {});
  return mine;
}

/** Czy to odmowa z powodu limitu, a nie prawdziwy blad. */
function isRateLimit(status: number, error: unknown): boolean {
  return status === 503 || str(error).toUpperCase() === 'QUERY_LIMIT_EXCEEDED';
}

/**
 * Czy to odmowa z powodu limitu zapytan. Dla wolajacego to NIE jest blad zadania
 * — nic sie nie zepsulo i nie ma czego naprawiac, portal poprosil tylko o chwile.
 * Ekran bledu zostaje dla rzeczy, z ktorymi uzytkownik moze cokolwiek zrobic.
 */
export function isRateLimitError(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return text.toUpperCase().includes('QUERY_LIMIT_EXCEEDED') || text.includes('HTTP 503');
}

/*
 * Po odmowie z limitu zapytanie NIE PRZEPADA — czeka i idzie jeszcze raz, tym
 * samym `fetch`em z tymi samymi parametrami. Nie ma tu wiec licznika prob:
 * odmowa z limitu nie jest bledem zadania i nie ma powodu, zeby po pieciu
 * podejsciach nagle sie nim stala. Zwlaszcza przy ZAPISIE — porzucona zmiana to
 * zmiana, ktora uzytkownik uwaza za zrobiona, a ktorej w Bitriksie nie ma.
 *
 * Odstepy rosna (1s, 2s, 4s, 8s, 16s) i zatrzymuja sie na `BACKOFF_MAX`, zeby
 * odzyskanie nie czekalo dluzej, niz musi.
 *
 * `RATE_BUDGET` to jedyny bezpiecznik: gdyby portal odmawial godzinami, wiszace
 * w nieskonczonosc zapytanie byloby gorsze od uczciwego bledu. Pol godziny to
 * DUZO wiecej niz jakikolwiek zaobserwowany zator — jesli sie skonczy, to znaczy,
 * ze problem nie jest juz chwilowy i uzytkownik ma prawo o nim wiedziec.
 */
const BACKOFF_MAX = 30_000;
const RATE_BUDGET = 30 * 60_000;

async function post(method: string, params: Record<string, unknown>): Promise<any> {
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt++) {
    await takeToken();

    const res = await fetch(`/api/bx/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok && !json?.error) return json;

    if (isRateLimit(res.status, json?.error) && Date.now() - startedAt < RATE_BUDGET) {
      /*
       * Wstrzymujemy caly ruch i oproznamy wlasne wiadro. Samego czekania tu nie
       * ma — odsiedzi je `takeToken` na gorze petli, razem z kazdym innym
       * zapytaniem, ktore w tym czasie przyjdzie.
       */
      const wait = Math.min(1000 * 2 ** attempt, BACKOFF_MAX);
      pausedUntil = Math.max(pausedUntil, Date.now() + wait);
      tokens = 0;
      refilledAt = Date.now();
      continue;
    }

    throw new BxError(json?.error || `HTTP ${res.status}`, json?.error_description);
  }
}

/*
 * Jedno przejscie dla wszystkich wywolan — i dlatego jedyne sensowne miejsce na
 * dziennik. Logowanie przy kazdej funkcji mutujacej z osobna znaczyloby, ze
 * nastepna dopisana funkcja po cichu do dziennika nie trafia.
 *
 * Piszemy TYLKO zapisy (`WRITE_METHODS`) i piszemy je RAZEM Z BLEDAMI: nieudana
 * proba jest zwykle wazniejsza od udanej, a w dzienniku Bitriksa nie zostawia
 * po sobie nic.
 */
async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!WRITE_METHODS.has(method)) return coalesce<T>(method, params);

  try {
    const result = (await post(method, params)).result as T;
    logAction({
      at: Date.now(),
      method,
      taskId: taskIdOf(params),
      label: describe(method, params),
      params: slimParams(params),
      error: null,
    });
    return result;
  } catch (e) {
    logAction({
      at: Date.now(),
      method,
      taskId: taskIdOf(params),
      label: describe(method, params),
      params: slimParams(params),
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Czy dana metoda jest dla TEGO webhooka osiagalna — bez wykonywania jej skutku.
 *
 * Sztuczka: wolamy ja BEZ WYMAGANYCH PARAMETROW. Bitrix odpowiada wtedy bledem
 * o brakujacym parametrze, co znaczy „metoda jest, zakres jest, uprawnienia sa" —
 * a zaden zapis sie nie wykonuje, bo nie ma na czym. Dzieki temu tak samo
 * bezpiecznie sprawdzamy odczyty i ZAPISY (usuniecie zadania, edycje komentarza).
 *
 * Rozrozniamy sciany, bo kazda prowadzi do innej rozmowy z administratorem:
 *  - `brak`   — metody nie ma w tej WERSJI portalu; pomoze tylko aktualizacja,
 *  - `zakres` — token webhooka nie ma uprawnienia do modulu (`insufficient_scope`),
 *  - `dostep` — modul jest, ale KONTO nie ma praw (`ACCESS_ERROR`),
 *  - `ok`     — przeszlo albo odbilo sie o brakujacy parametr.
 */
export type ProbeStan = 'ok' | 'brak' | 'zakres' | 'dostep' | 'blad';

export async function probeMethod(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ stan: ProbeStan; opis: string; wynik?: unknown }> {
  try {
    const res = await post(method, params);
    return { stan: 'ok', opis: 'działa', wynik: res?.result };
  } catch (e) {
    const kod = e instanceof BxError ? e.message : String(e);
    const opis = (e instanceof BxError && e.description) || kod;
    if (kod === 'ERROR_METHOD_NOT_FOUND') return { stan: 'brak', opis: 'nie ma jej w tej wersji portalu' };
    if (kod === 'insufficient_scope') return { stan: 'zakres', opis: 'webhook nie ma zakresu tego modułu' };
    /*
     * Brak uprawnien bywa zglaszany kodem ALBO samym opisem — np. „User does not
     * have access to managing other users work time" przychodzi pod ogolnym
     * kodem. Patrzymy na oba, bo od tego zalezy KOLOR: pomaranczowy „do zalatwienia
     * u administratora", a nie czerwony „cos jest zepsute".
     */
    if (kod === 'ACCESS_ERROR' || /access|denied|permission/i.test(`${kod} ${opis}`)) {
      return { stan: 'dostep', opis: String(opis).slice(0, 90) };
    }
    /* „Kontroler jest, ale nie ta akcja" — z naszego punktu widzenia to brak metody. */
    if (kod === '22002') return { stan: 'brak', opis: 'kontroler jest, ale nie ta akcja' };
    /*
     * Blad o PARAMETRACH to dobra wiadomosc: metoda odpowiedziala, czyli jest
     * osiagalna — a my nie podalismy nic, wiec nic sie nie wykonalo.
     */
    if (/^\d+$/.test(kod) || /ERROR_ARGUMENT|EMPTY|WRONG|REQUIRED|_ERROR$/i.test(kod)) {
      return { stan: 'ok', opis: 'osiągalna (odbiła się o brak parametrów)' };
    }
    return { stan: 'blad', opis: String(opis).slice(0, 90) };
  }
}

/** Serializacja do query stringa w formacie Bitriksa: `filter[GROUP_ID]=451&select[0]=ID`. */
function toQuery(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value === null || value === undefined) return out;

  if (Array.isArray(value)) {
    value.forEach((item, i) => toQuery(item, `${prefix}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      toQuery(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

export interface BatchCmd {
  method: string;
  params: Record<string, unknown>;
}

const numOrUndef = (v: unknown): number | undefined =>
  v === undefined || v === null ? undefined : Number(v);

/** Ile wywolan miesci sie w jednym `batch` — twardy limit Bitriksa. */
const MAX_BATCH = 50;

interface BatchSlot {
  result: any;
  error: { error?: string; error_description?: string } | null;
  /* Koperta stronicowania — batch oddaje ja per polecenie, w `result_total`/`result_next`. */
  total: number | undefined;
  next: number | undefined;
}

/**
 * Jedno zapytanie HTTP = jedno wywolanie `batch`, choc w srodku jest ich do 50.
 * Wazne: dla wiadra limitow portalu batch liczy sie JAKO JEDNO zapytanie, wiec to
 * najtansza droga na zbicie ruchu.
 *
 * Bledy NIE lecą tu wyjatkiem — kazde wywolanie dostaje wlasna komorke. Inaczej
 * jedno zadanie bez dostepu przewracaloby 49 zdrowych obok niego.
 */
async function runBatch(cmds: BatchCmd[]): Promise<BatchSlot[]> {
  const cmd: Record<string, string> = {};
  cmds.forEach((c, i) => {
    cmd[String(i)] = `${c.method}?${toQuery(c.params).join('&')}`;
  });

  const json = await post('batch', { halt: 0, cmd });
  const payload = json.result ?? {};

  return cmds.map((_, i) => ({
    result: payload.result?.[String(i)],
    error: payload.result_error?.[String(i)] ?? null,
    total: numOrUndef(payload.result_total?.[i]),
    next: numOrUndef(payload.result_next?.[i]),
  }));
}

/** Jawne pakowanie znanej z gory listy wywolan. Blad ktoregokolwiek przerywa calosc. */
async function callBatch(cmds: BatchCmd[]): Promise<any[]> {
  const results: any[] = [];

  for (let i = 0; i < cmds.length; i += MAX_BATCH) {
    const chunk = cmds.slice(i, i + MAX_BATCH);
    for (const slot of await runBatch(chunk)) {
      if (slot.error) throw new BxError(slot.error.error ?? 'batch error', slot.error.error_description);
      results.push(slot.result);
    }
  }
  return results;
}

/*
 * Koalescencja odczytow. Wszystko, co wystartuje w tym samym ticku — czyli caly
 * `Promise.all([...])` na starcie, komplet zapytan panelu szczegolow, sonda —
 * schodzi do JEDNEGO zapytania HTTP zamiast kilkunastu.
 *
 * `setTimeout(0)`, a nie mikrozadanie: mikrozadanie odpaliloby sie w srodku
 * lancucha `await`-ow i zlapaloby tylko czesc paczki.
 *
 * Zapisy tedy NIE ida — ich kolejnosc bywa istotna (wejscie do sprintu), a
 * pakowanie zmienialoby ja w sposob trudny do przesledzenia.
 */
interface Waiting {
  cmd: BatchCmd;
  ok: (v: any) => void;
  fail: (e: unknown) => void;
}

let waiting: Waiting[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushBatch(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = waiting.splice(0, MAX_BATCH);
  if (!batch.length) return;
  if (waiting.length) flushTimer = setTimeout(flushBatch, 0);

  runBatch(batch.map((w) => w.cmd)).then(
    (slots) =>
      batch.forEach((w, i) => {
        const slot = slots[i];
        if (slot?.error) w.fail(new BxError(slot.error.error ?? 'batch error', slot.error.error_description));
        else w.ok({ result: slot?.result, total: slot?.total, next: slot?.next });
      }),
    (e) => batch.forEach((w) => w.fail(e)),
  );
}

interface Envelope<T> {
  result: T;
  total: number | undefined;
  next: number | undefined;
}

function coalesceRaw<T>(method: string, params: Record<string, unknown>): Promise<Envelope<T>> {
  return new Promise<Envelope<T>>((ok, fail) => {
    waiting.push({ cmd: { method, params }, ok, fail });
    if (waiting.length >= MAX_BATCH) flushBatch();
    else if (flushTimer === null) flushTimer = setTimeout(flushBatch, 0);
  });
}

async function coalesce<T>(method: string, params: Record<string, unknown>): Promise<T> {
  return (await coalesceRaw<T>(method, params)).result;
}

// ─── Typy ────────────────────────────────────────────────────────────────────

export interface Task {
  id: number;
  code: string | null; // "IT-747" z tytulu
  title: string; // tytul bez prefiksu kodu
  rawTitle: string;
  status: string;
  priority: string;
  responsibleId: number | null;
  responsibleName: string | null;
  responsiblePhoto: string | null;
  creatorId: number | null;
  creatorName: string | null;
  creatorPhoto: string | null;
  /**
   * Obserwatorzy — SAME identyfikatory. Lista zadan nie dostaje dla tego pola nazwisk
   * ani zdjec (inaczej niz `responsible` czy `creator`), ale do filtrowania wystarcza:
   * nazwe dokleja filtr z osob, ktore juz zna.
   */
  auditorIds: number[];
  createdDate: string | null;
  changedDate: string | null;
  closedDate: string | null;
  deadline: string | null;
  stageId: number | null;
  sprintId: number | null;
  parentId: number | null;
  /** Etykiety zadania. W tej grupie uzywane niemal wszedzie (EMX, WMS, feature…). */
  tags: string[];
  /**
   * Story pointy scruma. `null` = nie oszacowano (albo jeszcze nie dociagniete).
   * NIE ma ich w `tasks.task.list` — leza na scrumowym bycie zadania i wchodza
   * osobnym, tlowym przebiegiem (patrz `fetchStoryPoints`).
   */
  storyPoints: number | null;
  /**
   * Epik scruma, do ktorego nalezy zadanie. `null` = bez epika (albo jeszcze nie
   * dociagniete). Tak jak story pointy, lezy na scrumowym bycie zadania i wchodzi
   * osobnym, tlowym przebiegiem (patrz `fetchScrumMeta`).
   */
  epicId: number | null;
  /**
   * Nieprzeczytane komentarze — licznik prowadzi Bitrix wzgledem konta z webhooka.
   * Jest w `tasks.task.list`, wiec kropka na wierszu nie kosztuje ani jednego
   * dodatkowego zapytania.
   */
  newComments: number;
  /**
   * Czat zadania (komentarze nowszych zadan). Jest w `tasks.task.list`, wiec licznik
   * odpowiedzi nie musi pytac o kazde zadanie osobno przez `tasks.task.get`.
   */
  chatId: number | null;
}

export interface Stage {
  id: number;
  name: string;
  sort: number;
  sprintId: number;
  /** Kolor kolumny ustawiony w Bitriksie (hex bez #) — uzywamy go na tablicy. */
  color: string | null;
  /** NEW / WORK / FINISH — Bitrix oznacza tak skrajne etapy procesu. */
  type: string;
}

export interface Sprint {
  id: number;
  name: string;
  dateStart: string | null;
  dateEnd: string | null;
  /** `active` / `completed` / `planned` — wykres predkosci bierze tylko domkniete. */
  status: string;
}

/** Epik scruma — nadrzedny "temat" grupujacy zadania ponad sprintami. */
export interface Epic {
  id: number;
  name: string;
  /** Kolor nadany w Bitriksie (hex bez #) — do kropki/pigulki na wierszu. */
  color: string | null;
}

export interface Project {
  id: number;
  name: string;
  /** Rola w projekcie: `A` wlasciciel, `E` moderator, `K` uczestnik. */
  role: string;
}

// ─── Mapowanie stalych Bitrix ────────────────────────────────────────────────

/**
 * Etykiety statusow i priorytetow sa czytane z portalu (`tasks.task.getFields`),
 * zeby nie rozjechaly sie z tym, co widac w Bitriksie. Ponizsze wartosci to
 * wylacznie fallback — dokladnie to, co zwrocil ten portal.
 * Bitrix NIE udostepnia tu statusow 1 ani 7, mimo ze istnieja w jego wnetrzu.
 */
export const FALLBACK_STATUS: Record<string, string> = {
  '2': 'W oczekiwaniu',
  '3': 'W toku',
  '4': 'Czeka na kontrolę',
  '5': 'Zakończone',
  '6': 'Odłożone',
};

export const FALLBACK_PRIORITY: Record<string, string> = {
  '0': 'Niski',
  '1': 'Normalny',
  '2': 'Wysoki',
};

/** Zakonczone znikaja z widokow innych niz "Wszystkie". Odlozone (6) zostaja — to wstrzymanie, nie koniec. */
export const CLOSED_STATUSES = new Set(['5']);

/**
 * Status "oddane do akceptacji" (Bitrix: 4, „Czeka na kontrolę").
 *
 * NIE jest zamknieciem — `CLOSED_STATUSES` go nie obejmuje, wiec „Pokaż
 * zakończone" tych zadan nie dotyczy. Przy planowaniu to jednak praca, ktorej
 * juz nikt nie bedzie robil: czeka na cudza akceptacje. Stad osobny przelacznik.
 *
 * Status ustawia sama automatyzacja kolumny „Do zatwierdzenia / PR" (sprawdzone
 * 2026-09-10: wszystkie 25 zadan w tej kolumnie mialy status 4), wiec wystarczy
 * on za rozpoznanie — i dziala takze poza sprintem, gdzie kolumn nie ma.
 */
export const REVIEW_STATUSES = new Set(['4']);

export interface FieldEnums {
  status: Record<string, string>;
  priority: Record<string, string>;
}

export async function fetchFieldEnums(): Promise<FieldEnums> {
  try {
    const res = await call<any>('tasks.task.getFields');
    const status = res?.fields?.status?.values;
    const priority = res?.fields?.priority?.values;
    return {
      status: status && Object.keys(status).length ? status : FALLBACK_STATUS,
      priority: priority && Object.keys(priority).length ? priority : FALLBACK_PRIORITY,
    };
  } catch {
    return { status: FALLBACK_STATUS, priority: FALLBACK_PRIORITY };
  }
}

// ─── Normalizacja ────────────────────────────────────────────────────────────

/** Bitrix zwraca "0" i "" jako "brak" dla identyfikatorow relacji. */
const relId = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * `storyPoints` ze scruma to string: "5" gdy oszacowano, "" gdy nie.
 * Zero traktujemy jak brak — nie zasmiecamy karty pustym oszacowaniem.
 */
const storyPointValue = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * `responsible` przychodzi raz jako obiekt, raz jako samo id — zaleznie od metody.
 * W `tasks.task.list` obiekt niesie tez `icon` (zdjecie) i `workPosition`.
 */
function personName(v: unknown): string | null {
  if (v && typeof v === 'object' && 'name' in (v as any)) return str((v as any).name) || null;
  return null;
}

function personId(v: unknown): number | null {
  if (v && typeof v === 'object' && 'id' in (v as any)) {
    const n = Number((v as any).id);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Zdjecie z `responsible.icon`. Dwa przypadki, ktore trzeba odsiac, bo inaczej
 * <img> sie nie laduje i przegladarka rysuje w kolku tekst alt (imie):
 *  - brak zdjecia: Bitrix zwraca pusty string albo domyslna grafike z /bitrix/images/
 *  - sciezki ze spacjami: ".../Klaudiusz Koder neutral.jpg.png"
 */
function photoUrl(raw: unknown): string | null {
  const url = str(raw).trim();
  if (!url || /\/bitrix\/images\//.test(url)) return null;
  return url.replace(/ /g, '%20');
}

const personPhoto = (v: unknown): string | null => photoUrl((v as any)?.icon);

const CODE_RE = /^\s*(IT-\d+)\s*[:.\-—]\s*/i;

function normalizeTask(t: any): Task {
  const rawTitle = str(t.title ?? t.TITLE);
  const m = rawTitle.match(CODE_RE);

  return {
    id: Number(t.id ?? t.ID),
    code: m ? m[1].toUpperCase() : null,
    title: m ? rawTitle.slice(m[0].length) : rawTitle,
    rawTitle,
    status: str(t.status ?? t.STATUS) || '2',
    priority: str(t.priority ?? t.PRIORITY) || '1',
    responsibleId: relId(t.responsibleId ?? t.RESPONSIBLE_ID ?? t.responsible?.id),
    responsibleName: personName(t.responsible),
    responsiblePhoto: personPhoto(t.responsible),
    creatorId: relId(t.createdBy ?? t.CREATED_BY ?? t.creator?.id),
    creatorName: personName(t.creator),
    creatorPhoto: personPhoto(t.creator),
    auditorIds: (Array.isArray(t.auditors) ? t.auditors : [])
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isFinite(n) && n > 0),
    createdDate: str(t.createdDate ?? t.CREATED_DATE) || null,
    changedDate: str(t.changedDate ?? t.CHANGED_DATE) || null,
    closedDate: str(t.closedDate ?? t.CLOSED_DATE) || null,
    deadline: str(t.deadline ?? t.DEADLINE) || null,
    stageId: relId(t.stageId ?? t.STAGE_ID),
    sprintId: relId(t.sprintId ?? t.SPRINT_ID),
    parentId: relId(t.parentId ?? t.PARENT_ID),
    // Bitrix zwraca [] gdy brak tagow, a mape id -> {id,title} gdy sa.
    tags: Object.values((t.tags ?? {}) as Record<string, any>)
      .map((tag: any) => str(tag?.title))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pl')),
    // Dociagane osobno przez `fetchScrumMeta` — lista Bitriksa ich nie niesie.
    storyPoints: null,
    epicId: null,
    newComments: Math.max(0, Number(t.newCommentsCount ?? t.NEW_COMMENTS_COUNT ?? 0) || 0),
    chatId: relId(t.chatId ?? t.CHAT_ID),
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Bez DESCRIPTION — opisy tych zadan potrafia miec kilka kB, wiec dla ~1000 rekordow
 * to kilka MB czytane dla tekstu, ktorego lista i tak nie pokazuje.
 * Opis dociagamy leniwie przez `fetchDescription` przy otwarciu panelu.
 */
const LIST_SELECT = [
  'ID',
  'TITLE',
  'STATUS',
  'PRIORITY',
  'RESPONSIBLE_ID',
  // Zwraca tez CALY obiekt `creator` (id, nazwa, zdjecie) — filtr po autorze
  // dostaje z tego awatar bez ani jednego dodatkowego zapytania.
  'CREATED_BY',
  // Obserwatorzy — do filtra. Same identyfikatory, wiec tanio nawet przy 1160 zadaniach.
  'AUDITORS',
  'CREATED_DATE',
  'CHANGED_DATE',
  'CLOSED_DATE',
  'DEADLINE',
  'STAGE_ID',
  'SPRINT_ID',
  'PARENT_ID',
  'TAGS',
  'NEW_COMMENTS_COUNT',
  'CHAT_ID',
];

const PAGE = 50;

/**
 * OPISY wszystkich zadan projektu — do wyszukiwania po tresci.
 *
 * Osobne pobranie, a nie dodatkowe pole w `LIST_SELECT`, bo opisy waza mniej
 * wiecej tyle co cala reszta listy razem wziete (okolo 1,9 MB na 1318 zadan),
 * a potrzebne sa tylko temu, kto wlaczy szukanie w opisach. Pelne uzasadnienie
 * i opis pulapki `%DESCRIPTION` — w `descCache.ts`.
 *
 * Kosztuje tyle samo wywolan co zwykla lista: jedna strona plus reszta jednym
 * `batch`, czyli okolo 27 wywolan na 1318 zadan.
 */
export async function fetchDescriptions(
  groupId: number,
  onPostep?: (gotowe: number, wszystkie: number) => void,
): Promise<Map<number, { d: string; ch: string | null }>> {
  const params = {
    filter: { GROUP_ID: groupId },
    select: ['ID', 'DESCRIPTION', 'CHANGED_DATE'],
    order: { ID: 'desc' },
  };

  const first = await coalesceRaw<{ tasks?: any[] }>('tasks.task.list', { ...params, start: 0 });
  const rows: any[] = first.result?.tasks ?? [];
  const total: number = Number(first.total ?? rows.length);
  onPostep?.(rows.length, total);

  const rest: BatchCmd[] = [];
  for (let start = PAGE; start < total; start += PAGE) {
    rest.push({ method: 'tasks.task.list', params: { ...params, start } });
  }
  if (rest.length) {
    for (const page of await callBatch(rest)) {
      rows.push(...(page?.tasks ?? []));
      onPostep?.(rows.length, total);
    }
  }

  const out = new Map<number, { d: string; ch: string | null }>();
  for (const r of rows) {
    const d = String(r?.description ?? '').trim();
    /* Zadania bez opisu pomijamy — to okolo co dwudzieste, a pusty wpis
       zajmowalby miejsce i nigdy niczego nie dopasowal. */
    if (d) out.set(Number(r.id), { d, ch: r?.changedDate ?? null });
  }
  return out;
}

export async function fetchTasks(groupId: number): Promise<Task[]> {
  const params = {
    filter: { GROUP_ID: groupId },
    select: LIST_SELECT,
    order: { ID: 'desc' },
  };

  // Pierwsza strona daje tez `total`, z ktorego wyliczamy reszte stron.
  const first = await coalesceRaw<{ tasks?: any[] }>('tasks.task.list', { ...params, start: 0 });
  const tasks: any[] = first.result?.tasks ?? [];
  const total: number = Number(first.total ?? tasks.length);

  const rest: BatchCmd[] = [];
  for (let start = PAGE; start < total; start += PAGE) {
    rest.push({ method: 'tasks.task.list', params: { ...params, start } });
  }

  if (rest.length) {
    for (const page of await callBatch(rest)) {
      tasks.push(...(page?.tasks ?? []));
    }
  }
  return tasks.map(normalizeTask);
}

/** Scrumowe pola zadania spoza `tasks.task.list` — dociagane w tle jednym przebiegiem. */
export interface ScrumMeta {
  storyPoints: number | null;
  epicId: number | null;
}

/**
 * Scrumowe pola listy zadan (story pointy + epik). Nie ma ich w `tasks.task.list`
 * — obydwa leza na scrumowym bycie zadania (`tasks.api.scrum.task.get`), a ta jedna
 * metoda oddaje je RAZEM, wiec pobranie epika nie kosztuje ani jednego dodatkowego
 * wywolania ponad to, co i tak robimy dla story pointow. Jedno id = jedno wywolanie,
 * pakowane po 50 w batch (dla ~1000 zadan to ~20 zapytan).
 *
 * Dlatego to przebieg TLOWY, odpalany po pierwszym renderze: `onChunk` oddaje
 * wyniki partiami, zeby badge'y pojawialy sie na biezaco, a nie po calosci. Do
 * mapy trafia zadanie, ktore ma story pointy ALBO epik; brak klucza == ani jedno.
 */
export async function fetchScrumMeta(
  taskIds: number[],
  onChunk?: (meta: Map<number, ScrumMeta>) => void,
): Promise<Map<number, ScrumMeta>> {
  const all = new Map<number, ScrumMeta>();

  for (let i = 0; i < taskIds.length; i += 50) {
    const ids = taskIds.slice(i, i + 50);
    // Zadanie spoza scruma zwroci blad i wywali caly batch — wtedy ta partia
    // po prostu nie dostaje scrumowych pol (reszta przebiegu leci dalej).
    const results = await callBatch(
      ids.map((id) => ({ method: 'tasks.api.scrum.task.get', params: { id } })),
    ).catch(() => [] as any[]);

    const chunk = new Map<number, ScrumMeta>();
    results.forEach((r, j) => {
      const sp = storyPointValue(r?.storyPoints);
      const eid = relId(r?.epicId);
      if (sp !== null || eid !== null) chunk.set(ids[j], { storyPoints: sp, epicId: eid });
    });

    if (chunk.size) {
      chunk.forEach((v, k) => all.set(k, v));
      onChunk?.(chunk);
    }
  }

  return all;
}

/**
 * Epiki grupy — nadrzedne tematy scruma. Osobne zapytanie (jak sprint/backlog),
 * bo `tasks.task.list` o nich nie wie. Blad polykamy: projekt bez scruma nie ma
 * epikow i wtedy funkcja epika po prostu sie nie pokazuje.
 *
 * UWAGA: filtr MUSI byc UPPER_CASE (`GROUP_ID`) — jak w `sprint.list`. Lowercase
 * `groupId` po cichu zwraca pusta liste zamiast bledu (sprawdzone na zywo).
 */
export async function fetchEpics(groupId: number): Promise<Epic[]> {
  try {
    const res = await call<any>('tasks.api.scrum.epic.list', { filter: { GROUP_ID: groupId } });
    // `call` oddaje juz `.result` (tablica epikow); zostawiamy fallback na `{ epics }`.
    const rows: any[] = Array.isArray(res) ? res : (res?.epics ?? []);
    return rows.map((e) => ({
      id: Number(e.id),
      name: str(e.name),
      color: str(e.color).replace(/^#/, '') || null,
    }));
  } catch {
    return [];
  }
}

/**
 * Czy w grupie zmienilo sie cokolwiek od podanego znacznika.
 *
 * Bitrix nie umie nas powiadomic (webhook przychodzacy to klucz do API, nie kanal
 * push — `event.bind` odmawia z WRONG_AUTH_TYPE, a `pull.*` nie miesci sie w
 * zakresie tokenu), wiec "na zmiane" realizujemy pytaniem o SAMA DELTE: jedna
 * strona, jedno pole, bez liczenia `total` (`start: -1`). Prawie zawsze wraca
 * pusta lista i dopiero niepusta uruchamia pelne przeladowanie.
 *
 * `since` MUSI byc lancuchem prosto od Bitriksa (max `changedDate` z listy),
 * nigdy z naszego zegara: portal interpretuje date bez offsetu we wlasnej
 * strefie, a ta chodzi tu o dwie godziny obok — prog liczony lokalnie lapal
 * zmiany sprzed dwoch godzin przy kazdej sondzie.
 */
export async function fetchChangedSince(groupId: number, since: string): Promise<boolean> {
  const json = await post('tasks.task.list', {
    filter: { GROUP_ID: groupId, '>CHANGED_DATE': since },
    select: ['ID'],
    start: -1,
  });
  return (json.result?.tasks ?? []).length > 0;
}

/** Najswiezsza data zmiany na liscie — prog dla `fetchChangedSince`. */
export function latestChange(tasks: Task[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of tasks) {
    if (!t.changedDate) continue;
    const ms = Date.parse(t.changedDate);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = t.changedDate;
    }
  }
  return best;
}

/**
 * Etapy kanbana sa per sprint (kazdy sprint ma wlasny komplet o tych samych nazwach —
 * dlatego `bitrix_sync.py` rozwiazuje je po nazwie). Pytamy tylko o sprinty,
 * ktore realnie wystapily na zadaniach, i to jednym batchem.
 */
export async function fetchStages(sprintIds: number[]): Promise<Stage[]> {
  if (!sprintIds.length) return [];

  const results = await callBatch(
    sprintIds.map((sprintId) => ({
      method: 'tasks.api.scrum.kanban.getStages',
      params: { sprintId },
    })),
  ).catch(() => [] as any[]); // zamkniety sprint / brak dostepu nie moze wywalic listy

  return results.flatMap((stages, i) =>
    Object.values(stages ?? {}).map((s: any) => ({
      id: Number(s.id),
      name: str(s.name),
      sort: Number(s.sort ?? 0),
      sprintId: sprintIds[i],
      color: str(s.color) || null,
      type: str(s.type),
    })),
  );
}

/**
 * Aktywny sprint grupy. Uwaga: ta metoda przyjmuje filtr UPPER_CASE
 * (`filter[GROUP_ID]`) — `groupId` po cichu zwraca pusta liste zamiast bledu.
 * W grupie moze byc tylko jeden sprint ze statusem `active`.
 */
export async function fetchActiveSprint(groupId: number): Promise<Sprint | null> {
  try {
    const res = await call<any[]>('tasks.api.scrum.sprint.list', {
      filter: { GROUP_ID: groupId, STATUS: 'active' },
    });
    const s = (res ?? [])[0];
    if (!s) return null;
    return {
      id: Number(s.id),
      name: str(s.name),
      dateStart: str(s.dateStart) || null,
      dateEnd: str(s.dateEnd) || null,
      status: str(s.status),
    };
  } catch {
    return null;
  }
}

/**
 * Zaklada KOLEJNY sprint w grupie.
 *
 * Nazwa i daty sa wyliczane po stronie wolajacego (patrz `nastepnySprint` w App),
 * bo to decyzja o tresci, nie o transporcie — tutaj zostaje samo wyslanie.
 *
 * Komplet pol ustalony na zywo, bo dokumentacja ich nie wymienia, a metoda oddaje
 * je pojedynczo, przy kazdej probie inny komunikat:
 *  - bez `groupId`   -> „Group id not found"
 *  - bez dat         -> „Incorrect dateStart/dateEnd format" (format pobłażliwy:
 *                       `YYYY-MM-DD` i pelny ISO przechodza tak samo)
 *  - bez `status`    -> „Incorrect sprint status"; jedyna przyjmowana wartosc to
 *                       `planned` (`new` i `draft` sa odrzucane)
 *  - bez `createdBy` -> „Unable to add sprint", czyli komunikat NIE wskazujacy
 *                       brakujacego pola — to on kosztowal najwiecej prob
 */
export async function createSprint(
  groupId: number,
  name: string,
  dateStart: string,
  dateEnd: string,
  createdBy: number,
): Promise<number | null> {
  const res = await call<any>('tasks.api.scrum.sprint.add', {
    fields: { groupId, name, dateStart, dateEnd, status: 'planned', createdBy },
  });
  const id = Number(res?.id ?? res?.sprint?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * WSZYSTKIE sprinty grupy — wykres predkosci potrzebuje kilku ostatnich, nie tylko
 * biezacego. Ten sam filtr UPPER_CASE co w `fetchActiveSprint`: `groupId` pisane
 * malymi literami po cichu oddaje pusta liste.
 */
/**
 * WSZYSCY aktywni pracownicy portalu, a nie tylko ci, ktorzy trafili do zadan.
 * Lista osob budowana z zadan pokazuje kilkunascie nazwisk z jednego projektu,
 * co wystarcza do FILTROWANIA (po kims bez zadan i tak nie ma czego filtrowac),
 * ale nie do wzmianek `@` - tam trzeba dosiegnac calej firmy, takze kogos, kto
 * nie ma u nas ani jednego zadania.
 *
 * Sciagamy WSZYSTKICH (z 158 kont 93 to osoby juz nieaktywne), ale kazdy dostaje
 * flage `active` i wolajacy decyduje, kogo pokazac:
 *
 *  - wzmianki `@` i wybor osob -> TYLKO aktywni; podpowiadanie kogos, kogo nie ma
 *    juz w firmie, jest bez sensu;
 *  - ROZWIAZYWANIE NAZWISK -> wszyscy. Byly pracownik zostaje obserwatorem starych
 *    zadan, wiec filtrujac po samych aktywnych pokazywalismy w filtrze "#102"
 *    zamiast "Grzegorz Wozniak".
 *
 * `USER_TYPE` odsiewamy dodatkowo u siebie - dzis kazde konto na tym portalu to
 * `employee`, ale konta zewnetrzne (extranet, e-mail, boty) nie maja czego szukac
 * we wzmiankach, gdyby kiedys sie pojawily.
 */
export interface Employee extends Person {
  /** `false` = konto wylaczone (byly pracownik). Patrz komentarz przy `fetchEmployees`. */
  active: boolean;
  /** Dzialy pracownika (`UF_DEPARTMENT`) — po nich poznajemy, kto jest z IT (patrz `planAssign.ts`). */
  departments: number[];
}

export async function fetchEmployees(): Promise<Employee[]> {
  const PAGE = 50;
  const raw: any[] = [];
  for (let start = 0, page = 0; page < 20; page++) {
    // BEZ filtra ACTIVE — patrz komentarz nizej, potrzebujemy takze wylaczonych.
    const chunk = await call<any[]>('user.get', { start });
    const got = chunk ?? [];
    raw.push(...got);
    if (got.length < PAGE) break;
    start += PAGE;
  }

  return raw
    .filter((u) => str(u.USER_TYPE) === 'employee')
    .map((u) => ({
      id: Number(u.ID),
      // Czesc kont to skrzynki dzialow ("Lakiernia", "Zwroty i wymiany") - maja samo
      // imie i zadnego nazwiska. Zostaja: wspomnienie dzialu jest sensowne.
      name: [str(u.NAME), str(u.LAST_NAME)].filter(Boolean).join(' ').trim() || `#${u.ID}`,
      photo: photoUrl(u.PERSONAL_PHOTO),
      active: u.ACTIVE === true || u.ACTIVE === 'Y',
      departments: (Array.isArray(u.UF_DEPARTMENT) ? u.UF_DEPARTMENT : [])
        .map(Number)
        .filter((d: number) => Number.isFinite(d)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export async function fetchSprints(groupId: number): Promise<Sprint[]> {
  /*
   * Metoda stronicuje po 50, ale - inaczej niz reszta REST-u - NIE oddaje ani
   * `next`, ani `total` (sprawdzone: start=0 daje 50 pozycji i next=null,
   * start=50 kolejne 16). Petla oparta na `next`, jak w `fetchProjects`, urwie
   * sie wiec po pierwszej stronie i zostawi 50 NAJSTARSZYCH sprintow, czyli
   * dokladnie nie te, o ktore chodzi - biezacy jest na koncu. Przewijamy sami
   * o dlugosc strony i konczymy na stronie krotszej niz pelna.
   *
   * Blad LECI DALEJ, nie zamienia sie w pusta liste. Przy `catch { return [] }`
   * dashboard mowil "Ten projekt nie ma jeszcze sprintow" takze wtedy, gdy portal
   * odrzucil zapytanie (QUERY_LIMIT_EXCEEDED) - czyli podawal falszywa przyczyne.
   * Lepiej pokazac prawdziwy komunikat niz uspokajajace klamstwo.
   */
  const PAGE = 50;
  const raw: any[] = [];
  for (let start = 0, page = 0; page < 20; page++) {
    const chunk = await call<any[]>('tasks.api.scrum.sprint.list', {
      filter: { GROUP_ID: groupId },
      start,
    });
    const got = chunk ?? [];
    raw.push(...got);
    if (got.length < PAGE) break;
    start += PAGE;
  }

  return raw
    .map((s) => ({
      id: Number(s.id),
      name: str(s.name),
      dateStart: str(s.dateStart) || null,
      dateEnd: str(s.dateEnd) || null,
      status: str(s.status),
    }))
    .filter((s) => Number.isFinite(s.id) && s.dateStart)
    .sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)));
}

/** Zadanie sprintu w ujeciu wykresow: tyle, ile trzeba, zeby je „spalic". */
export interface SprintTask {
  id: number;
  storyPoints: number | null;
  /** Kiedy zadanie zostalo domkniete (null = wciaz otwarte). */
  closedAt: string | null;
  /**
   * Kiedy zadanie PIERWSZY RAZ trafilo do akceptacji (status 4).
   *
   * `closedAt` sie do tego nie nadaje: Bitrix NADPISUJE date zamkniecia przy
   * kazdym kolejnym domknieciu, wiec zadanie oddane do sprawdzenia 20 sierpnia,
   * a wdrozone 1 wrzesnia, ma tam 1 wrzesnia. Przy liczeniu akceptacji jako
   * zrobionej spalaloby sie o tydzien za pozno — suma dobra, dzien zly.
   */
  reviewAt: string | null;
  /**
   * Kiedy zadanie trafilo DO TEGO sprintu — albo `null`, gdy bylo w nim od poczatku.
   *
   * Bitrix loguje `MOVE_TO_SPRINT` z data, ale BEZ numeru sprintu (`from`/`to` sa
   * puste), wiec sprint rozpoznajemy po tym, w czyje okno wpada znacznik czasu.
   * Przeniesienia z sprintu na sprint (przenoszenie ogona) NIE zostawiaja wpisu,
   * wiec zadania przeniesione dostaja `null` i licza sie od dnia pierwszego —
   * co jest poprawne, bo faktycznie byly w sprincie od jego startu.
   */
  addedAt: string | null;
  /** Kto odpowiada — wykres da sie zawezic do jednej osoby. */
  responsibleId: number | null;
  responsibleName: string | null;
  /**
   * Czy zadanie jest NAPRAWDE gotowe, czyli stoi w kolumnie typu FINISH.
   *
   * Nie wystarczy `closedAt`: Bitrix stempluje date zamkniecia juz przy statusie 4
   * ("Czeka na kontrolę"), wiec wszystko z "Do zatwierdzenia / PR" wygladaloby na
   * zrobione — w Sprincie 65 to 100 z 254 SP. Wlasny wykres Bitriksa spala tylko
   * kolumne FINISH (258 -> 190, czyli dokladnie 68 SP z "Wdrożone"), i to jest
   * uczciwsze: praca czekajaca na akceptacje nie jest dostarczona.
   */
  done: boolean;
  /**
   * Kolumna tablicy, w ktorej zadanie STOI TERAZ — do podzialki per etap.
   *
   * Same `done` na to nie wystarcza: mowi tylko „czy w FINISH", czyli skleja
   * „Nowe", „W toku" i „Do zatwierdzenia" w jedno „jeszcze nie". Etapy sa
   * wlasnoscia SPRINTU (kazdy ma swoj komplet o tych samych nazwach), wiec to id
   * ma sens wylacznie razem ze `stages` z tego samego pobrania.
   */
  stageId: number | null;
}

/**
 * Wynik jednego pobrania sprintu: zadania ORAZ kolumny jego tablicy.
 *
 * Etapy jada razem z zadaniami, bo i tak byly juz pobierane (do rozpoznania
 * kolumny FINISH) i po prostu ladowaly w koszu. Osobne `fetchStages` z pulpitu
 * kosztowaloby drugie wywolanie po dokladnie te same dane.
 */
export interface SprintData {
  tasks: SprintTask[];
  /** Kolumny tablicy TEGO sprintu, w kolejnosci z tablicy (`sort`). */
  stages: Stage[];
}

/**
 * Zadania JEDNEGO sprintu razem ze story pointami.
 *
 * UWAGA na filtr: `SPRINT_ID` (UPPER_CASE) zwraca zadania sprintu, ale `sprintId`
 * jest po cichu IGNOROWANY i oddaje cala grupe — sprawdzone na zywo: 14 zadan
 * wobec 1135. To ta sama pulapka co `GROUP_ID` w `sprint.list` i `epic.list`.
 *
 * Moment domkniecia bierzemy z `closedDate` samego zadania, a nie z dziennika
 * zmian: dziennik kosztuje jedno wywolanie NA ZADANIE, a `closedDate` przychodzi
 * gratis z lista. Cena jest taka, ze zadanie domkniete i ponownie otwarte pokaze
 * tylko OSTATNIE domkniecie — na wykresie spalania to rzadki przypadek brzegowy.
 */
export async function fetchSprintTasks(sprintId: number): Promise<SprintData> {
  /*
   * STRONICOWANIE JEST OBOWIAZKOWE. `tasks.task.list` oddaje najwyzej 50 pozycji
   * na strone, a sprint spokojnie miewa ich wiecej (Sprint 65 = 63). Bez petli
   * suma story pointow liczy sie z pierwszej piecdziesiatki i wychodzi ZANIZONA,
   * cicho: nie ma bledu, jest po prostu mniejsza liczba niz w Bitriksie.
   */
  const tasks: any[] = [];
  for (let start = 0, page = 0; page < 40; page++) {
    const res = await call<{ tasks: any[] }>('tasks.task.list', {
      filter: { SPRINT_ID: sprintId },
      select: ['ID', 'CLOSED_DATE', 'RESPONSIBLE_ID', 'STAGE_ID'],
      start,
    }).catch(() => ({ tasks: [] as any[] }));

    const chunk = res?.tasks ?? [];
    tasks.push(...chunk);
    if (chunk.length < 50) break;
    start += 50;
  }

  const ids = tasks.map((t) => Number(t.id)).filter(Number.isFinite);
  if (!ids.length) return { tasks: [], stages: [] };

  const meta = await fetchScrumMeta(ids);

  /*
   * Moment oddania do akceptacji czytamy z dziennika zmian — tylko dla zadan
   * ZAMKNIETYCH, bo otwarte jeszcze nigdzie nie trafily. To jedno wywolanie na
   * zadanie, pakowane po 50 w batch (w Sprincie 65 okolo 38 zadan = jeden
   * dodatkowy round-trip). Blad pojedynczego zadania nie moze wywalic wykresu,
   * wiec przy braku wpisu zostaje `closedAt`.
   */
  const closedIds = ids;
  const reviewAt = new Map<number, string>();
  const movedAt = new Map<number, string>();
  if (closedIds.length) {
    /*
     * Kazde zadanie osobnym batchem-jednoelementowym? Nie — ale `callBatch` rzuca
     * na PIERWSZYM bledzie w paczce i gubi to, co juz zebral. Jedno zadanie bez
     * dostepu do historii kasowaloby wtedy daty oddania do akceptacji dla CALEGO
     * sprintu i cala krzywa cicho przesuwalaby sie o kilka dni. Dzielimy wiec na
     * mniejsze paczki: awaria psuje najwyzej swoja czesc.
     */
    const logs: any[] = [];
    for (let i = 0; i < closedIds.length; i += 20) {
      const part = closedIds.slice(i, i + 20);
      const got = await callBatch(
        part.map((id) => ({ method: 'tasks.task.history.list', params: { taskId: id } })),
      ).catch(() => part.map(() => null));
      logs.push(...got);
    }

    logs.forEach((log, i) => {
      const rows: any[] = log?.list ?? [];
      const first = rows
        .filter((r) => str(r?.field) === 'STATUS' && str(r?.value?.to) === '4')
        .map((r) => str(r.createdDate))
        .filter(Boolean)
        .sort()[0];
      if (first) reviewAt.set(closedIds[i], first);

      /* Ostatnie wejscie do sprintu — wczesniejsze dotycza sprintow sprzed tego. */
      const moved = rows
        .filter((r) => str(r?.field) === 'MOVE_TO_SPRINT')
        .map((r) => str(r.createdDate))
        .filter(Boolean)
        .sort()
        .pop();
      if (moved) movedAt.set(closedIds[i], moved);
    });
  }

  // Etapy TEGO sprintu — kazdy sprint ma wlasny komplet o tych samych nazwach,
  // wiec „gotowe" trzeba rozstrzygnac po typie kolumny, nie po jej nazwie czy id.
  const stages = (await fetchStages([sprintId]).catch(() => [])).sort((a, b) => a.sort - b.sort);
  const finish = new Set(stages.filter((st) => st.type === 'FINISH').map((st) => st.id));

  const rows = tasks.map((t) => ({
    id: Number(t.id),
    storyPoints: meta.get(Number(t.id))?.storyPoints ?? null,
    // Te same trzy warianty klucza co w `normalizeTask` — `tasks.task.list` oddaje
    // raz `responsibleId`, raz `RESPONSIBLE_ID`, a przy rozwinietym polu tylko
    // `responsible.id`. Wezsze odczytanie dziala, dopoki Bitrix nie zmieni ksztaltu
    // odpowiedzi, i wtedy CICHO gasi cala liste osob na wykresie.
    closedAt: str(t.closedDate ?? t.CLOSED_DATE) || null,
    reviewAt: reviewAt.get(Number(t.id)) ?? null,
    addedAt: movedAt.get(Number(t.id)) ?? null,
    responsibleId: relId(t.responsibleId ?? t.RESPONSIBLE_ID ?? t.responsible?.id),
    responsibleName: str(t.responsible?.name ?? t.responsibleName) || null,
    done: finish.has(relId(t.stageId ?? t.STAGE_ID) ?? -1),
    stageId: relId(t.stageId ?? t.STAGE_ID),
  }));

  return { tasks: rows, stages };
}

/**
 * Projekty, w ktorych jestem — do przelacznika w pasku.
 *
 * `sonet_group.user.groups` zwraca grupy uzytkownika Z WEBHOOKA, czyli dokladnie
 * "moje". Swiadomie NIE uzywamy `sonet_group.get`: ono oddaje wszystko, co na
 * portalu widoczne (tu 85 grup wobec 4 wlasnych), a przy okazji stronicuje po 50,
 * wiec bez paginacji po cichu gubiloby reszte.
 *
 * Projekt, w ktorym nie ma mnie na liscie, wciaz da sie otworzyc — po numerze,
 * wpisanym w pole filtra przelacznika.
 *
 * Blad polykamy, bo webhook moze nie miec uprawnienia `sonet_group`: zostaje
 * wtedy projekt z .env i aplikacja dziala jak przed dodaniem wyboru.
 */
export async function fetchProjects(): Promise<Project[]> {
  const raw: any[] = [];

  try {
    // Metoda jest z rodziny legacy i te nie deklaruja `total` — idziemy po `next`,
    // dopoki cos oddaje. Licznik obrotow jest bezpiecznikiem, nie limitem danych.
    for (let start = 0, page = 0; page < 20; page++) {
      const json = await coalesceRaw<any[]>('sonet_group.user.groups', { start });
      const chunk: any[] = json.result ?? [];
      raw.push(...chunk);

      const next = Number(json.next);
      if (!chunk.length || !Number.isFinite(next) || next <= start) break;
      start = next;
    }
  } catch {
    return [];
  }

  return raw
    .map((g) => ({
      id: Number(g.GROUP_ID),
      // Nazwy grup bywaja zapisane z koncowa spacja ("Peowiaków ") — widac to w UI.
      name: str(g.GROUP_NAME).trim() || `#${g.GROUP_ID}`,
      role: str(g.ROLE),
    }))
    .filter((g) => Number.isFinite(g.id) && g.id > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export interface ChecklistItem {
  id: number;
  title: string;
  done: boolean;
  /** Zagniezdzenie w drzewie checklisty (0 = bezposrednio pod checklista). */
  depth: number;
}

/**
 * Checklisty w Bitriksie to DRZEWO (pole `parentId`) o DOWOLNEJ glebokosci: wezel na
 * poziomie 0 to sama checklista (np. "BX_CHECKLIST_1"), jej potomkowie to pozycje —
 * a te moga miec WLASNE podpozycje (i jeszcze glebiej). Zadanie moze miec kilka
 * checklist, dlatego grupujemy. Splaszczamy CALE poddrzewo z `depth`, zeby zagniezdzone
 * pozycje nie ginely (dawniej brano tylko bezposrednie dzieci — sub-itemy przepadaly).
 */
export interface ChecklistGroup {
  id: number;
  /** Pusty tytul = luzne pozycje / techniczna nazwa checklisty (BX_CHECKLIST_N). */
  title: string;
  items: ChecklistItem[];
}

function checklistGroups(v: unknown): ChecklistGroup[] {
  const nodes = Object.values((v ?? {}) as Record<string, any>)
    .filter(Boolean)
    .map((c: any) => ({
      id: Number(c.id ?? c.ID),
      parentId: Number(c.parentId ?? c.PARENT_ID ?? 0),
      title: str(c.title ?? c.TITLE),
      done: c.isComplete === true || c.isComplete === 'Y' || c.IS_COMPLETE === 'Y',
    }))
    .filter((c) => c.title && Number.isFinite(c.id));

  const byParent = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId);
    if (list) list.push(n);
    else byParent.set(n.parentId, [n]);
  }
  // Kolejnosc jak w UI Bitriksa = kolejnosc tworzenia (id). `sortIndex` z API bywa
  // niespojny (np. ukonczona pozycja ma 0, a i tak wisi na koncu), wiec go nie uzywamy.
  const kids = (parentId: number) => (byParent.get(parentId) ?? []).slice().sort((a, b) => a.id - b.id);

  // Techniczna nazwa checklisty ("BX_CHECKLIST_1") nie jest naglowkiem dla usera.
  const isSynthetic = (t: string) => /^BX_CHECKLIST_\d+$/i.test(t);

  const groups: ChecklistGroup[] = [];
  const loose: ChecklistItem[] = [];
  for (const root of kids(0)) {
    const rootKids = kids(root.id);
    if (rootKids.length === 0) {
      // Wezel poziomu 0 bez dzieci = pojedyncza luzna pozycja.
      loose.push({ id: root.id, title: root.title, done: root.done, depth: 0 });
      continue;
    }
    // Root z dziecmi = checklista. Splaszczamy CALE poddrzewo (rekurencyjnie) z depth.
    const items: ChecklistItem[] = [];
    const walk = (parentId: number, depth: number) => {
      for (const n of kids(parentId)) {
        items.push({ id: n.id, title: n.title, done: n.done, depth });
        walk(n.id, depth + 1);
      }
    };
    walk(root.id, 0);
    groups.push({ id: root.id, title: isSynthetic(root.title) ? '' : root.title, items });
  }
  if (loose.length) groups.unshift({ id: 0, title: '', items: loose });
  return groups;
}

/**
 * Zalacznik zadania. `id` to identyfikator DOCZEPIENIA (`UF_TASK_WEBDAV_FILES`),
 * `objectId` — pliku na Dysku. Potrzebne oba: bajty ciagniemy po `id`
 * (`/api/attach/<id>`), ale opis odwoluje sie do obrazkow po `objectId`
 * (`[DISK FILE ID=n437269]`), wiec bez tej pary nie da sie ich skojarzyc.
 */
export interface TaskAttachment {
  id: number;
  objectId: number;
  name: string;
  image: boolean;
}

export interface TaskDetail {
  /**
   * Do KTOREGO zadania naleza te szczegoly.
   *
   * Bez tego nie dalo sie odroznic „szczegoly juz sa" od „szczegoly sa, ale
   * jeszcze poprzedniego zadania" — a z nich bierze sie `chatId`, po ktorym
   * ciagniemy komentarze. Patrz komentarz przy `Comments` w App.tsx.
   */
  taskId: number;
  description: string;
  /** Wspolwykonawcy i obserwatorzy zadania — pola specyficzne dla Bitriksa. */
  accomplices: Person[];
  auditors: Person[];
  checklist: ChecklistGroup[];
  creatorName: string | null;
  creatorId: number | null;
  creatorPhoto: string | null;
  favorite: boolean;
  timeEstimate: number;
  /** Story pointy scruma — `null` gdy nieoszacowane lub projekt bez scruma. */
  storyPoints: number | null;
  /** Pliki doczepione do zadania — takze te wstawione w opis. */
  attachments: TaskAttachment[];
  /** Czat zadania — dzisiejsze komentarze leza tam, nie na forum (patrz `fetchComments`). */
  chatId: number | null;
}

export interface Person {
  id: number;
  name: string;
  photo: string | null;
}

/** `accomplicesData` / `auditorsData` to mapa id -> dane uzytkownika (albo tablica). */
function people(v: unknown): Person[] {
  return Object.values((v ?? {}) as Record<string, any>)
    .filter(Boolean)
    .map((u) => ({
      id: Number(u.id ?? u.ID),
      name: [u.name ?? u.NAME, u.lastName ?? u.LAST_NAME].filter(Boolean).join(' ').trim() || `#${u.id}`,
      photo: personPhoto(u),
    }))
    .filter((p) => Number.isFinite(p.id));
}

/**
 * Szczegoly pobierane dopiero przy otwarciu zadania — opisy potrafia miec kilka kB,
 * a checklisty i obserwatorzy nie sa potrzebne na liscie.
 */
export async function fetchTaskDetail(taskId: number): Promise<TaskDetail> {
  const [res, scrum] = await Promise.all([
    /*
     * `select` jest tu KONIECZNE. Bez niego `tasks.task.get` oddaje swoj domyslny
     * zestaw pol, w ktorym NIE MA zadnego pola uzytkownika — `ufTaskWebdavFiles`
     * wraca jako `undefined`, lista zalacznikow wychodzi pusta i obrazki wstawione
     * w opis nie maja sie z czym skojarzyc. `*` dokłada wszystko, co bylo do tej
     * pory, wiec reszta pobrania zostaje bez zmian.
     */
    call<any>('tasks.task.get', { taskId, select: ['*', 'UF_TASK_WEBDAV_FILES'] }),
    // Story pointy leza na scrumowym bycie zadania, nie na samym zadaniu.
    // Projekt bez scruma odpowie bledem — wtedy zostaje `null` (brak oszacowania).
    call<any>('tasks.api.scrum.task.get', { id: taskId }).catch(() => null),
  ]);
  const t = res?.task ?? {};

  /*
   * Zadanie oddaje SAME identyfikatory doczepien; nazwa i typ pliku wymagaja
   * osobnego pytania. Idzie jednym batchem, a niepowodzenie kosztuje zalaczniki,
   * nie cale zadanie — opis i komentarze maja sie pokazac tak czy owak.
   */
  const attachIds = (Array.isArray(t.ufTaskWebdavFiles) ? t.ufTaskWebdavFiles : [])
    .map((v: unknown) => Number(v))
    .filter((n: number) => Number.isFinite(n) && n > 0);

  let attachments: TaskAttachment[] = [];
  if (attachIds.length) {
    try {
      const raw = await callBatch(attachIds.map((id: number) => ({ method: 'disk.attachedObject.get', params: { id } })));
      attachments = raw
        .map((r: any, i: number) => {
          const o = Array.isArray(r) ? r[0] : r;
          if (!o?.OBJECT_ID) return null;
          const name = str(o.NAME);
          return {
            id: attachIds[i],
            objectId: Number(o.OBJECT_ID),
            name,
            image: /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name),
          };
        })
        .filter((a): a is TaskAttachment => a !== null);
    } catch {
      // brak zalacznikow nie moze zablokowac otwarcia zadania
    }
  }

  return {
    description: str(t.description),
    accomplices: people(t.accomplicesData),
    auditors: people(t.auditorsData),
    checklist: checklistGroups(t.checklist),
    creatorName: personName(t.creator),
    creatorId: personId(t.creator),
    creatorPhoto: personPhoto(t.creator),
    favorite: t.favorite === 'Y' || t.favorite === true,
    timeEstimate: Number(t.timeEstimate ?? 0),
    storyPoints: storyPointValue(scrum?.storyPoints),
    chatId: relId(t.chatId),
    taskId: Number(t.id ?? t.ID),
    attachments,
  };
}

// ─── Komentarze ──────────────────────────────────────────────────────────────

/*
 * Komentarze zadania leza w Bitriksie w DWOCH miejscach i zadne nie widzi drugiego:
 *
 *  - forum  — stary mechanizm, czytany przez `task.commentitem.getlist`. Zadanie
 *             ma go tylko wtedy, gdy ma `forumTopicId`. U nas to zaimportowana
 *             partia (numery 109xxx).
 *  - czat   — kazde zadanie ma `chatId` i to tam trafia dzisiejsza dyskusja.
 *
 * Dlatego pytamy oba i sklejamy po dacie. Objaw, ktory to wykryl: IT-754 mial
 * `newCommentsCount: 2`, a panel pokazywal "Brak komentarzy" — bo zadanie nie ma
 * forum, a komentarz siedzial w czacie.
 */
/**
 * Zalacznik komentarza. `id` to identyfikator pliku na Dysku — bajty ciagniemy
 * przez `/api/file/<id>`, bo kazdy adres, ktory Bitrix podaje wprost, albo niesie
 * token webhooka, albo wymaga sesji w portalu (patrz komentarz przy tej trasie
 * w `server/bxProxy.ts`).
 */
export interface CommentFile {
  id: number;
  name: string;
  /** Obrazki rysujemy w tresci; reszta zostaje odnosnikiem z nazwa pliku. */
  image: boolean;
  /** Proporcje z Bitriksa — miniatura rezerwuje miejsce, wiec watek nie skacze. */
  width: number | null;
  height: number | null;
}

export interface Comment {
  id: number;
  authorId: number;
  authorName: string;
  authorPhoto: string | null;
  text: string;
  date: string | null;
  /** Numery z obu zrodel moga sie powtorzyc, wiec klucz Reacta sklada sie z obu pol. */
  source: 'forum' | 'chat';
  files: CommentFile[];
}

const stamp = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Legacy API — parametry sa UPPER_CASE i pozycyjne, inaczej niz w `tasks.*`. */
async function fetchForumComments(taskId: number): Promise<Comment[]> {
  const res = await call<any[]>('task.commentitem.getlist', {
    TASKID: taskId,
    ORDER: { POST_DATE: 'asc' },
  });
  return (res ?? []).map((c) => ({
    id: Number(c.ID),
    authorId: Number(c.AUTHOR_ID),
    authorName: str(c.AUTHOR_NAME),
    // Ta metoda oddaje tylko imie i nazwisko — zdjecie dobiera `fetchPhotos`.
    authorPhoto: null,
    text: str(c.POST_MESSAGE),
    date: str(c.POST_DATE) || null,
    source: 'forum' as const,
    // Forum trzyma zalaczniki w `ATTACHED_OBJECTS` (identyfikatory doczepienia, nie
    // plikow) — inna sciezka niz czat, wiec na razie zostaje pusto.
    files: [],
  }));
}

/**
 * Zdjecia autorow, ktorych nie bylo w odpowiedzi z komentarzami. Dotyczy forum:
 * `task.commentitem.getlist` zwraca sam AUTHOR_NAME. Jedno zapytanie HTTP na
 * wszystkich (batch), a niepowodzenie kosztuje najwyzej inicjaly zamiast zdjecia.
 */
async function fetchPhotos(ids: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (!ids.length) return out;

  try {
    const res = await callBatch(ids.map((ID) => ({ method: 'user.get', params: { ID } })));
    res.forEach((r, i) => {
      const u = Array.isArray(r) ? r[0] : r;
      out.set(ids[i], photoUrl(u?.PERSONAL_PHOTO));
    });
  } catch {
    // brak zdjecia to nie powod, zeby nie pokazac komentarza
  }
  return out;
}

/**
 * Dluzsze watki sa ucinane — `im.dialog.messages.get` stronicuje wstecz przez
 * `LAST_ID`, ale komentarzy do zadania praktycznie nigdy nie ma tylu.
 */
const CHAT_LIMIT = 100;

async function fetchChatComments(chatId: number, beforeId?: number): Promise<Comment[]> {
  const res = await call<any>('im.dialog.messages.get', {
    DIALOG_ID: `chat${chatId}`,
    LIMIT: CHAT_LIMIT,
    /* `LAST_ID` stronicuje WSTECZ — oddaje wiadomosci starsze od podanej. */
    ...(beforeId ? { LAST_ID: beforeId } : {}),
  });

  /*
   * Nazwiska i zdjecia przychodza w tej samej odpowiedzi (pole `users`) — zero
   * dodatkowych zapytan. Adresy avatarow z CDN-a Bitriksa potrafia miec spacje
   * (nazwa wgranego pliku), wiec musza przejsc przez `photoUrl` — bez tego <img>
   * sie nie laduje i w kolku zostaja same inicjaly.
   */
  const names = new Map<number, string>();
  const photos = new Map<number, string | null>();
  for (const u of Object.values((res?.users ?? {}) as Record<string, any>)) {
    const id = Number((u as any)?.id);
    if (!Number.isFinite(id)) continue;
    names.set(id, str((u as any).name).trim());
    photos.set(id, photoUrl((u as any).avatar));
  }

  /*
   * `files` bywa slownikiem, a bywa tablica — zaleznie od wersji portalu. Bierzemy
   * wartosci w obu przypadkach, zamiast zakladac jedno i gasnac przy drugim.
   */
  const rawFiles = (res?.files ?? {}) as Record<string, any> | any[];
  const byFile = new Map<number, CommentFile>();
  for (const f of Array.isArray(rawFiles) ? rawFiles : Object.values(rawFiles)) {
    const id = Number((f as any)?.id);
    if (!Number.isFinite(id)) continue;
    byFile.set(id, {
      id,
      name: str((f as any).name) || `plik ${id}`,
      image: str((f as any).type) === 'image',
      width: Number((f as any).image?.width) || null,
      height: Number((f as any).image?.height) || null,
    });
  }

  return Object.values((res?.messages ?? {}) as Record<string, any>)
    .filter(Boolean)
    .map((m: any) => {
      const authorId = Number(m.author_id);
      return {
        id: Number(m.id),
        authorId,
        authorName: names.get(authorId) || `#${authorId}`,
        authorPhoto: photos.get(authorId) ?? null,
        text: str(m.text),
        date: str(m.date) || null,
        source: 'chat' as const,
        /*
         * Pliki przychodza OBOK wiadomosci, we wspolnym worku `files`; wiadomosc
         * trzyma same numery w `params.FILE_ID`. Zero dodatkowych zapytan.
         */
        files: ((m.params?.FILE_ID ?? []) as unknown[])
          .map((id) => byFile.get(Number(id)))
          .filter((f): f is CommentFile => Boolean(f)),
      };
    })
    /*
     * `author_id: 0` to wpisy systemowe — "zmienil etap na W toku", "jest teraz
     * obserwatorem", "utworzono czat zadania". W czacie zadania jest ich
     * wielokrotnie wiecej niz prawdziwych komentarzy i bez tego filtra dyskusja
     * ginie w dzienniku zmian.
     */
    /*
     * ...ale komentarz z SAMYM obrazkiem ma pusty tekst i wypadal tu razem z nimi,
     * czyli nie bylo go widac w ogole — nie "bez zdjecia", tylko wcale.
     */
    .filter((c) => c.authorId !== 0 && (c.text || c.files.length > 0));
}

/**
 * `chatId` bierzemy z `tasks.task.get` (patrz `fetchTaskDetail`). Gdy go nie znamy
 * — bo szczegoly sie nie wczytaly — zostaje samo forum; lepiej to niz nic.
 * Forum pytamy zawsze: dla zadania bez watku odpowiada natychmiast pusta lista.
 */
export async function fetchComments(taskId: number, chatId: number | null): Promise<Comment[]> {
  const [forum, chat] = await Promise.all([
    fetchForumComments(taskId),
    chatId === null ? Promise.resolve<Comment[]>([]) : fetchChatComments(chatId),
  ]);

  /*
   * Zdjecia dla forum. Najpierw za darmo — ta sama osoba czesto pisala tez
   * w czacie, a stamtad avatar juz mamy. Dopiero po reszte idziemy do user.get,
   * wiec przy zadaniu bez forum (czyli wiekszosci) nie ma zadnego dodatkowego
   * zapytania.
   */
  if (forum.length) {
    const known = new Map(chat.map((c) => [c.authorId, c.authorPhoto]));
    const missing = [...new Set(forum.map((c) => c.authorId))].filter(
      (id) => Number.isFinite(id) && id > 0 && !known.has(id),
    );
    const fetched = await fetchPhotos(missing);

    for (const c of forum) {
      c.authorPhoto = known.get(c.authorId) ?? fetched.get(c.authorId) ?? null;
    }
  }

  return [...forum, ...chat].sort((a, b) => stamp(a.date) - stamp(b.date));
}

/**
 * STARSZA porcja watku — do przycisku „Pokaz starsze".
 *
 * Pierwsze pobranie bierze `CHAT_LIMIT` ostatnich wiadomosci; przy dlugiej
 * dyskusji poczatek po prostu nie istnial w panelu i nie bylo tego nawet widac.
 * Pusta odpowiedz znaczy „to juz caly watek" — wolajacy chowa wtedy przycisk.
 *
 * Tylko czat: forum oddaje swoje komentarze w calosci za pierwszym razem.
 */
export async function fetchOlderComments(chatId: number, beforeId: number): Promise<Comment[]> {
  const starsze = await fetchChatComments(chatId, beforeId);
  return starsze.sort((a, b) => stamp(a.date) - stamp(b.date));
}

export interface ChatTail {
  /** Od najstarszej do najnowszej, z wpisami systemowymi (author_id 0). */
  messages: ChatMessage[];
  /** Autor → jego dzialy w strukturze firmy (pole `departments` w `users`). */
  departments: Map<number, number[]>;
}

const TAIL_PAGE = 50;

/**
 * Koncowka czatu w surowej postaci — dla licznika odpowiedzi, nie dla panelu.
 *
 * Surowy BBCode, bo kotwica to „[B]1." pytan wywiadu. Dzialy autorow przychodza
 * w tej samej odpowiedzi, wiec odroznienie IT od reszty nie kosztuje zapytania.
 * Druga strona tylko wtedy, gdy w pierwszej pelnej nie ma zadnych pytan — kotwica
 * to OSTATNIA runda, wiec lezy prawie zawsze w najnowszych wiadomosciach.
 */
export async function fetchChatTail(chatId: number, pages = 2): Promise<ChatTail> {
  const messages: ChatMessage[] = [];
  const departments = new Map<number, number[]>();
  let lastId: number | undefined;

  for (let p = 0; p < pages; p++) {
    const res = await call<any>('im.dialog.messages.get', {
      DIALOG_ID: `chat${chatId}`,
      LIMIT: TAIL_PAGE,
      ...(lastId ? { LAST_ID: lastId } : {}),
    });
    for (const u of Object.values((res?.users ?? {}) as Record<string, any>)) {
      const id = Number(u?.id);
      if (Number.isFinite(id)) departments.set(id, ((u?.departments ?? []) as unknown[]).map(Number));
    }
    const got: ChatMessage[] = Object.values((res?.messages ?? {}) as Record<string, any>)
      .filter(Boolean)
      .map((m: any) => ({ id: Number(m.id), authorId: Number(m.author_id) || 0, text: str(m.text) }));
    messages.push(...got);
    if (got.length < TAIL_PAGE || got.some((m) => QUESTION.test(m.text))) break;
    lastId = Math.min(...got.map((m) => m.id));
  }

  messages.sort((a, b) => a.id - b.id);
  return { messages, departments };
}

export async function addComment(taskId: number, text: string, authorId: number): Promise<void> {
  await call('task.commentitem.add', {
    TASKID: taskId,
    FIELDS: { POST_MESSAGE: text, AUTHOR_ID: authorId },
  });
}

/** Zalacznik gotowy do wyslania: nazwa i bajty juz zakodowane base64. */
export interface Upload {
  name: string;
  base64: string;
}

/**
 * Komentarz Z ZALACZNIKAMI — wklejony zrzut ekranu i tym podobne.
 *
 * `task.commentitem.add` nie umie doczepic pliku, wiec idziemy droga czatu, ta
 * sama, ktora uzywa sam Bitrix:
 *
 *  1. `im.disk.folder.get` — kazdy czat ma wlasny folder na Dysku,
 *  2. `disk.folder.uploadfile` — wgranie bajtow (base64) do tego folderu,
 *  3. `im.disk.file.commit` — dopiero to ZAMIENIA wgrane pliki w wiadomosc,
 *     razem z trescia komentarza. `UPLOAD_ID` przyjmuje tablice, wiec kilka
 *     zrzutow idzie jako JEDEN komentarz, a nie seria osobnych.
 *
 * Powstaly komentarz binear czyta bez zadnych zmian: `fetchChatComments` bierze
 * numery z `params.FILE_ID` i dane ze wspolnego worka `files`.
 */
export async function addCommentWithFiles(
  taskId: number,
  chatId: number,
  text: string,
  pliki: Upload[],
): Promise<void> {
  const folder = await call<any>('im.disk.folder.get', { CHAT_ID: chatId });
  const folderId = Number(folder?.ID);
  if (!Number.isFinite(folderId) || folderId <= 0) {
    throw new BxError('Nie udało się ustalić folderu czatu dla załączników');
  }

  /*
   * NAZWA MUSI BYC UNIKALNA W FOLDERZE. Dysk odmawia duplikatu — `DISK_OBJ_22000`
   * („Plik o takiej nazwie juz istnieje"), a nie dokleja licznika sam. Firefox
   * przy wklejaniu zrzutu nadaje plikowi ZAWSZE te sama nazwe, wiec pierwszy
   * zrzut w zadaniu przechodzil, a kazdy nastepny sie odbijal.
   *
   * Doklejamy znacznik czasu w base36 przed rozszerzeniem: nazwa zostaje
   * czytelna, a kolizja wymagalaby dwoch wgran w tej samej milisekundzie.
   */
  const unikalna = (nazwa: string, i: number) => {
    const kropka = nazwa.lastIndexOf('.');
    const rdzen = kropka > 0 ? nazwa.slice(0, kropka) : nazwa;
    const ext = kropka > 0 ? nazwa.slice(kropka) : '';
    return `${rdzen}-${(Date.now() + i).toString(36)}${ext}`;
  };

  /* Po kolei, nie rownolegle: przepustnica i tak przepuszcza dwa zapytania na
     sekunde, a szereg latwiej opisac, gdy ktores wgranie padnie. */
  const ids: number[] = [];
  for (const [i, p] of pliki.entries()) {
    const res = await call<any>('disk.folder.uploadfile', {
      id: folderId,
      data: { NAME: unikalna(p.name, i) },
      fileContent: p.base64,
    });
    const id = Number(res?.ID);
    if (id) ids.push(id);
  }
  if (!ids.length) throw new BxError('Żaden załącznik nie został wgrany');

  await call('im.disk.file.commit', { CHAT_ID: chatId, UPLOAD_ID: ids, MESSAGE: text, taskId });
}

/**
 * Zmiana tresci komentarza.
 *
 * Dwa zrodla = dwie metody, dokladnie jak przy czytaniu (patrz `fetchComments`):
 * komentarz z forum ma wlasna metode zadaniowa, a komentarz z czatu jest wiadomoscia.
 *
 * DLA CZATU IDZIEMY PRZEZ `im.v2.*`, NIE PRZEZ `im.message.update`.
 *
 * Stare `im.message.update` ma OKNO CZASOWE — po jego uplywie oddaje
 * `CANT_EDIT_MESSAGE` („Time has expired for modification or you don't have
 * access"), a dlugosci okna nie da sie odczytac: dokumentacja mowi tylko, ze
 * ustawia ja portal, i nie ma jej w polach wiadomosci. Zmierzone: 15 minut
 * przechodzi, 7 i 10 dni juz nie.
 *
 * `im.v2.Chat.Message.update` tego limitu NIE MA i nie stawia znacznika
 * „zmieniono" — czyli zachowuje sie dokladnie tak, jak edycja komentarza we
 * wlasnym interfejsie Bitriksa. Sprawdzone na komentarzu sprzed 10 dni: w tej
 * samej sekundzie stara metoda odmawiala, a ta zapisala tresc i pozwolila ja
 * przywrocic co do znaku. Metody nie ma ani w `methods`, ani w dokumentacji.
 *
 * `taskId` nie jest jej parametrem — jedzie tylko po to, zeby wpis w dzienniku
 * wiedzial, ktorego zadania dotyczy (patrz `taskIdOf`). Sprawdzone, ze nadmiarowy
 * klucz jej nie przeszkadza.
 */
export async function editComment(
  comment: { id: number; source: 'forum' | 'chat' },
  taskId: number,
  text: string,
): Promise<void> {
  if (comment.source === 'forum') {
    await call('task.commentitem.update', {
      TASKID: taskId,
      ITEMID: comment.id,
      FIELDS: { POST_MESSAGE: text },
    });
    return;
  }
  await call('im.v2.Chat.Message.update', {
    messageId: comment.id,
    fields: { message: text },
    taskId,
  });
}

/**
 * Usuniecie komentarza. Nieodwracalne — wywolujacy MUSI wczesniej zapytac.
 *
 * Ta sama para zrodel co przy edycji. Wersja czatowa bierze TABLICE numerow
 * (`messageIds`), bo pod spodem stoi kolekcja wiadomosci; pojedynczy `messageId`
 * odbija sie od konstruktora. Dla nas to zawsze jedna pozycja.
 */
export async function deleteComment(
  comment: { id: number; source: 'forum' | 'chat' },
  taskId: number,
): Promise<void> {
  if (comment.source === 'forum') {
    await call('task.commentitem.delete', { TASKID: taskId, ITEMID: comment.id });
    return;
  }
  await call('im.v2.Chat.Message.delete', { messageIds: [comment.id], taskId });
}

// ─── Historia / czas w toku ──────────────────────────────────────────────────

/**
 * Jeden wpis z dziennika zmian zadania (`tasks.task.history.list`). Interesuje nas
 * tylko zmiana statusu, ale metoda loguje kazde pole (tytul, opis, komentarz…),
 * wiec filtrujemy po `field` dopiero po stronie klienta.
 */
export interface HistoryEntry {
  createdDate: string | null;
  /** Nazwa zmienionego pola: STATUS / REAL_STATUS / STAGE_ID / TITLE… */
  field: string;
  from: string;
  to: string;
  /** Kto zmienil — API oddaje to w `user`, a przy zmianach z zewnatrz to sedno. */
  by: string | null;
}

/**
 * Pelny dziennik zmian zadania. Metoda stronicuje po `next` (jak `sonet_group`),
 * a wpisow bywa duzo (kazda edycja to osobny rekord), wiec licznik obrotow jest
 * bezpiecznikiem. To metoda TYLKO DO ODCZYTU — nic nie zmienia w zadaniu.
 */
export async function fetchTaskHistory(taskId: number): Promise<HistoryEntry[]> {
  const all: any[] = [];

  for (let start = 0, page = 0; page < 20; page++) {
    const json = await post('tasks.task.history.list', {
      taskId,
      order: { createdDate: 'ASC' },
      start,
    });
    // Odpowiedz bywa `{ result: { list: [...] } }` albo samą tablicą — bierzemy oba.
    const res = json.result;
    const list: any[] = Array.isArray(res) ? res : (res?.list ?? []);
    all.push(...list);

    const next = Number(json.next);
    if (!list.length || !Number.isFinite(next) || next <= start) break;
    start = next;
  }

  return all.map((h) => ({
    createdDate: str(h.createdDate ?? h.CREATED_DATE) || null,
    field: str(h.field ?? h.FIELD),
    from: str(h.value?.from ?? h.value?.FROM ?? h.FROM_VALUE ?? ''),
    to: str(h.value?.to ?? h.value?.TO ?? h.TO_VALUE ?? ''),
    by: [str(h.user?.name), str(h.user?.lastName)].filter(Boolean).join(' ') || null,
  }));
}

/** Godziny robocze do "przycinania" bardzo dlugich odcinkow — patrz `clampWorkingMs`. */
export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 16;

/** Odcinek czasu (ms epoch) — jedno wejscie zadania w dany status i wyjscie z niego. */
export interface Interval {
  start: number;
  end: number;
}

/**
 * Odcinki, w ktorych zadanie bylo w statusie `target` (domyslnie "3" = W toku).
 * Wejscie w status to wpis `to === target`, wyjscie to najblizszy kolejny wpis zmiany
 * statusu. Gdy zadanie WCIAZ jest w tym statusie, odcinek konczy sie w `nowMs`.
 *
 * Bounce (W toku → kontrola → znowu W toku) daje kilka odcinkow — nic nie gubimy.
 *
 * Bitrix loguje zmiane statusu raz jako `STATUS`, raz jako `REAL_STATUS` (ta druga to
 * status "prawdziwy", bez pseudo-stanow typu "po terminie"). Gdyby liczyc oba, kazdy
 * odcinek policzylby sie podwojnie — dlatego bierzemy REAL_STATUS, a STATUS tylko gdy
 * REAL_STATUS w ogole nie ma.
 */
/** Nazwa etapu czytana jako "praca trwa". Dziennik zapisuje NAZWY, nie identyfikatory. */
const IN_PROGRESS_STAGE = /^\s*(w toku|in progress)\s*$/i;

/** Wspolny przebieg: z listy zmian jednego pola robi odcinki "bylo w X". */
function intervalsFrom(
  rows: { t: number; to: string }[],
  hits: (to: string) => boolean,
  nowMs: number,
): Interval[] {
  const out: Interval[] = [];
  let openStart: number | null = null;
  for (const r of rows.slice().sort((a, b) => a.t - b.t)) {
    if (openStart !== null) {
      out.push({ start: openStart, end: r.t });
      openStart = null;
    }
    if (hits(r.to)) openStart = r.t;
  }
  if (openStart !== null) out.push({ start: openStart, end: Math.max(openStart, nowMs) });
  return out;
}

export function inProgressIntervals(history: HistoryEntry[], nowMs: number, target = '3'): Interval[] {
  const at = (h: HistoryEntry) => (h.createdDate ? Date.parse(h.createdDate) : NaN);
  const rowsOf = (field: string) =>
    history.filter((h) => h.field === field).map((h) => ({ t: at(h), to: h.to })).filter((r) => Number.isFinite(r.t));

  /*
   * ETAP jest zrodlem PIERWSZYM, status zapasowym.
   *
   * W tym portalu praca plynie po kolumnach kanbana sprintu, a wbudowany status
   * bywa tylko przestawiany na koncu (2 -> 4). Do 2026-09-04 Bitrix trzymal status
   * w parze z etapem, wiec liczenie po statusie dawalo te same odcinki. Miedzy
   * 2026-09-04 a 2026-09-16 `moveToStage` zapisywal `STAGE_ID` przez
   * `tasks.task.update` zamiast `task.stages.movetask` i para sie rozjechala —
   * po samym statusie wychodzilo 0 minut (zadanie 116017 / IT-876: etap
   * Nowe -> W toku bez zadnego wpisu statusu). Od 2026-09-16 binear znow przesuwa
   * przez `movetask`, ale zadania z tamtego okresu zostaja w historii, wiec etap
   * pozostaje zrodlem pierwszym.
   *
   * Zrodla NIE SUMUJEMY. Dla zadan sprzed rozjazdu w dzienniku sa OBA wpisy z tym
   * samym znacznikiem czasu, wiec suma liczylaby kazdy odcinek dwa razy. Bierzemy
   * to, ktore w ogole cos ma — etap, a gdy zadanie nie ma historii etapow (np. nigdy
   * nie bylo w sprincie), wracamy do statusu.
   */
  const byStage = intervalsFrom(rowsOf('STAGE'), (to) => IN_PROGRESS_STAGE.test(to), nowMs);
  if (byStage.length) return byStage;

  const real = rowsOf('REAL_STATUS');
  return intervalsFrom(real.length ? real : rowsOf('STATUS'), (to) => to === target, nowMs);
}

/** Prosta suma odcinkow (czas zegarowy, bez przycinania). */
export function sumIntervalsMs(intervals: Interval[]): number {
  return intervals.reduce((acc, i) => acc + Math.max(0, i.end - i.start), 0);
}

/**
 * To samo, ale liczone TYLKO w godzinach pracy (domyslnie 8:00–16:00) i TYLKO w dni
 * robocze. Zadanie zostawione "w toku" na noc, weekend czy kilka dni nie ma naliczac
 * dob zegarowych — z kazdego odcinka bierzemy jedynie minuty w dziennym oknie pracy,
 * a soboty i niedziele pomijamy w calosci.
 *
 * Przyklad: 15:00 → 09:00 nastepnego dnia = 1 h (15→16) + 1 h (8→9) = 2 h.
 *
 * Iterujemy dzien po dniu przez `setDate` (odporne na zmiane czasu), a granice okna
 * liczymy w LOKALNEJ strefie przegladarki.
 */
export function clampWorkingMs(
  intervals: Interval[],
  startHour = WORK_START_HOUR,
  endHour = WORK_END_HOUR,
): number {
  let sum = 0;
  for (const { start, end } of intervals) {
    if (end <= start) continue;
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);
    while (day.getTime() <= end) {
      const dow = day.getDay(); // 0 = niedziela, 6 = sobota
      if (dow !== 0 && dow !== 6) {
        const winStart = new Date(day);
        winStart.setHours(startHour, 0, 0, 0);
        const winEnd = new Date(day);
        winEnd.setHours(endHour, 0, 0, 0);

        const lo = Math.max(start, winStart.getTime());
        const hi = Math.min(end, winEnd.getTime());
        if (hi > lo) sum += hi - lo;
      }
      day.setDate(day.getDate() + 1);
    }
  }
  return sum;
}

/**
 * Czy ktorykolwiek odcinek "w toku" przechodzi przez wiecej niz jeden dzien kalendarzowy
 * (inna data startu i konca). To sygnal, ze czas zegarowy lapie noce/weekendy i warto
 * spytac o przyciecie — inaczej niz prog "ponad 24 h", bo 16 h potrafi rozlac sie na dwa dni.
 */
export function spansMultipleDays(intervals: Interval[]): boolean {
  return intervals.some(({ start, end }) => {
    if (end <= start) return false;
    const a = new Date(start);
    a.setHours(0, 0, 0, 0);
    const b = new Date(end);
    b.setHours(0, 0, 0, 0);
    return b.getTime() > a.getTime();
  });
}

/**
 * Czas jako "3 dni 4 godz. 12 min" — puste jednostki znikaja, zero to "0 min".
 *
 * `hoursOnly` wylacza dni i podaje wszystko w godzinach ("25 godz. 10 min").
 * Do czasu PRZYCIETEGO do godzin pracy: tam „1 dzień 1 godz." klamie, bo dzien
 * roboczy ma osiem godzin, a nie dwadziescia cztery — czytajac „1 dzień" liczy
 * sie w glowie osiem i wychodzi trzy razy za malo. W czasie zegarowym dni
 * znacza dokladnie to, co powinny, wiec tam zostaja.
 */
export function formatDurationPl(ms: number, hoursOnly = false): string {
  const totalMin = Math.round(ms / 60000);
  const days = hoursOnly ? 0 : Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin - days * 1440) / 60);
  const mins = totalMin % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'dzień' : 'dni'}`);
  if (hours) parts.push(`${hours} godz.`);
  if (mins) parts.push(`${mins} min`);
  return parts.length ? parts.join(' ') : '0 min';
}

// ─── Mutacje ─────────────────────────────────────────────────────────────────

export async function updateTask(
  taskId: number,
  fields: Record<string, string | number>,
): Promise<void> {
  await call('tasks.task.update', { taskId, fields });
}

/**
 * Tagi zadania. Bitrix podmienia CALA liste, wiec wolajacy podaje komplet nazw
 * (dodanie = stary zestaw + nowa nazwa, usuniecie = zestaw bez niej). Osobna
 * funkcja, bo `updateTask` przyjmuje tylko pola skalarne, a `TAGS` to tablica.
 */
export async function updateTags(taskId: number, tags: string[]): Promise<void> {
  await call('tasks.task.update', { taskId, fields: { TAGS: tags } });
}

/** Nieodwracalne usuniecie zadania. W UI zawsze poprzedzone potwierdzeniem. */
export async function deleteTask(taskId: number): Promise<void> {
  await call('tasks.task.delete', { taskId });
}

/**
 * Zadania POWIAZANE (Bitrix: DEPENDS_ON, legacy CTaskItem). Nowe `tasks.task.*` tego
 * pola nie znaja, wiec:
 *  - odczyt: `task.item.getdependson` (zwraca tablice ID jako stringi),
 *  - zapis:  `task.item.update(TASKID, { DEPENDS_ON: [...] })` — Bitrix podmienia CALA
 *    liste, nie ma "dodaj jedno", wiec dodanie/usuniecie to odczyt + zapis zmienionej.
 */
export async function fetchRelated(taskId: number): Promise<number[]> {
  const ids = await call<string[] | null>('task.item.getdependson', { TASKID: taskId });
  return (ids ?? []).map(Number).filter((n) => Number.isFinite(n));
}

async function setRelated(taskId: number, ids: number[]): Promise<void> {
  // Pusta lista kasuje wszystkie powiazania. ARFIELDS to nazwa argumentu legacy metody.
  await call('task.item.update', { TASKID: taskId, ARFIELDS: { DEPENDS_ON: ids } });
}

export async function addRelated(taskId: number, otherId: number): Promise<void> {
  const cur = await fetchRelated(taskId);
  if (cur.includes(otherId)) return;
  await setRelated(taskId, [...cur, otherId]);
}

export async function removeRelated(taskId: number, otherId: number): Promise<void> {
  const cur = await fetchRelated(taskId);
  await setRelated(
    taskId,
    cur.filter((id) => id !== otherId),
  );
}

/**
 * Ktore z podanych zadan MAJA >=1 powiazane (DEPENDS_ON) — do plakietki na liscie.
 * DEPENDS_ON nie ma w danych listy, wiec pytamy per zadanie, ale batchem po 50 i bez
 * `halt` (blad pojedynczego zadania pomijamy, nie wywraca calosci). Zwraca zbior ID
 * zadan majacych powiazania.
 */
export async function fetchRelatedPresence(taskIds: number[]): Promise<Set<number>> {
  const chunks: number[][] = [];
  for (let i = 0; i < taskIds.length; i += 50) chunks.push(taskIds.slice(i, i + 50));

  const have = new Set<number>();
  // Batche puszczamy falami po kilka RÓWNOLEGLE — sekwencyjnie ~1000 zadan to 20 rund
  // i kilkadziesiat sekund. Concurrency ograniczone, zeby nie wpasc w limit webhooka.
  const CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY);
    await Promise.all(
      wave.map(async (chunk) => {
        const cmd: Record<string, string> = {};
        chunk.forEach((id, idx) => {
          cmd[String(idx)] = `task.item.getdependson?${toQuery({ TASKID: id }).join('&')}`;
        });
        try {
          const json = await post('batch', { halt: 0, cmd });
          // `result.result` jest kluczowane po kluczu komendy (idx); PUSTE wyniki Bitrix
          // POMIJA (klucza brak) — dlatego czytamy po idx, a nie po pozycji.
          const res = json.result?.result ?? {};
          chunk.forEach((id, idx) => {
            const arr = res[String(idx)];
            if (Array.isArray(arr) && arr.length > 0) have.add(id);
          });
        } catch {
          // Pojedynczy batch padl — pomijamy; brak plakietki jest lepszy niz wywrocenie.
        }
      }),
    );
  }
  return have;
}

/** Etap kanbana; dziala tylko dla zadan przypisanych do sprintu. */
/**
 * Samo pole etapu, BEZ logiki kolumn — Bitrix nie rusza przy tym statusu.
 *
 * Uzywane WYLACZNIE przy wejsciu do sprintu, do postawienia karty w kolumnie
 * wejsciowej: ta droga odpala regule nadajaca IT-NNN i jest sprawdzona na zywo.
 * Wszystko inne idzie przez `moveToStage`.
 */
async function writeStageField(taskId: number, stageId: number): Promise<void> {
  await call('tasks.task.update', { taskId, fields: { STAGE_ID: stageId } });
}

const stageSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Status prosto z zadania — `tasks.task.list` zobaczylby zmiane dopiero po minutach. */
async function readStatus(taskId: number): Promise<string> {
  const res = await call<any>('tasks.task.get', { taskId, select: ['ID', 'STATUS'] }).catch(() => null);
  return str(res?.task?.status);
}

/**
 * Przesuniecie karty tak, jak robi to Bitrix: przez `task.stages.movetask`.
 *
 * Kolumna niesie STATUS — W toku = 3, Do zatwierdzenia = 4, Wdrozone = 5,
 * Nowe = 2. Przy przeciaganiu w Bitriksie i przy synchronizacji z GitHubem
 * zmienia sie on razem z kolumna prawie zawsze (sprawdzone na 124 zadaniach z
 * trzech sprintow), a przy golym `tasks.task.update {STAGE_ID}` — nigdy. Zadania
 * przesuwane w binear staly wiec w kolumnie ze statusem, ktory do niej nie
 * pasowal, i wykres liczyl je inaczej niz kafelki.
 *
 * Wczesniej binear uzywal wlasnie tego (do 2026-09-04), po czym przeszedl na
 * `tasks.task.update`, bo `movetask` z id etapu sprintu zwracal `true` i nic nie
 * robil. Wtedy nie wiedzielismy jeszcze, ze karta musi najpierw trafic na
 * tablice (`kanban.addTask`, odkryte 2026-09-10) — bez karty nie bylo czego
 * przesuwac. Sprawdzone na zywo 2026-09-16 na zadaniu testowym: przesuwa karte
 * sprintu i status idzie za kolumna.
 *
 * Status zmienia Bitrix, nie my — chwile PO przesunieciu. Zwracamy go, zeby
 * `mutate` zapisal go jako nasz skutek: inaczej wrocilby z nastepna lista jako
 * „zmiana z zewnatrz", a na ekranie wisialby stary az do odswiezenia.
 */
export async function moveToStage(taskId: number, stageId: number): Promise<{ status: string } | undefined> {
  const was = await readStatus(taskId);
  await call('task.stages.movetask', { id: taskId, stageId });

  /* Na zadaniu testowym status byl gotowy po okolo sekundzie. Kolumna bez
     reguly statusu go nie zmieni — wtedy po prostu nic nie zwracamy. */
  for (let i = 0; i < 5; i++) {
    await stageSleep(500);
    const now = await readStatus(taskId);
    if (now && now !== was) return { status: now };
  }
  return undefined;
}

/**
 * Przeniesienie zadania miedzy sprintem a backlogiem.
 *
 * W scrumie "poza sprintem" nie jest brakiem przypisania, tylko przypisaniem do
 * INNEGO bytu: backlog grupy ma wlasne id (tu 229) dokladnie tak jak sprint (367),
 * a zadanie zawsze lezy w jednym z nich. Dlatego to jedna metoda w obie strony,
 * a nie osobne "dodaj" i "usun".
 *
 * `tasks.task.update({ SPRINT_ID })` NIE jest tu alternatywa: pole widac w
 * `getFields`, ale przynaleznosc trzyma osobna tabela scruma i przestawienie
 * samego pola rozjechaloby jedno z drugim.
 */
export async function moveToSprint(
  taskId: number,
  entityId: number,
  stageId?: number,
): Promise<{ status: string } | undefined> {
  /*
   * Wejscie do sprintu idzie PRZEZ KOLEJKE — patrz `queued`. Rownolegle wejscia
   * dostawaly ten sam numer IT, bo regula liczy go z listy, ktora nie nadaza za
   * zapisami. Powrot do backlogu numeru nie dotyczy, ale i tak nie ma go po co
   * wyprzedzac w kolejce.
   */
  return queued(() => enterSprint(taskId, entityId, stageId));
}

async function enterSprint(
  taskId: number,
  entityId: number,
  stageId?: number,
): Promise<{ status: string } | undefined> {
  /*
   * 1. PRZYNALEZNOSC do sprintu. Sama w sobie nie robi nic wiecej: nie nadaje
   *    etapu (`STAGE_ID` zostaje 0), nie stawia karty na tablicy i nie odpala
   *    zadnych regul.
   */
  await call('tasks.api.scrum.task.update', { id: taskId, fields: { entityId } });

  /* Powrot do backlogu — nie ma kolumny, w ktora cokolwiek mialoby wejsc. */
  if (stageId === undefined) return undefined;

  /*
   * KOLUMNA WEJSCIOWA. Automatyzacja nadajaca numer IT-XXX wisi na JEDNEJ
   * kolumnie — u nas "Nowe / Oczekujące" (typ NEW). Wejscie do sprintu prosto
   * na "W toku" czy "Do zatwierdzenia" nie odpala jej wcale, wiec zadanie
   * zostaje bez numeru.
   *
   * Dlatego kazde wejscie do sprintu prowadzimy przez kolumne NEW, a dopiero
   * potem przestawiamy karte tam, gdzie uzytkownik ja upuscil.
   *
   * Gdy etapow nie da sie pobrac, wchodzimy wprost na docelowa kolumne —
   * zadanie ma trafic do sprintu nawet za cene braku numeru.
   */
  const entryId =
    (await fetchStages([entityId]).catch(() => [] as Stage[])).find((st) => st.type === 'NEW')?.id ??
    stageId;

  /*
   * 2. KARTA na tablicy sprintu — krok, ktorego tu przez caly czas brakowalo.
   *
   * Bez niego zadanie owszem ma sprint i etap, ale dla tablicy Bitriksa nie
   * istnieje: nie ma karty, wiec nie ma czego "wpuscic" do kolumny. Reguly
   * kolumny (u nas: nadanie numeru IT-XXX i wlaczenie liczenia czasu) sluchaja
   * WLASNIE wejscia karty, nie zmiany pola.
   *
   * To tlumaczy stara zagadke: przeniesienie z binear wygladalo na udane —
   * `STAGE_ID` sie zapisywal, listy pokazywaly sprint i kolumne — a numer nie
   * przychodzil nigdy, w przeciwienstwie do przeciagniecia karty w Bitriksie.
   *
   * Sprawdzone na zywo 2026-09-10 (zadanie 116373 -> IT-895): dziennik zmian
   * pokazuje MOVE_TO_SPRINT, zaraz po nim STAGE "Nowe / Oczekujące" ->
   * "Nowe / Oczekujące" (to wlasnie jest owo WEJSCIE karty do kolumny), a
   * sekunde pozniej TITLE przepisany przez regule na "IT-895: ...".
   *
   * Kolejnosc jest istotna: reguly odpalaja na kroku 3, ale tylko wtedy, gdy
   * karta z kroku 2 juz stoi na tablicy. Przerwa miedzy wywolaniami nie jest
   * potrzebna.
   */
  await call('tasks.api.scrum.kanban.addTask', { sprintId: entityId, taskId, stageId: entryId });

  /*
   * 3. ETAP. Dopiero ten zapis Bitrix czyta jako wejscie karty do kolumny —
   *    i dopiero teraz odpalaja sie jej reguly.
   */
  /* Kolumna wejsciowa zostaje na sprawdzonej drodze — patrz `writeStageField`. */
  await writeStageField(taskId, entryId);



  /*
   * 4. DOCELOWA kolumna. Czekamy najpierw, az regula dopisze numer: przestawienie
   *    karty w trakcie jej pracy to wyscig, ktorego nie kontrolujemy, a numer jest
   *    tu cala stawka. Regula wyrabia sie w okolo sekunde (sprawdzone), wiec
   *    odpytujemy krotko i z gory ograniczonym budzetem.
   *
   *    Brak numeru po tym czasie NIE blokuje przeniesienia: uzytkownik prosil
   *    o konkretna kolumne i ma ja dostac, choćby numer mial nie przyjsc.
   */
  /*
   * Na numer czekamy ZAWSZE, takze gdy kolumna docelowa jest ta sama co
   * wejsciowa. Wczesniej bylo tu wyjscie „nie ma dokad przestawiac" — i przez
   * nie kolejka zwalniala sie, zanim numer byl widoczny dla listy. Czyli
   * dokladnie w najczestszym przypadku (kilka zadan wrzuconych do „Nowe /
   * Oczekujace") duplikaty pojawialyby sie dalej.
   */
  const code = await waitForCode(taskId);

  /*
   * Zanim oddamy kolejke nastepnemu zadaniu, upewniamy sie, ze lista WIDZI juz
   * ten numer — inaczej nastepne policzy to samo `max` i dostanie duplikat.
   * Gdy numer nie przyszedl wcale, nie ma na co czekac: przeniesienie i tak ma
   * sie odbyc, a brak numeru widac potem w tytule.
   */
  if (code) await waitForListed(code);

  /* Upuszczone wprost na kolumne wejsciowa — nie ma dokad przestawiac. */
  if (entryId === stageId) return undefined;

  /* Kolumna docelowa ZE statusem — tak, jak przy zwyklym przeciagnieciu. */
  return moveToStage(taskId, stageId);
}

/**
 * Krotkie oczekiwanie na numer IT-XXX dopisany przez automatyzacje kolumny.
 *
 * `tasks.task.get` czyta zadanie wprost i widzi zmiane od razu — w odroznieniu od
 * `tasks.task.list`, ktore po wejsciu do sprintu potrafi nie widziec zadania przez
 * dobrych kilka minut (sprawdzone 2026-09-10: filtr po samym ID zwracal pustke).
 */
async function waitForCode(taskId: number, budgetMs = 6000, stepMs = 700): Promise<string | null> {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, stepMs));
    const title = await call<any>('tasks.task.get', { taskId, select: ['ID', 'TITLE'] })
      .then((r) => str(r?.task?.title))
      .catch(() => '');
    const m = title.match(/\bIT-\d+/);
    if (m) return m[0];
  }
  return null;
}

/**
 * Czeka, az `tasks.task.list` ZOBACZY nadany numer.
 *
 * To nie jest ostroznosc na wyrost, tylko warunek konieczny dla NASTEPNEGO
 * zadania: regula liczy numer jako `max(IT-NNN w tytulach) + 1` wlasnie przez
 * `tasks.task.list`, a ta metoda po zapisie bywa o kilka minut z tylu. Dopoki
 * nowy numer nie jest dla niej widoczny, kolejne wejscie policzy to samo `max`
 * i dostanie TEN SAM numer (sprawdzone na zywo: szesc zadan przeniesionych
 * jednym gestem, wszystkie `IT-910`).
 */
async function waitForListed(code: string, budgetMs = 60_000, stepMs = 2000): Promise<boolean> {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    const seen = await call<any>('tasks.task.list', { filter: { '%TITLE': code }, select: ['ID'] })
      .then((r) => (r?.tasks ?? []).length > 0)
      .catch(() => false);
    if (seen) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

/*
 * KOLEJKA wejsc do sprintu.
 *
 * Wejscie odpala regule nadajaca numer, a ta liczy go z listy, ktora nie nadaza
 * za zapisami. Rownolegle wejscia — a tak dziala kazde zaznaczenie kilku zadan
 * i kazde przeciagniecie grupy — pytaja wiec o to samo `max` i dostaja ten sam
 * numer.
 *
 * Kolejka ustawia je jedno za drugim i przepuszcza nastepne dopiero wtedy, gdy
 * numer poprzedniego jest juz widoczny dla listy. Wolniej, ale numer jest
 * jedyna rzecza, ktora ta operacja ma naprawde wyprodukowac — a duplikatu nie
 * da sie naprawic inaczej niz recznie, zadanie po zadaniu.
 */
let sprintEntryQueue: Promise<unknown> = Promise.resolve();

function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = sprintEntryQueue.then(fn, fn);
  /* Blad jednego wejscia nie moze zablokowac kolejki dla nastepnych. */
  sprintEntryQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Story pointy leza na scrumowym bycie zadania (tak jak sprint), nie na samym
 * zadaniu — stad ta sama metoda co `moveToSprint`. Pusty string kasuje oszacowanie.
 */
/**
 * Wspolwykonawcy / obserwatorzy zadania.
 *
 * Osobno od `updateTask`, bo te pola sa TABLICAMI identyfikatorow, a tamta funkcja
 * przyjmuje pojedyncze wartosci.
 *
 * Pusta lista NIE moze isc jako pusta tablica: serializacja nie wyprodukowalaby
 * wtedy zadnego parametru, Bitrix nie zobaczylby pola i po prostu zostawilby stara
 * wartosc — czyli ostatniej osoby nie dalo by sie usunac. Pusty STRING czysci pole
 * (sprawdzone na zywo: `fields[AUDITORS]=` zdejmuje wszystkich).
 */
export async function updateParticipants(
  taskId: number,
  field: 'ACCOMPLICES' | 'AUDITORS',
  ids: number[],
): Promise<void> {
  await call('tasks.task.update', { taskId, fields: { [field]: ids.length ? ids : '' } });
}

export async function updateStoryPoints(taskId: number, points: number | ''): Promise<void> {
  await call('tasks.api.scrum.task.update', { id: taskId, fields: { storyPoints: points } });
}

/**
 * Epik zadania — jak sprint i story pointy, na scrumowym bycie zadania, stad ta
 * sama metoda. `0` odpina epik (zadanie bez tematu).
 */
export async function updateEpic(taskId: number, epicId: number): Promise<void> {
  await call('tasks.api.scrum.task.update', { id: taskId, fields: { epicId } });
}

/** Odhaczenie / cofniecie pozycji checklisty — dwie osobne metody Bitriksa. */
export async function setChecklistItem(taskId: number, itemId: number, done: boolean): Promise<void> {
  await call(done ? 'task.checklistitem.complete' : 'task.checklistitem.renew', {
    taskId,
    itemId,
  });
}

/**
 * Backlog projektu. Osobne zapytanie, bo `sonet_group` nic o nim nie wie,
 * a bez jego id nie ma jak wyjac zadania ze sprintu.
 *
 * Blad polykamy: projekt bez scruma nie ma backlogu i wtedy zostaje sam sprint.
 */
export async function fetchBacklogId(groupId: number): Promise<number | null> {
  try {
    const res = await call<any>('tasks.api.scrum.backlog.get', { id: groupId });
    const id = Number(res?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export interface AppConfig {
  groupId: string;
  userId: string | null;
  /** Adres portalu, wyciagniety z webhooka — bez zaszywania domeny w kodzie UI. */
  portal: string | null;
  /** Konto-zaslepka pokazywane jako "Nieprzypisane" — z .env (BX_UNASSIGNED_ID). */
  unassignedId: number;
  /**
   * Dzialy Bitriksa uznawane za IT — z .env (BX_IT_DEPARTMENTS). Licznik odpowiedzi
   * odroznia po nich pytajacych od odpowiadajacych. Pusto = IT to tylko konto webhooka.
   */
  itDepartments: number[];
  /**
   * Konta liczone jako IT bez wzgledu na dzial — z .env (BX_IT_USERS). Typowo konto,
   * z ktorego automat zadaje pytania wywiadu, gdy siedzi w dziale spoza IT.
   */
  itUsers: number[];
  /**
   * Odliczanie do konca sprintu — ilu programistow liczymy (z .env: BX_CAPACITY_DEVS,
   * domyslnie 4). Opcjonalne, bo migawka zapisana przez wczesniejsza wersje go nie ma.
   */
  capacityDevs?: number;
  /**
   * Odpowiedzialni, ktorych zadania NIE wchodza do limitu punktow (z .env:
   * BX_CAPACITY_EXCLUDE_IDS) — typowo kierownik, ktory nie liczy sie do pojemnosci.
   */
  capacityExcludeIds?: number[];
  configured: boolean;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config');
  return res.json();
}
