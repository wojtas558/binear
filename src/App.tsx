import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CLOSED_STATUSES,
  FALLBACK_PRIORITY,
  FALLBACK_STATUS,
  addComment,
  fetchComments,
  fetchActiveSprint,
  fetchBacklogId,
  fetchChangedSince,
  fetchConfig,
  fetchFieldEnums,
  fetchProjects,
  fetchStages,
  fetchScrumMeta,
  fetchEpics,
  fetchTaskDetail,
  fetchTaskHistory,
  fetchTasks,
  fetchRelated,
  fetchRelatedPresence,
  addRelated,
  removeRelated,
  formatDurationPl,
  inProgressIntervals,
  sumIntervalsMs,
  clampWorkingMs,
  spansMultipleDays,
  WORK_START_HOUR,
  WORK_END_HOUR,
  latestChange,
  moveToSprint,
  deleteTask,
  moveToStage,
  setChecklistItem,
  updateStoryPoints,
  updateEpic,
  updateTags,
  updateTask,
  type AppConfig,
  type Comment,
  type Epic,
  type FieldEnums,
  type Project,
  type Sprint,
  type Stage,
  type Task,
  type TaskDetail,
} from './bitrix';
import {
  getCachedComments,
  getCachedDetail,
  setCachedComments,
  setCachedDetail,
} from './detailCache';
import { renderDescription, setPortalBase } from './markdown';
import { ErrorBoundary } from './ErrorBoundary';
import { checkForUpdate, runUpdate, type UpdateInfo } from './version';
import {
  Avatar,
  ChevronIcon,
  GroupIcon,
  PriorityIcon,
  SearchIcon,
  StageIcon,
  StatusIcon,
  ListIcon,
  BoardIcon,
  DirIcon,
  RefreshIcon,
  ViewsIcon,
  statusColor,
  SubtaskIcon,
  ParentIcon,
  LinkIcon,
  MoreIcon,
  CheckIcon,
  CloseIcon,
  CommentIcon,
  CopyIcon,
  ExternalIcon,
  ElsewhereIcon,
  TrashIcon,
  PinIcon,
  tagHue,
} from './icons';
import {
  MONTHS,
  shortDate,
  isUnassigned,
  setUnassignedId,
  sumPoints,
  UNASSIGNED_ID,
  UNASSIGNED_LABEL,
} from './taskView';
import { Board } from './Board';
import { CommandPalette, type Command } from './CommandPalette';
import { applyTheme, loadTheme, watchSystemTheme, THEMES, type Theme } from './theme';
import { applyFont, loadFont, FONTS, type Font } from './font';
import { loadProject, saveProject } from './project';
import { loadSeen, saveSeen } from './seen';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  collisionDetection,
  dragId,
  groupDropId,
  parseDrag,
  parseDrop,
  snapToCursor,
  subDropId,
} from './dnd';

/** Zakres listy. Domyslnie tylko aktywny sprint — reszta jest na jedno klikniecie obok. */
type Scope = 'sprint' | 'outside' | 'all';
type GroupBy = 'stage' | 'status' | 'assignee';
type PickerKind =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'stage'
  | 'sprint'
  | 'points'
  | 'parent'
  | 'epic'
  | 'tags';
type ViewMode = 'list' | 'board';

/*
 * Filtry w stylu Linear: pasek nad lista, do ktorego dokladasz warunki. Kazdy
 * wymiar (osoba, priorytet, etap, status, tag) to jeden "chip" z lista wybranych
 * wartosci. W obrebie jednego wymiaru wartosci lacza sie przez LUB (pasuje
 * dowolna z nich), a rozne wymiary przez ORAZ (wszystkie musza pasowac) —
 * dokladnie jak w Linearze.
 *
 * Filtr etapu trzymamy po NAZWIE, nie po id: te same etapy powtarzaja sie miedzy
 * sprintami pod innym id (patrz stageOrder), wiec filtr po id przezylby tylko
 * jeden sprint. Filtr osoby trzyma id — konto-zaslepke zbijamy do UNASSIGNED_ID,
 * dzieki czemu jeden warunek "Nieprzypisane" lapie i braki, i zaslepke.
 */
type FilterField = 'assignee' | 'priority' | 'stage' | 'status' | 'tag' | 'epic';

/**
 * Operatory jak w Linearze. Wymiary jednowartosciowe (osoba/priorytet/status/etap —
 * zadanie ma jedna wartosc) dostaja `is`/`isNot`; tag jest wielowartosciowy, wiec ma
 * `anyOf`/`allOf`/`noneOf`. Pusty zestaw wartosci nie zawezaja niczego.
 */
type FilterOp = 'is' | 'isNot' | 'anyOf' | 'allOf' | 'noneOf';

/** Jeden warunek paska. Ten sam wymiar moze wystapic wiele razy (np. tag = X ORAZ tag ≠ Y). */
interface Condition {
  id: string;
  field: FilterField;
  op: FilterOp;
  values: string[];
}

/** Lista warunkow — miedzy warunkami ORAZ, wewnatrz warunku decyduje operator. */
type Filters = Condition[];

const FILTER_FIELDS: { field: FilterField; label: string }[] = [
  { field: 'assignee', label: 'Osoba' },
  { field: 'priority', label: 'Priorytet' },
  { field: 'stage', label: 'Etap' },
  { field: 'status', label: 'Status' },
  { field: 'epic', label: 'Epik' },
  { field: 'tag', label: 'Tag' },
];

const FILTER_LABEL = Object.fromEntries(FILTER_FIELDS.map((f) => [f.field, f.label])) as Record<
  FilterField,
  string
>;

/** Wymiary, w ktorych zadanie ma WIELE wartosci naraz — tylko tam ma sens „wszystkie z". */
const MULTI_FIELDS = new Set<FilterField>(['tag']);

/**
 * Pseudo-wartosc filtra tagu „Bez tagów" — zadanie bez zadnego tagu. Znak NUL nie
 * moze byc prawdziwym tagiem, wiec nie zderzy sie z nazwa. Traktowana jak zwykla
 * wartosc w warunku (anyOf/allOf/noneOf), tylko dopasowanie liczy pusta liste tagow.
 */
const NO_TAGS = '\u0000';

const opsFor = (field: FilterField): FilterOp[] =>
  MULTI_FIELDS.has(field) ? ['anyOf', 'allOf', 'noneOf'] : ['is', 'isNot'];

const defaultOp = (field: FilterField): FilterOp => opsFor(field)[0];

/** Podpis operatora na chipie. `many` = wybrano wiecej niz jedna wartosc. */
function opLabel(op: FilterOp, many: boolean): string {
  switch (op) {
    case 'is':
      return many ? 'to jedno z' : 'to';
    case 'isNot':
      return many ? 'to żadne z' : 'to nie';
    case 'anyOf':
      return 'dowolny z';
    case 'allOf':
      return 'wszystkie z';
    case 'noneOf':
      return 'żaden z';
  }
}

// Stabilne id warunku — wystarczy monotoniczny licznik na czas zycia karty.
let condSeq = 0;
const newCondId = (): string => `c${++condSeq}`;

/** Ile ikon pokazac w nachodzacym stosie na chipie, zanim przejdziemy na „+N". */
const CHIP_STACK_MAX = 5;

const EMPTY_FILTERS: Filters = [];

/** Czy jakikolwiek warunek realnie zawezaja (ma wybrane wartosci). */
const anyFilter = (f: Filters) => f.some((c) => c.values.length > 0);

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'sprint', label: 'Aktywny sprint' },
  { key: 'outside', label: 'Poza sprintem' },
  { key: 'all', label: 'Wszystkie' },
];

const GROUPS: { key: GroupBy; label: string; help: string }[] = [
  { key: 'stage', label: 'Etap w sprincie', help: 'Kolumny kanbana sprintu' },
  { key: 'status', label: 'Status zadania', help: 'Wbudowane pole Bitriksa' },
  { key: 'assignee', label: 'Osoba', help: 'Osoba odpowiedzialna' },
];

/** Klawisz -> rodzaj popovera. Jedna litera na wymiar zadania. */
const PICKER_KEYS: Record<string, PickerKind> = {
  s: 'status',
  a: 'assignee',
  p: 'priority',
  m: 'stage',
  // `s` zajmuje status, wiec sprint dostaje `w` — jak „wrzuc do sprintu".
  w: 'sprint',
};

interface Person {
  id: number;
  name: string;
  photo: string | null;
}

/*
 * Ustawienia widoku przezywaja odswiezenie. Zapisujemy tylko to, co jest
 * decyzja uzytkownika (widok, grupowanie, sortowanie, filtry) — NIE stan chwilowy
 * (zaznaczenie, zwiniete grupy, otwarte zadanie, filtr tagu), bo ten po powrocie
 * do aplikacji bylby juz nieaktualny i myllacy.
 * Wersja w kluczu: przy zmianie ksztaltu ustawien stare po prostu sie zignoruja.
 */
const SETTINGS_KEY = 'binear.view.v1';

interface Settings {
  viewMode: ViewMode;
  groupBy: GroupBy;
  subGroupBy: GroupBy | null;
  sort: SortOpts;
  scope: Scope;
  onlyMine: boolean;
  withUnassigned: boolean;
  showDone: boolean;
  /**
   * Puste grupy/kolumny. Lista: pokazuje naglowek etapu/statusu nawet bez zadan.
   * Tablica: gdy wylaczone, kolumna bez kart znika (np. "Wdrozone", gdy nic nie
   * jest wdrozone). Dotyczy tylko grupowania po etapie i statusie — przy osobie
   * nie ma skonczonego zbioru grup do domalowania.
   */
  showEmpty: boolean;
  /**
   * PUSTE kategorie (kolumny/grupy), ktore mimo braku zadan maja byc widoczne —
   * po NAZWIE, bo te same etapy maja rozne id w kazdym sprincie (patrz stageOrder).
   * Zastepuje dawny globalny przelacznik „Puste kolumny": zamiast wszystko-albo-nic
   * wybierasz w panelu, ktore konkretnie puste kategorie pokazac. Puste = zadna.
   */
  shownEmpty: string[];
  /** Szerokosc panelu szczegolow w px — ustawiana chwytem na jego lewej krawedzi. */
  detailWidth: number;
  /** Selektor zakresu jako karuzela (true) albo zwykla rozwijana lista (false). */
  scopeCarousel: boolean;
}

const DETAIL_MIN = 360;
/** Lista musi zostac uzywalna, wiec panel nigdy nie zabiera jej calej szerokosci. */
const detailMax = () => Math.max(DETAIL_MIN, window.innerWidth - 420);

const DEFAULT_SETTINGS: Settings = {
  viewMode: 'list',
  groupBy: 'stage',
  subGroupBy: null,
  sort: { by: 'updated', dir: 'desc', groupDir: 'asc' },
  scope: 'sprint',
  onlyMine: true,
  withUnassigned: false,
  showDone: false,
  showEmpty: false,
  shownEmpty: [],
  detailWidth: 520,
  scopeCarousel: true,
};

/**
 * Klucz przypietej kategorii = OS + nazwa. Sama nazwa by nie wystarczyla: „W toku"
 * jest jednoczesnie etapem i statusem, wiec przypiecie na jednej osi zapalaloby
 * te druga po przelaczeniu (pod)grupowania.
 */
const pinKey = (axis: GroupBy, name: string) => `${axis}:${name}`;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    // Scalamy z domyslnymi, zeby dolozenie nowego ustawienia nie wywrocilo startu.
    return { ...DEFAULT_SETTINGS, ...saved, sort: { ...DEFAULT_SETTINGS.sort, ...saved.sort } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Zapisany widok (jak w Linearze) — cały stan „na co patrzę": filtry, grupowanie,
 * sortowanie, zakres i przełączniki. GLOBALNY (nie per projekt) i tylko na tym
 * urządzeniu. Uwaga: filtry potrafią wskazywać wartości konkretnego projektu (nazwy
 * etapów, id osób), więc widok zastosowany w innym projekcie może nic nie złapać.
 */
interface SavedView {
  id: string;
  name: string;
  filters: Filters;
  /** Tekst z pola wyszukiwania — zapisywany razem z filtrami. */
  query: string;
  groupBy: GroupBy;
  subGroupBy: GroupBy | null;
  sort: SortOpts;
  scope: Scope;
  onlyMine: boolean;
  withUnassigned: boolean;
  showDone: boolean;
  showEmpty: boolean;
  viewMode: ViewMode;
}

const VIEWS_KEY = 'binear.views.v1';

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedView[]) : [];
    if (!Array.isArray(arr)) return [];
    // Widoki sprzed pola `query` (i innych) — domykamy braki, zeby apply/fingerprint
    // nie trafialy na undefined.
    return arr.map((v) => ({ ...v, query: v.query ?? '' }));
  } catch {
    return [];
  }
}

/** Porownywalny odcisk widoku — bez `id`/`name`, z filtrami bez ulotnych id warunkow. */
function viewFingerprint(v: Omit<SavedView, 'id' | 'name'>): string {
  return JSON.stringify({
    filters: v.filters.map((c) => ({ field: c.field, op: c.op, values: c.values })),
    query: v.query,
    groupBy: v.groupBy,
    subGroupBy: v.subGroupBy,
    sort: v.sort,
    scope: v.scope,
    onlyMine: v.onlyMine,
    withUnassigned: v.withUnassigned,
    showDone: v.showDone,
    showEmpty: v.showEmpty,
    viewMode: v.viewMode,
  });
}

/*
 * Bitrix wymaga osoby odpowiedzialnej na kazdym zadaniu, wiec zespol uzywa konta
 * "Klaudiusz Koder" (id 251) jako zaslepki dla zadan niczyich. W UI pokazujemy je
 * jako "Nieprzypisane" — inaczej lista klamie, ze ktos to wzial.
 * Uwaga: to samo konto jest AUTOREM wiekszosci zadan (masowy import) i tam
 * nazwa zostaje prawdziwa — zaslepka dotyczy WYLACZNIE osoby odpowiedzialnej.
 * Podmiana nazwy takze przy autorze zrobilaby z historii zadania bezimienna
 * liste "Nieprzypisane" i skasowalaby jedyny slad, skad zadanie sie wzielo.
 */
/* Konto-zaslepka i formatowanie daty mieszkaja w ./taskView — dzieli je z Board. */

/*
 * Osoba w tekscie (autor, wspolwykonawca, obserwator, autor komentarza). Konto-zaslepka
 * (id 251) pokazujemy WSZEDZIE jako "Nieprzypisane" — tak samo jak przy osobie
 * odpowiedzialnej — zeby nie raz bylo osoba, a raz zaslepka.
 */
function PersonInline({
  id,
  name,
  photo,
}: {
  id: number | null;
  name: string | null;
  photo?: string | null;
}) {
  const unassigned = isUnassigned(id);
  return (
    <>
      <Avatar name={unassigned ? null : name} photo={unassigned ? undefined : photo} />{' '}
      {unassigned ? UNASSIGNED_LABEL : name}
    </>
  );
}

/* Stala referencja — wchodzi do zaleznosci `useMemo` w Pickerze. */
const rawProjectLabel = (n: number) => `Otwórz projekt #${n}`;

/** Rola w projekcie. Zwykle uczestnictwo (`K`) nie dostaje dopisku — jest domyslne. */
const PROJECT_ROLE: Record<string, string> = { A: 'właściciel', E: 'moderator' };

/** Punkt zaczepienia popovera — wiersz listy albo miejsce klikniecia prawym. */
interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

/*
 * "Status" i "Etap" to w Bitriksie DWA NIEZALEZNE pola i latwo je pomylic:
 *  - Status  = wbudowane pole zadania (W oczekiwaniu / W toku / Zakonczone / …).
 *              Istnieje zawsze, niezaleznie od sprintu.
 *  - Etap    = kolumna kanbana KONKRETNEGO sprintu (Nowe / W toku /
 *              Do zatwierdzenia / PR / Wdrozone). Istnieje tylko w sprincie.
 * W tej grupie realny przeplyw pracy zyje w Etapie — Status jest praktycznie
 * nieuzywany (784 Zakonczone, 184 W oczekiwaniu, 29 Odlozone, reszta zero).
 * Nazwy w UI musza to rozroznienie niesc, bo same "Status"/"Etap" go nie niosa.
 */
const PICKER_TITLE: Record<PickerKind, string> = {
  status: 'Status zadania',
  assignee: 'Osoba',
  priority: 'Priorytet',
  stage: 'Etap w sprincie',
  sprint: 'Sprint',
  points: 'Story points',
  parent: 'Zadanie nadrzędne',
  epic: 'Epik',
  tags: 'Tagi',
};

const PICKER_HELP: Record<PickerKind, string> = {
  status: 'Wbudowane pole Bitriksa, niezależne od sprintu',
  assignee: 'Osoba odpowiedzialna za zadanie',
  priority: 'Priorytet zadania w Bitriksie',
  stage: 'Kolumna kanbana w sprincie — to nią steruje sync z gita',
  sprint: 'Wrzuć zadanie do sprintu albo odeślij do backlogu',
  points: 'Punkty scruma — szacunek złożoności',
  parent: 'Zadanie, pod którym to zadanie wisi',
  epic: 'Nadrzędny temat scruma grupujący zadania ponad sprintami',
  tags: 'Etykiety zadania — klikaj, aby dodać lub zdjąć',
};

/** Kolejnosc pozycji w menu kontekstowym; skrot pokazujemy jako podpowiedz. */
/* Etap na gorze — to nim steruje realny przeplyw pracy. Status zostaje dostepny,
   ale jako ostatni: w tej grupie zyje wlasnym zyciem i rzadko sie go rusza. */
const MENU_ITEMS: { kind: PickerKind; key: string }[] = [
  { kind: 'sprint', key: 'w' },
  { kind: 'stage', key: 'm' },
  { kind: 'assignee', key: 'a' },
  { kind: 'priority', key: 'p' },
  { kind: 'status', key: 's' },
];

/*
 * Kolumny, ktore nie sa krokiem w procesie, tylko jego ZATRZYMANIEM.
 *
 * Bitrix ich nie oznacza: `type` wypelnia wylacznie na skrajnych etapach
 * (NEW / WORK / FINISH), a "Wstrzymane" ma je puste — dokladnie tak samo jak
 * "Do zatwierdzenia / PR", ktore jest normalnym krokiem. Nie da sie ich wiec
 * rozroznic z danych i lista musi byc wprost.
 *
 * Zgadujemy po nazwie, bo kazdy sprint ma WLASNY komplet etapow o innych id
 * (te same nazwy, inne numery), wiec id nie przezylyby nastepnego sprintu.
 */
const PARKED_STAGES = new Set(['wstrzymane']);

const isParkedStage = (name: string) => PARKED_STAGES.has(name.trim().toLowerCase());

// ─── Dane + mutacje ──────────────────────────────────────────────────────────

interface Data {
  tasks: Task[];
  stages: Stage[];
  stageNames: Map<number, string>;
  /** Nazwa etapu -> pozycja w procesie. Etapy powtarzaja sie miedzy sprintami pod ta sama nazwa. */
  stageOrder: Map<string, number>;
  /**
   * stageId -> jak narysowac pierscien etapu (kolor kolumny + postep w procesie).
   * `progress: null` oznacza etap poza przeplywem — patrz PARKED_STAGES.
   */
  stageMeta: Map<number, { color: string | null; progress: number | null }>;
  /** Etykiety statusu i priorytetu prosto z portalu — zeby nie rozjechaly sie z Bitriksem. */
  labels: FieldEnums;
  activeSprint: Sprint | null;
  /**
   * Backlog projektu jako BYT scruma, nie jako "brak sprintu" — bez jego id nie
   * ma dokad odeslac zadania ze sprintu. `null` w projekcie bez scruma.
   */
  backlogId: number | null;
  config: AppConfig | null;
  /** Projekty do przelaczenia. Pusto, gdy webhook nie ma dostepu do grup roboczych. */
  projects: Project[];
  /** Epiki grupy — nadrzedne tematy scruma. Pusto w projekcie bez scruma. */
  epics: Epic[];
  /** epicId -> epik, do podpisu/koloru na wierszu i w panelu. */
  epicNames: Map<number, Epic>;
  /** Projekt, z ktorego pochodza `tasks` — rozstrzygniety wybor, nie preferencja. */
  groupId: number | null;
}

const EMPTY: Data = {
  tasks: [],
  stages: [],
  stageNames: new Map(),
  stageOrder: new Map(),
  stageMeta: new Map(),
  labels: { status: FALLBACK_STATUS, priority: FALLBACK_PRIORITY },
  activeSprint: null,
  backlogId: null,
  config: null,
  projects: [],
  epics: [],
  epicNames: new Map(),
  groupId: null,
};

interface Toast {
  id: number;
  text: string;
}

/**
 * Jak czesto pytac Bitriksa "czy cos sie zmienilo". Sonda to jedno zapytanie
 * o same ID zmienionych zadan, wiec 30 s nie jest tu zadnym obciazeniem.
 */
const POLL_MS = 30_000;

/**
 * Po tylu milisekundach bez ruchu myszy i klawisza uznajemy, ze nikogo nie ma,
 * i przestajemy pytac. Pieć minut, bo krotszy prog gasilby sonde przy czytaniu
 * dluzszego opisu, a dluzszy nie ratuje juz przed noca z otwarta karta.
 */
const IDLE_MS = 5 * 60_000;

function useBitrixData() {
  const [data, setData] = useState<Data>(EMPTY);
  /** Wybor uzytkownika; null = "ten z .env". Zmiana pociaga za soba pelne przeladowanie. */
  const [project, setProject] = useState<number | null>(loadProject);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  /**
   * Zadania, ktorych nie bylo przy poprzednim uruchomieniu. Trzymane w stanie,
   * a nie liczone na biezaco: `r` w trakcie pracy ma NIE gasic tych oznaczen,
   * bo inaczej wystarczy jedno odswiezenie i nie wiadomo juz, co przyszlo nowego.
   */
  const [newIds, setNewIds] = useState<Set<number>>(new Set());

  // Stan sprzed mutacji czytamy z refa — setState jest asynchroniczny,
  // a rollback musi znac dokladnie te wartosci, ktore nadpisalismy.
  const tasksRef = useRef<Task[]>([]);
  useEffect(() => {
    tasksRef.current = data.tasks;
  }, [data.tasks]);

  /** Najswiezsza data zmiany z ostatniego pobrania — prog sondy. */
  const watermarkRef = useRef<string | null>(null);
  /** Blokada nakladajacych sie pobran: sonda nie ma wchodzic w trwajace ladowanie. */
  const busyRef = useRef(false);
  /** Kiedy ostatnio cokolwiek zrobiles — patrz IDLE_MS. */
  const activeAtRef = useRef(Date.now());
  // Sonda czyta `pending` z refa, zeby nie restartowac interwalu przy kazdej mutacji.
  const pendingRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  /**
   * `silent` = odswiezenie w tle (sonda zmian, powrot do karty). Nie zapala
   * spinnera i nie zamienia widoku na ekran bledu — chwilowy brak sieci ma
   * zostawic ostatnie dobre dane na ekranie, a nie skasowac caly widok.
   */
  const load = useCallback(async (silent = false) => {
    // Recznemu odswiezeniu nigdy nie odmawiamy — inaczej `R` w trakcie sondy
    // wygladaloby na przycisk, ktory nie dziala.
    if (silent && busyRef.current) return;
    busyRef.current = true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const config = await fetchConfig();
      if (!config.configured) {
        throw new Error('Brak BITRIX_WEBHOOK w .env — skopiuj .env.example do .env i wklej URL webhooka.');
      }

      // Konto-zaslepka z .env — ustawiamy PRZED wczytaniem zadan, wiec grupowanie,
      // picker i widok "Nieprzypisane" czytaja juz wlasciwe id.
      setUnassignedId(config.unassignedId);

      // Renderer wzmianek potrzebuje adresu portalu; znamy go dopiero z konfiguracji.
      setPortalBase(config.portal);

      // Recznie wybrany projekt bije ten z .env — patrz src/project.ts.
      const groupId = project ?? Number(config.groupId);

      const [tasks, labels, activeSprint, projects, backlogId, epics] = await Promise.all([
        fetchTasks(groupId),
        fetchFieldEnums(),
        fetchActiveSprint(groupId),
        fetchProjects(),
        fetchBacklogId(groupId),
        fetchEpics(groupId),
      ]);

      /*
       * Nowosci liczymy wzgledem listy z poprzedniego uruchomienia. Pierwsze
       * wejscie do projektu tylko zapisuje stan — inaczej caly backlog zapalilby
       * sie jako "nowy" i badge nie znaczylby nic.
       */
      // Prog dla sondy zmian — patrz `fetchChangedSince`.
      watermarkRef.current = latestChange(tasks);

      const seen = loadSeen(groupId);
      const ids = tasks.map((t) => t.id);
      if (seen) {
        const fresh = ids.filter((id) => !seen.has(id));
        if (fresh.length) setNewIds((prev) => new Set([...prev, ...fresh]));
      }
      saveSeen(groupId, ids);

      // Etapy sa per sprint — pytamy tylko o sprinty, ktore realnie wystapily.
      const sprintIds = [...new Set(tasks.map((t) => t.sprintId).filter((v): v is number => !!v))];
      const stages = await fetchStages(sprintIds);

      /*
       * Kolejnosc etapow bierzemy z AKTYWNEGO sprintu. Ta sama nazwa ma rozny `sort`
       * w roznych sprintach (np. "Do zatwierdzenia / PR" to 300 w starych, 400 w 365),
       * wiec minimum po wszystkich 59 sprintach sklejalo etapy w zla kolejnosc.
       * Sprinty historyczne uzupelniaja tylko nazwy, ktorych aktywny nie ma.
       */
      const activeOrder = new Map<string, number>();
      const fallbackOrder = new Map<string, number>();
      for (const s of stages) {
        const r = stageRank(s);
        if (activeSprint && s.sprintId === activeSprint.id) {
          activeOrder.set(s.name, r);
        } else {
          const seen = fallbackOrder.get(s.name);
          if (seen === undefined || r < seen) fallbackOrder.set(s.name, r);
        }
      }
      // Aktywny sprint nadpisuje historyczne minimum dla tych samych nazw.
      const stageOrder = new Map([...fallbackOrder, ...activeOrder]);

      /*
       * Wypelnienie pierscienia = pozycja etapu w SWOIM sprincie (0 na pierwszym,
       * 1 na ostatnim). Liczone per sprint, bo kazdy ma wlasny zestaw kolumn.
       *
       * Etapy wstrzymania sa z tego rachunku WYLACZONE — nie zajmuja kroku ani
       * w liczniku, ani w mianowniku. Inaczej "Wstrzymane" (3. z 5 kolumn)
       * rysowalo sie jako 50% i wygladalo na BARDZIEJ zaawansowane niz "W toku"
       * (25%), a przeciez postoj nie posuwa zadania do przodu.
       */
      const stageMeta = new Map<number, { color: string | null; progress: number | null }>();
      const bySprint = new Map<number, Stage[]>();
      for (const s of stages) {
        const list = bySprint.get(s.sprintId);
        if (list) list.push(s);
        else bySprint.set(s.sprintId, [s]);
      }
      for (const list of bySprint.values()) {
        const ordered = [...list].sort((a, b) => a.sort - b.sort);
        const flow = ordered.filter((s) => !isParkedStage(s.name));

        for (const s of ordered) {
          if (isParkedStage(s.name)) {
            stageMeta.set(s.id, { color: s.color, progress: null });
            continue;
          }
          const i = flow.indexOf(s);
          const progress = s.type === 'FINISH' ? 1 : flow.length < 2 ? 0 : i / (flow.length - 1);
          stageMeta.set(s.id, { color: s.color, progress });
        }
      }

      setData((prev) => {
        // Story pointy z poprzedniego przebiegu przenosimy po id — swieza lista z
        // `fetchTasks` ma je puste, a bez tego badge'y gaslyby na kazdej cichej
        // sondzie i zapalaly sie od nowa dopiero po tlowym dociagnieciu. Id zadan
        // sa globalne, wiec nie ma ryzyka podmiany miedzy projektami.
        const carried = new Map(prev.tasks.map((t) => [t.id, { sp: t.storyPoints, ep: t.epicId }]));
        return {
          tasks: tasks.map((t) => {
            const c = carried.get(t.id);
            return c ? { ...t, storyPoints: c.sp, epicId: c.ep } : t;
          }),
          stages,
          stageNames: new Map(stages.map((s) => [s.id, s.name])),
          stageOrder,
          stageMeta,
          labels,
          activeSprint,
          backlogId,
          config,
          projects,
          epics,
          epicNames: new Map(epics.map((e) => [e.id, e])),
          groupId,
        };
      });

      /*
       * Scrumowe pola (story pointy + epik) dociagamy PO pierwszym renderze: to jedno
       * wywolanie na zadanie (~20 batchy dla ~1000 zadan), wiec blokowanie nimi startu
       * zabiloby szybki pierwszy obraz, o ktory cala ta sciezka walczy. Wyniki wpadaja
       * partiami i sa scalane po id; straznik `groupId` odrzuca je po przelaczeniu projektu.
       */
      void fetchScrumMeta(ids, (meta) => {
        setData((d) =>
          d.groupId === groupId
            ? {
                ...d,
                tasks: d.tasks.map((t) => {
                  const m = meta.get(t.id);
                  return m ? { ...t, storyPoints: m.storyPoints, epicId: m.epicId } : t;
                }),
              }
            : d,
        );
      }).catch(() => {
        /* Brak story pointow nie moze wywalic widoku — zostaja po prostu puste. */
      });
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Sonda zmian. Co POLL_MS pytamy Bitriksa wylacznie o to, czy w grupie cokolwiek
   * ruszylo od naszego znacznika (jedno pole, jedna strona) i dopiero niepusta
   * odpowiedz uruchamia pelne, ciche przeladowanie.
   *
   * Pomijamy sonde, gdy karta jest w tle (nie ma komu patrzec) i gdy trwa wlasna
   * mutacja — inaczej odpowiedz sprzed zapisu cofnelaby optymistyczna zmiane
   * na ekranie na te kilkaset milisekund, zanim REST zdazy potwierdzic.
   *
   * ORAZ gdy nikogo nie ma przy klawiaturze. `document.hidden` mowi tylko o karcie
   * w tle, a nie o Tobie: karta zostawiona na wierzchu wyglada dokladnie tak samo
   * jak uzywana, wiec sonda chodzila cala noc. Bezczynnosc liczymy sami — po
   * IDLE_MS bez ruchu myszy i klawisza przestajemy pytac, a pierwszy dotyk
   * klawiatury wznawia i OD RAZU dociaga dane, zeby nie patrzec na stare.
   *
   * Slepa plamka: USUNIETE zadanie nie ma juz daty zmiany, wiec sonda go nie zlapie.
   * Dlatego i powrot do karty, i powrot po bezczynnosci robia pelne odswiezenie,
   * nie sonde.
   */
  useEffect(() => {
    let stop = false;

    const idle = () => Date.now() - activeAtRef.current > IDLE_MS;
    /** Wspolny warunek: jest komu patrzec i nie wchodzimy w trwajace zapytanie. */
    const ready = () => !document.hidden && !busyRef.current && !pendingRef.current.size;

    const probe = async () => {
      const since = watermarkRef.current;
      const groupId = data.groupId;
      if (stop || !since || groupId === null) return;
      if (idle() || !ready()) return;
      try {
        if (await fetchChangedSince(groupId, since)) await load(true);
      } catch {
        // sonda nie ma prawa nic zepsuc — nastepna proba za POLL_MS
      }
    };

    const onActivity = () => {
      const wasIdle = idle();
      activeAtRef.current = Date.now();
      // Wracasz po przerwie — dane sa sprzed przerwy, wiec nie czekamy na sonde.
      if (wasIdle && ready()) void load(true);
    };

    const onVisible = () => {
      if (document.hidden) return;
      // Przelaczenie na karte jest aktywnoscia samo w sobie — inaczej powrot do
      // karty po dluzszej przerwie od razu liczylby sie jako bezczynnosc.
      activeAtRef.current = Date.now();
      if (ready()) void load(true);
    };

    // `pointermove` odpala sie gesto, ale robi tu tylko przypisanie liczby.
    const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });
    const timer = setInterval(() => void probe(), POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      for (const e of EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, data.groupId]);

  /**
   * Optymistyczna mutacja: UI zmienia sie natychmiast, REST leci w tle,
   * a przy bledzie wiersz wraca do poprzedniej wartosci i leci toast.
   * Bez tego kazda zmiana to 400-800 ms czekania — czyli dokladnie to,
   * przed czym uciekamy z Bitriksa.
   */
  const patchTasks = (id: number, patch: Partial<Task>) =>
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  const mutate = useCallback(
    async (id: number, patch: Partial<Task>, run: () => Promise<unknown>, what: string) => {
      const before = tasksRef.current.find((t) => t.id === id);
      if (!before) return;

      const rollback = Object.fromEntries(
        Object.keys(patch).map((k) => [k, before[k as keyof Task]]),
      ) as Partial<Task>;

      patchTasks(id, patch);
      setPending((p) => new Set(p).add(id));

      try {
        await run();
      } catch (e) {
        patchTasks(id, rollback);
        toast(`Nie udało się zapisać (${what}): ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(id);
          return next;
        });
      }
    },
    [toast],
  );

  /**
   * Usuniecie zadania — optymistyczne: znika z listy od razu, REST leci w tle,
   * a przy bledzie wraca na swoje miejsce. Nieodwracalne po stronie Bitriksa,
   * wiec wywolujacy MUSI wczesniej potwierdzic (patrz Confirm).
   */
  const removeTask = useCallback(
    async (id: number) => {
      const snapshot = tasksRef.current;
      const before = snapshot.find((t) => t.id === id);
      if (!before) return;

      setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
      setPending((p) => new Set(p).add(id));

      try {
        await deleteTask(id);
      } catch (e) {
        // Przywracamy zadanie na jego pierwotna pozycje, nie na koniec listy.
        setData((d) => {
          if (d.tasks.some((t) => t.id === id)) return d;
          const idx = snapshot.findIndex((t) => t.id === id);
          const tasks = [...d.tasks];
          tasks.splice(idx < 0 ? tasks.length : idx, 0, before);
          return { ...d, tasks };
        });
        toast(`Nie udało się usunąć zadania: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(id);
          return next;
        });
      }
    },
    [toast],
  );

  /**
   * Otwarcie zadania gasi oba sygnaly: nowosc i nieprzeczytane komentarze.
   * Licznik komentarzy zerujemy tylko lokalnie — Bitrix i tak odnotowuje
   * odwiedziny przy `tasks.task.get`, ktore panel szczegolow wlasnie wykonuje.
   */
  const markOpened = useCallback((id: number) => {
    setNewIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setData((d) =>
      d.tasks.some((t) => t.id === id && t.newComments > 0)
        ? { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, newComments: 0 } : t)) }
        : d,
    );
  }, []);

  /** Zmiana projektu przeladowuje wszystko — `load` zalezy od `project`. */
  const selectProject = useCallback((id: number) => {
    saveProject(id);
    setProject(id);
    setNewIds(new Set()); // nowosci sa liczone w obrebie projektu
    /*
     * Zwykly `reload` zostawia liste na ekranie, zeby nie migala. Tu byloby to
     * klamstwo: pod nazwa nowego projektu wisialyby przez kilka sekund zadania
     * poprzedniego. Konfiguracja i lista projektow zostaja — nie zaleza od wyboru.
     */
    setData((d) => ({ ...EMPTY, config: d.config, projects: d.projects }));
  }, []);

  return {
    ...data,
    // Wybor widac natychmiast, jeszcze zanim dojda zadania — inaczej klikniecie
    // w projekt przez kilka sekund nie zmienia niczego poza licznikiem.
    groupId: project ?? data.groupId,
    loading,
    error,
    pending,
    toasts,
    newIds,
    reload: load,
    mutate,
    removeTask,
    toast,
    selectProject,
    markOpened,
  };
}

// ─── Grupowanie ──────────────────────────────────────────────────────────────

interface Group {
  key: string;
  label: string;
  /** Pozycja grupy w naglowkach — statusy i etapy maja wlasna kolejnosc w procesie. */
  order: number;
  tasks: Task[];
}

/** Wiersz listy: zadanie plus jego miejsce w hierarchii. */
interface RowNode {
  task: Task;
  depth: number;
  /** Podzadania widoczne w tej samej grupie — tylko one da sie zwinac. */
  childCount: number;
  /**
   * Id rodzica, gdy rodzic NIE jest widoczny w tej grupie (inny etap, inna osoba,
   * odfiltrowany). Taki wiersz stoi na poziomie 0 i bez oznaczenia wygladalby
   * na zadanie samodzielne — a nim nie jest.
   */
  parentOutside: number | null;
}

/**
 * Buduje wiersze grupy z zachowaniem hierarchii Bitriksa (PARENT_ID).
 * Rodzic jest domyslnie rozwiniety — zwijanie jest opcja, a nie stanem startowym,
 * zeby zwiniete podzadania nie znikaly cicho z listy.
 * Hierarchia w tej grupie jest dwupoziomowa (epik -> podzadania), wiec nie
 * budujemy pelnego drzewa rekurencyjnie.
 */
function nest(tasks: Task[], collapsedTasks: Set<number>): RowNode[] {
  const present = new Set(tasks.map((t) => t.id));
  const kids = new Map<number, Task[]>();
  const roots: Task[] = [];

  for (const t of tasks) {
    if (t.parentId && present.has(t.parentId)) {
      const list = kids.get(t.parentId);
      if (list) list.push(t);
      else kids.set(t.parentId, [t]);
    } else {
      roots.push(t);
    }
  }

  const out: RowNode[] = [];
  for (const r of roots) {
    const ch = kids.get(r.id) ?? [];
    out.push({
      task: r,
      depth: 0,
      childCount: ch.length,
      parentOutside: r.parentId && !present.has(r.parentId) ? r.parentId : null,
    });
    if (ch.length && !collapsedTasks.has(r.id)) {
      for (const c of ch) out.push({ task: c, depth: 1, childCount: 0, parentOutside: null });
    }
  }
  return out;
}

const PRIORITY_RANK: Record<string, number> = { '2': 0, '1': 1, '0': 2 };

type SortBy = 'updated' | 'created' | 'priority' | 'deadline' | 'title';
type Dir = 'asc' | 'desc';

const SORTS: { key: SortBy; label: string }[] = [
  { key: 'updated', label: 'Zaktualizowane' },
  { key: 'created', label: 'Utworzone' },
  { key: 'priority', label: 'Priorytet' },
  { key: 'deadline', label: 'Termin' },
  { key: 'title', label: 'Tytuł' },
];

const time = (iso: string | null) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Porownanie ROSNACE dla wybranej osi. Braki (pusty termin, brak daty) lecą
 * zawsze na koniec, niezaleznie od kierunku — "brak terminu" nie jest ani
 * wczesniej, ani pozniej, tylko poza porzadkiem.
 */
function compareBy(by: SortBy, a: Task, b: Task): number {
  if (by === 'priority') return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  if (by === 'title') return (a.title || a.rawTitle).localeCompare(b.title || b.rawTitle, 'pl');

  const pick = (t: Task) =>
    by === 'updated' ? time(t.changedDate) : by === 'created' ? time(t.createdDate) : time(t.deadline);
  const av = pick(a);
  const bv = pick(b);
  if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
  return av - bv;
}

export interface SortOpts {
  by: SortBy;
  dir: Dir;
  /** Kierunek kolejnosci GRUP (nie zadan w grupie). */
  groupDir: Dir;
}

/*
 * Kolejnosc zadan w OBREBIE grupy/kolumny: NAJPIERW wybrana os w wybranym kierunku,
 * a moje zadania faworyzujemy dopiero jako POD-sortowanie — remis rozstrzygamy na
 * korzysc zalogowanego uzytkownika (nie ma juz przelacznika "Moje na górze", i nie
 * przebija ono wybranego sortowania). Na koniec stabilny remis po id. Ten sam porzadek
 * uzywa lista (w `bucket`) i tablica — zeby sortowanie znaczylo to samo w obu.
 */
function taskComparator(sort: SortOpts, me: number | null) {
  const dirMul = sort.dir === 'asc' ? 1 : -1;
  const mineRank = (t: Task) => (me !== null && t.responsibleId === me ? 0 : 1);
  return (a: Task, b: Task) =>
    compareBy(sort.by, a, b) * dirMul || mineRank(a) - mineRank(b) || b.id - a.id;
}

/*
 * Kolejnosc grup na LISCIE to nie kolejnosc procesu. Na tablicy kolumny musza isc
 * backlog -> done (inaczej to nie kanban), ale w liscie na gorze ma byc to, nad czym
 * sie teraz pracuje — backlog i rzeczy ukonczone schodza nizej.
 * Bitrix oznacza skrajne etapy przez `type` (NEW / WORK / FINISH), wiec da sie to
 * wyliczyc z danych zamiast wpisywac nazwy etapow na sztywno.
 */
function stageRank(s: Stage): number {
  if (s.type === 'WORK') return s.sort; // w toku — najwyzej
  if (s.type === 'FINISH') return 3000 + s.sort; // ukonczone — na samym dole
  if (s.type === 'NEW') return 2000 + s.sort; // backlog — nad ukonczonymi
  return 1000 + s.sort; // etapy posrednie (Wstrzymane, Do zatwierdzenia / PR)
}

/** To samo dla wbudowanego statusu: najpierw praca w toku, na koncu zamkniete. */
const STATUS_ORDER: Record<string, number> = {
  '3': 0, // W toku
  '4': 1, // Czeka na kontrolę
  '2': 2, // W oczekiwaniu
  '6': 3, // Odłożone
  '5': 4, // Zakończone
};

/**
 * Dzieli zadania na kubelki wg jednej osi. Uzywane zarowno do grupowania,
 * jak i do podgrupowania — te same reguly kluczy, etykiet i kolejnosci.
 * Klucz jest TECHNICZNY (kod statusu, nazwa etapu), zeby kolejnosc brala sie
 * z Bitriksa, a nie z odwrotnego szukania po napisie.
 */
function bucket(
  tasks: Task[],
  by: GroupBy,
  stageNames: Map<number, string>,
  stageOrder: Map<string, number>,
  statusLabels: Record<string, string>,
  me: number | null,
  sort: SortOpts,
  /** Klucze grup, ktore maja istniec nawet bez zadan — "Pokaż puste kolumny". */
  extraKeys: string[] = [],
): Group[] {
  const buckets = new Map<string, Task[]>();

  const keyOf = (t: Task) =>
    by === 'stage'
      ? (t.stageId && stageNames.get(t.stageId)) || 'Poza sprintem'
      : by === 'status'
        ? t.status
        : isUnassigned(t.responsibleId)
          ? UNASSIGNED_LABEL
          : (t.responsibleName ?? UNASSIGNED_LABEL);

  for (const t of tasks) {
    const k = keyOf(t);
    const list = buckets.get(k);
    if (list) list.push(t);
    else buckets.set(k, [t]);
  }

  // Puste grupy do domalowania — tylko te, ktorych jeszcze nie ma z zadan.
  for (const k of extraKeys) if (!buckets.has(k)) buckets.set(k, []);

  const cmp = taskComparator(sort, me);

  return [...buckets.entries()]
    .map(([key, list]) => {
      const isMyGroup = me !== null && list[0]?.responsibleId === me;
      return {
        key,
        label: by === 'status' ? (statusLabels[key] ?? `Status ${key}`) : key,
        order:
          by === 'stage'
            ? (stageOrder.get(key) ?? 9e9)
            : by === 'status'
              ? (STATUS_ORDER[key] ?? 9e9)
              : // Przy grupowaniu po osobie: ja na gorze, nieprzypisane na dole,
                // reszta wg liczby zadan.
                isMyGroup
                ? -9e9
                : key === UNASSIGNED_LABEL
                  ? 9e9
                  : -list.length,
        tasks: list.sort(cmp),
      };
    })
    .sort((a, b) => (a.order - b.order) * (sort.groupDir === 'asc' ? 1 : -1));
}

/*
 * Filtr wyszukiwania — jeden i ten sam dla listy i dla licznikow przy zakresach,
 * zeby "Sprint · Poza sprintem · Wszystkie" pokazywalo REALNE liczby po wpisaniu
 * frazy, a nie sumy sprzed filtra.
 *
 * Zapytanie wygladajace na identyfikator ("IT-749", "it 749", "749", "#114677")
 * traktujemy DOKLADNIE. Samo szukanie po fragmencie dawalo zle wyniki: "IT-749"
 * trafialo tez w zadanie #114749 (jego numer zawiera 749) i to ono ladowalo na
 * gorze. Dopiero brak dokladnego trafienia spuszcza nas do szukania po fragmencie.
 */
function matchQuery(list: Task[], query: string): Task[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return list;

  const asId = q.match(/^#?\s*(?:it[\s-]*)?(\d+)$/);
  if (asId) {
    const n = asId[1];
    const exact = list.filter((t) => t.code?.toLowerCase() === `it-${n}` || String(t.id) === n);
    if (exact.length) return exact;
  }

  // Opisow nie ma w liscie (patrz LIST_SELECT) — zostaje kod, numer, tytul i tagi.
  return list.filter((t) =>
    `${t.code ?? ''} ${t.id} ${t.rawTitle} ${t.tags.join(' ')}`.toLowerCase().includes(q),
  );
}

/**
 * Czy zadanie przechodzi przez komplet filtrow z paska (patrz `Filters`). W obrebie
 * wymiaru LUB, miedzy wymiarami ORAZ. Etap dopasowujemy po nazwie (etapy sa per
 * sprint), osobe po id — z konto-zaslepka i brakiem zbitymi do UNASSIGNED_ID.
 */
function matchFilters(t: Task, conditions: Filters, stageNames: Map<number, string>): boolean {
  return conditions.every((c) => matchCondition(t, c, stageNames));
}

function matchCondition(t: Task, c: Condition, stageNames: Map<number, string>): boolean {
  if (!c.values.length) return true; // niedokonczony warunek nie zawezaja

  if (c.field === 'tag') {
    // „Bez tagów" (NO_TAGS) pasuje do zadania z pusta lista tagow; reszta jak zwykle.
    const has = (v: string) => (v === NO_TAGS ? t.tags.length === 0 : t.tags.includes(v));
    switch (c.op) {
      case 'allOf':
        return c.values.every(has);
      case 'noneOf':
        return !c.values.some(has);
      default: // anyOf
        return c.values.some(has);
    }
  }

  // Wymiary jednowartosciowe: wyliczamy klucz zadania (osoba po id, reszta wprost)
  // i sprawdzamy przynaleznosc; `isNot` odwraca wynik.
  const key =
    c.field === 'assignee'
      ? isUnassigned(t.responsibleId)
        ? String(UNASSIGNED_ID)
        : String(t.responsibleId)
      : c.field === 'priority'
        ? t.priority
        : c.field === 'status'
          ? t.status
          : c.field === 'epic'
            ? String(t.epicId ?? 0) // 0 = bez epika
            : (t.stageId && stageNames.get(t.stageId)) || ''; // stage — po nazwie
  const inSet = c.values.includes(key);
  return c.op === 'isNot' ? !inSet : inSet;
}

// ─── Formatowanie ────────────────────────────────────────────────────────────

// `shortDate` przeniesione do ./taskView — ten sam format daty na liscie i na tablicy.

/**
 * Zwiezly zakres sprintu do selektora zakresu. Ten sam miesiac -> „17–24 sie" (jedna
 * nazwa miesiaca zamiast dwoch); rozne miesiace -> pelne „17 sie – 2 wrz". Rok tylko,
 * gdy inny niz biezacy (jak w shortDate).
 */
function sprintRange(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    const yr = a.getFullYear() === new Date().getFullYear() ? '' : ` ${a.getFullYear()}`;
    return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}${yr}`;
  }
  return `${shortDate(start)} – ${shortDate(end)}`;
}

function dateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${shortDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Picker ──────────────────────────────────────────────────────────────────

interface Option {
  value: string;
  label: string;
  icon?: ReactNode;
  photo?: string | null;
  /** Dopisek po prawej — dzis typ projektu ("scrum", "archiwum"). */
  hint?: string;
  /** Kreska NAD ta pozycja — dzis oddziela zalogowanego uzytkownika od reszty osob. */
  divider?: boolean;
  /** Klucz zakladki (segments) w Pickerze — dzis "sprint" / "outside" dla rodzica. */
  group?: string;
}

function Picker({
  title,
  options,
  anchor,
  emptyLabel,
  rawLabel,
  freeLabel,
  placeholder = 'Filtruj…',
  segments,
  multi = false,
  selected,
  onToggle,
  onPick,
  onClose,
}: {
  title: string;
  options: Option[];
  anchor: Anchor;
  /** Co pokazac, gdy nie ma z czego wybierac. Domyslnie zwykle "Brak opcji". */
  emptyLabel?: string;
  /**
   * Pozwala oddac wartosc, ktorej nie ma na liscie, o ile wpisano sam numer.
   * Przy projektach to jedyne wyjscie, gdy webhook nie widzi grup roboczych —
   * identyfikator grupy stoi w adresie Bitriksa (`/workgroups/group/451/`).
   */
  rawLabel?: (n: number) => string;
  /**
   * Jak `rawLabel`, ale dla DOWOLNEGO tekstu — pozwala oddac wartosc, ktorej nie ma
   * na liscie (dzis: zalozenie nowego tagu wprost z pola szukania).
   */
  freeLabel?: (text: string) => string;
  /** Podpowiedz w polu; przy story pointach to nie "Filtruj", tylko "wpisz liczbę". */
  placeholder?: string;
  /** Zakladki filtrujace opcje po `Option.group`; pusty klucz = pokaz wszystkie. */
  segments?: { key: string; label: string }[];
  /**
   * Tryb wielokrotny (filtry): klik/Enter PRZELACZA pozycje i NIE zamyka popovera —
   * mozna zaznaczyc kilka wartosci naraz. Zamyka dopiero tlo albo Escape.
   * Zaznaczone dostaja ptaszek po prawej. Bez tego picker dziala po staremu:
   * jeden wybor i zamkniecie.
   */
  multi?: boolean;
  selected?: string[];
  onToggle?: (value: string) => void;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [seg, setSeg] = useState(segments?.[0]?.key ?? '');
  const sel = useMemo(() => new Set(selected ?? []), [selected]);
  /*
   * Bezpiecznik otwarcia: menu wyskakuje TUZ pod klikanym przyciskiem, wiec szybki
   * „doklik" (ten sam ruch, ktory otworzyl menu) trafial w pierwsza pozycje, zanim
   * kursor w ogole ruszyl w strone celu — stad „klikam Tag, wychodzi Osoba". Przez
   * pierwsze ~140 ms po otwarciu ignorujemy klik w pozycje; swiadomy, wycelowany klik
   * i tak trwa dluzej, wiec go nie blokujemy. (Klawiatura/Enter dziala od razu.)
   */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 140);
    return () => clearTimeout(t);
  }, []);
  /** W trybie wielokrotnym wybor przelacza pozycje i zostawia popover otwarty. */
  const choose = (value: string) => (multi ? onToggle?.(value) : onPick(value));

  const shown = useMemo(() => {
    // Filtr zakladki: pusty klucz nie zawęża; opcje bez `group` (np. "—") widac zawsze.
    const bySeg = seg ? options.filter((o) => o.group == null || o.group === seg) : options;

    const q = query.trim().toLowerCase();
    const hits = q ? bySeg.filter((o) => o.label.toLowerCase().includes(q)) : bySeg;
    const typed = query.trim();
    const withRaw =
      rawLabel && /^\d+$/.test(q) && Number(q) > 0 && !hits.some((o) => o.value === q)
        ? [{ value: q, label: rawLabel(Number(q)) }, ...hits]
        : // Dowolny tekst spoza listy — np. zupelnie nowy tag zakladany w locie.
          freeLabel && typed && !bySeg.some((o) => o.label.toLowerCase() === q)
          ? [{ value: typed, label: freeLabel(typed) }, ...hits]
          : hits;

    // Nie renderujemy setek pozycji naraz — reszta jest osiagalna przez szukanie.
    return withRaw.slice(0, 200);
  }, [options, query, rawLabel, freeLabel, seg]);

  useEffect(() => setCursor(0), [query, seg]);

  // Popover nie moze wyjechac poza ekran przy wierszach na dole listy.
  const width = 260;
  const height = Math.min(340, 92 + shown.length * 30 + (segments ? 32 : 0));
  const left = Math.min(anchor.left + 32, window.innerWidth - width - 12);
  const top =
    anchor.bottom + height > window.innerHeight ? Math.max(12, anchor.top - height - 4) : anchor.bottom + 4;

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="picker" style={{ left, top, width }}>
        <div className="picker-title">{title}</div>
        {segments && (
          <div className="picker-segments">
            {segments.map((s) => (
              <button
                key={s.key}
                className={`segment${seg === s.key ? ' segment-active' : ''}`}
                onClick={() => setSeg(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <input
          className="picker-input"
          /* type=search — inaczej menedzery hasel biora to pole za login i wchodza z podpowiedzia. */
          type="search"
          autoFocus
          value={query}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const opt = shown[cursor];
              if (opt) choose(opt.value);
            }
          }}
        />
        <div className="picker-list">
          {shown.length === 0 && <div className="picker-empty">{emptyLabel ?? 'Brak opcji'}</div>}
          {shown.map((o, i) => (
            <Fragment key={o.value}>
              {/* Kreska tylko MIEDZY pozycjami — na samej gorze listy nie ma czego dzielic. */}
              {o.divider && i > 0 && <div className="picker-sep" />}
              <button
                className={`picker-item${i === cursor ? ' picker-item-active' : ''}${
                  multi && sel.has(o.value) ? ' picker-item-on' : ''
                }`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => armed && choose(o.value)}
              >
                {o.photo !== undefined ? <Avatar name={o.label} photo={o.photo} /> : o.icon}
                <span className="picker-label">{o.label}</span>
                {o.hint && <span className="palette-hint">{o.hint}</span>}
                {multi && <span className="picker-check">{sel.has(o.value) && <CheckIcon />}</span>}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Widoki (zapisane) ───────────────────────────────────────────────────────

/**
 * Rozwijane „Widoki" w pasku: lista zapisanych widokow (klik = zastosuj, ✓ = aktywny,
 * ✕ = usun) plus pole „Zapisz bieżący widok…". Pozycjonowanie jak w `Picker`.
 */
/**
 * Suma story pointow w naglowku grupy i podgrupy — ten sam zeton co w kolumnie
 * tablicy (parytet widokow). Nic nie rysuje, gdy w kubelku nie ma oszacowan.
 */
function GroupPoints({ tasks }: { tasks: Task[] }) {
  const sp = sumPoints(tasks);
  if (sp === null) return null;
  return (
    <span className="head-sp" title="Suma story points w grupie">
      {sp} SP
    </span>
  );
}

function ViewsMenu({
  anchor,
  views,
  activeId,
  onApply,
  onDelete,
  onSave,
  onClose,
  autoFocusInput = true,
  hover = false,
  onHoverIn,
  onHoverOut,
}: {
  anchor: Anchor;
  views: SavedView[];
  activeId: string | null;
  onApply: (v: SavedView) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
  onClose: () => void;
  /** Menu otwarte najechaniem NIE zabiera focusu — inaczej kradnie klawiature mimochodem. */
  autoFocusInput?: boolean;
  /** Otwarte najechaniem — bez tla na caly ekran (patrz nizej). */
  hover?: boolean;
  /** Kursor wrocil nad menu — odwolaj zaplanowane zamkniecie. */
  onHoverIn?: () => void;
  /** Kursor zszedl z menu — zaplanuj zamkniecie. */
  onHoverOut?: () => void;
}) {
  const [name, setName] = useState('');

  const width = 260;
  const left = Math.min(anchor.left + 32, window.innerWidth - width - 12);
  const top = anchor.bottom + 4;

  // Biezacy uklad juz odpowiada zapisanemu widokowi (activeId). Zapisywanie go pod
  // nowa nazwa dawaloby duplikat o identycznym „odcisku" — fingerprint dopasowuje
  // wtedy PIERWSZY z nich, wiec drugiego nie da sie potem zaznaczyc. Blokujemy zapis.
  const activeName = views.find((v) => v.id === activeId)?.name ?? null;
  const alreadySaved = activeId != null;

  const save = () => {
    const n = name.trim();
    if (!n || alreadySaved) return;
    onSave(n);
    setName('');
  };

  return (
    <>
      {/*
        Tlo TYLKO przy otwarciu klikiem. Otwarte najechaniem nie moze go miec: tlo
        na caly ekran natychmiast przykrywa przycisk, przegladarka odpala na nim
        `mouseleave` i menu zamyka samo siebie ulamek sekundy po otwarciu.
        Wersja hover zamyka sie zjechaniem kursora, wiec lapacz klikniec jest zbedny.
      */}
      {!hover && <div className="picker-backdrop" onClick={onClose} />}
      <div
        className="picker"
        style={{ left, top, width }}
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
      >
        <div className="picker-title">Widoki</div>
        <div
          className="view-save"
          title={alreadySaved ? `Bieżący widok jest już zapisany jako „${activeName}"` : undefined}
        >
          <input
            className="picker-input"
            autoFocus={autoFocusInput && !alreadySaved}
            disabled={alreadySaved}
            value={name}
            placeholder="Zapisz bieżący widok…"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={alreadySaved || !name.trim()}
            onClick={save}
          >
            Zapisz
          </button>
        </div>
        <div className="picker-list">
          {views.length === 0 && <div className="picker-empty">Brak zapisanych widoków</div>}
          {views.map((v) => (
            <div key={v.id} className={`view-item${v.id === activeId ? ' view-item-on' : ''}`}>
              <button className="view-apply" onClick={() => onApply(v)}>
                <span className="picker-label">{v.name}</span>
                {v.id === activeId && (
                  <span className="picker-check">
                    <CheckIcon />
                  </span>
                )}
              </button>
              <button className="view-del" title="Usuń widok" onClick={() => onDelete(v.id)}>
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Wybor zakresu (Sprint / Poza / Wszystkie) ───────────────────────────────

/**
 * Selektor zakresu jako pionowa KARUZELA, w ktorej WYBRANA pozycja JEST przyciskiem
 * (zostaje w pasku). Po otwarciu poprzednia pozycja wisi NAD przyciskiem, a nastepna
 * POD nim — przygaszone. Kolko myszy obraca kolo (jeden krok na „zabkowanie"), tez na
 * zwinietym przycisku. Klik w sasiada wybiera go (staje sie przyciskiem-srodkiem).
 */
function ScopePicker({
  scope,
  scopes,
  counts,
  activeSprint,
  carousel,
  onPick,
}: {
  scope: Scope;
  scopes: typeof SCOPES;
  counts: Record<Scope, number>;
  activeSprint: { name: string; dateStart: string | null; dateEnd: string | null } | null;
  /** true = karuzela (sasiedzi nad/pod przyciskiem); false = zwykla lista rozwijana. */
  carousel: boolean;
  onPick: (s: Scope) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const n = scopes.length;
  const sel = Math.max(
    0,
    scopes.findIndex((s) => s.key === scope),
  );
  const cur = scopes[sel] ?? scopes[0];
  const prev = scopes[(sel - 1 + n) % n];
  const next = scopes[(sel + 1) % n];

  // Kolko: jeden krok na „zabkowanie". Natywny listener (passive:false), zeby
  // zablokowac przewijanie strony. `selRef` trzyma biezaca pozycje bez przepinania.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (n < 2) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 24) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      onPick(scopes[(selRef.current + dir + n) % n].key);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scopes, onPick, n]);

  const dates = (key: Scope) =>
    key === 'sprint' && activeSprint ? (
      <span className="segment-dates">{sprintRange(activeSprint.dateStart, activeSprint.dateEnd)}</span>
    ) : null;
  const labelFor = (s: { key: Scope; label: string }) =>
    s.key === 'sprint' && activeSprint ? activeSprint.name : s.label;

  // Sasiad (nad/pod przyciskiem) — przygaszony, klik go wybiera. Pokazujemy tylko gdy
  // jest wiecej niz jeden zakres i faktycznie rozny od srodka.
  const flank = (s: { key: Scope; label: string }, where: 'up' | 'down') => (
    <button
      className={`scope-flank scope-flank-${where}`}
      onClick={() => onPick(s.key)}
      title={`Zakres: ${labelFor(s)}`}
    >
      <span className="scope-picker-label">{labelFor(s)}</span>
      {dates(s.key)}
      <span className="segment-count">{counts[s.key]}</span>
    </button>
  );

  const showFlanks = open && carousel && n > 1;

  return (
    <div className={`scope-picker-wrap${open ? ' scope-open' : ''}`} ref={wrapRef}>
      {open && <div className="picker-backdrop" onClick={() => setOpen(false)} />}

      {showFlanks && flank(prev, 'up')}

      <button
        className={`scope-picker${open ? ' scope-picker-open' : ''}`}
        title="Zakres — kliknij, aby wybrać, albo przewiń kółkiem"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="scope-picker-label">{labelFor(cur)}</span>
        {dates(cur.key)}
        <span className="segment-count">{counts[cur.key]}</span>
        <ChevronIcon open={open} />
      </button>

      {showFlanks && flank(next, 'down')}

      {/* Zwykla lista rozwijana (gdy karuzela wylaczona) — pod przyciskiem, z ptaszkiem. */}
      {open && !carousel && (
        <div className="scope-menu" role="listbox">
          {scopes.map((s) => (
            <button
              key={s.key}
              role="option"
              aria-selected={s.key === scope}
              className={`scope-opt${s.key === scope ? ' scope-opt-on' : ''}`}
              onClick={() => {
                onPick(s.key);
                setOpen(false);
              }}
            >
              <span className="scope-opt-check">{s.key === scope && <CheckIcon />}</span>
              <span className="scope-picker-label">{labelFor(s)}</span>
              {dates(s.key)}
              <span className="segment-count">{counts[s.key]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Poziomy pasek przewijania (wlasny) ──────────────────────────────────────

/**
 * Kontener z POZIOMYM przewijaniem i WLASNYM, zaokraglonym paskiem. Natywnego nie
 * da sie zaokraglic w Firefoksie, wiec go chowamy i rysujemy pigulke sami — wyglada
 * tak samo we wszystkich przegladarkach. Pasek pojawia sie tylko przy najechaniu
 * i tylko gdy tresc naprawde wystaje.
 */
function ScrollX({
  children,
  onSpare,
}: {
  children: ReactNode;
  /** Wolne miejsce w px (clientWidth - scrollWidth); ujemne = tresc wystaje/przewija. */
  onSpare?: (spare: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ width: number; left: number } | null>(null);
  // Podczas przeciagania pasek ma zostac widoczny, nawet gdy kursor zjedzie z obszaru.
  const [dragging, setDragging] = useState(false);

  const sync = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    onSpare?.(clientWidth - scrollWidth);
    if (scrollWidth <= clientWidth + 1) {
      setThumb(null);
      return;
    }
    const width = Math.max(24, (clientWidth / scrollWidth) * clientWidth);
    const maxLeft = clientWidth - width;
    const range = scrollWidth - clientWidth;
    setThumb({ width, left: range ? (scrollLeft / range) * maxLeft : 0 });
  }, [onSpare]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // Chipy dochodza/znikaja bez zmiany rozmiaru kontenera — stad obserwator drzewa.
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
      mo.disconnect();
    };
  }, [sync]);

  const onDrag = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el || !thumb) return;
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    const maxLeft = el.clientWidth - thumb.width;
    const range = el.scrollWidth - el.clientWidth;
    const move = (ev: PointerEvent) => {
      const ratio = maxLeft ? range / maxLeft : 0;
      el.scrollLeft = startScroll + (ev.clientX - startX) * ratio;
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`scrollx${dragging ? ' scrollx-dragging' : ''}`}>
      <div className="scrollx-track" ref={trackRef}>
        {children}
      </div>
      {thumb && (
        <div
          className="scrollx-bar"
          onPointerDown={onDrag}
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
    </div>
  );
}

/**
 * Ile tagow miesci sie w wierszu przy danej szerokosci listy. Mierzymy realny
 * kontener (a nie okno), bo otwarty panel szczegolow zabiera polowe ekranu —
 * inaczej przy szerokim oknie i otwartym panelu tagi i tak by sie nie miescily.
 * Stala wartosc 2 powodowala "+N" nawet wtedy, gdy miejsca bylo pod dostatkiem.
 */
function tagsForWidth(width: number): number {
  if (width >= 1500) return 6;
  if (width >= 1250) return 5;
  if (width >= 1000) return 4;
  if (width >= 820) return 3;
  return 2;
}

/** Szerokosc elementu na zywo — ResizeObserver, bo zalezy tez od panelu bocznego. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

/**
 * Wartosc opozniona o `delay` — kazda kolejna zmiana kasuje poprzedni timer,
 * wiec przeliczenie leci raz, po przerwie w pisaniu, a nie po kazdym znaku.
 *
 * Pusta wartosc wraca NATYCHMIAST, z pominieciem timera: zdjecie filtru ma byc
 * odczuwalnie darmowe (nie ma wtedy czego liczyc — `filtered` zwraca caly
 * zakres bez jednego porownania), a czekanie na powrot pelnej listy wygladaloby
 * jak zaciecie.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (!value) {
      setSettled(value);
      return;
    }
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return settled;
}

/**
 * Pole filtra trzyma wpisywany tekst U SIEBIE i oddaje go w gore dopiero po
 * przerwie w pisaniu.
 *
 * Samo opoznienie WARTOSCI nic tu nie dawalo. Gdy `value` inputa siedzi w stanie
 * App, kazdy znak przerysowuje cale App, a `TaskRow` nie jest memoizowany —
 * wiec 1000 wierszy przechodzi pelny render przy kazdym nacisnietym klawiszu,
 * niezaleznie od tego, ze `filtered` zwraca dokladnie te sama tablice. Przemiel
 * byl tani, drogi byl RENDER, i tylko wyprowadzenie stanu z App go ucina:
 * teraz znak przerysowuje jedno pole tekstowe, a lista rusza sie raz, po pauzie.
 *
 * `ref` idzie na `<input>`, bo `/` i `Ctrl+F` ustawiaja na nim kursor.
 */
/** Uchwyt SearchBoxa — poza fokusem pozwala ustawic tekst z zewnatrz (np. z widoku). */
type SearchHandle = { focus: () => void; select: () => void; setValue: (v: string) => void };

const SearchBox = forwardRef<SearchHandle, { onChange: (q: string) => void }>(
  function SearchBox({ onChange }, ref) {
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      select: () => inputRef.current?.select(),
      setValue: (v: string) => setDraft(v),
    }));
    /*
     * 300 ms, nie 150. Przy 40 slowach na minute kolejne znaki dziela ~250 ms,
     * wiec przy 150 ms timer zdazal dobiec PRZED nastepnym klawiszem i lista
     * przeliczala sie tak samo po kazdym znaku — debounce nie sklejal niczego.
     * Sens ma dopiero prog dluzszy niz przerwa miedzy klawiszami.
     */
    const settled = useDebounced(draft, 300);

    useEffect(() => onChange(settled), [settled, onChange]);

    return (
      <div className="search">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Filtruj zadania…"
          spellCheck={false}
        />
      </div>
    );
  },
);

/**
 * Pasek tagow w wierszu: kilka pierwszych chipow + "+N". Najechanie na CALY pasek
 * (nie tylko na "+N") pokazuje pelna liste — cel jest wtedy duzo wiekszy.
 * Dymek leci przez portal i jest pozycjonowany `fixed`, bo lista ma
 * `overflow-y: auto` i wewnatrz zostalby przyciety na jej krawedzi.
 */
function TagStrip({
  tags,
  limit,
  onPick,
}: {
  tags: string[];
  limit: number;
  onPick: (name: string) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const hidden = tags.length - limit;

  return (
    <span
      className="tag-strip"
      onMouseEnter={(e) => {
        if (hidden <= 0) return; // wszystko juz widac, dymek nic by nie wniosl
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ left: Math.min(r.left, window.innerWidth - 248), top: r.bottom + 6 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {tags.slice(0, limit).map((t) => (
        <Tag key={t} name={t} onPick={onPick} />
      ))}
      {hidden > 0 && <span className="row-sub tag-more">+{hidden}</span>}

      {pos &&
        createPortal(
          <div className="tag-pop" style={{ left: pos.left, top: pos.top }}>
            {tags.map((t) => (
              <span key={t} className="tag tag-static">
                <span className="tag-dot" style={{ background: tagHue(t) }} />
                {t}
              </span>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * Kod zadania z przyciskiem kopiowania. Kopiujemy sam kod (IT-749), bo to jego
 * wkleja sie w nazwe galezi, tytul PR-a i commit — czyli w to, po czym
 * `bitrix_sync.py` rozpoznaje zadanie.
 */
function TaskCode({ code, onCopied }: { code: string; onCopied: (text: string) => void }) {
  const [done, setDone] = useState(false);

  return (
    <span className="row-code">
      {code}
      <button
        className="copy-btn"
        title={`Kopiuj ${code}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard
            .writeText(code)
            .then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1200);
              onCopied(code);
            })
            .catch(() => onCopied(''));
        }}
      >
        {done ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

/** Tag Bitriksa. Odcien wyliczany z nazwy, wiec dla danego tagu stale ten sam. */
function Tag({ name, onPick }: { name: string; onPick?: (name: string) => void }) {
  return (
    <button
      className="tag"
      title={onPick ? `Filtruj po tagu: ${name}` : name}
      onClick={
        onPick
          ? (e) => {
              e.stopPropagation(); // klik w tag nie ma otwierac zadania
              onPick(name);
            }
          : undefined
      }
    >
      <span className="tag-dot" style={{ background: tagHue(name) }} />
      {name}
    </button>
  );
}

// ─── Wiersz ──────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  active,
  selected,
  busy,
  depth,
  childCount,
  hiddenSubCount,
  elsewhereSubCount,
  collapsed,
  marked,
  isNew,
  hasRelated,
  epic,
  onEpic,
  stage,
  parentRef,
  tagLimit,
  onCopied,
  onOpenParent,
  onToggle,
  onMark,
  onSelect,
  onMenu,
  onTag,
}: {
  task: Task;
  active: boolean;
  selected: boolean;
  busy: boolean;
  depth: number;
  childCount: number;
  /** Podzadania, ktore nie przeszly filtrow — nie widac ich nigdzie. */
  hiddenSubCount: number;
  /** Podzadania widoczne, ale w innej grupie — sa na liscie, tylko nie tutaj. */
  elsewhereSubCount: number;
  collapsed: boolean;
  /** Nalezy do zaznaczenia wielokrotnego (Ctrl/Shift + klik). */
  marked: boolean;
  /** Nie bylo go przy poprzednim uruchomieniu — patrz src/seen.ts. */
  isNew: boolean;
  /** Ma >=1 zadanie powiazane (DEPENDS_ON) — plakietka lancucha w wierszu. */
  hasRelated?: boolean;
  /** Epik zadania — kolorowa kropka w wierszu; brak, gdy zadanie bez epika. */
  epic?: Epic | null;
  /** Klik w kropke epika — szybki filtr po tym epiku. */
  onEpic?: (epicId: number) => void;
  onToggle: () => void;
  /** Zaznacz/odznacz z checkboxa — bez otwierania zadania. */
  /** Wyglad pierscienia etapu; brak = zadanie poza sprintem, pokazujemy status. */
  stage?: { color: string | null; progress: number | null };
  /** Rodzic spoza tej grupy — pokazujemy odnosnik, zeby nie udawac samodzielnosci. */
  parentRef?: { id: number; label: string; title: string };
  /** Ile tagow zmiesci sie przy biezacej szerokosci listy. */
  tagLimit: number;
  onCopied: (code: string) => void;
  onOpenParent: (id: number) => void;
  onMark: (e: ReactMouseEvent) => void;
  onSelect: (e: ReactMouseEvent) => void;
  onMenu: (anchor: Anchor) => void;
  onTag: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: dragId(task.id) });

  /*
   * Kursor przewijamy do widoku, ale NIE przy pierwszym renderze wiersza. Inaczej
   * zadanie, ktore po zmianie (np. innej osobie przy grupowaniu po osobach) przeskakuje
   * do innej grupy, montuje sie na nowo z `active` i szarpalo widokiem az na sam gorny
   * kraniec. Nawigacja j/k dziala dalej — tam wiersze sa juz zamontowane, wiec `active`
   * tylko sie ZMIENIA i przewijanie zachodzi normalnie.
   */
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      return;
    }
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      /* Dwa uzycia tego samego wezla: przewijanie do kursora i uchwyt dnd-kit. */
      ref={(node) => {
        ref.current = node;
        setNodeRef(node);
      }}
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      className={`row${active ? ' row-active' : ''}${selected ? ' row-selected' : ''}${
        marked ? ' row-marked' : ''
      }${busy ? ' row-busy' : ''}${isDragging ? ' row-dragging' : ''}`}
      /* Shift+klik zaznaczylby tekst miedzy wierszami, Ctrl+klik potrafi zaczac
         zaznaczanie w niektorych przegladarkach. Blokujemy TYLKO z modyfikatorem,
         zeby zwykle zaznaczanie i kopiowanie tytulu dzialalo dalej.
         Na koncu oddajemy zdarzenie dnd-kitowi — to jego aktywator, wiec bez
         tego wywolania wiersz przestalby sie dac przeciagnac. */
      onMouseDown={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault();
        listeners?.onMouseDown?.(e);
      }}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // inaczej wypadloby tez menu widoku spod listy
        onMenu({ left: e.clientX, top: e.clientY, bottom: e.clientY });
      }}
      role="button"
      tabIndex={-1}
    >
      {/* Checkbox pojawia sie na hover (i zostaje, gdy cos juz jest zaznaczone) —
          zaznaczanie myszka bez trzymania modyfikatorow. */}
      <button
        className={`row-check${marked ? ' row-check-on' : ''}`}
        title={marked ? 'Odznacz' : 'Zaznacz'}
        aria-pressed={marked}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onMark(e);
        }}
      >
        {marked ? <CheckIcon /> : null}
      </button>

      {/*
        Wciecie zaczyna sie DOPIERO tutaj, a nie na paddingu wiersza — dzieki temu
        checkboxy stoja w jednej kolumnie niezaleznie od poziomu zagniezdzenia.
        Rozwijanie tylko gdy podzadania sa w tej samej grupie; inaczej pusty slot,
        zeby ikony w kolejnych wierszach nadal stały w jednej kolumnie.
      */}
      {childCount > 0 ? (
        <button
          className="row-twisty"
          style={depth ? { marginLeft: depth * 20 } : undefined}
          title={collapsed ? `Rozwiń ${childCount} podzadań` : 'Zwiń podzadania'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <ChevronIcon open={!collapsed} />
        </button>
      ) : (
        <span
          className="row-twisty-spacer"
          style={depth ? { marginLeft: depth * 20 } : undefined}
          aria-hidden
        />
      )}

      <PriorityIcon priority={task.priority} />
      {/* Pierscien pokazuje ETAP — to on niesie stan pracy. Poza sprintem
          etapu nie ma, wiec awaryjnie pokazujemy wbudowany status. */}
      {stage ? (
        <StageIcon progress={stage.progress} color={stage.color} />
      ) : (
        <StatusIcon status={task.status} />
      )}
      <TaskCode code={task.code ?? `#${task.id}`} onCopied={onCopied} />
      {/* Rodzic poza grupa — bez tego wiersz udawalby zadanie samodzielne. */}
      {parentRef && (
        <button
          className="row-parent"
          title={`Podzadanie: ${parentRef.label} ${parentRef.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenParent(parentRef.id);
          }}
        >
          <ParentIcon />
          {parentRef.label}
        </button>
      )}

      <span className="row-title">{task.title || task.rawTitle}</span>

      {/* Liczba tagow w wierszu zalezy od szerokosci listy — reszta jako "+N". */}
      {task.tags.length > 0 && <TagStrip tags={task.tags} limit={tagLimit} onPick={onTag} />}

      {/* Epik — kwadratowa plakietka ZA tagami; klik filtruje liste po tym epiku. */}
      {epic &&
        (() => {
          const col = epic.color ? `#${epic.color}` : tagHue(epic.name);
          return (
            <button
              type="button"
              className="row-epic"
              title={`Epik: ${epic.name} — kliknij, aby filtrować`}
              style={{
                borderColor: `color-mix(in srgb, ${col} 26%, transparent)`,
                background: `color-mix(in srgb, ${col} 9%, transparent)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (task.epicId != null) onEpic?.(task.epicId);
              }}
            >
              {epic.name}
            </button>
          );
        })()}

      {/*
        Jeden znacznik "⑂" na oba rodzaje niewidocznych tutaj podzadan, dwie liczby:
        pierwsza (przygaszona) = ile jest w INNYCH grupach (widoczne, tylko nie tu);
        druga (akcent) = ile UKRYL filtr (nie widac nigdzie). Rozne kolory zamiast
        dwoch osobnych plakietek — mniej szumu w wierszu, a znaczenie zostaje.
        Wlasna klasa, NIE `.row-sub`: to co innego niz "+N" od tagow.
      */}
      {(elsewhereSubCount > 0 || hiddenSubCount > 0) && (
        <span
          className="row-subs"
          title={[
            elsewhereSubCount > 0
              ? `${elsewhereSubCount} podzadań jest w innych grupach — szukaj ich pod ich własnym etapem/osobą`
              : '',
            hiddenSubCount > 0
              ? `${hiddenSubCount} podzadań ukrytych przez bieżący filtr — poluzuj filtry, żeby je zobaczyć`
              : '',
          ]
            .filter(Boolean)
            .join('\n')}
        >
          <SubtaskIcon />
          {elsewhereSubCount > 0 && <span className="row-subs-elsewhere">{elsewhereSubCount}</span>}
          {elsewhereSubCount > 0 && hiddenSubCount > 0 && <span className="row-subs-sep">·</span>}
          {hiddenSubCount > 0 && <span className="row-subs-hidden">{hiddenSubCount}</span>}
        </span>
      )}
      {/* Plakietka „ma powiazane zadania" (DEPENDS_ON) — sama ikona lancucha, bo liczby
          nie mamy w danych listy (patrz fetchRelatedPresence). */}
      {hasRelated && (
        <span className="row-related" title="Ma powiązane zadania">
          <LinkIcon />
        </span>
      )}
      {/* Dwa rozne sygnaly, wiec dwa rozne ksztalty: "nowe" to cale zadanie,
          dymek to dyskusja w srodku zadania, ktore juz znasz. */}
      {isNew && (
        <span className="row-new" title="Pojawiło się od Twojego poprzedniego uruchomienia">
          nowe
        </span>
      )}
      {task.newComments > 0 && (
        <span
          className="row-unread"
          title={`Nieprzeczytane komentarze: ${task.newComments}`}
        >
          <CommentIcon />
          {task.newComments}
        </span>
      )}

      {/* Story pointy scruma — dociagane w tle, wiec pojawiaja sie chwile po liscie. */}
      {task.storyPoints != null && (
        <span className="row-sp" title={`Story points: ${task.storyPoints}`}>
          {task.storyPoints}
        </span>
      )}

      <span className="row-meta">{shortDate(task.deadline || task.changedDate)}</span>

      {/* Prawy przycisk nie jest odkrywalny — to samo menu pod widocznym przyciskiem. */}
      <button
        className="row-more"
        title="Akcje"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu({ left: r.left, top: r.bottom + 4, bottom: r.bottom + 4 });
        }}
      >
        <MoreIcon />
      </button>

      {/* Zaslepka -> pusty awatar, zeby nie wygladalo na przypisane. */}
      {isUnassigned(task.responsibleId) ? (
        <Avatar name={null} />
      ) : (
        <Avatar name={task.responsibleName} photo={task.responsiblePhoto} />
      )}
    </div>
  );
}

// ─── Komentarze ──────────────────────────────────────────────────────────────

function Comments({
  taskId,
  chatId,
  ready,
  me,
  onError,
}: {
  taskId: number;
  /** Z `tasks.task.get`; bez niego widac tylko forum. */
  chatId: number | null;
  /** Szczegoly zadania juz doszly (albo sie nie udaly) — dopiero wtedy znamy `chatId`. */
  ready: boolean;
  me: number | null;
  onError: (m: string) => void;
}) {
  // Start od CACHE (detailCache.ts): stare komentarze widac od razu, bez "Wczytywanie…".
  const [comments, setComments] = useState<Comment[] | null>(() => getCachedComments(taskId));
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [computing, setComputing] = useState(false);
  /**
   * Gdy czas przekracza 24 h, nie wstawiamy od razu — pytamy, czy przyciac do godzin
   * pracy. Trzymamy oba warianty (pelny i przyciety), zeby wybor byl natychmiastowy.
   */
  const [bigTime, setBigTime] = useState<{ rawMs: number; workMs: number } | null>(null);
  // Pytanie pojawia sie pod polem komentarza, czesto pod krawedzia panelu —
  // przewijamy je w pole widzenia, zeby nie trzeba bylo szukac go recznie.
  const askRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bigTime) askRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [bigTime]);

  const load = useCallback(() => {
    if (!ready) return; // bez chatId pytanie byloby niepelne
    const cached = getCachedComments(taskId);
    setComments(cached); // z cache (albo null przy pierwszym otwarciu -> "Wczytywanie…")
    setFailed(null);
    fetchComments(taskId, chatId)
      .then((c) => {
        setComments(c);
        setCachedComments(taskId, c);
      })
      /*
       * Blad MUSI wygladac inaczej niz brak komentarzy. Wczesniej obie sytuacje
       * konczyly sie napisem "Brak komentarzy" i nie dalo sie ich rozroznic —
       * przez to awaria pobierania wygladala jak puste zadanie. Gdy mamy cache,
       * zostajemy przy nim zamiast pokazywac blad.
       */
      .catch((e) => !cached && setFailed(e instanceof Error ? e.message : String(e)));
  }, [ready, taskId, chatId]);

  useEffect(load, [load]);

  /** Dokleja gotowa linijke z czasem do pola komentarza (nie wysyla). */
  const insertLine = (ms: number) =>
    setDraft((prev) => {
      const line = `Czas pracy nad zadaniem: ${formatDurationPl(ms)}`;
      return prev.trim() ? `${prev.replace(/\s+$/, '')}\n${line}` : line;
    });

  /**
   * Liczy czas w statusie "W toku" z dziennika zmian (read-only) i WSTAWIA go do
   * pola komentarza — nie wysyla, nie zmienia zadania. Uzytkownik sam decyduje,
   * czy komentarz doda. Wersja poltestowa, przed przeniesieniem do skryptu.
   *
   * Gdy odcinek przechodzi przez wiecej niz jeden dzien, czas zegarowy lapie noce
   * i weekendy — wtedy nie wstawiamy od razu, tylko pytamy, czy przyciac do godzin
   * pracy (8–16, bez weekendow).
   */
  const insertWorkTime = async () => {
    if (computing) return;
    setComputing(true);
    try {
      const history = await fetchTaskHistory(taskId);
      const intervals = inProgressIntervals(history, Date.now());
      const rawMs = sumIntervalsMs(intervals);
      if (spansMultipleDays(intervals)) {
        setBigTime({ rawMs, workMs: clampWorkingMs(intervals) });
      } else {
        insertLine(rawMs);
      }
    } catch (e) {
      onError(`Nie udało się policzyć czasu pracy: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setComputing(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !me || sending) return;
    setSending(true);
    try {
      await addComment(taskId, text, me);
      setDraft('');
      load();
    } catch (e) {
      onError(`Nie udało się dodać komentarza: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="comments">
      <h2>Komentarze{comments ? ` · ${comments.length}` : ''}</h2>

      {comments === null && failed === null && <p className="desc-dim">Wczytywanie…</p>}
      {failed !== null && (
        <p className="desc-dim">
          Nie udało się wczytać komentarzy: {failed}{' '}
          <button className="link-btn" onClick={load}>
            Spróbuj ponownie
          </button>
        </p>
      )}
      {comments?.length === 0 && <p className="desc-dim">Brak komentarzy.</p>}

      {comments?.map((c) => {
        // Konto-zaslepka jako autor komentarza tez idzie jako "Nieprzypisane".
        const unassigned = isUnassigned(c.authorId);
        return (
        <article key={`${c.source}:${c.id}`} className="comment">
          <div className="comment-head">
            <Avatar name={unassigned ? null : c.authorName} photo={unassigned ? undefined : c.authorPhoto} />
            <strong>{unassigned ? UNASSIGNED_LABEL : c.authorName}</strong>
            <span className="row-meta">{dateTime(c.date)}</span>
          </div>
          <div className="comment-body">{renderDescription(c.text)}</div>
        </article>
        );
      })}

      <textarea
        className="comment-input"
        value={draft}
        placeholder={me ? 'Napisz komentarz… (Ctrl+Enter wysyła)' : 'Brak identyfikatora użytkownika'}
        disabled={!me || sending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {bigTime && (
        <div className="worktime-ask" ref={askRef}>
          <p>
            Zadanie było „w toku" przez kilka dni. Przyciąć do godzin pracy (
            {WORK_START_HOUR}:00–{WORK_END_HOUR}:00, bez weekendów)?
          </p>
          <div className="worktime-ask-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                insertLine(bigTime.workMs);
                setBigTime(null);
              }}
            >
              Przytnij → {formatDurationPl(bigTime.workMs)}
            </button>
            <button
              className="btn"
              onClick={() => {
                insertLine(bigTime.rawMs);
                setBigTime(null);
              }}
            >
              Pełny → {formatDurationPl(bigTime.rawMs)}
            </button>
            <button className="btn" onClick={() => setBigTime(null)}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      <div className="comment-actions">
        <button
          className="btn"
          disabled={computing || sending}
          title="Policz czas w statusie „W toku” i wstaw go do komentarza (nie wysyła)"
          onClick={() => void insertWorkTime()}
        >
          {computing ? 'Liczenie…' : 'Wstaw czas pracy'}
        </button>
        <button className="btn" disabled={!draft.trim() || !me || sending} onClick={() => void send()}>
          {sending ? 'Wysyłanie…' : 'Dodaj komentarz'}
        </button>
      </div>
    </section>
  );
}

// ─── Baner aktualizacji ──────────────────────────────────────────────────────

/**
 * Sprawdza RAZ przy zaladowaniu, czy na GitHubie jest nowszy commit (repo publiczne,
 * pytanie leci wprost z przegladarki). Gdy tak — pokazuje baner z jednym przyciskiem,
 * ktory odpala `git pull` po stronie serwera; po pobraniu Vite robi HMR i strona
 * odswieza sie sama. Brudne drzewo / brak ff konczy sie podpowiedzia recznego pulla.
 */
function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    checkForUpdate().then((r) => {
      if (live && r?.behind) setInfo(r);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!info || dismissed) return null;

  const update = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const res = await runUpdate();
    if (res.ok) {
      // Pull przeszedl — przeladowanie wciaga swiezy kod (a HMR czesto zdazy wczesniej).
      location.reload();
      return;
    }
    // Najczestszy powod: lokalne zmiany blokuja fast-forward.
    setProblem(res.message || 'Nie udało się zaktualizować. Zrób „git pull" ręcznie.');
    setBusy(false);
  };

  return (
    <div className="update-banner">
      <div className="update-banner-text">
        <strong>Nowa wersja binear</strong>
        {info.message && <span> — {info.message}</span>}
        {problem && <div className="update-banner-problem">{problem}</div>}
      </div>
      <div className="update-banner-actions">
        <a className="link-btn" href={info.compareUrl} target="_blank" rel="noreferrer">
          Zobacz zmiany
        </a>
        <button className="btn btn-primary" disabled={busy} onClick={() => void update()}>
          {busy ? 'Aktualizowanie…' : 'Zaktualizuj'}
        </button>
        <button className="btn" disabled={busy} onClick={() => setDismissed(true)}>
          Później
        </button>
      </div>
    </div>
  );
}

// ─── Panel szczegolow ────────────────────────────────────────────────────────

/*
 * Klikalne pole w panelu szczegolow — otwiera ten sam popover co menu kontekstowe,
 * zakotwiczony na samym polu. Dzieki temu status, priorytet i story pointy zmienia
 * sie wprost z panelu, bez wracania do listy.
 */
function FieldButton({
  kind,
  onPick,
  children,
}: {
  kind: PickerKind;
  onPick: (kind: PickerKind, anchor: Anchor) => void;
  children: ReactNode;
}) {
  return (
    <button
      className="dd-edit"
      title="Kliknij, aby zmienić"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPick(kind, { left: r.left, top: r.top, bottom: r.bottom });
      }}
    >
      {children}
      <span className="dd-edit-caret">
        <ChevronIcon open={false} />
      </span>
    </button>
  );
}

/*
 * Termin: wygladem jak reszta pol (tekst + strzalka + hover), a klik otwiera NATYWNY
 * kalendarz — ale przez ukryte `input[type=date]` i `showPicker()`, zeby nie pokazywac
 * brzydkiego natywnego pola. Pusta wartosc kasuje termin.
 */
function DateField({ value, onChange }: { value: string | null; onChange: (date: string) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const open = () => {
    const el = ref.current;
    if (!el) return;
    // showPicker to nowszy standard; gdy go brak, zostaje focus (klawiatura).
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.focus();
  };
  // Dzis w czasie LOKALNYM (nie UTC) — terminu nie da sie ustawic w przeszlosci.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (
    <span className="dd-date-wrap">
      <button className="dd-edit" title="Kliknij, aby zmienić" onClick={open}>
        {shortDate(value) || '—'}
        <span className="dd-edit-caret">
          <ChevronIcon open={false} />
        </span>
      </button>
      <input
        ref={ref}
        type="date"
        className="dd-date-hidden"
        min={today}
        value={value ? value.slice(0, 10) : ''}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden
      />
    </span>
  );
}

/* Tytul edytowalny w miejscu: klik zamienia naglowek w pole, Enter/blur zapisuje,
   Escape porzuca. Zapis leci tylko przy realnej zmianie niepustego tekstu. */
function EditableTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <h1
        className="detail-title"
        title="Kliknij, aby zmienić"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </h1>
    );
  }

  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onSave(v);
  };

  return (
    <textarea
      className="detail-title-input"
      autoFocus
      rows={2}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // panel zamyka sie na Escape — nie chcemy tego przy edycji
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

function DetailPanel({
  task,
  stageName,
  sprintName,
  epic,
  labels,
  me,
  portal,
  allTasks,
  visibleIds,
  groupOf,
  canStoryPoints,
  width,
  onResize,
  onOpenTask,
  onRelatedChange,
  onPick,
  onDeadline,
  onTitle,
  onClose,
  onDelete,
  onError,
}: {
  task: Task;
  stageName: string;
  sprintName: string;
  /** Epik zadania — do pola w panelu; `null`, gdy bez epika lub projekt bez scruma. */
  epic: Epic | null;
  labels: FieldEnums;
  me: number | null;
  portal: string | null;
  allTasks: Task[];
  /** Id zadan widocznych TERAZ na liscie — do oznaczenia podzadan ukrytych filtrem. */
  visibleIds: Set<number>;
  /** taskId -> nazwa grupy, w ktorej zadanie stoi przy biezacym grupowaniu. */
  groupOf: Map<number, string>;
  /** Czy projekt ma scrum — tylko wtedy story pointy maja sens (edytowalny wiersz). */
  canStoryPoints: boolean;
  width: number;
  onResize: (px: number) => void;
  onOpenTask: (id: number) => void;
  onPick: (kind: PickerKind, anchor: Anchor) => void;
  /** Po zmianie liczby powiazanych — do plakietki w wierszu (App trzyma zbior). */
  onRelatedChange: (taskId: number, hasRelated: boolean) => void;
  /** Nowy termin jako `YYYY-MM-DD`; pusty string kasuje. */
  onDeadline: (date: string) => void;
  onTitle: (title: string) => void;
  onClose: () => void;
  /** Usuniecie zadania — panel sam pyta o potwierdzenie przez App (setConfirm). */
  onDelete: () => void;
  onError: (m: string) => void;
}) {
  // Opis nie jedzie w liscie (bylby kilka MB dla ~1000 zadan) — dociagamy przy otwarciu.
  // Startujemy od CACHE (patrz detailCache.ts): przy ponownym otwarciu widac je od
  // razu, bez pustki. Potem i tak pytamy Bitrix i podmieniamy, gdy cos sie zmienilo.
  const [detail, setDetail] = useState<TaskDetail | null>(() => getCachedDetail(task.id));
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    let stale = false;
    const cached = getCachedDetail(task.id);
    setDetail(cached); // od razu z cache (albo null, gdy zadania jeszcze nie otwierano)
    setDetailError(false);

    fetchTaskDetail(task.id)
      .then((d) => !stale && setDetail(d))
      // Blad pokazujemy tylko, gdy nie mamy nawet cache — inaczej zostaje stara wersja.
      .catch(() => !stale && !cached && setDetailError(true));

    return () => {
      stale = true;
    };
  }, [task.id]);

  // Kazda wersja detali (swieza z Bitriksa albo po optymistycznej edycji) ląduje w
  // cache — dzieki temu ponowne otwarcie pokazuje ostatni znany stan, nie sprzed edycji.
  useEffect(() => {
    if (detail) setCachedDetail(task.id, detail);
  }, [detail, task.id]);

  // Hierarchia jest juz w pamieci — nie ma po co pytac Bitriksa o dzieci zadania.
  const parent = task.parentId ? allTasks.find((t) => t.id === task.parentId) : undefined;
  const children = allTasks.filter((t) => t.parentId === task.id);
  const doneChildren = children.filter((t) => CLOSED_STATUSES.has(t.status)).length;

  /*
   * Zadania POWIAZANE (Bitrix DEPENDS_ON). Poza danymi listy — dociagamy osobno per
   * zadanie (`fetchRelated`). Dodawanie/usuwanie optymistyczne: UI od razu, zapis w tle,
   * a przy bledzie cofamy i mowimy toastem. Picker (dodanie) zyje lokalnie w panelu.
   */
  const [related, setRelated] = useState<number[]>([]);
  const [relPicker, setRelPicker] = useState<Anchor | null>(null);
  useEffect(() => {
    let stale = false;
    setRelated([]);
    fetchRelated(task.id)
      .then((ids) => !stale && setRelated(ids))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [task.id]);

  const linkRelated = (otherId: number) => {
    if (otherId === task.id || related.includes(otherId)) return;
    setRelated((r) => [...r, otherId]);
    onRelatedChange(task.id, true); // po dodaniu na pewno ma powiazane — plakietka w wierszu
    addRelated(task.id, otherId).catch((e) => {
      setRelated((r) => {
        const back = r.filter((id) => id !== otherId);
        onRelatedChange(task.id, back.length > 0);
        return back;
      });
      onError(`Nie udało się powiązać zadania: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  const unlinkRelated = (otherId: number) => {
    setRelated((r) => {
      const back = r.filter((id) => id !== otherId);
      onRelatedChange(task.id, back.length > 0);
      return back;
    });
    removeRelated(task.id, otherId).catch((e) => {
      setRelated((r) => {
        const back = r.includes(otherId) ? r : [...r, otherId];
        onRelatedChange(task.id, back.length > 0);
        return back;
      });
      onError(`Nie udało się odpiąć zadania: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  /*
   * Odhaczanie pozycji checklisty wprost z panelu — optymistycznie (zmiana od razu),
   * a przy bledzie REST-a cofamy i mowimy o tym toastem. `detail` to lokalny stan
   * panelu, wiec i zmiane, i rollback robimy przez `setDetail`.
   */
  const toggleCheck = (groupId: number, itemId: number, wasDone: boolean) => {
    const set = (done: boolean) =>
      setDetail((d) =>
        d
          ? {
              ...d,
              checklist: d.checklist.map((g) =>
                g.id === groupId
                  ? { ...g, items: g.items.map((it) => (it.id === itemId ? { ...it, done } : it)) }
                  : g,
              ),
            }
          : d,
      );
    set(!wasDone);
    setChecklistItem(task.id, itemId, !wasDone).catch((e) => {
      set(wasDone);
      onError(`Nie udało się zmienić checklisty: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  // Panel pokazuje WSZYSTKIE podzadania, lista tylko przefiltrowane — bez tego
  // liczby w obu miejscach rozjezdzaly sie bez wyjasnienia.
  const hiddenChildren = children.filter((t) => !visibleIds.has(t.id)).length;

  /*
   * Chwyt na lewej krawedzi panelu. Nasluchy wieszamy na `window`, bo kursor
   * podczas ciagniecia wychodzi poza sam chwyt (i nad iframe/inne elementy).
   */
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;

    const move = (ev: MouseEvent) => {
      // Ciagniecie w LEWO poszerza panel, stad odwrocony znak.
      const next = Math.min(detailMax(), Math.max(DETAIL_MIN, startW - (ev.clientX - startX)));
      onResize(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
    };

    document.body.classList.add('resizing'); // blokuje zaznaczanie tekstu w trakcie
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <aside className="detail" style={{ width }}>
      <div className="detail-resizer" onMouseDown={startResize} title="Przeciągnij, aby zmienić szerokość" />
      <div className="detail-head">
        <TaskCode code={task.code ?? `#${task.id}`} onCopied={() => {}} />
        <div className="detail-head-right">
          <a
            className="icon-btn"
            href={`${portal ?? ''}/company/personal/user/${task.responsibleId ?? me ?? ''}/tasks/task/view/${task.id}/`}
            target="_blank"
            rel="noreferrer"
            title="Otwórz w Bitrix"
          >
            <ExternalIcon />
          </a>
          <button className="icon-btn icon-btn-danger" onClick={onDelete} title="Usuń zadanie">
            <TrashIcon />
          </button>
          <button className="icon-btn" onClick={onClose} title="Zamknij (Esc)">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="detail-body">
        <EditableTitle value={task.title || task.rawTitle} onSave={onTitle} />

        <dl className="props">
          {/* Etap pierwszy — to on niesie stan pracy w tej grupie. */}
          <dt title={PICKER_HELP.stage}>Etap</dt>
          <dd>
            <FieldButton kind="stage" onPick={onPick}>
              {stageName}
            </FieldButton>
          </dd>
          <dt title={PICKER_HELP.sprint}>Sprint</dt>
          <dd>
            <FieldButton kind="sprint" onPick={onPick}>
              {sprintName}
            </FieldButton>
          </dd>
          {/* Epik — nadrzedny temat scruma. Tylko w projekcie scrumowym (jak story pointy). */}
          {canStoryPoints && (
            <>
              <dt>Epik</dt>
              <dd>
                <FieldButton kind="epic" onPick={onPick}>
                  {epic ? (
                    <>
                      <span
                        className="row-epic-dot"
                        style={{ background: epic.color ? `#${epic.color}` : tagHue(epic.name) }}
                      />
                      {epic.name}
                    </>
                  ) : (
                    '—'
                  )}
                </FieldButton>
              </dd>
            </>
          )}
          {/* „Nadrzędne" przeniesione do sekcji relacji (nizej), razem z „Powiązane". */}
          {/* Story pointy z bytu scruma — edytowalne tylko w projekcie scrumowym. */}
          {canStoryPoints && (
            <>
              <dt>Story points</dt>
              <dd>
                <FieldButton kind="points" onPick={onPick}>
                  {task.storyPoints != null ? task.storyPoints : '—'}
                </FieldButton>
              </dd>
            </>
          )}
          <dt title={PICKER_HELP.priority}>Priorytet</dt>
          <dd>
            <FieldButton kind="priority" onPick={onPick}>
              <PriorityIcon priority={task.priority} /> {labels.priority[task.priority] ?? '—'}
            </FieldButton>
          </dd>
          <dt title={PICKER_HELP.assignee}>Osoba</dt>
          <dd>
            <FieldButton kind="assignee" onPick={onPick}>
              {isUnassigned(task.responsibleId) ? (
                <>
                  <Avatar name={null} /> {UNASSIGNED_LABEL}
                </>
              ) : (
                <>
                  <Avatar name={task.responsibleName} photo={task.responsiblePhoto} />{' '}
                  {task.responsibleName}
                </>
              )}
            </FieldButton>
          </dd>
          <dt>Termin</dt>
          <dd>
            <DateField value={task.deadline} onChange={onDeadline} />
          </dd>
          <dt>Utworzone</dt>
          <dd>{shortDate(task.createdDate) || '—'}</dd>
          {/* Status na koncu: w tej grupie nie odzwierciedla realnego przeplywu. */}
          <dt title={PICKER_HELP.status}>Status</dt>
          <dd className="dd-dim">
            <FieldButton kind="status" onPick={onPick}>
              <StatusIcon status={task.status} /> {labels.status[task.status] ?? task.status}
            </FieldButton>
          </dd>
          {/* Tagi jak epik: pole otwiera picker, tyle ze wielokrotny (zadanie ma ich kilka). */}
          <dt title={PICKER_HELP.tags}>Tagi</dt>
          <dd>
            <FieldButton kind="tags" onPick={onPick}>
              {task.tags.length ? (
                <span className="dd-tags">
                  {task.tags.map((t) => (
                    <Tag key={t} name={t} />
                  ))}
                </span>
              ) : (
                '—'
              )}
            </FieldButton>
          </dd>
          {detail?.creatorName && (
            <>
              <dt>Autor</dt>
              <dd>
                <PersonInline
                  id={detail.creatorId}
                  name={detail.creatorName}
                  photo={detail.creatorPhoto}
                />
              </dd>
            </>
          )}
        </dl>

        {/* Relacje zadania w JEDNEJ sekcji: nadrzedne (hierarchia Bitriksa) + powiazane
            (DEPENDS_ON). Oddzielone kreska od opisu/podzadan ponizej. */}
        <div className="rel-block">
          {/* Nadrzędne: selektor (ustaw/zmień/odepnij — ten sam picker „parent") w naglowku,
              a pod nim wiersz do PRZEJSCIA do rodzica, gdy jest ustawiony. */}
          <div className="rel-head">
            <span className="relation-kind">Nadrzędne</span>
            <FieldButton kind="parent" onPick={onPick}>
              {parent ? (parent.code ?? `#${parent.id}`) : task.parentId ? `#${task.parentId}` : '—'}
            </FieldButton>
          </div>
          {parent && (
            <button className="relation" onClick={() => onOpenTask(parent.id)}>
              <StatusIcon status={parent.status} />
              <span className="row-code">{parent.code ?? `#${parent.id}`}</span>
              <span className="relation-title">{parent.title || parent.rawTitle}</span>
            </button>
          )}

          <div className="rel-head">
            <span className="relation-kind">Powiązane{related.length ? ` · ${related.length}` : ''}</span>
            <button
              className="rel-add"
              title="Powiąż zadanie"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setRelPicker({ left: r.left - 200, top: r.bottom + 4, bottom: r.bottom + 4 });
              }}
            >
              +
            </button>
          </div>
          {related.map((id) => {
            const t = allTasks.find((x) => x.id === id);
            return (
              <div key={id} className="relation relation-linked">
                <button className="relation-main" onClick={() => onOpenTask(id)}>
                  {t ? <StatusIcon status={t.status} /> : <span className="rel-dot" />}
                  <span className="row-code">{t?.code ?? `#${id}`}</span>
                  <span className="relation-title">
                    {t ? t.title || t.rawTitle : 'zadanie spoza widoku'}
                  </span>
                </button>
                <button className="relation-x" title="Odepnij" onClick={() => unlinkRelated(id)}>
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>

        <div className="rel-sep" />

        {children.length > 0 && (
          <section className="subtasks">
            <h2>
              Podzadania · {doneChildren}/{children.length}
              {hiddenChildren > 0 && (
                <span
                  className="row-hidden-subs"
                  title={`${hiddenChildren} z nich nie widać na liście przy bieżących filtrach — poniżej są wyszarzone`}
                >
                  <SubtaskIcon />
                  {hiddenChildren}
                </span>
              )}
            </h2>
            {children.map((c) => {
              const hidden = !visibleIds.has(c.id);
              // Podzadanie widoczne, ale stojace w innej grupie niz rodzic —
              // pokazujemy GDZIE, a nie tylko ze gdzie indziej.
              const otherGroup =
                !hidden && groupOf.get(c.id) !== groupOf.get(task.id) ? groupOf.get(c.id) : null;

              return (
                <button
                  key={c.id}
                  className={`relation${hidden ? ' relation-hidden' : ''}`}
                  title={
                    hidden
                      ? 'Ukryte przez bieżące filtry listy'
                      : otherGroup
                        ? `Na liście stoi w grupie „${otherGroup}", nie razem z tym zadaniem`
                        : undefined
                  }
                  onClick={() => onOpenTask(c.id)}
                >
                  <StatusIcon status={c.status} />
                  <span className="row-code">{c.code ?? `#${c.id}`}</span>
                  <span className="relation-title">{c.title || c.rawTitle}</span>
                  {/* Który dokladnie jest ukryty — sama liczba w naglowku by nie wystarczyla. */}
                  {hidden && (
                    <span className="relation-hidden-mark" title="Ukryte przez bieżące filtry listy">
                      <SubtaskIcon />
                    </span>
                  )}
                  {/* Sam znacznik — nazwa grupy tylko w tooltipie, zeby nie rozpychac wiersza. */}
                  {otherGroup && (
                    <span className="relation-group-mark" title={`Na liście w grupie „${otherGroup}"`}>
                      <ElsewhereIcon />
                    </span>
                  )}
                  {isUnassigned(c.responsibleId) ? (
                    <Avatar name={null} />
                  ) : (
                    <Avatar name={c.responsibleName} photo={c.responsiblePhoto} />
                  )}
                </button>
              );
            })}
          </section>
        )}

        <div className="desc">
          {detailError && <p className="desc-dim">Nie udało się pobrać szczegółów.</p>}
          {!detailError && detail === null && <p className="desc-dim">Wczytywanie…</p>}
          {/* Opis idzie przez parser markdown/BB — najbardziej „obcy" input w calej
              aplikacji. Wlasna siatka bezpieczenstwa, zeby jeden dziwny opis psul
              najwyzej swoja ramke, a nie caly panel zadania. */}
          {detail &&
            (detail.description.trim() ? (
              <ErrorBoundary where="opis zadania">
                {renderDescription(detail.description)}
              </ErrorBoundary>
            ) : (
              <p className="desc-dim">Brak opisu.</p>
            ))}
        </div>

        {/* Pola rzadko uzywane — pokazujemy je tylko, gdy zadanie faktycznie je ma. */}
        {detail && detail.checklist.length > 0 && (
          <section className="subtasks">
            <h2>Checklista</h2>
            {detail.checklist.map((group) => {
              const done = group.items.filter((i) => i.done).length;
              return (
                <div key={group.id} className="checklist-group">
                  {group.title && (
                    <div className="checklist-group-head">
                      <span>{group.title}</span>
                      <span className="checklist-count">
                        {done}/{group.items.length}
                      </span>
                    </div>
                  )}
                  {group.items.map((it) => (
                    <button
                      key={it.id}
                      className={`check${it.done ? ' check-done' : ''}`}
                      // Zagniezdzenie (sub-itemy) przez wciecie w lewo wg `depth`.
                      style={{ paddingLeft: `calc(var(--s1) + ${it.depth * 18}px)` }}
                      title={it.done ? 'Odhacz' : 'Zaznacz jako zrobione'}
                      onClick={() => toggleCheck(group.id, it.id, it.done)}
                    >
                      <span className="check-box">{it.done ? <CheckIcon /> : null}</span>
                      {it.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </section>
        )}

        {detail && (detail.accomplices.length > 0 || detail.auditors.length > 0) && (
          <section className="subtasks">
            {detail.accomplices.length > 0 && (
              <>
                <h2>Współwykonawcy</h2>
                <div className="people">
                  {detail.accomplices.map((p) => (
                    <span key={p.id} className="person">
                      <PersonInline id={p.id} name={p.name} photo={p.photo} />
                    </span>
                  ))}
                </div>
              </>
            )}
            {detail.auditors.length > 0 && (
              <>
                <h2>Obserwatorzy</h2>
                <div className="people">
                  {detail.auditors.map((p) => (
                    <span key={p.id} className="person">
                      <PersonInline id={p.id} name={p.name} photo={p.photo} />
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/*
          `key` wymusza swiezy komponent na kazde zadanie. Bez tego React trzymal
          jedna instancje i wolniejsze zapytanie z POPRZEDNIEGO zadania potrafilo
          nadpisac wynik biezacego — komentarze pojawialy sie i znikaly zaleznie
          od tego, ktora odpowiedz przyszla ostatnia. Przy okazji czysci sie
          niedokonczona tresc w polu komentarza.
        */}
        <Comments
          key={task.id}
          taskId={task.id}
          chatId={detail?.chatId ?? null}
          ready={detail !== null || detailError}
          me={me}
          onError={onError}
        />
      </div>

      {/* Picker doboru zadania do powiazania — dowolne zadanie (w sprincie / poza),
          szukane po kodzie i tytule; spoza listy wpisuje sie numer Bitriksa. */}
      {relPicker && (
        <Picker
          title="Powiąż zadanie"
          anchor={relPicker}
          placeholder="Szukaj zadania…"
          emptyLabel="Brak zadań do wyboru"
          rawLabel={(n) => `#${n}`}
          segments={[
            { key: 'sprint', label: 'W sprincie' },
            { key: 'outside', label: 'Poza sprintem' },
          ]}
          options={allTasks
            .filter((t) => t.id !== task.id && !related.includes(t.id))
            .map((t) => ({
              value: String(t.id),
              label: `${t.code ?? `#${t.id}`} — ${t.title || t.rawTitle}`,
              group: t.sprintId ? 'sprint' : 'outside',
              icon: <StatusIcon status={t.status} />,
            }))}
          onClose={() => setRelPicker(null)}
          onPick={(value) => {
            linkRelated(Number(value));
            setRelPicker(null);
          }}
        />
      )}
    </aside>
  );
}

// ─── Aplikacja ───────────────────────────────────────────────────────────────

/*
 * Nazwa klawisza modyfikatora zalezy od systemu. Pokazywanie "⌘" na Windowsie
 * jest mylace — tego znaku nie ma na klawiaturze i nic nie mowi.
 */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'], label: 'Paleta poleceń — akcje i skok do zadania' },
  { keys: ['J', 'K'], label: 'Nawigacja po liście' },
  { keys: [MOD, 'klik'], label: 'Dodaj / usuń zadanie z zaznaczenia' },
  { keys: ['Shift', 'klik'], label: 'Zaznacz zakres od ostatnio klikniętego' },
  { keys: ['→', '←'], label: 'Rozwiń / zwiń podzadania' },
  { keys: ['Enter'], label: 'Otwórz zadanie' },
  { keys: ['Esc'], label: 'Zamknij panel / menu / zaznaczenie' },
  { keys: ['/'], label: 'Filtruj zadania' },
  { keys: [MOD, 'F'], label: 'Filtruj zadania — zamiast wyszukiwarki przeglądarki' },
  { keys: ['R'], label: 'Odśwież dane z Bitriksa' },
  { keys: ['W'], label: 'Sprint — wrzuć do sprintu albo do backlogu' },
  { keys: ['M'], label: 'Etap w sprincie' },
  { keys: ['A'], label: 'Osoba odpowiedzialna' },
  { keys: ['P'], label: 'Priorytet' },
  { keys: ['S'], label: 'Status (z potwierdzeniem)' },
  { keys: [MOD, 'Enter'], label: 'Wyślij komentarz' },
  { keys: ['?'], label: 'Ta ściągawka' },
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette shortcuts" role="dialog" aria-label="Skróty klawiszowe">
        <div className="palette-section">Skróty klawiszowe</div>
        <div className="palette-list">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="shortcut">
              <span className="shortcut-keys">
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          Wszystkie akcje są też pod <strong>prawym przyciskiem myszy</strong> na zadaniu
          i w palecie <kbd>{MOD}</kbd>
          <kbd>K</kbd>.
        </div>
      </div>
    </>
  );
}

/**
 * Cel upuszczenia. Osobny komponent, bo `useDroppable` to hook — nie da sie go
 * wywolac w `.map()` po sekcjach listy.
 *
 * Podswietlamy dopiero, gdy cos naprawde jest w reku (`active`): samo `isOver`
 * jest prawda takze przy zwyklym ruchu myszy nad lista.
 */
function DropZone({
  id,
  tag,
  disabled,
  className,
  dataGroup,
  children,
}: {
  id: string;
  tag: 'section' | 'div';
  disabled?: boolean;
  className?: string;
  dataGroup?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id, disabled });
  const cls = [className, isOver && active ? 'group-over' : null].filter(Boolean).join(' ');

  return tag === 'section' ? (
    <section ref={setNodeRef} className={cls || undefined} data-group={dataGroup}>
      {children}
    </section>
  ) : (
    <div ref={setNodeRef} className={cls || undefined}>
      {children}
    </div>
  );
}

interface Opt {
  value: string;
  label: string;
  hint?: string;
  /** Naglowek nad pozycja. Rysowany tylko przy ZMIANIE sekcji, jak w palecie polecen. */
  section?: string;
}

/** Kompaktowy select z panelu Display — przycisk + lista rozwijana pod nim. */
function DisplaySelect({
  value,
  options,
  onPick,
  disabled = false,
}: {
  value: string;
  options: Opt[];
  onPick: (v: string) => void;
  /** Wyszarzony i nieklikalny — np. Grupowanie na tablicy (tam zawsze etap). */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.value === value)?.label ?? '—';
  let lastSection = '';

  return (
    <div className="ds-wrap">
      <button
        className="ds-button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="ds-value">{label}</span>
        <ChevronIcon open={false} />
      </button>

      {open && (
        <>
          {/* Zamyka tylko te liste, nie caly panel. */}
          <div className="ds-backdrop" onClick={() => setOpen(false)} />
          <div className="ds-options">
            {options.map((o) => {
              const header = o.section && o.section !== lastSection ? o.section : null;
              lastSection = o.section ?? '';
              return (
                <div key={o.value}>
                  {header && <div className="ds-section">{header}</div>}
                  <button
                    className={`ds-option${o.value === value ? ' ds-option-on' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      onPick(o.value);
                    }}
                  >
                    <span className="menu-check">{o.value === value ? <CheckIcon /> : null}</span>
                    <span className="menu-label">{o.label}</span>
                    {o.hint && <span className="palette-hint">{o.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Panel widoku ("Display") — prawy przycisk na pustym tle listy albo przycisk
 * w toolbarze. Uklad: zakladki widoku, potem wiersze
 * `etykieta -> kompaktowy select`, przy Grupowaniu i Sortowaniu dodatkowo
 * przycisk kierunku, na koncu przelaczniki.
 */
function ViewMenu({
  anchor,
  state,
  activeSprintName,
  scopes,
  scopeCounts,
  columns,
  onClose,
  on,
}: {
  anchor: Anchor;
  state: {
    view: ViewMode;
    group: GroupBy;
    subGroup: GroupBy | null;
    sort: SortOpts;
    scope: Scope;
    mine: boolean;
    unassigned: boolean;
    done: boolean;
    empty: boolean;
    carousel: boolean;
    filtersOn: boolean;
    theme: Theme;
    font: Font;
  };
  activeSprintName: string | null;
  /** Zakresy, ktore maja sens w tym projekcie — bez sprintu zostaje sam "Wszystkie". */
  scopes: typeof SCOPES;
  scopeCounts: Record<Scope, number>;
  /** Kategorie biezacego poziomu: czy maja teraz zadania i czy sa przypiete. */
  columns: { name: string; present: boolean; pinned: boolean }[];
  onClose: () => void;
  on: {
    view: (v: ViewMode) => void;
    group: (g: GroupBy) => void;
    subGroup: (g: GroupBy | null) => void;
    sort: (patch: Partial<SortOpts>) => void;
    scope: (s: Scope) => void;
    mine: () => void;
    unassigned: () => void;
    done: () => void;
    empty: () => void;
    toggleColumn: (name: string) => void;
    carousel: () => void;
    clearFilters: () => void;
    reload: () => void;
    palette: () => void;
    theme: (t: Theme) => void;
    font: (f: Font) => void;
  };
}) {
  const Control = DisplaySelect;
  const width = 300;
  const height = 510;
  const rowClass = 'ds-row';
  // Tablica to zawsze kanban po etapach — grupowanie i podgrupowanie jej nie dotycza,
  // wiec na tablicy oba wiersze sa wyszarzone i nieklikalne (patrz .ds-row-off).
  const boardMode = state.view === 'board';
  const groupRow = `${rowClass}${boardMode ? ' ds-row-off' : ''}`;

  // Panel „Kolumny/Grupy" wyskakuje jako OSOBNY panel obok (panel w panelu), nie sekcja.
  const [colsOpen, setColsOpen] = useState(false);
  // Nazwa mowi, po co ten panel jest: trzymac PUSTE kategorie widoczne mimo braku zadan.
  const colTitle = boardMode
    ? 'Puste kolumny'
    : state.subGroup
      ? 'Puste podgrupy'
      : 'Puste grupy';

  // `height` sluzy tylko do tego, by panel nie wyjechal pod dolna krawedz ekranu.
  const left = Math.min(anchor.left, window.innerWidth - width - 12);
  const top = Math.min(anchor.top, Math.max(12, window.innerHeight - height - 12));

  // Flyout siada z lewej strony menu; gdy tam ciasno — z prawej.
  const flyW = 240;
  const flyLeft = left - flyW - 8 >= 8 ? left - flyW - 8 : left + width + 8;

  const check = (label: string, on_: boolean, run: () => void, disabled = false) => (
    <label className={`ds-check${disabled ? ' ds-check-off' : ''}`}>
      <span>{label}</span>
      <input type="checkbox" checked={on_} disabled={disabled} onChange={run} />
    </label>
  );

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="menu view-menu" style={{ left, top, width }}>
        {/* Zakladki widoku */}
        <div className="ds-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={state.view === 'list'}
            className={`ds-tab${state.view === 'list' ? ' ds-tab-on' : ''}`}
            onClick={() => on.view('list')}
          >
            <ListIcon /> Lista
          </button>
          <button
            role="tab"
            aria-selected={state.view === 'board'}
            className={`ds-tab${state.view === 'board' ? ' ds-tab-on' : ''}`}
            onClick={() => on.view('board')}
          >
            <BoardIcon /> Tablica
          </button>
        </div>

        <div className={groupRow}>
          <span className="ds-label">Grupowanie</span>
          <Control
            value={state.group}
            options={GROUPS.map((g) => ({ value: g.key, label: g.label }))}
            onPick={(v) => on.group(v as GroupBy)}
            disabled={boardMode}
          />
          <button
            className="ds-dir"
            title="Kolejność grup"
            disabled={boardMode}
            onClick={() => on.sort({ groupDir: state.sort.groupDir === 'asc' ? 'desc' : 'asc' })}
          >
            <DirIcon dir={state.sort.groupDir} />
          </button>
        </div>

        <div className={groupRow}>
          <span className="ds-label">Podgrupowanie</span>
          <Control
            value={state.subGroup ?? 'none'}
            // Podgrupowanie po tej samej osi co grupowanie nic by nie dalo.
            options={[
              { value: 'none', label: 'Brak' },
              ...GROUPS.filter((g) => g.key !== state.group).map((g) => ({
                value: g.key,
                label: g.label,
              })),
            ]}
            onPick={(v) => on.subGroup(v === 'none' ? null : (v as GroupBy))}
            disabled={boardMode}
          />
        </div>

        <div className={rowClass}>
          <span className="ds-label">Sortowanie</span>
          <Control
            value={state.sort.by}
            options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            onPick={(v) => on.sort({ by: v as SortBy })}
          />
          <button
            className="ds-dir"
            title={state.sort.dir === 'asc' ? 'Rosnąco' : 'Malejąco'}
            onClick={() => on.sort({ dir: state.sort.dir === 'asc' ? 'desc' : 'asc' })}
          >
            <DirIcon dir={state.sort.dir} />
          </button>
        </div>

        <div className={rowClass}>
          <span className="ds-label">Zakres</span>
          <Control
            value={state.scope}
            options={scopes.map((s) => ({
              value: s.key,
              label: s.key === 'sprint' && activeSprintName ? activeSprintName : s.label,
              hint: String(scopeCounts[s.key]),
            }))}
            onPick={(v) => on.scope(v as Scope)}
          />
        </div>

        <div className={rowClass}>
          <span className="ds-label">Motyw</span>
          <Control
            value={state.theme}
            options={THEMES.map((t) => ({ value: t.value, label: t.label, section: t.section }))}
            onPick={(v) => on.theme(v as Theme)}
          />
        </div>

        <div className={rowClass}>
          <span className="ds-label">Czcionka</span>
          <Control
            value={state.font}
            options={FONTS.map((f) => ({ value: f.value, label: f.label, hint: f.hint }))}
            onPick={(v) => on.font(v as Font)}
          />
        </div>

        <div className="menu-sep" />

        {check('Tylko moje', state.mine, on.mine)}
        {check('+ nieprzypisane', state.unassigned, on.unassigned, !state.mine)}
        {check('Pokaż zakończone', state.done, on.done)}
        {check('Karuzela zakresu', state.carousel, on.carousel)}

        <div className="menu-sep" />
        {/* „Kolumny/Grupy" otwiera OSOBNY panel obok — w dolnej sekcji, obok akcji. */}
        {columns.length > 0 && (
          <button
            className={`menu-item${colsOpen ? ' menu-item-on' : ''}`}
            onClick={() => setColsOpen((o) => !o)}
          >
            <span className="menu-check" />
            <span className="menu-label">{colTitle}</span>
            <span className="menu-flyarrow">
              <ChevronIcon open={colsOpen} />
            </span>
          </button>
        )}
        {state.filtersOn && (
          <button className="menu-item" onClick={() => { onClose(); on.clearFilters(); }}>
            <span className="menu-check" />
            <span className="menu-label">Wyczyść filtry</span>
          </button>
        )}
        <button className="menu-item" onClick={() => { onClose(); on.reload(); }}>
          <span className="menu-check" />
          <span className="menu-label">Odśwież</span>
          <kbd>r</kbd>
        </button>
        <button className="menu-item" onClick={() => { onClose(); on.palette(); }}>
          <span className="menu-check" />
          <span className="menu-label">Paleta poleceń</span>
          <kbd>{MOD}</kbd>
          <kbd>K</kbd>
        </button>
      </div>

      {/* Panel w panelu — osobny, obok menu widoku; checkbox na kazda kolumne/grupe. */}
      {colsOpen && columns.length > 0 && (
        <div className="menu view-cols-flyout" style={{ left: flyLeft, top, width: flyW }}>
          <div className="ds-colhead">{colTitle}</div>
          <div className="ds-colhint">Przypnij, żeby została widoczna także pusta.</div>
          <div className="ds-collist">
            {columns.map((c) => {
              const pinned = c.pinned;
              return (
                <button
                  key={c.name}
                  className={`ds-pinrow${pinned ? ' ds-pinrow-on' : ''}`}
                  title={
                    pinned
                      ? 'Przypięta — zostaje na widoku, nawet gdy pusta'
                      : 'Nieprzypięta — zniknie, gdy nie ma zadań'
                  }
                  onClick={() => on.toggleColumn(c.name)}
                >
                  <span className="ds-pin">
                    <PinIcon filled={pinned} />
                  </span>
                  <span className="ds-pinname">{c.name}</span>
                  {/* Kolumna z zadaniami i tak jest widoczna — pinezka liczy sie dopiero przy zerze. */}
                  {!c.present && <span className="ds-pinempty">pusta</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/** Potwierdzenie akcji, ktora latwo wywolac przypadkiem (dzis: zmiana statusu). */
function Confirm({
  title,
  body,
  confirmLabel = 'Zmień status',
  danger = false,
  onYes,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onYes: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        className="dialog"
        role="alertdialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2>{title}</h2>
        {body && <p>{body}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Anuluj
          </button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            autoFocus
            onClick={() => {
              onClose();
              onYes();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onYes: () => void;
}

interface PickerState {
  kind: PickerKind;
  taskId: number;
  /** Zadania, na ktore zadziala wybor — jedno albo cale zaznaczenie. */
  targets: number[];
  anchor: Anchor;
}

interface MenuState {
  taskId: number;
  targets: number[];
  anchor: Anchor;
}

/** Menu kontekstowe — glowna droga do akcji; skroty klawiszowe sa alternatywa. */
function ContextMenu({
  task,
  stageName,
  sprintName,
  labels,
  count,
  anchor,
  onPick,
  onOpen,
  onClose,
}: {
  task: Task;
  stageName: string;
  /** Gdzie zadanie lezy dzis: nazwa aktywnego sprintu, „Backlog" albo stary sprint. */
  sprintName: string;
  labels: FieldEnums;
  /** Ile zadan obejmie akcja — >1 gdy klikniete nalezy do zaznaczenia. */
  count: number;
  anchor: Anchor;
  onPick: (kind: PickerKind) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const bulk = count > 1;

  // Przy zaznaczeniu wielokrotnym nie pokazujemy biezacych wartosci — sa rozne.
  const current: Record<PickerKind, string> = {
    status: bulk ? '' : (labels.status[task.status] ?? task.status),
    assignee: bulk ? '' : isUnassigned(task.responsibleId) ? UNASSIGNED_LABEL : (task.responsibleName ?? ''),
    priority: bulk ? '' : (labels.priority[task.priority] ?? '—'),
    stage: bulk ? '' : task.sprintId ? stageName : 'poza sprintem',
    sprint: bulk ? '' : sprintName,
    points: bulk ? '' : task.storyPoints != null ? String(task.storyPoints) : '—',
    parent: bulk ? '' : task.parentId ? `#${task.parentId}` : '—',
    epic: '', // epika nie ma w MENU_ITEMS — edytuje sie go w panelu/filtrze
    tags: '', // tagi tez nie — edytuje sie je w panelu
  };

  const width = 248;
  const height = 40 + MENU_ITEMS.length * 30 + 34;
  const left = Math.min(anchor.left, window.innerWidth - width - 12);
  const top = Math.min(anchor.top, window.innerHeight - height - 12);

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="menu" style={{ left, top, width }}>
        <div className="menu-head">
          {bulk ? `Zaznaczono: ${count}` : (task.code ?? `#${task.id}`)}
        </div>

        {MENU_ITEMS.map(({ kind, key }) => {
          // Etapy istnieja tylko w obrebie sprintu — bez sprintu nie ma czego wybierac.
          const disabled = kind === 'stage' && !bulk && !task.sprintId;
          return (
            <button
              key={kind}
              className="menu-item"
              disabled={disabled}
              title={PICKER_HELP[kind]}
              onClick={() => !disabled && onPick(kind)}
            >
              <span className="menu-label">{PICKER_TITLE[kind]}</span>
              <span className="menu-value">{current[kind]}</span>
              <kbd>{key}</kbd>
            </button>
          );
        })}

        {!bulk && (
          <>
            <div className="menu-sep" />
            <button className="menu-item" onClick={onOpen}>
              <span className="menu-label">Otwórz szczegóły</span>
              <kbd>Enter</kbd>
            </button>
          </>
        )}
      </div>
    </>
  );
}

export default function App() {
  const {
    tasks,
    stages,
    stageNames,
    stageOrder,
    stageMeta,
    labels,
    activeSprint,
    backlogId,
    config,
    projects,
    epics,
    epicNames,
    groupId,
    loading,
    error,
    pending,
    toasts,
    newIds,
    reload,
    mutate,
    removeTask,
    toast,
    selectProject,
    markOpened,
  } = useBitrixData();

  // Ustawienia widoku wczytane z poprzedniej sesji (patrz SETTINGS_KEY).
  const [saved] = useState(loadSettings);

  /*
   * Ktore zadania MAJA powiazane (DEPENDS_ON) — do plakietki w wierszu. Danych nie ma
   * w liscie (patrz fetchRelatedPresence), wiec dociagamy je W TLE. Enricher:
   *  - DELTA po `changedDate`: sprawdzamy tylko zadania NOWE albo ZMIENIONE od ostatniego
   *    razu (edycja DEPENDS_ON bumpuje changedDate) — dzieki temu plakietki sa ZAWSZE
   *    swieze przy pollingu, a nie „raz na projekt".
   *  - BRAMKA na 'all': jedna runda bierze najwyzej CAP zadan i robi PRZERWE — nigdy nie
   *    wystrzeliwujemy 1000 wywolan naraz. Reszte domiata w kolejnych rundach.
   *  - Powiazania mogly ZNIKNAC — po sprawdzeniu tez USUWAMY z `relatedIds`.
   * `relRunningRef` pilnuje, ze petla leci pojedynczo; czyta `tasksRef` na biezaco.
   */
  const [relatedIds, setRelatedIds] = useState<Set<number>>(new Set());
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;
  // Cel enrichu to WIDOCZNY (przefiltrowany zakresem) podzbior, NIE cala lista projektu
  // (~1000 zadan zaladowanych zawsze). Ustawiany nizej, gdy znamy `filtered`.
  const enrichTargetsRef = useRef<Task[]>([]);
  const relCheckedAtRef = useRef<Map<number, string>>(new Map()); // taskId -> changedDate przy sprawdzeniu
  const relRunningRef = useRef(false);
  useEffect(() => {
    relCheckedAtRef.current = new Map();
    setRelatedIds(new Set());
  }, [groupId]);
  const runRelatedEnricher = useCallback(async () => {
    if (relRunningRef.current) return;
    relRunningRef.current = true;
    try {
      // BRAMKA: przy duzym widoku (np. „Wszystkie"/„Poza sprintem" ~1000) NIE enrichujemy —
      // to zajezdzalo webhooka (QUERY_LIMIT_EXCEEDED). Plakietki dzialaja w mniejszych
      // widokach (sprint, zawezone filtry). CAP+przerwa dodatkowo dawkuja wywolania.
      const MAX_VIEW = 400;
      const CAP = 100;
      for (;;) {
        const targets = enrichTargetsRef.current;
        if (targets.length > MAX_VIEW) break;
        const forGroup = groupIdRef.current;
        const todo = targets
          .filter((t) => relCheckedAtRef.current.get(t.id) !== (t.changedDate ?? ''))
          .slice(0, CAP);
        if (!todo.length) break;
        const ids = todo.map((t) => t.id);
        let have: Set<number>;
        try {
          have = await fetchRelatedPresence(ids);
        } catch {
          break; // runda padla (np. limit) — sprobujemy przy nastepnej zmianie widoku
        }
        if (groupIdRef.current !== forGroup) break; // zmiana projektu w locie
        setRelatedIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (have.has(id)) next.add(id);
            else next.delete(id);
          }
          return next;
        });
        for (const t of todo) relCheckedAtRef.current.set(t.id, t.changedDate ?? '');
        await new Promise((r) => setTimeout(r, 300)); // oddech dla webhooka
      }
    } finally {
      relRunningRef.current = false;
    }
  }, []);

  const [scopePref, setScope] = useState<Scope>(saved.scope);
  /*
   * Filtry z paska — patrz `Filters`. Celowo NIE trzymamy ich w SETTINGS_KEY:
   * odnosza sie do konkretnych osob/etapow/tagow tego projektu, wiec po powrocie
   * do aplikacji (albo po zmianie projektu) byly juz nieaktualne. Zyja jedna sesje,
   * tak samo jak szukanie.
   */
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  /**
   * „Wyczyść wszystkie" zwija sie do samego „×", gdy chipy zaczynaja przewijac
   * (brak miejsca). Histereza: zwijamy, gdy tresc wystaje (spare < 0), a rozwijamy
   * dopiero, gdy jest miejsce na CALY podpis (spare >= LABEL_W) — bez tego dokladanie
   * podpisu znow powodowaloby wystawanie i przycisk migalby w kolko.
   */
  const [clearCollapsed, setClearCollapsed] = useState(false);
  const onChipsSpare = useCallback((spare: number) => {
    const LABEL_W = 130; // ~szerokosc podpisu „Wyczyść wszystkie" z odstepem
    setClearCollapsed((prev) => (prev ? spare < LABEL_W : spare < -1));
  }, []);
  // Bez chipow ScrollX znika i przestaje raportowac miejsce — wracamy do pelnego podpisu.
  useEffect(() => {
    if (!anyFilter(filters)) setClearCollapsed(false);
  }, [filters]);
  /** Menu "+ Filtr" — wybor wymiaru; potem `filterPick` z wartosciami. */
  const [filterMenu, setFilterMenu] = useState<Anchor | null>(null);
  /** Otwarty popover wartosci dla jednego WARUNKU (wielokrotny wybor). */
  const [filterPick, setFilterPick] = useState<{ condId: string; anchor: Anchor } | null>(null);
  /** Otwarte menu operatora (to / to nie / dowolny z…) dla jednego warunku. */
  const [opMenu, setOpMenu] = useState<{ condId: string; anchor: Anchor } | null>(null);
  /** Zapisane widoki (globalne, localStorage) i otwarte menu „Widoki". */
  const [views, setViews] = useState<SavedView[]>(loadViews);
  /** `hover: true` = menu wyskoczylo samo, bez klikniecia (nie kradnie wtedy focusu). */
  const [viewsMenu, setViewsMenu] = useState<(Anchor & { hover?: boolean }) | null>(null);
  /*
   * Widoki otwieraja sie na NAJECHANIE, ale z dwoma opoznieniami, bez ktorych takie
   * menu jest nie do zycia: krotka zwloka przed otwarciem (przejazd myszy obok
   * przycisku niczego nie wyskakuje) i dluzsza przed zamknieciem (da sie zjechac
   * z przycisku na menu po skosie, nie tracac go po drodze).
   */
  const viewsTimer = useRef<number | null>(null);
  const clearViewsTimer = useCallback(() => {
    if (viewsTimer.current !== null) {
      clearTimeout(viewsTimer.current);
      viewsTimer.current = null;
    }
  }, []);
  const openViewsSoon = useCallback(
    (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const anchor = { left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4, hover: true };
      clearViewsTimer();
      viewsTimer.current = window.setTimeout(() => setViewsMenu(anchor), 140);
    },
    [clearViewsTimer],
  );
  const closeViewsSoon = useCallback(() => {
    clearViewsTimer();
    viewsTimer.current = window.setTimeout(() => setViewsMenu(null), 260);
  }, [clearViewsTimer]);
  // Timer nie moze przezyc odmontowania — inaczej setState poleci w pustke.
  useEffect(() => clearViewsTimer, [clearViewsTimer]);
  const [viewMode, setViewMode] = useState<ViewMode>(saved.viewMode);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Motyw i kroj stoja poza SETTINGS_KEY, bo czyta je tez skrypt w <head>.
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [font, setFont] = useState<Font>(loadFont);
  // Domyslnie wlaczone — na starcie interesuja mnie moje zadania, nie caly zespol.
  const [onlyMine, setOnlyMine] = useState(saved.onlyMine);
  const [withUnassigned, setWithUnassigned] = useState(saved.withUnassigned);
  const [showDone, setShowDone] = useState(saved.showDone);
  const [showEmpty, setShowEmpty] = useState(saved.showEmpty);
  const [shownEmpty, setShownEmpty] = useState<string[]>(saved.shownEmpty);
  const [scopeCarousel, setScopeCarousel] = useState(saved.scopeCarousel);
  // W obrebie sprintu kazde zadanie ma etap, wiec grupowanie po etapie
  // odwzorowuje realny przeplyw (W toku -> Do zatwierdzenia / PR -> Wdrozone).
  const [groupBy, setGroupBy] = useState<GroupBy>(saved.groupBy);
  const [subGroupBy, setSubGroupBy] = useState<GroupBy | null>(saved.subGroupBy);
  const [sort, setSort] = useState<SortOpts>(saved.sort);
  const [detailWidth, setDetailWidth] = useState(saved.detailWidth);
  const patchSort = useCallback((patch: Partial<SortOpts>) => setSort((s) => ({ ...s, ...patch })), []);

  /** Dodaj nowy warunek dla wymiaru i od razu otworz jego wartosci. */
  const addCondition = useCallback((field: FilterField, anchor: Anchor) => {
    const id = newCondId();
    setFilters((f) => [...f, { id, field, op: defaultOp(field), values: [] }]);
    setFilterPick({ condId: id, anchor });
  }, []);

  /** Przelacz jedna wartosc w konkretnym warunku (klik w pozycje popovera). */
  const toggleCondValue = useCallback(
    (condId: string, value: string) =>
      setFilters((f) =>
        f.map((c) =>
          c.id === condId
            ? {
                ...c,
                values: c.values.includes(value)
                  ? c.values.filter((v) => v !== value)
                  : [...c.values, value],
              }
            : c,
        ),
      ),
    [],
  );

  /** Zmien operator warunku (menu na chipie). */
  const setCondOp = useCallback(
    (condId: string, op: FilterOp) =>
      setFilters((f) => f.map((c) => (c.id === condId ? { ...c, op } : c))),
    [],
  );

  /** Usun jeden warunek (krzyzyk na chipie albo porzucony, pusty popover). */
  const removeCondition = useCallback(
    (condId: string) => setFilters((f) => f.filter((c) => c.id !== condId)),
    [],
  );

  /**
   * Szybki filtr po tagu (paleta / klik w tag na wierszu). Trafia do wspolnego
   * warunku „Tag: dowolny z", tworzac go w razie potrzeby; zdjecie ostatniego tagu
   * usuwa caly warunek. Warunki tagu z innym operatorem (np. „żaden z") zostawiamy.
   */
  const toggleTag = useCallback(
    (tag: string) =>
      setFilters((f) => {
        const anyCond = f.find((c) => c.field === 'tag' && c.op === 'anyOf');
        if (!anyCond) {
          return [...f, { id: newCondId(), field: 'tag' as FilterField, op: 'anyOf' as FilterOp, values: [tag] }];
        }
        const values = anyCond.values.includes(tag)
          ? anyCond.values.filter((v) => v !== tag)
          : [...anyCond.values, tag];
        if (!values.length) return f.filter((c) => c !== anyCond);
        return f.map((c) => (c === anyCond ? { ...c, values } : c));
      }),
    [],
  );

  /** Czy tag jest gdziekolwiek dodatnio wybrany — do „✓" w palecie. */
  const tagActive = useCallback(
    (tag: string) => filters.some((c) => c.field === 'tag' && c.op !== 'noneOf' && c.values.includes(tag)),
    [filters],
  );

  /**
   * Szybki filtr po epiku (klik w kropke na wierszu). Jak `toggleTag`, tylko epik jest
   * jednowartosciowy — wspolny warunek „Epik: to", ponowny klik w ten sam epik go zdejmuje.
   */
  const toggleEpicFilter = useCallback(
    (epicId: number) =>
      setFilters((f) => {
        const value = String(epicId);
        const cond = f.find((c) => c.field === 'epic' && c.op === 'is');
        if (!cond) {
          return [...f, { id: newCondId(), field: 'epic' as FilterField, op: 'is' as FilterOp, values: [value] }];
        }
        const values = cond.values.includes(value)
          ? cond.values.filter((v) => v !== value)
          : [...cond.values, value];
        if (!values.length) return f.filter((c) => c !== cond);
        return f.map((c) => (c === cond ? { ...c, values } : c));
      }),
    [],
  );
  /** Zatwierdzony filtr — SearchBox oddaje go po przerwie w pisaniu, nie po znaku. */
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(new Set());
  /** Zaznaczenie wielokrotne + kotwica dla zakresu Shift. */
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [markAnchor, setMarkAnchor] = useState<number | null>(null);
  /** Zadanie trzymane w reku — potrzebne tylko do podgladu pod kursorem. */
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [viewMenu, setViewMenu] = useState<Anchor | null>(null);
  const [projectMenu, setProjectMenu] = useState<Anchor | null>(null);
  const searchRef = useRef<SearchHandle>(null);
  const [contentRef, contentWidth] = useWidth<HTMLDivElement>();
  const tagLimit = tagsForWidth(contentWidth);

  const me = config?.userId ? Number(config.userId) : null;

  const project = useMemo(
    () => projects.find((p) => p.id === groupId) ?? null,
    [projects, groupId],
  );

  /*
   * Zwykly projekt (nie scrum) nie ma sprintow, wiec podzial "w sprincie / poza"
   * niczego by nie dzielil — zostaje jeden zakres. Zapisana preferencja jest
   * DERYWOWANA, a nie nadpisywana: po powrocie do projektu scrumowego wraca
   * dokladnie ten zakres, ktory byl ustawiony.
   */
  const scopes = useMemo(
    () => (activeSprint ? SCOPES : SCOPES.filter((s) => s.key === 'all')),
    [activeSprint],
  );
  const scope: Scope = activeSprint ? scopePref : 'all';

  /**
   * Zmiana projektu to inny zbior zadan, wiec caly stan chwilowy odnoszacy sie do
   * poprzedniego (otwarte zadanie, zaznaczenie, zwiniete grupy, filtr tagu, szukanie)
   * przestaje cokolwiek znaczyc. Ustawienia widoku zostaja — te sa decyzja o tym,
   * JAK patrzec, niezaleznie od tego NA CO.
   */
  const pickProject = useCallback(
    (id: number) => {
      if (id === groupId) return;
      setOpenId(null);
      setMarked(new Set());
      setMarkAnchor(null);
      setCollapsed(new Set());
      setCollapsedTasks(new Set());
      setFilters(EMPTY_FILTERS);
      setQuery('');
      setCursor(0);
      selectProject(id);
    },
    [groupId, selectProject],
  );

  /** Ludzie z realnie wystepujacych przypisan — zero dodatkowych zapytan do user.get. */
  const people = useMemo(() => {
    const map = new Map<number, Person>();
    for (const t of tasks) {
      if (t.responsibleId && !map.has(t.responsibleId)) {
        map.set(t.responsibleId, {
          id: t.responsibleId,
          // Konto-zaslepka wystawiamy jako "Nieprzypisane" — dzieki temu da sie
          // przez nie ODPIAC zadanie, czego Bitrix inaczej nie pozwala zrobic.
          name: t.responsibleId === UNASSIGNED_ID ? UNASSIGNED_LABEL : (t.responsibleName ?? `#${t.responsibleId}`),
          photo: t.responsibleId === UNASSIGNED_ID ? null : t.responsiblePhoto,
        });
      }
    }
    return [...map.values()].sort((a, b) => {
      // Zalogowany uzytkownik na gorze, tuz pod nim "Nieprzypisane" (najczestsze dwa
      // cele przypisania stoja razem), dalej reszta alfabetycznie.
      const rank = (p: Person) => (p.id === me ? 0 : p.id === UNASSIGNED_ID ? 1 : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, 'pl');
    });
  }, [tasks, me]);

  const sprintId = activeSprint?.id ?? null;

  // Przelaczniki dzialaja niezaleznie od zakresu, zeby liczniki przy zakresach
  // pokazywaly to, co faktycznie zobaczysz po klliknieciu.
  const base = useMemo(
    () =>
      tasks.filter((t) => {
        // "Nieprzypisane" dokladamy do "Tylko moje" — praca niczyja w sprincie
        // jest zwykle tak samo istotna jak wlasna, a bez tego znika z widoku.
        const mineOrFree =
          t.responsibleId === me || (withUnassigned && isUnassigned(t.responsibleId));
        if (onlyMine && !mineOrFree) return false;
        if (!showDone && CLOSED_STATUSES.has(t.status)) return false;
        // Filtry z paska (Linear) — patrz `matchFilters`. Sa w `base`, wiec liczniki
        // przy zakresach i decyzja o zamknieciu panelu tez je uwzgledniaja.
        if (!matchFilters(t, filters, stageNames)) return false;
        return true;
      }),
    [tasks, onlyMine, withUnassigned, showDone, filters, stageNames, me],
  );

  // `base` po wyszukiwaniu, ale BEZ ograniczenia zakresem — wspolne dla licznikow
  // przy zakresach i dla tego, czy panel ma zostac otwarty (zakres to nawigacja,
  // nie filtr tresci, patrz nizej).
  const queriedBase = useMemo(() => matchQuery(base, query), [base, query]);

  // Liczniki przy zakresach licza to, co widac PO wpisaniu frazy, rozbite na sprint/reszte.
  const scopeCounts = useMemo(() => {
    let inSprint = 0;
    for (const t of queriedBase) if (sprintId && t.sprintId === sprintId) inSprint++;
    return { sprint: inSprint, outside: queriedBase.length - inSprint, all: queriedBase.length };
  }, [queriedBase, sprintId]);

  /*
   * Zbior, po ktorym decydujemy o zamknieciu panelu — celowo BEZ zakresu. Zakres
   * (Sprint / Poza sprintem / Wszystkie) to sposob patrzenia, tak jak Lista/Tablica:
   * przelaczenie go NIE ma zamykac otwartego zadania. Zamyka je dopiero wypadniecie
   * z filtrow TRESCI (tylko moje, zakonczone, tag, szukanie) — patrz efekt nizej.
   */
  const panelIds = useMemo(() => new Set(queriedBase.map((t) => t.id)), [queriedBase]);

  const filtered = useMemo(() => {
    const inScope = base.filter((t) => {
      const inSprint = sprintId !== null && t.sprintId === sprintId;
      if (scope === 'sprint' && !inSprint) return false;
      if (scope === 'outside' && inSprint) return false;
      return true;
    });
    return matchQuery(inScope, query);
  }, [base, scope, sprintId, query]);

  /** Wszystkie tagi wystepujace w grupie, z liczba uzyc — do palety i filtra. */
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'));
  }, [tasks]);

  /** Etykieta pojedynczej wartosci filtra — do podpisu chipa. */
  const filterValueLabel = useCallback(
    (field: FilterField, value: string): string => {
      if (field === 'assignee')
        return Number(value) === UNASSIGNED_ID
          ? UNASSIGNED_LABEL
          : (people.find((p) => p.id === Number(value))?.name ?? `#${value}`);
      if (field === 'priority') return labels.priority[value] ?? value;
      if (field === 'status') return labels.status[value] ?? value;
      if (field === 'epic')
        return value === '0' ? 'Bez epika' : (epicNames.get(Number(value))?.name ?? `#${value}`);
      if (field === 'tag' && value === NO_TAGS) return 'Bez tagów';
      return value; // etap i tag — wartoscia jest sama nazwa
    },
    [people, labels, epicNames],
  );

  /** Etap ma to samo id w kazdym sprincie — do ikony na chipie mapujemy po nazwie. */
  const stageIconByName = useMemo(() => {
    const m = new Map<string, { color: string | null; progress: number | null }>();
    for (const s of stages) {
      if (sprintId && s.sprintId !== sprintId) continue;
      if (m.has(s.name)) continue;
      const meta = stageMeta.get(s.id);
      m.set(s.name, { color: meta?.color ?? s.color, progress: meta?.progress ?? null });
    }
    return m;
  }, [stages, sprintId, stageMeta]);

  /** Ikona/awatar pojedynczej wartosci filtra — do „facepile" na chipie (jak w Linearze). */
  const filterValueIcon = useCallback(
    (field: FilterField, value: string): ReactNode => {
      if (field === 'assignee') {
        if (Number(value) === UNASSIGNED_ID) return <Avatar name={null} />;
        const p = people.find((x) => x.id === Number(value));
        return <Avatar name={p?.name ?? `#${value}`} photo={p?.photo} />;
      }
      if (field === 'priority') return <PriorityIcon priority={value} />;
      if (field === 'status') return <StatusIcon status={value} />;
      if (field === 'stage') {
        const meta = stageIconByName.get(value);
        return <StageIcon progress={meta?.progress ?? null} color={meta?.color ?? null} />;
      }
      if (field === 'epic') {
        const e = epicNames.get(Number(value));
        const c = value === '0' ? 'var(--fg-dim)' : e?.color ? `#${e.color}` : tagHue(e?.name ?? value);
        return <span className="tag-dot" style={{ background: c }} />;
      }
      const dotColor = value === NO_TAGS ? 'var(--fg-dim)' : tagHue(value);
      return <span className="tag-dot" style={{ background: dotColor }} />;
    },
    [people, stageIconByName, epicNames],
  );

  /**
   * Sam kolor wartosci — do jednolitych „monet" w facepile (wiele wartosci). Pelne
   * kolorowe krazki nachodza na siebie czysto (jak awatary); rysowanie tam pierscieni
   * dawalo podwojne obwodki i przeswitujace slivery sasiada.
   */
  const filterValueColor = useCallback(
    (field: FilterField, value: string): string => {
      if (field === 'status') return statusColor(value);
      if (field === 'stage') {
        const c = stageIconByName.get(value)?.color;
        return c ? `#${c}` : 'var(--fg-dim)';
      }
      if (field === 'tag') return value === NO_TAGS ? 'var(--fg-dim)' : tagHue(value);
      if (field === 'epic') {
        const e = epicNames.get(Number(value));
        return value === '0' ? 'var(--fg-dim)' : e?.color ? `#${e.color}` : tagHue(e?.name ?? value);
      }
      // Priorytet: trzy odrebne kolory (jak slupki w PriorityIcon) — wysoki pomaranczowy,
      // normalny akcent motywu, niski wyciszona szarosc.
      if (field === 'priority')
        return value === '2'
          ? 'var(--accent-orange)'
          : value === '1'
            ? 'var(--fg-muted)'
            : 'color-mix(in srgb, var(--accent-green) 55%, white)';
      return 'var(--fg-dim)';
    },
    [stageIconByName, epicNames],
  );

  /**
   * Jeden token facepile: okragla moneta z tlem POD ikona (podbarwiona dla
   * statusu/etapu/tagu, neutralna dla priorytetu, awatar dla osoby). Uzywany tak
   * samo w chipie jedno- i wielowartosciowym, zeby pojedyncza wartosc miala to samo
   * tlo co monety w facepile — rozni je tylko podpis obok (tylko przy 1 wartosci).
   */
  const filterToken = useCallback(
    (field: FilterField, v: string, i: number): ReactNode => {
      const color = filterValueColor(field, v);
      const hasIcon = field === 'status' || field === 'stage';
      const tinted = hasIcon || field === 'tag' || field === 'epic' || field === 'priority';
      // Priorytet ma WLASNY, kolorowy znak (slupki), wiec jego moneta jest tylko lekko
      // podbarwiona (28%), zeby slupki zostaly czytelne; reszta (pierscien/tag) 55%.
      const tintPct = field === 'priority' ? 28 : 55;
      return (
        <span
          className="filter-chip-vicon"
          key={v}
          style={{
            zIndex: CHIP_STACK_MAX - i,
            ...(tinted
              ? { background: `color-mix(in srgb, ${color} ${tintPct}%, var(--bg-panel))` }
              : {}),
          }}
        >
          {field === 'assignee' ? (
            filterValueIcon('assignee', v)
          ) : hasIcon ? (
            filterValueIcon(field, v)
          ) : field === 'tag' || field === 'epic' ? (
            <span className="filter-chip-tagcore" style={{ background: color }} />
          ) : (
            filterValueIcon('priority', v)
          )}
        </span>
      );
    },
    [filterValueColor, filterValueIcon],
  );

  /** Menu "+ Filtr": lista wymiarow (z liczba juz wybranych wartosci jako dopisek). */
  const addFilterOptions = useMemo<Option[]>(
    () =>
      FILTER_FIELDS.map((f) => {
        // Ile aktywnych warunkow juz dotyczy tego wymiaru — ten sam wymiar moze wystapic wiele razy.
        const n = filters.filter((c) => c.field === f.field && c.values.length).length;
        return { value: f.field, label: f.label, hint: n ? String(n) : undefined };
      }),
    [filters],
  );

  /** Opcje wartosci dla otwartego warunku — te same ikony/awatary co w wierszu listy. */
  const filterOptions = useMemo<Option[]>(() => {
    const field = filters.find((c) => c.id === filterPick?.condId)?.field;
    if (!field) return [];
    if (field === 'assignee')
      return people.map((p) => ({
        value: String(p.id),
        label: p.name,
        // „Nieprzypisane" to konto-zaslepka: pusty awatar, nie inicjal — tak samo jak
        // w wierszu listy, na karcie i w pickerze osoby.
        photo: p.id === UNASSIGNED_ID ? undefined : p.photo,
        icon: p.id === UNASSIGNED_ID ? <Avatar name={null} /> : undefined,
      }));
    if (field === 'priority')
      return Object.entries(labels.priority).map(([value, label]) => ({
        value,
        label,
        icon: <PriorityIcon priority={value} />,
      }));
    if (field === 'status')
      return Object.entries(labels.status).map(([value, label]) => ({
        value,
        label,
        icon: <StatusIcon status={value} />,
      }));
    if (field === 'stage') {
      // Nazwy etapow aktywnego sprintu, bez powtorek, w kolejnosci procesu.
      const seen = new Set<string>();
      const opts: Option[] = [];
      for (const s of [...stages].filter((x) => x.sprintId === sprintId).sort((a, b) => a.sort - b.sort)) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        const meta = stageMeta.get(s.id);
        opts.push({
          value: s.name,
          label: s.name,
          icon: <StageIcon progress={meta?.progress ?? null} color={meta?.color ?? s.color} />,
        });
      }
      return opts;
    }
    if (field === 'epic') {
      const dot = (c: string) => <span className="tag-dot" style={{ background: c }} />;
      return [
        { value: '0', label: 'Bez epika', icon: dot('var(--fg-dim)') },
        ...epics.map((e) => ({
          value: String(e.id),
          label: e.name,
          icon: dot(e.color ? `#${e.color}` : tagHue(e.name)),
        })),
      ];
    }
    return [
      // „Bez tagów" — zadania zupelnie bez etykiet (patrz NO_TAGS w matchCondition).
      {
        value: NO_TAGS,
        label: 'Bez tagów',
        icon: <span className="tag-dot" style={{ background: 'var(--fg-dim)' }} />,
      },
      ...allTags.map(([tag, count]) => ({
        value: tag,
        label: tag,
        hint: String(count),
        icon: <span className="tag-dot" style={{ background: tagHue(tag) }} />,
      })),
    ];
  }, [filters, filterPick, people, labels, stages, sprintId, stageMeta, allTags, epics]);

  /*
   * Klucze pustych grup dla danej osi — tylko etap i status maja skonczony, znany
   * zbior. Przy osobie zwracamy [], bo "pustej osoby" nie da sie wyliczyc (lista
   * ludzi bierze sie z przypisan). Ta sama funkcja dziala dla grupowania i dla
   * PODGRUPOWANIA — dzieki temu "Puste kolumny" dziala tez np. Osoba -> Status.
   *
   * Kolumna "zakonczone" (etap FINISH albo status zamkniety) podlega WYLACZNIE
   * ustawieniu "Pokaż zakończone", nie "Puste kolumny".
   */
  /** Wszystkie kategorie osi, ktore MOGA istniec bez zadan — kandydaci do panelu „Puste". */
  const allEmptyKeys = useCallback(
    (axis: GroupBy | null): string[] => {
      if (!axis) return [];
      if (axis === 'stage')
        return stages
          .filter((s) => s.sprintId === sprintId)
          .filter((s) => showDone || s.type !== 'FINISH')
          .map((s) => s.name);
      if (axis === 'status')
        return Object.keys(labels.status).filter((k) => showDone || !CLOSED_STATUSES.has(k));
      return [];
    },
    [stages, sprintId, showDone, labels.status],
  );

  /**
   * Puste grupy, ktore realnie domalowujemy: tylko te ZAZNACZONE w panelu „Puste".
   * Dawniej rzadzil tym jeden przelacznik (wszystko albo nic) — teraz wybor jest per kategoria.
   */
  const emptyKeysFor = useCallback(
    (axis: GroupBy | null): string[] =>
      axis ? allEmptyKeys(axis).filter((k) => shownEmpty.includes(pinKey(axis, k))) : [],
    [allEmptyKeys, shownEmpty],
  );

  const groups = useMemo(
    () => bucket(filtered, groupBy, stageNames, stageOrder, labels.status, me, sort, emptyKeysFor(groupBy)),
    [filtered, groupBy, stageNames, stageOrder, labels.status, me, sort, emptyKeysFor],
  );

  /**
   * Kazda grupa dostaje liste podgrup. Bez podgrupowania jest to jedna podgrupa
   * bez naglowka — dzieki temu render i nawigacja maja jeden ksztalt danych.
   */
  const groupNodes = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        subs: subGroupBy
          ? bucket(g.tasks, subGroupBy, stageNames, stageOrder, labels.status, me, sort, emptyKeysFor(subGroupBy)).map((s) => ({
              ...s,
              nodes: nest(s.tasks, collapsedTasks),
            }))
          : [{ key: '', label: '', order: 0, tasks: g.tasks, nodes: nest(g.tasks, collapsedTasks) }],
      })),
    [groups, subGroupBy, stageNames, stageOrder, labels.status, collapsedTasks, me, sort, emptyKeysFor],
  );

  /** Klucz zwijania podgrupy musi byc unikalny w obrebie calej listy. */
  const subKey = (groupKey: string, sub: string) => `${groupKey} ${sub}`;

  // Plaska lista widocznych zadan — po niej chodzi kursor klawiatury.
  // Musi odpowiadac temu, co faktycznie widac, wiec liczy sie ze zwinieciem
  // zarowno grup, jak i podzadan.
  const flat = useMemo(
    () =>
      groupNodes.flatMap((g) =>
        collapsed.has(g.key)
          ? []
          : g.subs.flatMap((s) =>
              collapsed.has(subKey(g.key, s.key)) ? [] : s.nodes.map((n) => n.task),
            ),
      ),
    [groupNodes, collapsed],
  );

  /** Zadania widoczne po filtrach — panel szczegolow zaznacza po tym ukryte podzadania. */
  const visibleIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered]);

  // Enrich plakietek „powiazane" chodzi po WIDOCZNYM (przefiltrowanym) podzbiorze, nie po
  // calej liscie projektu — patrz runRelatedEnricher (delta po changedDate + bramka rozmiaru).
  enrichTargetsRef.current = filtered;
  useEffect(() => {
    void runRelatedEnricher();
  }, [filtered, groupId, runRelatedEnricher]);

  /*
   * Ile podzadan NIE PRZESZLO filtrow. Wczesniej liczylem to jako
   * "wszystkie dzieci minus dzieci zagniezdzone w tej grupie" — a to co innego:
   * dziecko w innym etapie/u innej osoby jest widoczne, tylko kawalek dalej,
   * i wpadalo do licznika "ukryte". Teraz liczba w wierszu znaczy dokladnie to samo,
   * co w panelu szczegolow, i tooltip nie klamie.
   */
  /** W ktorej grupie stoi kazde widoczne zadanie — panel pokazuje to przy podzadaniach. */
  const groupOfTask = useMemo(() => {
    const m = new Map<number, string>();
    for (const g of groupNodes) for (const t of g.tasks) m.set(t.id, g.label);
    return m;
  }, [groupNodes]);

  const childStats = useMemo(() => {
    const m = new Map<number, { hidden: number; inFilter: number }>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const s = m.get(t.parentId) ?? { hidden: 0, inFilter: 0 };
      if (visibleIds.has(t.id)) s.inFilter++;
      else s.hidden++;
      m.set(t.parentId, s);
    }
    return m;
  }, [tasks, visibleIds]);

  /** Ile podzadan zadania jest widocznych TERAZ — potrzebne dla ←/→ na kursorze. */
  const visibleKids = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of groupNodes) for (const s of g.subs) for (const n of s.nodes) m.set(n.task.id, n.childCount);
    return m;
  }, [groupNodes]);

  /**
   * Kursor jest INDEKSEM w `flat`, a `flat` przebudowuje sie przy kazdej zmianie
   * filtrow, grupowania i sortowania. Samo przyciecie do dlugosci listy zostawialo
   * podswietlenie na tej samej POZYCJI, czyli na zupelnie innym zadaniu:
   * 12. wiersz sprintu i 12. wiersz spoza sprintu nie maja ze soba nic wspolnego.
   *
   * Dlatego kursor sledzi ZADANIE, nie miejsce — po przebudowie szukamy tego
   * samego id.
   *
   * A gdy zadanie wypadlo z widoku, kursor idzie na `-1`, czyli NIC nie jest
   * podswietlone. Przyciecie do dlugosci listy byloby tu tym samym bledem w innym
   * przebraniu: zostawialoby podswietlenie na wierszu, ktory trafil sie pod tym
   * numerem. Zaden wiersz nie jest lepszy niz przypadkowy — `j`/`k` wchodzi
   * wtedy od gory, a wszyscy odbiorcy `flat[cursor]` i tak zniosa `undefined`.
   */
  const prevFlatRef = useRef<Task[]>([]);
  useEffect(() => {
    const prev = prevFlatRef.current;
    prevFlatRef.current = flat;
    setCursor((c) => {
      const id = prev[c]?.id;
      // Pierwszy render (nie bylo jeszcze listy) albo kursor juz zdjety — nie ma
      // czego sledzic, wiec zostaje zwykle przyciecie: na starcie pierwszy wiersz.
      if (id === undefined) return Math.min(c, Math.max(0, flat.length - 1));
      return flat.findIndex((t) => t.id === id);
    });
  }, [flat]);

  /*
   * Panel szczegolow zamykamy, gdy otwarte zadanie WYPADA Z FILTROW TRESCI (tylko
   * moje, zakonczone, tag, szukanie) — zaznaczenie, ktorego nie ma na liscie po
   * takim filtrze, zaznaczeniem nie jest. Ale ZAKRESU tu nie liczymy: `panelIds`
   * jest scope-niezalezne, wiec przejscie Sprint -> Wszystkie / Poza sprintem
   * zostawia panel otwarty (to nawigacja, nie filtr — jak Lista/Tablica).
   *
   * Liczy sie `panelIds` (po filtrach tresci), nie `flat`: zwiniecie grupy chowa
   * wiersz, ale zadania nie odfiltrowuje, wiec panel ma zostac otwarty.
   *
   * W trakcie ladowania nie zamykamy nic — pusta lista znaczy wtedy "brak danych",
   * a nie "tego zadania juz tu nie ma".
   *
   * Reagujemy wylacznie na ZMIANE zbioru, nigdy na samo otwarcie. Panel pozwala
   * wejsc w podzadanie ukryte filtrem (i sam je tak podpisuje) — zamykanie po
   * `openId` zatrzaskiwaloby je natychmiast po klikinieciu.
   */
  /*
   * Czy otwarte zadanie przechodzilo filtry tresci W CHWILI otwarcia. Zadanie otwarte
   * mimo filtrow (podzadanie z panelu) zostaje otwarte na zawsze — inaczej zamknelo by
   * je pierwsze odswiezenie w tle, czyli najdalej po 30 sekundach.
   * `panelIds` swiadomie NIE jest zaleznoscia: liczy sie stan sprzed otwarcia.
   */
  const openWasVisibleRef = useRef(false);
  useEffect(() => {
    openWasVisibleRef.current = openId !== null && panelIds.has(openId);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevVisibleRef = useRef(panelIds);
  useEffect(() => {
    const filtersMoved = prevVisibleRef.current !== panelIds;
    prevVisibleRef.current = panelIds;
    if (!filtersMoved || loading || openId === null) return;
    if (!openWasVisibleRef.current) return;
    if (!panelIds.has(openId)) setOpenId(null);
  }, [panelIds, openId, loading]);

  // Zapis ustawien widoku — jeden efekt, bez rozrzucania po handlerach.
  useEffect(() => {
    const settings: Settings = {
      viewMode,
      groupBy,
      subGroupBy,
      sort,
      // Preferencja, nie `scope` — ten w projekcie bez sprintu jest zawsze "all"
      // i zapisanie go skasowaloby wybor sprzed przelaczenia projektu.
      scope: scopePref,
      onlyMine,
      withUnassigned,
      showDone,
      showEmpty,
      shownEmpty,
      detailWidth,
      scopeCarousel,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // brak miejsca / tryb prywatny — ustawienia po prostu nie przezyja odswiezenia
    }
  }, [viewMode, groupBy, subGroupBy, sort, scopePref, onlyMine, withUnassigned, showDone, showEmpty, shownEmpty, detailWidth, scopeCarousel]);

  // ── Zapisane widoki (globalne) ──
  useEffect(() => {
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
    } catch {
      // brak miejsca / tryb prywatny — widoki po prostu nie przezyja odswiezenia
    }
  }, [views]);

  /** Biezacy stan „na co patrzę" — do zapisu i do wykrycia, ktory widok jest aktywny. */
  const viewSnapshot = useMemo<Omit<SavedView, 'id' | 'name'>>(
    () => ({
      filters,
      query,
      groupBy,
      subGroupBy,
      sort,
      // Preferencja (scopePref), nie efektywny `scope` — patrz zapis ustawien wyzej.
      scope: scopePref,
      onlyMine,
      withUnassigned,
      showDone,
      showEmpty,
      viewMode,
    }),
    [filters, query, groupBy, subGroupBy, sort, scopePref, onlyMine, withUnassigned, showDone, showEmpty, viewMode],
  );

  const activeViewId = useMemo(() => {
    const fp = viewFingerprint(viewSnapshot);
    return views.find((v) => viewFingerprint(v) === fp)?.id ?? null;
  }, [views, viewSnapshot]);

  const applyView = useCallback((v: SavedView) => {
    // Swieze id warunkow, zeby nie kolidowaly z licznikiem `condSeq` biezacej sesji.
    setFilters(v.filters.map((c) => ({ ...c, id: newCondId() })));
    // Wyszukiwanie: od razu do stanu i do widocznego pola (SearchBox ma wlasny draft).
    // Widoki zapisane przed dodaniem pola `query` nie maja go wcale — bez `?? ''`
    // setQuery(undefined) wywala matchQuery (query.trim) i cala aplikacja gasnie.
    const q = v.query ?? '';
    setQuery(q);
    searchRef.current?.setValue(q);
    setGroupBy(v.groupBy);
    setSubGroupBy(v.subGroupBy);
    setSort(v.sort);
    setScope(v.scope);
    setOnlyMine(v.onlyMine);
    setWithUnassigned(v.withUnassigned);
    setShowDone(v.showDone);
    setShowEmpty(v.showEmpty);
    setViewMode(v.viewMode);
    // Menu zostaje otwarte — mozna przeklikiwac widoki i patrzec na wynik bez
    // ponownego otwierania listy. Zamyka je klikniecie poza (backdrop) albo Esc.
  }, []);

  const saveView = useCallback(
    (name: string) => {
      const n = name.trim();
      if (!n) return;
      setViews((vs) => [...vs, { id: `v${Date.now()}`, name: n, ...viewSnapshot }]);
    },
    [viewSnapshot],
  );

  const deleteView = useCallback(
    (id: string) => setViews((vs) => vs.filter((v) => v.id !== id)),
    [],
  );

  useEffect(() => {
    applyTheme(theme);
    // Przy "Systemowy" motyw ma nadazac za przelaczeniem OS juz w trakcie pracy.
    return watchSystemTheme(theme, () => applyTheme(theme));
  }, [theme]);

  useEffect(() => applyFont(font), [font]);

  // Otwarcie zadania = zobaczylem je; oba oznaczenia gasna.
  useEffect(() => {
    if (openId !== null) markOpened(openId);
  }, [openId, markOpened]);

  const openTask = useMemo(
    () => (openId === null ? null : (tasks.find((t) => t.id === openId) ?? null)),
    [openId, tasks],
  );

  /**
   * Klik w wiersz:
   *   Ctrl/⌘ + klik  — dolacz/odlacz pojedyncze zadanie
   *   Shift  + klik  — zaznacz caly zakres od kotwicy do klikanego, wlacznie
   *   zwykly klik    — czysci zaznaczenie i otwiera zadanie
   * Zakres liczymy po `flat`, czyli po tym, co faktycznie widac (z uwzglednieniem
   * zwinietych grup i podzadan) — inaczej Shift lapalby wiersze spoza ekranu.
   */
  const toggleMark = useCallback((id: number) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMarkAnchor(id);
  }, []);

  /** Zakres liczony po widocznej kolejnosci; zwraca false, gdy nie ma kotwicy. */
  const selectRangeTo = useCallback(
    (id: number) => {
      if (markAnchor === null) return false;
      const from = flat.findIndex((t) => t.id === markAnchor);
      const to = flat.findIndex((t) => t.id === id);
      if (from < 0 || to < 0) return false;

      const [lo, hi] = from <= to ? [from, to] : [to, from];
      setMarked((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(flat[i].id);
        return next;
      });
      return true;
    },
    [flat, markAnchor],
  );

  /** Checkbox: zaznacza bez otwierania zadania; z Shiftem bierze caly zakres. */
  const markRow = useCallback(
    (e: ReactMouseEvent, id: number) => {
      const idx = flat.findIndex((t) => t.id === id);
      if (idx >= 0) setCursor(idx);
      if (e.shiftKey && selectRangeTo(id)) return;
      toggleMark(id);
    },
    [flat, selectRangeTo, toggleMark],
  );

  const clickRow = useCallback(
    (e: ReactMouseEvent, id: number) => {
      const idx = flat.findIndex((t) => t.id === id);
      if (idx >= 0) setCursor(idx);

      /*
       * Shift+klik ROZSZERZA zaznaczenie tekstu zakotwiczone przy poprzednim
       * kliknieciu — samo preventDefault na mousedown nie wszedzie to lapie,
       * wiec dodatkowo zdejmujemy zaznaczenie po zdarzeniu.
       */
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
      }

      if (e.ctrlKey || e.metaKey) {
        toggleMark(id);
        return;
      }
      if (e.shiftKey && selectRangeTo(id)) return;

      setMarked(new Set());
      setMarkAnchor(id);
      setOpenId(id);
    },
    [flat, selectRangeTo, toggleMark],
  );

  /** Zaznaczenie wygrywa nad pojedynczym zadaniem, o ile klikniete do niego nalezy. */
  const targetsFor = useCallback(
    (id: number) => (marked.has(id) && marked.size > 1 ? [...marked] : [id]),
    [marked],
  );

  const openPicker = useCallback(
    (kind: PickerKind, taskId: number, anchor?: Anchor, targets?: number[]) => {
      const t = targets ?? [taskId];
      if (anchor) {
        setPicker({ kind, taskId, targets: t, anchor });
        return;
      }
      const el = document.querySelector(`[data-task-id="${taskId}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPicker({ kind, taskId, targets: t, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
    },
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Paleta ma pierwszenstwo i dziala takze w polach tekstowych.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (confirm) {
        if (e.key === 'Escape') setConfirm(null);
        return; // dialog musi zostac rozstrzygniety
      }
      if (paletteOpen) return; // paleta ma wlasna obsluge klawiatury
      if (helpOpen) {
        if (e.key === 'Escape') setHelpOpen(false);
        return;
      }
      if (picker) return; // popover ma wlasna obsluge klawiatury
      if (menu || viewMenu) {
        if (e.key === 'Escape') {
          setMenu(null);
          setViewMenu(null);
        }
        return;
      }

      /*
       * Ctrl+F idzie na filtr listy zamiast na wyszukiwarke przegladarki.
       * Ta druga szuka tylko po tym, co AKURAT jest na ekranie — czyli po juz
       * odfiltrowanym wycinku — i nie znajdzie zadania po numerze ani tagu.
       * Filtr przeszukuje caly projekt: kod, numer, tytul i tagi.
       *
       * Musi stac PRZED sprawdzeniem `typing`, ktore odrzuca wszystko
       * z modyfikatorem. Dziala tez z kursorem w polu tekstowym, bo to odruch,
       * nie tryb — a `select()` pozwala od razu pisac na nowo.
       */
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

      if (e.key === 'Escape') {
        if (typing) (e.target as HTMLElement).blur();
        else if (marked.size) setMarked(new Set()); // najpierw zdejmij zaznaczenie
        else setOpenId(null);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      const current = flat[cursor];

      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, flat.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (current) setOpenId(current.id);
      } else if (e.key === 'r') {
        void reload();
      } else if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && current) {
        /*
         * Konwencja drzewa (jak w eksploratorze plikow):
         *   →  zwiniety rodzic -> rozwin;  rozwiniety -> wejdz w pierwsze dziecko
         *   ←  rozwiniety rodzic -> zwin;  dziecko -> wroc do rodzica i zwin go
         * Dzieki temu "wejdz w podzadania i wyjdz" to ta sama para klawiszy,
         * bez siegania po mysz i bez szukania kursorem rodzica.
         */
        e.preventDefault();
        const kids = visibleKids.get(current.id) ?? 0;
        const isCollapsed = collapsedTasks.has(current.id);

        const setCollapsedFor = (id: number, value: boolean) =>
          setCollapsedTasks((prev) => {
            const next = new Set(prev);
            if (value) next.add(id);
            else next.delete(id);
            return next;
          });

        if (e.key === 'ArrowRight') {
          if (kids > 0 && isCollapsed) setCollapsedFor(current.id, false);
          else if (kids > 0) setCursor((c) => Math.min(c + 1, flat.length - 1));
        } else if (kids > 0 && !isCollapsed) {
          setCollapsedFor(current.id, true);
        } else if (current.parentId) {
          // Indeks rodzica zostaje poprawny po zwinieciu — dzieci sa PO nim.
          const parentIdx = flat.findIndex((t) => t.id === current.parentId);
          if (parentIdx >= 0) {
            setCursor(parentIdx);
            setCollapsedFor(current.parentId, true);
          }
        }
      } else if (PICKER_KEYS[e.key] && current) {
        e.preventDefault();
        openPicker(PICKER_KEYS[e.key], current.id, undefined, targetsFor(current.id));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    flat,
    cursor,
    reload,
    picker,
    menu,
    viewMenu,
    paletteOpen,
    helpOpen,
    openPicker,
    visibleKids,
    collapsedTasks,
    marked,
    targetsFor,
    confirm,
  ]);

  const applyStage = useCallback(
    (taskId: number, stageId: number) =>
      mutate(taskId, { stageId }, () => moveToStage(taskId, stageId), 'etap'),
    [mutate],
  );

  /** Szybkie spojrzenie na rodzica — do odnosnika przy podzadaniu i na karcie. */
  const parentInfo = useCallback(
    (parentId: number) => {
      const p = tasks.find((t) => t.id === parentId);
      return p
        ? { id: p.id, label: p.code ?? `#${p.id}`, title: p.title || p.rawTitle }
        : { id: parentId, label: `#${parentId}`, title: 'zadanie spoza grupy' };
    },
    [tasks],
  );

  /** Etykieta rodzica per zadanie — tablica nie zagniezdza kart, wiec potrzebuje jej wszedzie. */
  const parentLabels = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const m = new Map<number, string>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const p = byId.get(t.parentId);
      m.set(t.id, p ? (p.code ?? `#${p.id}`) : `#${t.parentId}`);
    }
    return m;
  }, [tasks]);

  /**
   * Upuszczenie wiersza na grupe = nadanie mu wartosci tej grupy. Dziala dla
   * wszystkich trzech osi grupowania, bo kazda odpowiada realnemu polu Bitriksa.
   * "Poza sprintem" i "Nieprzypisane" nie sa wartosciami, tylko brakiem — nie da
   * sie na nie upuscic i mowimy o tym wprost.
   */
  const applyAxis = useCallback(
    (axis: GroupBy, key: string, ids: number[]) => {
      if (axis === 'status') {
        ids
          .filter((id) => tasks.find((t) => t.id === id)?.status !== key)
          .forEach((id) => mutate(id, { status: key }, () => updateTask(id, { STATUS: key }), 'status'));
        return;
      }

      if (axis === 'assignee') {
        // "Nieprzypisane" jest realnym celem — to konto-zaslepka (UNASSIGNED_ID).
        const p = people.find((x) => x.name === key);
        if (!p) {
          toast(`Nie znaleziono osoby „${key}".`);
          return;
        }
        ids
          .filter((id) => tasks.find((t) => t.id === id)?.responsibleId !== p.id)
          .forEach((id) =>
            mutate(
              id,
              { responsibleId: p.id, responsibleName: p.name, responsiblePhoto: p.photo },
              () => updateTask(id, { RESPONSIBLE_ID: p.id }),
              'osoba',
            ),
          );
        return;
      }

      // axis === 'stage': etap trzeba rozwiazac w sprincie KAZDEGO zadania osobno,
      // bo ta sama nazwa etapu ma inne id w kazdym sprincie.
      let skipped = 0;
      for (const id of ids) {
        const t = tasks.find((x) => x.id === id);
        const st = t?.sprintId
          ? stages.find((s) => s.sprintId === t.sprintId && s.name === key)
          : undefined;
        if (!st) skipped++;
        else if (t?.stageId !== st.id) applyStage(id, st.id);
      }
      if (skipped > 0) {
        toast(`Pominięto ${skipped} zadań — nie są w sprincie, więc nie mają etapów.`);
      }
    },
    [people, tasks, stages, mutate, applyStage, toast],
  );

  /**
   * Upuszczenie wiersza = nadanie mu wartosci celu. Przy wlaczonym podgrupowaniu
   * upuszczenie na PODGRUPE ustawia obie osi naraz (np. etap ORAZ osobe) — inaczej
   * karta wracalaby do swojej starej podgrupy i wygladalo to na zignorowany drop.
   * Wartosci juz ustawione sa pomijane, wiec nie wysylamy pustych zapytan.
   */
  const dropOnGroup = useCallback(
    (groupKey: string, ids: number[], subValue?: string) => {
      applyAxis(groupBy, groupKey, ids);
      if (subGroupBy && subValue !== undefined) applyAxis(subGroupBy, subValue, ids);
    },
    [applyAxis, groupBy, subGroupBy],
  );

  /*
   * Czujniki przeciagania.
   *
   * Mysz rusza dopiero po 5 px, inaczej kazde klikniecie w wiersz (a takze
   * Ctrl/Shift + klik do zaznaczania) startowaloby przeciaganie.
   * Dotyk po przytrzymaniu 250 ms — bez tego nie da sie przewinac listy palcem.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = useCallback((e: DragStartEvent) => setDraggingId(parseDrag(e.active.id)), []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingId(null);
      const id = parseDrag(e.active.id);
      const target = e.over ? parseDrop(e.over.id) : null;
      if (id === null || !target) return;

      if (target.kind === 'col') {
        applyStage(id, target.stageId);
        return;
      }
      if (target.kind === 'sub') {
        dropOnGroup(target.groupKey, targetsFor(id), target.subKey);
        return;
      }
      // Upuszczenie w tej samej sekcji nic nie zmienia — nie wysylamy zapytania.
      const source = groupNodes.find((x) =>
        x.subs.some((s) => s.nodes.some((n) => n.task.id === id)),
      );
      if (source?.key === target.groupKey) return;
      dropOnGroup(target.groupKey, targetsFor(id));
    },
    [applyStage, dropOnGroup, groupNodes, targetsFor],
  );

  /** Podglad pod kursorem: przeciagamy zaznaczenie, jesli zadanie do niego nalezy. */
  const dragging = useMemo(
    () => (draggingId === null ? null : (tasks.find((t) => t.id === draggingId) ?? null)),
    [draggingId, tasks],
  );
  const dragCount = draggingId === null ? 0 : targetsFor(draggingId).length;

  /** Kolumny tablicy to etapy aktywnego sprintu — kanban z Bitriksa, nie wlasny podzial. */
  const boardStages = useMemo(
    () => (sprintId ? stages.filter((s) => s.sprintId === sprintId) : []),
    [stages, sprintId],
  );

  /**
   * PUSTE kategorie do panelu — te, ktore w biezacym widoku nie maja ani jednego
   * zadania, wiec bez zaznaczenia w ogole by sie nie pokazaly. Poziom bierzemy
   * najglebszy: tablica -> etapy, lista z podgrupowaniem -> os PODGRUPY, inaczej
   * os grupowania. Kategorie z zadaniami widac zawsze — nie ma ich na tej liscie.
   */
  /** Os, ktorej dotyczy panel: tablica -> etapy, lista -> podgrupa albo grupa. */
  const colAxis: GroupBy | null = viewMode === 'board' ? 'stage' : (subGroupBy ?? groupBy);

  /** Przypnij/odepnij kategorie biezacej osi — klucz niesie os, wiec osie sie nie mieszaja. */
  const toggleColumn = useCallback(
    (name: string) => {
      if (!colAxis) return;
      const k = pinKey(colAxis, name);
      setShownEmpty((s) => (s.includes(k) ? s.filter((n) => n !== k) : [...s, k]));
    },
    [colAxis],
  );

  /** Nazwy etapow przypietych na tablicy — Board dostaje juz gotowa liste. */
  const pinnedStages = useMemo(
    () => allEmptyKeys('stage').filter((n) => shownEmpty.includes(pinKey('stage', n))),
    [allEmptyKeys, shownEmpty],
  );

  const categories = useMemo(() => {
    const axis = colAxis;
    if (!axis) return [] as { name: string; present: boolean; pinned: boolean }[];
    /*
     * Tylko kategorie, ktore MOGA istniec bez zadan (realne etapy/statusy) — bo panel
     * sluzy do trzymania PUSTYCH kolumn na widoku. Twory pochodne z danych, jak
     * „Poza sprintem" (etykieta zastepcza dla zadan bez etapu) czy konkretna osoba,
     * nie daja sie wyliczyc przy zerze, wiec ich tu nie ma. Kubelek daje kolejnosc
     * procesu i informacje, czy kategoria ma teraz zadania.
     */
    const keys = new Set(allEmptyKeys(axis));
    if (!keys.size) return [] as { name: string; present: boolean; pinned: boolean }[];
    return bucket(filtered, axis, stageNames, stageOrder, labels.status, me, sort, allEmptyKeys(axis))
      .filter((g) => keys.has(g.label))
      .map((g) => ({
        name: g.label,
        present: g.tasks.length > 0,
        pinned: shownEmpty.includes(pinKey(axis, g.label)),
      }));
  }, [colAxis, filtered, stageNames, stageOrder, labels.status, me, sort, allEmptyKeys, shownEmpty]);

  /*
   * Karty na tablicy sortujemy tym samym porzadkiem co wiersze w liscie — kolumna
   * pozostaje etapem, ale wewnatrz niej kolejnosc idzie za ustawieniem Sortowanie
   * (z moimi zadaniami zawsze na gorze). Bez tego karty stały w kolejnosci z Bitriksa.
   */
  const boardTasks = useMemo(
    () => [...filtered].sort(taskComparator(sort, me)),
    [filtered, sort, me],
  );

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const current = flat[cursor];

    if (current) {
      const name = current.code ?? `#${current.id}`;
      for (const { kind, key } of MENU_ITEMS) {
        if (kind === 'stage' && !current.sprintId) continue;
        list.push({
          id: `task-${kind}`,
          section: `Zadanie ${name}`,
          label: `Zmień: ${PICKER_TITLE[kind]}`,
          // Skrot bierzemy prosto z MENU_ITEMS — lancuch ifow po `kind` cichlby
          // przy kazdym nowym wymiarze, podpisujac go klawiszem poprzedniego.
          hint: key,
          run: () => openPicker(kind, current.id),
        });
      }
      list.push({
        id: 'task-open',
        section: `Zadanie ${name}`,
        label: 'Otwórz szczegóły',
        hint: 'Enter',
        run: () => setOpenId(current.id),
      });
    }

    list.push(
      {
        id: 'view-list',
        section: 'Widok',
        label: 'Lista',
        run: () => setViewMode('list'),
      },
      {
        id: 'view-board',
        section: 'Widok',
        label: 'Tablica (kanban sprintu)',
        run: () => setViewMode('board'),
      },
      ...scopes.map((s) => ({
        id: `scope-${s.key}`,
        section: 'Zakres',
        label: s.key === 'sprint' && activeSprint ? activeSprint.name : s.label,
        hint: String(scopeCounts[s.key]),
        run: () => setScope(s.key),
      })),
      ...projects.map((p) => ({
        id: `project-${p.id}`,
        section: 'Projekt',
        label: p.name,
        hint: p.id === groupId ? '✓' : PROJECT_ROLE[p.role],
        run: () => pickProject(p.id),
      })),
      ...GROUPS.map((g) => ({
        id: `group-${g.key}`,
        section: 'Grupuj wg',
        label: g.label,
        run: () => setGroupBy(g.key),
      })),
      ...SORTS.map((s) => ({
        id: `sort-${s.key}`,
        section: 'Sortuj wg',
        label: s.label,
        hint: sort.by === s.key ? (sort.dir === 'asc' ? '↑' : '↓') : undefined,
        run: () =>
          // Ponowny wybor tej samej osi odwraca kierunek — jak w naglowkach tabel.
          patchSort(sort.by === s.key ? { dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { by: s.key }),
      })),
      ...THEMES.map((t) => ({
        id: `theme-${t.value}`,
        section: t.section ? `Motyw — ${t.section.toLowerCase()}` : 'Motyw',
        label: t.label,
        hint: theme === t.value ? '✓' : undefined,
        run: () => setTheme(t.value),
      })),
      ...FONTS.map((f) => ({
        id: `font-${f.value}`,
        section: 'Czcionka',
        label: f.label,
        hint: font === f.value ? '✓' : undefined,
        run: () => setFont(f.value),
      })),
      {
        id: 'toggle-mine',
        section: 'Filtry',
        label: onlyMine ? 'Pokaż wszystkich' : 'Tylko moje',
        run: () => setOnlyMine((v) => !v),
      },
      {
        id: 'toggle-unassigned',
        section: 'Filtry',
        label: withUnassigned ? 'Ukryj nieprzypisane' : 'Pokaż też nieprzypisane',
        run: () => setWithUnassigned((v) => !v),
      },
      {
        id: 'toggle-done',
        section: 'Filtry',
        label: showDone ? 'Ukryj zakończone' : 'Pokaż zakończone',
        run: () => setShowDone((v) => !v),
      },
      {
        id: 'reload',
        section: 'Filtry',
        label: 'Odśwież dane',
        hint: 'r',
        run: () => void reload(),
      },
    );

    if (anyFilter(filters)) {
      list.push({
        id: 'filter-clear',
        section: 'Filtry',
        label: 'Wyczyść filtry',
        run: () => setFilters(EMPTY_FILTERS),
      });
    }
    // Tag z palety wpada do wspolnego warunku „Tag: dowolny z" (przelacza).
    for (const [tag, count] of allTags) {
      list.push({
        id: `tag-${tag}`,
        section: 'Tagi',
        label: tag,
        hint: tagActive(tag) ? '✓' : String(count),
        run: () => toggleTag(tag),
      });
    }

    // Skok do zadania — po kodzie IT-XXX albo tytule, w obrebie tego, co widac.
    for (const t of filtered.slice(0, 300)) {
      list.push({
        id: `goto-${t.id}`,
        section: 'Przejdź do zadania',
        label: t.title || t.rawTitle,
        hint: t.code ?? `#${t.id}`,
        icon: <StatusIcon status={t.status} />,
        run: () => setOpenId(t.id),
      });
    }
    return list;
  }, [
    flat,
    cursor,
    filtered,
    activeSprint,
    scopes,
    scopeCounts,
    projects,
    groupId,
    pickProject,
    onlyMine,
    withUnassigned,
    showDone,
    showEmpty,
    filters,
    allTags,
    toggleTag,
    tagActive,
    sort,
    patchSort,
    reload,
    openPicker,
    theme,
    font,
  ]);

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Konfiguracja popovera dla wybranego wymiaru ──
  const pickerTask = picker ? tasks.find((t) => t.id === picker.taskId) : null;

  const pickerConfig = useMemo<{
    title: string;
    options: Option[];
    apply: (value: string) => unknown;
    /** Pozwala wpisac wartosc spoza listy (liczba) — dla story pointow i rodzica. */
    rawLabel?: (n: number) => string;
    /** To samo, ale dowolnym tekstem — dla zakladania nowego tagu. */
    freeLabel?: (text: string) => string;
    placeholder?: string;
    segments?: { key: string; label: string }[];
    /** Tryb wielokrotny (tagi): klik przelacza pozycje i nie zamyka popovera. */
    multi?: boolean;
    selected?: string[];
    onToggle?: (value: string) => void;
  } | null>(() => {
    if (!picker || !pickerTask) return null;

    const targets = picker.targets.length ? picker.targets : [pickerTask.id];

    /** Kazde zadanie dostaje wlasna mutacje — wiec i wlasny rollback przy bledzie. */
    const forEach = (patch: Partial<Task>, run: (id: number) => Promise<unknown>, what: string) =>
      Promise.all(targets.map((id) => mutate(id, patch, () => run(id), what)));

    if (picker.kind === 'status') {
      return {
        title: 'Status',
        options: Object.entries(labels.status).map(([value, label]) => ({
          value,
          label,
          icon: <StatusIcon status={value} />,
        })),
        /*
         * Status za potwierdzeniem — latwo go ruszyc przypadkiem (sasiaduje
         * ze skrotami etapu), a w tej grupie prawie nigdy nie jest tym, co chcemy.
         */
        apply: (value: string) => {
          const label = labels.status[value] ?? value;
          setConfirm({
            title:
              targets.length > 1
                ? `Zmienić status ${targets.length} zadań na „${label}"?`
                : `Zmienić status na „${label}"?`,
            body:
              'Status to osobne pole Bitriksa — nie rusza kolumny na tablicy sprintu. ' +
              'Przepływem pracy steruje Etap (skrót „m”), i to jego pilnuje synchronizacja z gita. ' +
              'Status zmieniaj tylko wtedy, gdy naprawdę chodzi Ci o to pole.',
            onYes: () =>
              void forEach({ status: value }, (id) => updateTask(id, { STATUS: value }), 'status'),
          });
        },
      };
    }
    if (picker.kind === 'priority') {
      return {
        title: 'Priorytet',
        options: Object.entries(labels.priority).map(([value, label]) => ({
          value,
          label,
          icon: <PriorityIcon priority={value} />,
        })),
        apply: (value: string) =>
          forEach({ priority: value }, (id) => updateTask(id, { PRIORITY: value }), 'priorytet'),
      };
    }
    if (picker.kind === 'points') {
      /*
       * Nie sztywna lista: pokazujemy kilka najczestszych wartosci, a pole u gory
       * przyjmuje DOWOLNA liczbe (patrz `rawLabel`) — byle calkowita i nieujemna.
       * "—" kasuje oszacowanie. Zapis idzie przez `updateStoryPoints`.
       */
      const COMMON = ['—', '1', '2', '3', '5', '8', '13'];
      return {
        title: 'Story points',
        options: COMMON.map((v) => ({ value: v, label: v })),
        // Wpisana liczba wchodzi jako opcja; `/^\d+$/` w Pickerze odsiewa minus i ułamki.
        rawLabel: (n: number) => String(n),
        placeholder: 'Wpisz liczbę i Enter…',
        apply: (value: string) => {
          const n = value === '—' ? null : Number(value);
          if (n != null && (!Number.isInteger(n) || n < 0)) return; // tylko całkowite ≥ 0
          return forEach({ storyPoints: n }, (id) => updateStoryPoints(id, n ?? ''), 'story points');
        },
      };
    }
    if (picker.kind === 'epic') {
      /*
       * Epik to nadrzedny temat scruma. "Bez epika" (0) odpina. Historycznych/obcych
       * epikow nie ma jak wymyslic — pokazujemy te z grupy plus opcje odpiecia.
       */
      const dot = (c: string) => <span className="tag-dot" style={{ background: c }} />;
      return {
        title: epics.length ? 'Epik' : 'Projekt nie ma epików',
        options: [
          { value: '0', label: 'Bez epika', icon: dot('var(--fg-dim)') },
          ...epics.map((e) => ({
            value: String(e.id),
            label: e.name,
            icon: dot(e.color ? `#${e.color}` : tagHue(e.name)),
          })),
        ],
        placeholder: 'Szukaj epika…',
        apply: (value: string) => {
          const eid = Number(value); // 0 = odepnij
          return forEach({ epicId: eid || null }, (id) => updateEpic(id, eid), 'epik');
        },
      };
    }
    if (picker.kind === 'tags') {
      /*
       * Wielokrotny wybor: klik PRZELACZA tag i nie zamyka popovera, wiec da sie
       * poprawic kilka naraz. Bitrix podmienia cala liste, wiec przy kazdym klikniecu
       * wysylamy komplet nazw. Wpisanie nazwy spoza listy zaklada NOWY tag (freeLabel).
       */
      const current = pickerTask.tags;
      const setTags = (next: string[]) =>
        forEach({ tags: [...next].sort((a, b) => a.localeCompare(b, 'pl')) },
          (id) => updateTags(id, next), 'tagi');
      return {
        title: 'Tagi',
        options: allTags.map(([tag, count]) => ({
          value: tag,
          label: tag,
          hint: String(count),
          icon: <span className="tag-dot" style={{ background: tagHue(tag) }} />,
        })),
        placeholder: 'Szukaj lub wpisz nowy…',
        freeLabel: (t) => `Nowy tag „${t}"`,
        multi: true,
        selected: current,
        onToggle: (value: string) => {
          const has = current.includes(value);
          void setTags(has ? current.filter((t) => t !== value) : [...current, value]);
        },
        // W trybie multi Picker uzywa onToggle; `apply` zostaje dla zgodnosci typu.
        apply: () => {},
      };
    }
    if (picker.kind === 'parent') {
      /*
       * Rodzicem moze byc DOWOLNE zadanie — nie tylko z biezacego widoku — wiec
       * bierzemy je z pelnej listy i tagujemy: w sprincie / poza sprintem. Zakladki
       * (segments) pozwalaja zawezic do jednego z tych zbiorow, a szukanie łapie kod
       * i tytul. "—" odpina rodzica; spoza listy wpisuje sie numer Bitriksa (rawLabel).
       */
      const self = pickerTask.id;
      return {
        title: 'Zadanie nadrzędne',
        segments: [
          { key: 'sprint', label: 'W sprincie' },
          { key: 'outside', label: 'Poza sprintem' },
        ],
        options: [
          { value: '0', label: '— (bez rodzica)' },
          ...tasks
            .filter((t) => t.id !== self)
            .map((t) => ({
              value: String(t.id),
              label: `${t.code ?? `#${t.id}`} — ${t.title || t.rawTitle}`,
              group: t.sprintId ? 'sprint' : 'outside',
            })),
        ],
        rawLabel: (n: number) => `#${n}`,
        placeholder: 'Szukaj zadania…',
        apply: (value: string) => {
          const pid = Number(value); // 0 = odepnij
          return forEach(
            { parentId: pid || null },
            (id) => updateTask(id, { PARENT_ID: pid }),
            'zadanie nadrzędne',
          );
        },
      };
    }
    if (picker.kind === 'assignee') {
      return {
        title: 'Osoba odpowiedzialna',
        // Zalogowany uzytkownik stoi na gorze (patrz sortowanie `people`); kreska
        // pod nim oddziela "ja" od pozostalych osob.
        options: people.map((p, i) => ({
          value: String(p.id),
          label: p.name,
          // „Nieprzypisane" to konto-zaslepka — pusty awatar (kolko-placeholder), ten sam
          // co przy nieprzypisanym zadaniu w wierszu; nie zdjecie/inicjal.
          photo: p.id === UNASSIGNED_ID ? undefined : p.photo,
          icon: p.id === UNASSIGNED_ID ? <Avatar name={null} /> : undefined,
          // Kreska pod para „ja + Nieprzypisane" — oddziela skroty od reszty ludzi.
          divider:
            i > 0 &&
            p.id !== me &&
            p.id !== UNASSIGNED_ID &&
            (people[i - 1].id === me || people[i - 1].id === UNASSIGNED_ID),
        })),
        apply: (value: string) => {
          const p = people.find((x) => x.id === Number(value));
          return forEach(
            {
              responsibleId: Number(value),
              responsibleName: p?.name ?? null,
              responsiblePhoto: p?.photo ?? null,
            },
            (id) => updateTask(id, { RESPONSIBLE_ID: Number(value) }),
            'osoba',
          );
        },
      };
    }
    if (picker.kind === 'sprint') {
      /*
       * Dwa cele, nie lista: aktywny sprint albo backlog. Sprintow historycznych
       * swiadomie nie pokazujemy — wrzucenie zadania do zamknietego sprintu nie
       * jest niczym, czego sie tu chce, a lista 61 pozycji tylko by to utrudniala.
       */
      const options = [
        ...(activeSprint ? [{ value: String(activeSprint.id), label: activeSprint.name }] : []),
        ...(backlogId ? [{ value: String(backlogId), label: 'Backlog' }] : []),
      ];
      return {
        title: options.length ? 'Sprint' : 'Projekt nie ma scruma',
        options,
        apply: async (value: string) => {
          const entityId = Number(value);
          const toSprint = activeSprint !== null && entityId === activeSprint.id;
          /*
           * Etapu NIE zgadujemy — nadaje go Bitrix przy wejsciu do sprintu.
           * Czyscimy go optymistycznie i dociagamy prawdziwy cichym odswiezeniem,
           * zamiast pokazywac kolumne, ktorej zadanie moze wcale nie dostac.
           */
          await Promise.all(
            targets.map((id) =>
              mutate(
                id,
                { sprintId: toSprint ? entityId : null, stageId: null },
                () => moveToSprint(id, entityId),
                'sprint',
              ),
            ),
          );
          await reload(true);
        },
      };
    }
    // Etapy istnieja tylko w obrebie sprintu zadania.
    const sprintStages = stages.filter((s) => s.sprintId === pickerTask.sprintId);
    return {
      title: pickerTask.sprintId ? 'Etap' : 'Zadanie nie jest w sprincie',
      options: sprintStages
        .sort((a, b) => a.sort - b.sort)
        .map((s) => {
          // Ten sam pierscien etapu co w wierszu listy — kolor i postep z `stageMeta`.
          const meta = stageMeta.get(s.id);
          return {
            value: String(s.id),
            label: s.name,
            icon: <StageIcon progress={meta?.progress ?? null} color={meta?.color ?? s.color} />,
          };
        }),
      apply: (value: string) => {
        /*
         * Etap zyje w konkretnym sprincie, wiec zbiorczo mozna przestawic tylko te
         * zadania, ktore sa w TYM SAMYM sprincie co wybrany etap. Reszte pomijamy
         * i mowimy o tym wprost, zamiast po cichu nie zrobic nic.
         */
        const eligible = targets.filter(
          (id) => tasks.find((t) => t.id === id)?.sprintId === pickerTask.sprintId,
        );
        const skipped = targets.length - eligible.length;
        if (skipped > 0) {
          toast(`Pominięto ${skipped} zadań spoza sprintu „${activeSprint?.name ?? ''}" — etap ich nie dotyczy.`);
        }
        return Promise.all(eligible.map((id) => applyStage(id, Number(value))));
      },
    };
  }, [
    picker,
    pickerTask,
    people,
    me,
    stages,
    stageMeta,
    tasks,
    labels,
    activeSprint,
    backlogId,
    epics,
    allTags,
    mutate,
    applyStage,
    reload,
    toast,
  ]);

  /**
   * Gdzie zadanie lezy. Aktywny sprint znamy z nazwy; stary sprint zostaje numerem,
   * bo nie pobieramy 61 sprintow tylko po to, zeby podpisac jeden wiersz.
   */
  const sprintLabel = useCallback(
    (t: Task) =>
      !t.sprintId
        ? 'Backlog'
        : t.sprintId === activeSprint?.id
          ? activeSprint.name
          : `Sprint #${t.sprintId}`,
    [activeSprint],
  );

  /** Epik zadania jako obiekt {nazwa, kolor} — albo null, gdy bez epika/nie dociagniete. */
  const epicOf = useCallback(
    (t: Task): Epic | null => (t.epicId != null ? (epicNames.get(t.epicId) ?? null) : null),
    [epicNames],
  );

  return (
    <div className="app">
      <main className="main">
        <header className="toolbar">
          {/* Nazwa projektu JEST przelacznikiem — nie ma osobnej kontrolki obok,
              bo to jedyne miejsce w pasku, ktore mowi "na co patrzysz". */}
          <button
            className="brand"
            title={
              projects.length
                ? 'Zmień projekt'
                : 'Zmień projekt — webhook nie widzi grup roboczych, więc listy nie ma; zostaje numer'
            }
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              // Picker sam dokłada +32 do lewej krawędzi, więc odejmujemy tyle samo.
              setProjectMenu({ left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
          >
            <span className="brand-dot" />
            <span className="brand-name">
              {project?.name ?? (groupId ? `#${groupId}` : 'Projekt')}
            </span>
            <ChevronIcon open={false} />
          </button>

          {/* `key` na projekcie: zmiana projektu ma czyscic filtr, a tekst
              siedzi teraz w SearchBoksie — przemontowanie jest tanszym
              sposobem na to niz przepychanie wartosci w dol. */}
          <SearchBox key={groupId ?? 'none'} ref={searchRef} onChange={setQuery} />
          <span className="count">
            {loading ? 'ładowanie…' : `${filtered.length} z ${tasks.length}`}
          </span>

          {/* Grupowanie w toolbarze, nie w sidebarze — jest wtedy dostepne
              na kazdej szerokosci ekranu i nie znika razem z panelem bocznym. */}
          <button
            className="display-btn"
            title={`Grupowanie: ${GROUPS.find((g) => g.key === groupBy)?.help ?? ''}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setViewMenu({ left: r.left - 150, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
          >
            {/* Ikona niesie biezacy widok — po usunieciu przelacznika z paska
                to jedyne miejsce, w ktorym widac, czy jestes na liscie czy tablicy. */}
            {viewMode === 'board' ? <BoardIcon /> : <ListIcon />}
            <span className="display-label">Grupuj:</span>
            {GROUPS.find((g) => g.key === groupBy)?.label ?? '—'}
            {subGroupBy && (
              <span className="display-label">
                › {GROUPS.find((g) => g.key === subGroupBy)?.label}
              </span>
            )}
            <ChevronIcon open={false} />
          </button>

          {/* Na waskich ekranach pasek zakresu chowa sie w to samo menu,
              ktore wypada pod prawym przyciskiem — jedna definicja, dwa wejscia. */}
          <button
            className="filters-btn"
            title="Widok, zakres i filtry"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setViewMenu({ left: r.left - 180, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
          >
            <GroupIcon />
            {scope === 'sprint' && activeSprint ? activeSprint.name : SCOPES.find((s) => s.key === scope)?.label}
          </button>

          <button className="icon-btn" onClick={() => void reload()} title="Odśwież (R)">
            <RefreshIcon />
          </button>
          {/* Skroty byly kiedys wypisane w panelu bocznym. Po jego usunieciu zostal
              sam klawisz "?", ktory trzeba znac — stad jawny przycisk. */}
          <button
            className="icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Skróty klawiszowe (?)"
          >
            ?
          </button>
        </header>

        {/* Zakres jest zawsze na wierzchu — wyjscie poza aktywny sprint to jedno klikniecie. */}
        {/* Wybor Lista/Tablica siedzi wylacznie w panelu widoku (zakladki na gorze) —
            tu byl duplikat tej samej kontrolki. */}
        <div className="scopebar">
          <ScopePicker
            scope={scope}
            scopes={scopes}
            counts={scopeCounts}
            activeSprint={activeSprint}
            carousel={scopeCarousel}
            onPick={setScope}
          />

          {!activeSprint && <span className="sprint-dates">brak aktywnego sprintu</span>}

          {marked.size > 0 && (
            <span className="selection-bar">
              <strong>{marked.size}</strong> zaznaczonych
              <button className="tag-x" onClick={() => setMarked(new Set())} title="Wyczyść (Esc)">
                <CloseIcon />
              </button>
            </span>
          )}

          {/* Przelaczniki „Tylko moje / + nieprzypisane / Zakończone" zdjete z paska —
              zyja teraz wylacznie w menu widoku (ViewMenu), zeby nie zasmiecac zakresu. */}

          {/* Pionowa kreska oddziela grupe zakresu (segmenty + daty) od grupy filtrow
              (chipy + „+ Filtr"), zeby linia czytala sie jako dwa bloki, nie jeden ciag. */}
          <span className="scopebar-div" aria-hidden />

          {/* Przelacznik zapisanych widokow — po LEWEJ, przed grupa filtrow. */}
          <button
            className="views-btn"
            title="Zapisane widoki"
            onMouseEnter={(e) => openViewsSoon(e.currentTarget)}
            onMouseLeave={closeViewsSoon}
            onClick={(e) => {
              // Klik dziala jak dawniej: otwiera od razu (i ustawia focus w polu nazwy).
              clearViewsTimer();
              const r = e.currentTarget.getBoundingClientRect();
              setViewsMenu({ left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
          >
            <ViewsIcon />
            <span className="display-label">Widok:</span>
            {views.find((v) => v.id === activeViewId)?.name ?? 'Własny'}
            <ChevronIcon open={false} />
          </button>

          {/* Wyczyszczenie wszystkiego jako „×" MIEDZY widokiem a chipami. Pokazuj tez
              przy samym tekscie wyszukiwania — czysci filtry ORAZ szukanie. */}
          {(anyFilter(filters) || query.trim() !== '') && (
            <button
              className={`filter-clear-x${clearCollapsed ? ' filter-clear-x-min' : ''}`}
              title="Wyczyść wszystkie (filtry i wyszukiwanie)"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setQuery('');
                searchRef.current?.setValue('');
              }}
            >
              <CloseIcon />
              <span className="filter-clear-x-label">Wyczyść wszystkie</span>
            </button>
          )}

          {/* Chipy filtrow (przewijane POZIOMO), a TUZ ZA NIMI „+ Filtr" — dodawanie
              dopisuje kolejny chip na koncu, wiec przycisk stoi tam, gdzie pojawi sie efekt. */}
          {anyFilter(filters) && (
            <ScrollX onSpare={onChipsSpare}>
              {filters
                .filter((c) => c.values.length)
              .map((c) => (
                <div className="filter-chip" key={c.id}>
                  <button
                    className="filter-chip-main filter-chip-opbtn"
                    title="Zmień operator"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setOpMenu({ condId: c.id, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
                    }}
                  >
                    <span className="filter-chip-field">{FILTER_LABEL[c.field]}</span>
                    <span className="filter-chip-op">{opLabel(c.op, c.values.length > 1)}</span>
                  </button>
                  <button
                    className="filter-chip-main"
                    title={c.values.map((v) => filterValueLabel(c.field, v)).join(', ')}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setFilterPick({
                        condId: c.id,
                        anchor: { left: r.left - 32, top: r.top, bottom: r.bottom },
                      });
                    }}
                  >
                    {c.values.length === 1 ? (
                      // Jedna wartosc: ta sama moneta (tlo POD ikona) co w facepile + podpis.
                      <span className="filter-chip-val">
                        <span className="filter-chip-stack">{filterToken(c.field, c.values[0], 0)}</span>
                        {filterValueLabel(c.field, c.values[0])}
                      </span>
                    ) : (
                      // Facepile jak w Linearze — nachodzace, NIEPRZEZROCZYSTE monety.
                      // Osoba = awatar. Status/etap = znajoma ikona-pierscien NA monecie
                      // podbarwionej kolorem wartosci: moneta jest widoczna i pelna, wiec
                      // czysto zaslania sasiada (zero przeswitow), a jasniejsza ikona na
                      // wierzchu zostaje czytelna. Priorytet: te same slupki co gdzie
                      // indziej, na neutralnej monecie. Tag: podbarwiona moneta + maly rdzen.
                      <span className="filter-chip-stack">
                        {c.values.slice(0, CHIP_STACK_MAX).map((v, i) => filterToken(c.field, v, i))}
                        {c.values.length > CHIP_STACK_MAX && (
                          <span className="filter-chip-more">+{c.values.length - CHIP_STACK_MAX}</span>
                        )}
                      </span>
                    )}
                  </button>
                  <button
                    className="filter-chip-x"
                    title="Usuń filtr"
                    onClick={() => removeCondition(c.id)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </ScrollX>
          )}

          <button
            className="filter-add"
            title="Dodaj filtr (osoba, priorytet, etap, status, tag)"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFilterMenu({ left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
          >
            <span className="filter-add-plus">+</span> Filtr
          </button>
        </div>

        {error && (
          <div className="error">
            <strong>Nie udało się pobrać zadań</strong>
            <p>{error}</p>
          </div>
        )}

        {/* Prawy przycisk na pustym tle (albo na naglowku grupy) = menu widoku.
            Wiersze i karty zatrzymuja propagacje, wiec maja swoje wlasne menu. */}
        <div
          className="content"
          ref={contentRef}
          onContextMenu={(e) => {
            e.preventDefault();
            setViewMenu({ left: e.clientX, top: e.clientY, bottom: e.clientY });
          }}
        >
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
        {viewMode === 'board' ? (
          <Board
            tasks={boardTasks}
            stages={boardStages}
            showDone={showDone}
            shownEmpty={pinnedStages}
            epicOf={epicOf}
            pending={pending}
            activeId={flat[cursor]?.id ?? null}
            openId={openId}
            marked={marked}
            newIds={newIds}
            parentLabels={parentLabels}
            onOpen={(id, e) => clickRow(e, id)}
            onMenu={(id, anchor) => {
              setCursor(flat.findIndex((x) => x.id === id));
              setMenu({ taskId: id, targets: targetsFor(id), anchor });
            }}
          />
        ) : (
        <div className="list">
          {!error && !loading && groupNodes.length === 0 && (
            <div className="empty">Brak zadań pasujących do filtra.</div>
          )}

          {groupNodes.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <DropZone key={g.key} tag="section" id={groupDropId(g.key)} dataGroup={g.key}>
                <div className="group-head" onClick={() => toggleGroup(g.key)}>
                  <ChevronIcon open={!isCollapsed} />
                  <span className="group-label">{g.label}</span>
                  <span className="group-count">{g.tasks.length}</span>
                  <GroupPoints tasks={g.tasks} />
                </div>
                {!isCollapsed &&
                  g.subs.map((sub) => {
                    const sKey = subKey(g.key, sub.key);
                    const subCollapsed = collapsed.has(sKey);
                    /*
                     * Podgrupa tez jest celem upuszczenia i musi wygrac z sekcja
                     * nadrzedna — inaczej drop ustawia tylko os glowna i zadanie
                     * wraca do swojej starej podgrupy, co wyglada na zignorowany
                     * drop. Pierwszenstwo zalatwia collisionDetection w dnd.ts.
                     */
                    return (
                      <DropZone
                        key={sKey || 'all'}
                        tag="div"
                        id={subDropId(g.key, sub.key)}
                        disabled={!sub.label}
                      >
                        {sub.label && (
                          <div className="subgroup-head" onClick={() => toggleGroup(sKey)}>
                            <ChevronIcon open={!subCollapsed} />
                            <span className="subgroup-label">{sub.label}</span>
                            <span className="group-count">{sub.tasks.length}</span>
                            <GroupPoints tasks={sub.tasks} />
                          </div>
                        )}
                        {!subCollapsed &&
                          sub.nodes.map(({ task: t, depth, childCount: visibleKids, parentOutside }) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      active={flat[cursor]?.id === t.id}
                      selected={openId === t.id}
                      busy={pending.has(t.id)}
                      depth={depth}
                      childCount={visibleKids}
                      hiddenSubCount={childStats.get(t.id)?.hidden ?? 0}
                      elsewhereSubCount={(childStats.get(t.id)?.inFilter ?? 0) - visibleKids}
                      collapsed={collapsedTasks.has(t.id)}
                      onToggle={() =>
                        setCollapsedTasks((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                      }
                      marked={marked.has(t.id)}
                      isNew={newIds.has(t.id)}
                      hasRelated={relatedIds.has(t.id)}
                      epic={epicOf(t)}
                      onEpic={toggleEpicFilter}
                      stage={t.stageId ? stageMeta.get(t.stageId) : undefined}
                      parentRef={parentOutside ? parentInfo(parentOutside) : undefined}
                      tagLimit={tagLimit}
                      onCopied={(code) =>
                        toast(code ? `Skopiowano ${code}` : 'Nie udało się skopiować do schowka')
                      }
                      onOpenParent={setOpenId}
                      onMark={(e) => markRow(e, t.id)}
                      onSelect={(e) => clickRow(e, t.id)}
                      onMenu={(anchor) => {
                        setCursor(flat.findIndex((x) => x.id === t.id));
                        setMenu({ taskId: t.id, targets: targetsFor(t.id), anchor });
                      }}
                      onTag={(name) => toggleTag(name)}
                    />
                          ))}
                      </DropZone>
                    );
                  })}
              </DropZone>
            );
          })}
        </div>
        )}

        {/*
          Podglad pod kursorem zamiast domyslnego "ducha" przegladarki: ten byl
          zrzutem calego wiersza na pelna szerokosc listy i zaslanial cele.
          Przy zaznaczeniu wielu zadan pokazujemy licznik, bo przeciagamy je
          wszystkie naraz (patrz targetsFor).
        */}
        <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
          {dragging && (
            <div className="drag-preview">
              <span className="row-code">{dragging.code ?? `#${dragging.id}`}</span>
              <span className="drag-preview-title">{dragging.title || dragging.rawTitle}</span>
              {dragCount > 1 && <span className="drag-preview-count">{dragCount}</span>}
            </div>
          )}
        </DragOverlay>
        </DndContext>
        </div>
      </main>

      {openTask && (
        <DetailPanel
          task={openTask}
          stageName={(openTask.stageId && stageNames.get(openTask.stageId)) || 'Poza sprintem'}
          sprintName={sprintLabel(openTask)}
          epic={epicOf(openTask)}
          labels={labels}
          me={me}
          portal={config?.portal ?? null}
          allTasks={tasks}
          visibleIds={visibleIds}
          groupOf={groupOfTask}
          canStoryPoints={activeSprint !== null}
          width={detailWidth}
          onResize={setDetailWidth}
          onOpenTask={setOpenId}
          onRelatedChange={(id, has) =>
            setRelatedIds((prev) => {
              const next = new Set(prev);
              if (has) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onPick={(kind, anchor) => openPicker(kind, openTask.id, anchor)}
          onDeadline={(date) =>
            void mutate(
              openTask.id,
              { deadline: date || null },
              () => updateTask(openTask.id, { DEADLINE: date }),
              'termin',
            )
          }
          onTitle={(title) =>
            void mutate(
              openTask.id,
              { title, rawTitle: title },
              () => updateTask(openTask.id, { TITLE: title }),
              'tytuł',
            )
          }
          onClose={() => setOpenId(null)}
          onDelete={() =>
            setConfirm({
              title: `Usunąć zadanie „${openTask.title || openTask.rawTitle}"?`,
              body: 'Zadanie zniknie z Bitriksa razem z podzadaniami, komentarzami i checklistą. Tej operacji nie da się cofnąć.',
              confirmLabel: 'Usuń',
              danger: true,
              onYes: () => {
                setOpenId(null);
                void removeTask(openTask.id);
              },
            })
          }
          onError={toast}
        />
      )}

      {menu &&
        (() => {
          const t = tasks.find((x) => x.id === menu.taskId);
          if (!t) return null;
          return (
            <ContextMenu
              task={t}
              stageName={(t.stageId && stageNames.get(t.stageId)) || 'Poza sprintem'}
              sprintName={sprintLabel(t)}
              labels={labels}
              count={menu.targets.length}
              anchor={menu.anchor}
              onClose={() => setMenu(null)}
              onOpen={() => {
                setMenu(null);
                setOpenId(t.id);
              }}
              onPick={(kind) => {
                // Popover otwieramy w tym samym miejscu, w ktorym stalo menu.
                setMenu(null);
                openPicker(kind, t.id, menu.anchor, menu.targets);
              }}
            />
          );
        })()}

      {picker && pickerConfig && (
        <Picker
          title={pickerConfig.title}
          options={pickerConfig.options}
          rawLabel={pickerConfig.rawLabel}
          freeLabel={pickerConfig.freeLabel}
          placeholder={pickerConfig.placeholder}
          segments={pickerConfig.segments}
          multi={pickerConfig.multi}
          selected={pickerConfig.selected}
          onToggle={pickerConfig.onToggle}
          anchor={picker.anchor}
          onClose={() => setPicker(null)}
          onPick={(value) => {
            setPicker(null);
            void pickerConfig.apply(value);
          }}
        />
      )}

      {viewsMenu && (
        <ViewsMenu
          anchor={viewsMenu}
          views={views}
          activeId={activeViewId}
          onApply={applyView}
          onDelete={deleteView}
          onSave={saveView}
          /* Otwarte najechaniem: nie zabieramy focusu i pilnujemy kursora nad menu. */
          autoFocusInput={!viewsMenu.hover}
          hover={!!viewsMenu.hover}
          onHoverIn={clearViewsTimer}
          onHoverOut={closeViewsSoon}
          onClose={() => {
            clearViewsTimer();
            setViewsMenu(null);
          }}
        />
      )}

      {/* "+ Filtr": najpierw wybor wymiaru, potem popover wartosci w tym samym miejscu. */}
      {filterMenu && (
        <Picker
          title="Dodaj filtr"
          anchor={filterMenu}
          options={addFilterOptions}
          placeholder="Szukaj wymiaru…"
          onClose={() => setFilterMenu(null)}
          onPick={(value) => {
            const anchor = filterMenu;
            setFilterMenu(null);
            addCondition(value as FilterField, anchor);
          }}
        />
      )}

      {(() => {
        // Wartosci otwartego warunku — pobieramy go po id, zeby chip i popover byly zawsze zgodne.
        const cond = filterPick && filters.find((c) => c.id === filterPick.condId);
        if (!filterPick || !cond) return null;
        return (
          <Picker
            multi
            title={FILTER_LABEL[cond.field]}
            anchor={filterPick.anchor}
            options={filterOptions}
            selected={cond.values}
            emptyLabel="Brak wartości do wyboru"
            onToggle={(value) => toggleCondValue(cond.id, value)}
            onPick={() => {}}
            onClose={() => {
              // Porzucony, pusty warunek (np. „+ Filtr" bez wyboru) nie zostaje wiszacy.
              if (!cond.values.length) removeCondition(cond.id);
              setFilterPick(null);
            }}
          />
        );
      })()}

      {(() => {
        const cond = opMenu && filters.find((c) => c.id === opMenu.condId);
        if (!opMenu || !cond) return null;
        return (
          <Picker
            title="Operator"
            anchor={opMenu.anchor}
            options={opsFor(cond.field).map((op) => ({
              value: op,
              label: opLabel(op, cond.values.length > 1),
            }))}
            onClose={() => setOpMenu(null)}
            onPick={(value) => {
              setCondOp(cond.id, value as FilterOp);
              setOpMenu(null);
            }}
          />
        );
      })()}

      {projectMenu && (
        <Picker
          title="Projekt"
          anchor={projectMenu}
          emptyLabel="Webhook nie widzi grup roboczych — wpisz numer projektu"
          rawLabel={rawProjectLabel}
          options={projects.map((p) => ({
            value: String(p.id),
            // Ptaszek zamiast ikony grupy zaznacza biezacy — lista bywa dluga.
            icon: p.id === groupId ? <CheckIcon /> : <GroupIcon />,
            label: p.name,
            hint: PROJECT_ROLE[p.role],
          }))}
          onClose={() => setProjectMenu(null)}
          onPick={(value) => {
            setProjectMenu(null);
            pickProject(Number(value));
          }}
        />
      )}

      {confirm && (
        <Confirm
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onYes={confirm.onYes}
          onClose={() => setConfirm(null)}
        />
      )}

      {viewMenu && (
        <ViewMenu
          anchor={viewMenu}
          state={{
            view: viewMode,
            group: groupBy,
            subGroup: subGroupBy,
            sort,
            scope,
            mine: onlyMine,
            unassigned: withUnassigned,
            done: showDone,
            empty: showEmpty,
            carousel: scopeCarousel,
            filtersOn: anyFilter(filters),
            theme,
            font,
          }}
          activeSprintName={activeSprint?.name ?? null}
          scopes={scopes}
          scopeCounts={scopeCounts}
          columns={categories}
          onClose={() => setViewMenu(null)}
          on={{
            view: setViewMode,
            group: (g) => {
              setGroupBy(g);
              // Podgrupowanie po tej samej osi co grupowanie nic by nie dalo.
              setSubGroupBy((s) => (s === g ? null : s));
            },
            subGroup: setSubGroupBy,
            sort: patchSort,
            scope: setScope,
            mine: () => setOnlyMine((v) => !v),
            unassigned: () => setWithUnassigned((v) => !v),
            done: () => setShowDone((v) => !v),
            empty: () => setShowEmpty((v) => !v),
            toggleColumn,
            carousel: () => setScopeCarousel((v) => !v),
            clearFilters: () => setFilters(EMPTY_FILTERS),
            reload: () => void reload(),
            palette: () => setPaletteOpen(true),
            theme: setTheme,
            font: setFont,
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}

      <UpdateBanner />

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
