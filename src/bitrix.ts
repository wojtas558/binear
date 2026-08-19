/** Klient REST Bitrix — leci przez lokalne proxy, token nigdy nie trafia do przegladarki. */

export class BxError extends Error {
  constructor(
    message: string,
    readonly description?: string,
  ) {
    super(message);
  }
}

async function post(method: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/bx/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    throw new BxError(json?.error || `HTTP ${res.status}`, json?.error_description);
  }
  return json;
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return (await post(method, params)).result as T;
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

/**
 * `batch` pakuje do 50 wywolan w jedno zapytanie HTTP. Grupa IT SCRUM ma ~1000 zadan,
 * czyli 20 stron po 50 — sekwencyjnie to ~10 s, batchem dwa round-tripy.
 */
async function callBatch(cmds: BatchCmd[]): Promise<any[]> {
  const results: any[] = [];

  for (let i = 0; i < cmds.length; i += 50) {
    const chunk = cmds.slice(i, i + 50);
    const cmd: Record<string, string> = {};
    chunk.forEach((c, idx) => {
      cmd[String(idx)] = `${c.method}?${toQuery(c.params).join('&')}`;
    });

    const json = await post('batch', { halt: 0, cmd });
    const payload = json.result ?? {};
    const errors = payload.result_error ?? {};

    chunk.forEach((_, idx) => {
      const err = errors[String(idx)];
      if (err) throw new BxError(err.error ?? 'batch error', err.error_description);
      results.push(payload.result?.[String(idx)]);
    });
  }
  return results;
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
   * Nieprzeczytane komentarze — licznik prowadzi Bitrix wzgledem konta z webhooka.
   * Jest w `tasks.task.list`, wiec kropka na wierszu nie kosztuje ani jednego
   * dodatkowego zapytania.
   */
  newComments: number;
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
    // Dociagane osobno przez `fetchStoryPoints` — lista Bitriksa ich nie niesie.
    storyPoints: null,
    newComments: Math.max(0, Number(t.newCommentsCount ?? t.NEW_COMMENTS_COUNT ?? 0) || 0),
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
  'CREATED_DATE',
  'CHANGED_DATE',
  'CLOSED_DATE',
  'DEADLINE',
  'STAGE_ID',
  'SPRINT_ID',
  'PARENT_ID',
  'TAGS',
  'NEW_COMMENTS_COUNT',
];

const PAGE = 50;

export async function fetchTasks(groupId: number): Promise<Task[]> {
  const params = {
    filter: { GROUP_ID: groupId },
    select: LIST_SELECT,
    order: { ID: 'desc' },
  };

  // Pierwsza strona daje tez `total`, z ktorego wyliczamy reszte stron.
  const first = await post('tasks.task.list', { ...params, start: 0 });
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

/**
 * Story pointy dla listy zadan. Nie ma ich w `tasks.task.list` — kazdy punkt
 * to pole na scrumowym bycie zadania (`tasks.api.scrum.task.get`), wiec jedno
 * id = jedno wywolanie, pakowane po 50 w batch (dla ~1000 zadan to ~20 zapytan).
 *
 * Dlatego to przebieg TLOWY, odpalany po pierwszym renderze: `onChunk` oddaje
 * wyniki partiami, zeby badge'y pojawialy sie na biezaco, a nie po calosci.
 * Zwracamy tylko realne oszacowania (brak/zero pomijamy), wiec brak klucza w
 * mapie == "bez story pointow".
 */
export async function fetchStoryPoints(
  taskIds: number[],
  onChunk?: (points: Map<number, number>) => void,
): Promise<Map<number, number>> {
  const all = new Map<number, number>();

  for (let i = 0; i < taskIds.length; i += 50) {
    const ids = taskIds.slice(i, i + 50);
    // Zadanie spoza scruma zwroci blad i wywali caly batch — wtedy ta partia
    // po prostu nie dostaje story pointow (reszta przebiegu leci dalej).
    const results = await callBatch(
      ids.map((id) => ({ method: 'tasks.api.scrum.task.get', params: { id } })),
    ).catch(() => [] as any[]);

    const chunk = new Map<number, number>();
    results.forEach((r, j) => {
      const sp = storyPointValue(r?.storyPoints);
      if (sp !== null) chunk.set(ids[j], sp);
    });

    if (chunk.size) {
      chunk.forEach((v, k) => all.set(k, v));
      onChunk?.(chunk);
    }
  }

  return all;
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
    };
  } catch {
    return null;
  }
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
      const json = await post('sonet_group.user.groups', { start });
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
}

/**
 * Checklisty w Bitriksie to DRZEWO (pole `parentId`): wezel na poziomie 0 to tytul
 * checklisty, jego dzieci to pozycje. Zadanie moze miec kilka takich checklist —
 * dlatego grupujemy, a nie splaszczamy do jednej listy (inaczej naglowki liczyly
 * sie jako pozycje i 2 checklisty po 4 i 3 wygladaly jak jedna na 9).
 */
export interface ChecklistGroup {
  id: number;
  /** Pusty tytul = luzne pozycje bez sekcji (zwykla, jednopoziomowa checklista). */
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
  const bySort = (a: { id: number }, b: { id: number }) => a.id - b.id;

  const groups: ChecklistGroup[] = [];
  const loose: ChecklistItem[] = [];
  for (const top of (byParent.get(0) ?? []).slice().sort(bySort)) {
    const children = (byParent.get(top.id) ?? []).slice().sort(bySort);
    if (children.length > 0) {
      // Wezel z dziecmi = tytul checklisty; pozycje to jego dzieci.
      groups.push({
        id: top.id,
        title: top.title,
        items: children.map((c) => ({ id: c.id, title: c.title, done: c.done })),
      });
    } else {
      // Wezel bez dzieci = zwykla pozycja (checklista bez sekcji).
      loose.push({ id: top.id, title: top.title, done: top.done });
    }
  }
  if (loose.length) groups.unshift({ id: 0, title: '', items: loose });
  return groups;
}

export interface TaskDetail {
  description: string;
  /** Wspolwykonawcy i obserwatorzy zadania — pola specyficzne dla Bitriksa. */
  accomplices: Person[];
  auditors: Person[];
  checklist: ChecklistGroup[];
  creatorName: string | null;
  creatorId: number | null;
  favorite: boolean;
  timeEstimate: number;
  /** Story pointy scruma — `null` gdy nieoszacowane lub projekt bez scruma. */
  storyPoints: number | null;
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
    call<any>('tasks.task.get', { taskId }),
    // Story pointy leza na scrumowym bycie zadania, nie na samym zadaniu.
    // Projekt bez scruma odpowie bledem — wtedy zostaje `null` (brak oszacowania).
    call<any>('tasks.api.scrum.task.get', { id: taskId }).catch(() => null),
  ]);
  const t = res?.task ?? {};

  return {
    description: str(t.description),
    accomplices: people(t.accomplicesData),
    auditors: people(t.auditorsData),
    checklist: checklistGroups(t.checklist),
    creatorName: personName(t.creator),
    creatorId: personId(t.creator),
    favorite: t.favorite === 'Y' || t.favorite === true,
    timeEstimate: Number(t.timeEstimate ?? 0),
    storyPoints: storyPointValue(scrum?.storyPoints),
    chatId: relId(t.chatId),
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
export interface Comment {
  id: number;
  authorId: number;
  authorName: string;
  authorPhoto: string | null;
  text: string;
  date: string | null;
  /** Numery z obu zrodel moga sie powtorzyc, wiec klucz Reacta sklada sie z obu pol. */
  source: 'forum' | 'chat';
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

async function fetchChatComments(chatId: number): Promise<Comment[]> {
  const res = await call<any>('im.dialog.messages.get', {
    DIALOG_ID: `chat${chatId}`,
    LIMIT: CHAT_LIMIT,
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
      };
    })
    /*
     * `author_id: 0` to wpisy systemowe — "zmienil etap na W toku", "jest teraz
     * obserwatorem", "utworzono czat zadania". W czacie zadania jest ich
     * wielokrotnie wiecej niz prawdziwych komentarzy i bez tego filtra dyskusja
     * ginie w dzienniku zmian.
     */
    .filter((c) => c.authorId !== 0 && c.text);
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

export async function addComment(taskId: number, text: string, authorId: number): Promise<void> {
  await call('task.commentitem.add', {
    TASKID: taskId,
    FIELDS: { POST_MESSAGE: text, AUTHOR_ID: authorId },
  });
}

// ─── Mutacje ─────────────────────────────────────────────────────────────────

export async function updateTask(
  taskId: number,
  fields: Record<string, string | number>,
): Promise<void> {
  await call('tasks.task.update', { taskId, fields });
}

/** Etap kanbana; dziala tylko dla zadan przypisanych do sprintu. */
export async function moveToStage(taskId: number, stageId: number): Promise<void> {
  await call('task.stages.movetask', { id: taskId, stageId });
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
export async function moveToSprint(taskId: number, entityId: number): Promise<void> {
  await call('tasks.api.scrum.task.update', { id: taskId, fields: { entityId } });
}

/**
 * Story pointy leza na scrumowym bycie zadania (tak jak sprint), nie na samym
 * zadaniu — stad ta sama metoda co `moveToSprint`. Pusty string kasuje oszacowanie.
 */
export async function updateStoryPoints(taskId: number, points: number | ''): Promise<void> {
  await call('tasks.api.scrum.task.update', { id: taskId, fields: { storyPoints: points } });
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
  configured: boolean;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config');
  return res.json();
}
