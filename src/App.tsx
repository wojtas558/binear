import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { HoverNote } from './HoverNote';
import {
  CLOSED_STATUSES,
  REVIEW_STATUSES,
  FALLBACK_PRIORITY,
  FALLBACK_STATUS,
  addComment,
  addCommentWithFiles,
  probeMethod,
  type ProbeStan,
  deleteComment,
  editComment,
  fetchComments,
  fetchOlderComments,
  fetchActiveSprint,
  fetchSprints,
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
  BxError,
  createSprint,
  fetchDescriptions,
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
  updateParticipants,
  updateStoryPoints,
  updateEpic,
  updateTags,
  updateTask,
  fetchEmployees,
  type Employee,
  type AppConfig,
  type Comment,
  type Epic,
  type FieldEnums,
  type Project,
  type Sprint,
  type Stage,
  type Task,
  type TaskDetail,
  isRateLimitError,
  type Interval,
} from './bitrix';
import {
  clearDraft,
  getCachedComments,
  getCachedDetail,
  getDraft,
  setCachedComments,
  setCachedDetail,
  setDraft as storeDraft,
} from './detailCache';
import { POZYCJE, SPRAWDZENIA, opisWyniku, type Kontekst } from './perms';
import { wczytajListe, zapiszListe, type ListSnapshot } from './listCache';
import { wczytajOpisy, zapiszOpisy, type Opis } from './descCache';
import { wczytajWklejone, wyczyscWklejone, zapiszWklejone } from './pasteStore';
import { renderDescription, setPortalBase } from './markdown';
import { buildQuote, plainText, splitQuote } from './quote';
import { ErrorBoundary } from './ErrorBoundary';
import { checkForUpdate, runUpdate, type UpdateInfo } from './version';
import {
  Avatar,
  ChevronIcon,
  GroupIcon,
  HistoryIcon,
  PlanIcon,
  PriorityIcon,
  SearchIcon,
  StageIcon,
  StatusIcon,
  ListIcon,
  BoardIcon,
  ChartIcon,
  ClipIcon,
  GripIcon,
  PersonIcon,
  ColumnsIcon,
  PenIcon,
  EyeIcon,
  CalendarIcon,
  TagIcon,
  LayersIcon,
  HashIcon,
  RingIcon,
  BarsIcon,
  DirIcon,
  RefreshIcon,
  ViewsIcon,
  statusColor,
  personColor,
  SubtaskIcon,
  ParentIcon,
  LinkIcon,
  MoreIcon,
  CheckIcon,
  CloseIcon,
  CommentIcon,
  ReplyIcon,
  ExternalIcon,
  ElsewhereIcon,
  TrashIcon,
  PinIcon,
  tagHue,
} from './icons';
import {
  MONTHS,
  podzielNaTrafienia,
  tagsForWidth,
  shortDate,
  isUnassigned,
  setUnassignedId,
  stageOf,
  sumPoints,
  tasksWord,
  UNASSIGNED_ID,
  UNASSIGNED_LABEL,
} from './taskView';
import { Picker, type Anchor, type Option } from './Picker';
import {
  describe as describeAction,
  HISTORY_DAYS,
  onHistoryChange,
  readHistory,
  foldEntries,
  MARK,
  SEP,
  diffTasks,
  logAction,
  noteAuthor,
  notePrevious,
  setTaskNames,
  type HistoryEntry,
  type Resolve,
  noteMine,
} from './history';
import { TaskCode } from './TaskCode';
import { zapiszPrzeniesienie, type Dodane } from './planRecent';
import { Board } from './Board';
import { Dashboard } from './Dashboard';
import { Planning, SORT_DOMYSLNY } from './Planning';
import { planComparator } from './planSort';
import { CountersBar, useAnsweredTasks, useCounterHistory } from './CountersBar';
import {
  COUNTERS,
  counterDef,
  countAll,
  type CounterCtx,
  type CounterKey,
  type DaySnapshot,
} from './counters';
import { CommandPalette, type Command } from './CommandPalette';
import { applyTheme, loadTheme, watchSystemTheme, THEMES, type Theme } from './theme';
import { applyFont, loadFont, FONTS, type Font } from './font';
import { loadProject, saveProject } from './project';
import { loadRead, loadSeen, saveRead, saveSeen } from './seen';
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
type GroupBy = 'stage' | 'status' | 'assignee' | 'flat';
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
type ViewMode = 'list' | 'board' | 'charts' | 'planning';

/**
 * Wyglad terminu w wierszu listy. Trzy warianty ZOSTAJA na stale — nie sa
 * tymczasowe „do porownania", tylko wyborem uzytkownika (ustalone 2026-09-18):
 *  `off`  — jedna data, bez ikony i koloru; termin nie rozni sie od daty zmiany;
 *  `mark` — DOMYSLNY: jedno miejsce, termin z ikona i kolorem pilnosci, a bez
 *           terminu przygaszona data zmiany;
 *  `chip` — data zmiany zawsze, a termin w osobnym, zarezerwowanym slocie obok.
 */
type DeadlineLook = 'off' | 'mark' | 'chip';
const DEADLINE_LOOKS: { key: DeadlineLook; label: string }[] = [
  { key: 'off', label: 'Bez wyróżnienia' },
  { key: 'mark', label: 'W miejscu daty' },
  { key: 'chip', label: 'Osobny żeton' },
];

/**
 * Grupa dla zadan BEZ etapu, czyli spoza sprintu — rejestr. To nie jest nazwa
 * etapu, wiec kod, ktory szuka etapu po nazwie grupy, musi ja obsluzyc osobno.
 */
const NO_SPRINT = 'Poza sprintem';

/** Warianty kolorowania grup listy — patrz `listTint` w ustawieniach. */
type ListTint = 'off' | 'fade' | 'rail';
const LIST_TINTS: { key: ListTint; label: string }[] = [
  { key: 'off', label: 'Bez koloru' },
  { key: 'fade', label: 'Nagłówek' },
  { key: 'rail', label: 'Szyna z lewej' },
];

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
type FilterField =
  | 'assignee'
  | 'creator'
  | 'priority'
  | 'stage'
  | 'status'
  | 'tag'
  | 'epic'
  | 'points'
  | 'deadline'
  | 'observer';

/**
 * Operatory jak w Linearze. Wymiary jednowartosciowe (osoba/priorytet/status/etap —
 * zadanie ma jedna wartosc) dostaja `is`/`isNot`; tag jest wielowartosciowy, wiec ma
 * `anyOf`/`allOf`/`noneOf`. Pusty zestaw wartosci nie zawezaja niczego.
 */
type FilterOp = 'is' | 'isNot' | 'anyOf' | 'allOf' | 'noneOf' | 'between';

/** Jeden warunek paska. Ten sam wymiar moze wystapic wiele razy (np. tag = X ORAZ tag ≠ Y). */
interface Condition {
  id: string;
  field: FilterField;
  op: FilterOp;
  values: string[];
}

/** Lista warunkow — miedzy warunkami ORAZ, wewnatrz warunku decyduje operator. */
type Filters = Condition[];

/*
 * Wymiary filtra w TRZECH grupach, oddzielonych kreska w menu "+ Filtr":
 * kto (ludzie) - gdzie w procesie (stan) - o czym (tresc zadania).
 *
 * Przy czterech pozycjach kolejnosc byla obojetna, przy osmiu juz nie: plaska
 * lista zmusza do czytania wszystkich etykiet po kolei, zamiast skoczyc wzrokiem
 * do wlasciwej trojki. `divider` rysuje kreske NAD pozycja (Picker pomija ja na
 * samej gorze listy), wiec grupe otwiera jej pierwszy element.
 */
const FILTER_FIELDS: { field: FilterField; label: string; icon: ReactNode; divider?: boolean }[] = [
  // kto
  { field: 'assignee', label: 'Osoba', icon: <PersonIcon /> },
  { field: 'creator', label: 'Autor', icon: <PenIcon /> },
  { field: 'observer', label: 'Obserwator', icon: <EyeIcon /> },
  // gdzie w procesie
  { field: 'stage', label: 'Etap', icon: <ColumnsIcon />, divider: true },
  { field: 'status', label: 'Status', icon: <RingIcon /> },
  { field: 'priority', label: 'Priorytet', icon: <BarsIcon /> },
  { field: 'deadline', label: 'Termin', icon: <CalendarIcon /> },
  // o czym
  { field: 'epic', label: 'Epik', icon: <LayersIcon />, divider: true },
  { field: 'tag', label: 'Tag', icon: <TagIcon /> },
  { field: 'points', label: 'Story points', icon: <HashIcon /> },
];

const FILTER_LABEL = Object.fromEntries(FILTER_FIELDS.map((f) => [f.field, f.label])) as Record<
  FilterField,
  string
>;

/** Wymiary, w ktorych zadanie ma WIELE wartosci naraz — tylko tam ma sens „wszystkie z". */
/*
 * Wymiary, w ktorych ZADANIE ma wiele wartosci naraz — stad operatory zbiorowe
 * (dowolny z / wszystkie z / zaden z) zamiast "to / to nie".
 */
const MULTI_FIELDS = new Set<FilterField>(['tag', 'observer']);

/**
 * Pseudo-wartosc filtra tagu „Bez tagów" — zadanie bez zadnego tagu. Znak NUL nie
 * moze byc prawdziwym tagiem, wiec nie zderzy sie z nazwa. Traktowana jak zwykla
 * wartosc w warunku (anyOf/allOf/noneOf), tylko dopasowanie liczy pusta liste tagow.
 */
const NO_TAGS = '\u0000';

/*
 * Story pointy to jedyny wymiar LICZBOWY, wiec jako jedyny dostaje progi.
 * ZAKRES skladamy z dwoch warunkow (>= 3 ORAZ <= 8) zamiast osobnego widzetu od
 * min-max: pasek i tak laczy warunki przez ORAZ i od poczatku dopuszcza ten sam
 * wymiar wiele razy, wiec zakres wychodzi z mechanizmu, ktory juz jest.
 */
/**
 * To samo co NO_TAGS, ale dla story pointow: „Bez oszacowania” — zadanie, ktoremu
 * nikt nie nadal pointow. Osobna stala, bo to osobny wymiar i osobne znaczenie;
 * znak jest ten sam, a wymiary nigdy nie mieszaja sie w jednym warunku.
 *
 * Wazne: zadanie bez oszacowania NIE wpada w zaden zakres liczbowy. „co najmniej 1”
 * ma znaczyc „oszacowane na co najmniej 1”, a nie „cokolwiek” — brak oszacowania
 * to brak danych, nie zero.
 */
const NO_POINTS = '\u0000';

/** To samo co NO_POINTS, ale dla terminu: zadanie, ktoremu nikt terminu nie nadal. */
const NO_DEADLINE = '\u0001';

/*
 * Termin filtrujemy W DNIACH OD DZIS, nie datami z kalendarza.
 *
 * Zakres dat bylby prawdziwy tylko w dniu zapisania: widok "termin do 30.09"
 * zapisany we wrzesniu w pazdzierniku nie znaczy juz nic. "Od dzis do za 7 dni"
 * znaczy to samo zawsze — a przy terminach pyta sie wlasnie o to.
 *
 * Skala jest nierowna CELOWO: gesto wokol dzis, bo tam sie rozstrzyga, co robic
 * teraz; rzadko na koncach. Suwak chodzi po jej INDEKSACH, wiec odstepy na torze
 * sa rowne mimo nierownych wartosci — dokladnie jak przy story pointach.
 */
const DEADLINE_SCALE = [-90, -30, -14, -7, -3, -1, 0, 1, 3, 7, 14, 30, 60, 90];

/** Pelne dni kalendarzowe miedzy dzis a `iso`; ujemne = po terminie. */
function dayOffset(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((midnight(d) - midnight(new Date())) / 86400000);
}

/** Granica zakresu terminu po ludzku — ten sam podpis na suwaku i na chipie. */
function dayLabel(d: number): string {
  if (d === 0) return 'dziś';
  if (d === 1) return 'jutro';
  if (d === -1) return 'wczoraj';
  return d < 0 ? `${-d} dni po terminie` : `za ${d} dni`;
}

const isRange = (field: FilterField, op: FilterOp) =>
  (field === 'points' || field === 'deadline') && op === 'between';

const opsFor = (field: FilterField): FilterOp[] =>
  MULTI_FIELDS.has(field)
    ? ['anyOf', 'allOf', 'noneOf']
    : field === 'points' || field === 'deadline'
      ? // Zakres PIERWSZY, bo `defaultOp` bierze poczatek listy: story pointy to
        // skala liczbowa, wiec „od-do" jest tu zwyklym przypadkiem, a wybor
        // pojedynczych wartosci wyjatkiem.
        ['between', 'is', 'isNot']
      : ['is', 'isNot'];

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
    case 'between':
      return 'w zakresie';
  }
}

/**
 * Podpis zakresu na chipie. Granica otwarta czyta sie jako nierownosc, nie jako
 * puste miejsce: samo "od 3" to "3+", samo "do 8" to "≤ 8".
 */
function rangeLabel(field: FilterField, values: string[]): string {
  const [from = '', to = ''] = values;
  if (field === 'deadline') {
    // Termin czyta sie slowami, nie liczbami: "-7" na chipie nie znaczy nic.
    if (from && to) return `${dayLabel(Number(from))} – ${dayLabel(Number(to))}`;
    if (from) return `od ${dayLabel(Number(from))}`;
    if (to) return `do ${dayLabel(Number(to))}`;
    return 'dowolny';
  }
  if (from && to) return `${from}–${to} SP`;
  if (from) return `${from}+ SP`;
  if (to) return `≤ ${to} SP`;
  return 'dowolny';
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
  /* Klucz `flat`, a nie `none`: „none" oznacza juz WYLACZONE podgrupowanie w
     kontrolce ponizej, wiec ta sama nazwa zderzylaby sie z tamta wartoscia. */
  { key: 'flat', label: 'Bez grupowania', help: 'Jedna lista, bez nagłówków' },
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
  /*
   * Filtry WIDOKU PLANOWANIA — wlasne, nie te z panelu.
   *
   * Planowanie odpowiada na inne pytanie niz lista ("co bierzemy dalej", a nie
   * "co jest"), wiec i odsiew ma inny: domyslnie bez zakonczonych, za to
   * z oddanymi do akceptacji. Wspolne przelaczniki znaczylyby, ze ustawienie
   * listy po cichu zmienia sumy w panelach planowania — i odwrotnie.
   */
  planDone: boolean;
  planReview: boolean;
  /** Stos kluczy sortowania planowania — kolejnosc ma znaczenie. */
  planSort: { by: PlanSortBy; dir: 'asc' | 'desc' }[];
  /**
   * Odcien grup na LISCIE — trzy warianty do porownania na zywo:
   *  `head` pasek na naglowku, `fade` pasek + wygaszanie w dol, `rail` szyna z lewej.
   */
  listTint: ListTint;
  /** Wyglad terminu w wierszu — patrz `DeadlineLook`. */
  deadlineLook: DeadlineLook;
  /*
   * Czy wyszukiwarka zaglada takze do OPISOW. Wylaczone domyslnie, bo wlaczenie
   * kosztuje jednorazowe pobranie okolo 1,9 MB (patrz `descCache.ts`) — decyzja
   * nalezy do uzytkownika, a nie do domyslnej konfiguracji.
   */
  szukajWOpisach: boolean;
  /*
   * Moce zespolu na sprint, w SP. `null` = nie ustawiono recznie i bierzemy
   * odniesienie, ktore widok planowania i tak liczy: ile zespol NAPRAWDE dowiozl
   * w ostatnim zamknietym sprincie. Uczciwszy domysl niz okragla liczba.
   */
  planMoce: number | null;
  /*
   * KOLEJKA DZIALOW do wybierania zadan na kolejny sprint. Dzialy to EPIKI grupy
   * — nie wymyslamy drugiego slownika, skoro zadania sa juz nimi opisane.
   *
   * Trzymamy identyfikatory, nie nazwy: epik da sie w Bitriksie przemianowac,
   * a kolejnosc ma to przezyc. Czego NIE MA w zapisie, jest nowe i dopisuje sie
   * na koniec — dzieki temu dolozony epik pojawia sie sam, a usuniety znika.
   */
  planKolejka: number[];
  /** Dzialy chwilowo pomijane (nieobecne na spotkaniu). */
  planPominieci: number[];
  /** Ile razy juz wybierano — pozycja w kolejce to reszta z dzielenia. */
  planTura: number;
  /*
   * Czy rejestr w trakcie tury ma pokazywac TYLKO zadania z tagiem `DO-STARTU`.
   * Domyslnie tak: bez tego do wyboru wchodza rzeczy jeszcze niedomyslane
   * (`DO-WYWIADU`, `OCZEKUJE-NA-ODPOWIEDZ`), ktorych nie ma sensu brac na sprint.
   */
  planTylkoDoStartu: boolean;
  /** Czy niedomknieta praca z trwajacego sprintu wlicza sie do mocy kolejnego. */
  planPrzeniesienie: boolean;
  /**
   * Czy KOLEJKA DZIALOW jest w uzyciu. Wylaczona zdejmuje zawezenie rejestru do
   * epiku i do `DO-STARTU` — planowanie poza spotkaniem, gdy nikt nie wybiera po
   * kolei, a chodzi o przejrzenie calego rejestru.
   */
  planKolejkaWl: boolean;
  /**
   * Podzial widoku planowania: `cols` rejestr kontra sprinty, `split` sprint
   * aktywny kontra planowany. Siedzi TUTAJ, a nie w `Planning`, bo przelaczenie
   * widoku odmontowuje ten komponent — proporcje ginely przy kazdym wyjsciu.
   */
  planPodzial: { cols: number; split: number };
  /**
   * Zwiniete panele sprintow w planowaniu, po ID sprintu. Z tego samego powodu co
   * `planPodzial`: przelaczenie widoku odmontowuje `Planning` i zwiniecie ginelo.
   * Po ID, nie „aktywny/planowany" — nowy sprint zaczyna rozwiniety.
   */
  planZwiniete: number[];
  /**
   * Puste grupy/kolumny. Lista: pokazuje naglowek etapu/statusu nawet bez zadan.
   * Tablica: gdy wylaczone, kolumna bez kart znika (np. "Wdrozone", gdy nic nie
   * jest wdrozone). Dotyczy tylko grupowania po etapie i statusie — przy osobie
   * nie ma skonczonego zbioru grup do domalowania.
   */
  showEmpty: boolean;
  /** Karty licznikow pod naglowkiem (patrz `CountersBar`). */
  showCounters: boolean;
  /** Kafelki licznikow schowane przez uzytkownika (olowek przy „Pokaż liczniki"). */
  hiddenCounters: string[];
  /**
   * PUSTE kategorie (kolumny/grupy), ktore mimo braku zadan maja byc widoczne —
   * po NAZWIE, bo te same etapy maja rozne id w kazdym sprincie (patrz stageOrder).
   * Zastepuje dawny globalny przelacznik „Puste kolumny": zamiast wszystko-albo-nic
   * wybierasz w panelu, ktore konkretnie puste kategorie pokazac. Puste = zadna.
   */
  shownEmpty: string[];
  /** Szerokosc panelu szczegolow w px — ustawiana chwytem na jego lewej krawedzi. */
  detailWidth: number;
  /*
   * ZWINIECIA — grup i zadan z podzadaniami. Zwiniecie to decyzja „tego teraz nie
   * chce ogladac", czyli dokladnie to samo co reszta ustawien widoku, a nie stan
   * chwilowy. Bez zapisu kazde odswiezenie rozwijalo wszystko z powrotem.
   *
   * Klucze grup zaleza od WYMIARU grupowania, wiec kazdy wymiar pamieta swoje
   * wlasne zwiniecia i powrot do poprzedniego widoku je odtwarza.
   */
  collapsed: string[];
  collapsedTasks: number[];
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
  planDone: false,
  planReview: true,
  /* Domyslna kolejnosc waznosci — plomien rosnaco (ranga 0 = wysoki), tag tak
     samo, a story pointy malejaco, bo tu wiecej znaczy wazniej. */
  planSort: [
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
  // Kolor grup domyslnie WLACZONY — bez niego lista jest jednolita szara scianka.
  listTint: 'fade',
  deadlineLook: 'mark',
  szukajWOpisach: false,
  planMoce: null,
  planKolejka: [],
  planPominieci: [],
  planTura: 0,
  planTylkoDoStartu: true,
  planPrzeniesienie: true,
  planKolejkaWl: true,
  /* 0,8 dla sprintu aktywnego: to w nim sie planuje, a kolejny jest na razie
     miejscem odkladczym — patrz `SPLIT_DEFAULT` w `Planning`. */
  planPodzial: { cols: 0.5, split: 0.8 },
  planZwiniete: [],
  showEmpty: false,
  showCounters: true,
  hiddenCounters: [],
  shownEmpty: [],
  detailWidth: 520,
  collapsed: [],
  collapsedTasks: [],
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
  /**
   * Zapisywany dla ZGODNOSCI ze starymi widokami w localStorage, ale juz NIE
   * uzywany: widok opisuje, CO jest na ekranie, a lista/tablica/wykresy to tylko
   * sposob rysowania tego samego. Zastosowanie widoku nie przerzuca wiec trybu,
   * a dwa widoki rozniace sie wylacznie trybem to po prostu ten sam widok.
   */
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
    /*
     * `viewMode` CELOWO nie wchodzi do odcisku. Widok zapisany opisuje, CO jest
     * na ekranie (filtry, grupowanie, sortowanie, zakres) — a lista, tablica i
     * wykresy to tylko sposob rysowania tego samego zestawu. Gdy `viewMode`
     * liczyl sie do tozsamosci, przelaczenie z listy na tablice przestawialo
     * pasek na "Własny", chociaz nic w doborze zadan sie nie zmienilo.
     *
     * Zapisany widok NADAL pamieta swoj tryb i przywraca go przy zastosowaniu —
     * chodzi wylacznie o to, ze pozniejsza zmiana trybu nie unieważnia widoku.
     */
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
function PersonInline({ name, photo }: { name: string | null; photo?: string | null }) {
  /*
   * BEZ „Nieprzypisane". Ten komponent rysuje AUTORA i UCZESTNIKOW, a nie osobe
   * odpowiedzialna — a konto-zaslepka z `.env` to normalne konto, ktore po prostu
   * pelni role „nikt tego nie prowadzi". Jako autor jest konkretna osoba i ma sie
   * nazywac po imieniu. „Nieprzypisane" znaczy cos wylacznie przy przypisaniu.
   */
  return (
    <>
      <Avatar name={name} photo={photo} /> {name}
    </>
  );
}

/* Stala referencja — wchodzi do zaleznosci `useMemo` w Pickerze. */
const rawProjectLabel = (n: number) => `Otwórz projekt #${n}`;

/** Rola w projekcie. Zwykle uczestnictwo (`K`) nie dostaje dopisku — jest domyslne. */
const PROJECT_ROLE: Record<string, string> = { A: 'właściciel', E: 'moderator' };

/** Punkt zaczepienia popovera — wiersz listy albo miejsce klikniecia prawym. */
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
/*
 * Znaczki pozycji menu — TE SAME, ktorych uzywa „+ Filtr" (patrz `FILTER_FIELDS`).
 * Menu i filtr mowia o tych samych polach zadania, wiec musza mowic tym samym
 * slownikiem obrazkow; dwa zestawy kazalyby uczyc sie go dwa razy.
 *
 * Sprint jest wyjatkiem: w filtrze go nie ma, a dziennik zostawia go bez ikony
 * (patrz komentarz przy `hist-name`) — tam stoi w zdaniu, wiec brak znaczka nic
 * nie psuje. Tutaj stoi w KOLUMNIE i jedna pusta pozycja wyglada jak brak, nie
 * jak decyzja. Dostaje tablice, bo sprint to wlasnie tablica z kolumnami.
 */
const MENU_ICON: Partial<Record<PickerKind, ReactNode>> = {
  sprint: <BoardIcon />,
  stage: <ColumnsIcon />,
  assignee: <PersonIcon />,
  priority: <BarsIcon />,
  status: <RingIcon />,
};

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
   * WSZYSTKIE sprinty grupy. Dziennik nazywa po nich zapisy („sprint → Sprint 66")
   * zamiast pokazywac goly identyfikator.
   */
  sprints: Sprint[];
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

/**
 * Migawka z IndexedDB → stan widoku. Mapy odtwarzamy z par (patrz `listCache`).
 * Brak migawki daje pusty stan, czyli to samo, co bylo wczesniej zawsze.
 */
function zData(s: ListSnapshot | null): Data {
  if (!s) return EMPTY;
  return {
    ...EMPTY,
    ...s,
    stageNames: new Map(s.stageNames),
    stageOrder: new Map(s.stageOrder),
    stageMeta: new Map(s.stageMeta),
    epicNames: new Map(s.epicNames),
  };
}

/** Odwrotnie: stan widoku → migawka do zapisania. Jedno miejsce, wiec pola nie rozjada sie z `Data`. */
function zeStanu(d: Data): ListSnapshot {
  return {
    ...d,
    stageNames: [...d.stageNames],
    stageOrder: [...d.stageOrder],
    stageMeta: [...d.stageMeta],
    epicNames: [...d.epicNames],
  };
}

const EMPTY: Data = {
  tasks: [],
  stages: [],
  stageNames: new Map(),
  stageOrder: new Map(),
  stageMeta: new Map(),
  labels: { status: FALLBACK_STATUS, priority: FALLBACK_PRIORITY },
  activeSprint: null,
  sprints: [],
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

/* Ile czekamy przed ponowieniem po odmowie z limitu. Wiadro portalu leje sie
   2 zapytania na sekunde, wiec pare sekund wystarcza, zeby bylo z czego brac. */
const RATE_RETRY_MS = 5000;

/**
 * Po tylu milisekundach bez ruchu myszy i klawisza uznajemy, ze nikogo nie ma,
 * i przestajemy pytac. Pieć minut, bo krotszy prog gasilby sonde przy czytaniu
 * dluzszego opisu, a dluzszy nie ratuje juz przed noca z otwarta karta.
 */
const IDLE_MS = 5 * 60_000;

/**
 * Jak dlugo bronic wlasnego zapisu przed lista, ktora go jeszcze nie widzi.
 *
 * `tasks.task.list` po zapisie potrafi przez KILKA MINUT zwracac stary wiersz —
 * nawet filtrowany po id tego jednego zadania (`tasks.task.get` jest dokladny,
 * ale listy z niego nie zlozymy: to jedno wywolanie na zadanie). Bez ochrony
 * kazde ciche odswiezenie cofalo na ekranie dopiero co wprowadzona zmiane, a
 * wlasciwa wartosc wracala dopiero po kilku minutach. Zapis byl caly czas
 * poprawny — klamal WIDOK.
 *
 * Piec minut to bezpiecznik na wypadek, gdyby lista nigdy nie potwierdzila
 * naszej wartosci (np. automatyzacja Bitriksa zapisala cos innego). W normalnym
 * biegu pinezka znika wczesniej — w chwili, gdy serwer zwroci to samo.
 */
const PIN_TTL_MS = 5 * 60_000;

/** Wlasny zapis czekajacy na potwierdzenie przez liste. */
interface Pin {
  /** Kiedy zapisalismy — do wygasniecia. */
  at: number;
  /** Pola, ktore sami ustawilismy, wraz z wartosciami. */
  fields: Partial<Task>;
  /** Zadanie usuniete przez nas: ma NIE wracac z nieaktualnej listy. */
  gone?: boolean;
}

/** Porownanie wartosci pola — tagi i osoby to tablice, reszta wartosci proste. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Naklada wlasne zapisy na swieza liste i sprzata pinezki, ktore zrobily swoje.
 *
 * Pinezka znika, gdy serwer zaczyna zwracac te sama wartosc (dogonil nas) albo
 * gdy minal `PIN_TTL_MS`. Mapa jest zywa (ref), wiec czyscimy ja w miejscu.
 */
function applyPins(tasks: Task[], pins: Map<number, Pin>): Task[] {
  if (!pins.size) return tasks;
  const now = Date.now();

  for (const [id, pin] of pins) {
    if (now - pin.at > PIN_TTL_MS) pins.delete(id);
  }
  if (!pins.size) return tasks;

  const out: Task[] = [];
  for (const t of tasks) {
    const pin = pins.get(t.id);
    if (!pin) {
      out.push(t);
      continue;
    }
    if (pin.gone) continue;

    let patched = t;
    for (const [k, v] of Object.entries(pin.fields)) {
      const key = k as keyof Task;
      /* Serwer nas dogonil w tym polu — pinezka nie ma juz czego bronic. */
      if (sameValue(t[key], v)) {
        delete pin.fields[key];
        continue;
      }
      if (patched === t) patched = { ...t };
      (patched as unknown as Record<string, unknown>)[k] = v;
    }
    /* Nic juz nie trzymamy dla tego zadania. */
    if (!Object.keys(pin.fields).length) pins.delete(t.id);
    out.push(patched);
  }

  /*
   * Zadania usuniete przez nas, ktorych lista wciaz nie zdjela, nie trafily do
   * `out` — ale ich pinezki musza zyc dalej, az lista naprawde je zgubi. Gdy
   * zniknely, pinezka nie ma juz sensu.
   */
  const present = new Set(tasks.map((t) => t.id));
  for (const [id, pin] of pins) {
    if (pin.gone && !present.has(id)) pins.delete(id);
  }
  return out;
}

function useBitrixData() {
  /* Pusty start; ostatnio widziana lista dochodzi z migawki w efekcie nizej. */
  const [data, setData] = useState<Data>(EMPTY);

  /*
   * Projekt, dla ktorego skonczyl sie tlowy przebieg story pointow i epikow. Do tego
   * momentu „bez SP" i „bez epika" to w wiekszosci zadania jeszcze niedociagniete,
   * wiec liczniki oparte na tych polach pokazuja wielokropek zamiast falszywej liczby.
   */
  const [metaGroup, setMetaGroup] = useState<number | null>(null);

  /**
   * Czy doszlo juz PRAWDZIWE pobranie. Dopoki nie, na ekranie stoi migawka.
   *
   * To nie to samo co „lista jest niepusta": projekt bez zadan konczy pobranie
   * z pusta lista, a spozniona migawka nadpisalaby wtedy poprawny wynik cudza
   * zawartoscia. Tak samo przy przelaczeniu projektu, ktore czysci stan do pustego.
   */
  const pobrano = useRef(false);

  /*
   * Ostatnio widziana lista — pokazujemy ja OD RAZU, a swieze dane podmieniaja ja
   * chwile pozniej (patrz `load`). Ten sam wzorzec, ktorym dzialaja juz szczegoly
   * zadania i komentarze.
   *
   * Bez tego kazde przeladowanie strony — takze to, ktorego nikt nie wywolal: po
   * zerwaniu polaczenia z serwerem deweloperskim albo po uspieniu karty przez
   * przegladarke — wygladalo jak zniknieciecie calego widoku (zgloszenie #4).
   */
  useEffect(() => {
    const wybrany = loadProject();
    void wczytajListe(wybrany).then((s) => {
      if (!s || pobrano.current) return;
      /* Migawka INNEGO projektu niz wybrany to nie „lepsze niz nic", tylko cudza
         lista pod nowa nazwa — patrz `groupId` w zwracanym obiekcie. */
      if (wybrany !== null && s.groupId !== wybrany) return;
      /*
       * Konfiguracja niesie skutki uboczne, ktore `load` wykonuje osobno: konto
       * „Nieprzypisane" i baze adresow dla wzmianek. Bez nich lista z migawki
       * grupowalaby zaslepke jako zwykla osobe, a wzmianki linkowaly w prozne.
       */
      if (s.config) {
        setUnassignedId(s.config.unassignedId);
        setPortalBase(s.config.portal);
      }
      setData((d) => (d.tasks.length ? d : zData(s)));
    });
  }, []);
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
  /*
   * Wlasne zapisy, ktorych lista jeszcze nie potwierdza — patrz `applyPins`.
   * W refie, nie w stanie: nakladamy je W TRAKCIE `setData`, a nie renderujemy,
   * wiec ich zmiana nie ma prawa sama z siebie odswiezac widoku.
   */
  const pinsRef = useRef<Map<number, Pin>>(new Map());
  /*
   * Stan zadan, z ktorym porownujemy NASTEPNE pobranie — zrodlo wpisow „zmiana
   * spoza binear". Osobny od `tasksRef`, bo tamten aktualizuje sie dopiero w
   * efekcie; tutaj potrzebujemy podmiany dokladnie w chwili porownania.
   */
  const seenRef = useRef<Map<number, Record<string, unknown>>>(new Map());
  useEffect(() => {
    tasksRef.current = data.tasks;
    /*
     * Dziennik dostaje nazwy zadan, zeby WPISAC je do swoich wpisow. Nie czyta
     * ich pozniej po id: zadanie bywa skasowane albo chwilowo wypadniete z
     * `tasks.task.list`, a wpis ma zostac czytelny. Patrz `setTaskNames`.
     */
    setTaskNames(
      new Map(data.tasks.map((t) => [t.id, { code: t.code, title: t.title || t.rawTitle }])),
    );

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

  /* Ponowienie po limicie zapytan — jeden oczekujacy timer, nie kolejka. */
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef<(silent?: boolean) => void>(() => {});

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
    let retrying = false;
    if (retryRef.current !== null) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
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

      const [tasks, labels, activeSprint, projects, backlogId, epics, allSprints] =
        await Promise.all([
        fetchTasks(groupId),
        fetchFieldEnums(),
        fetchActiveSprint(groupId),
        fetchProjects(),
        fetchBacklogId(groupId),
        fetchEpics(groupId),
        /* Lista sprintow do nazw w dzienniku. Blad nie moze wywalic startu:
           bez niej dziennik pokaze `#379` zamiast nazwy i nic wiecej. */
        fetchSprints(groupId).catch(() => [] as Sprint[]),
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

      /*
       * ZMIANY Z ZEWNATRZ — czyli te, ktorych binear nie zrobil.
       *
       * Wychodza z porownania tego, co mielismy, z tym, co wlasnie przyszlo.
       * Pierwsze wczytanie pomijamy (nie ma z czym porownywac), pola z pinezka
       * takze — to nasze wlasne zapisy, ktorych lista jeszcze nie potwierdza.
       *
       * AUTORA TU NIE PYTAMY. Kusilo, zeby dociagnac go od razu z dziennika
       * Bitriksa, ale to jedno wywolanie NA ZADANIE przy kazdym odswiezeniu —
       * przy fali zmian (zamkniecie sprintu rusza kilkadziesiat zadan) wprost
       * droga do `QUERY_LIMIT_EXCEEDED`, czyli do wywalenia calej aplikacji po to,
       * zeby dopisac nazwisko. Nazwisko dociaga panel dziennika, i tylko dla
       * wpisow, na ktore ktos faktycznie patrzy — patrz `useAuthors`.
       */
      if (seenRef.current.size) {
        const changes = diffTasks(
          seenRef.current,
          tasks as unknown as Record<string, unknown>[],
          /*
           * `in`, a NIE sprawdzenie wartosci. Pinezka na `deadline: null` albo
           * `storyPoints: 0` jest prawdziwa pinezka — przy testowaniu wartosci
           * wypadlaby jako falsz i wlasne wyczyszczenie terminu trafiloby do
           * dziennika jako CUDZA zmiana. Liczy sie obecnosc pola, nie jego tresc.
           */
          (taskId, prop) => {
            const pin = pinsRef.current.get(taskId);
            return Boolean(pin) && prop in pin!.fields;
          },
        );

        /*
         * Stan odniesienia podmieniamy OD RAZU, a nie przez `tasksRef` (ten
         * aktualizuje sie dopiero w efekcie, po renderze). Dwa pobrania pod rzad —
         * np. reczne odswiezenie w trakcie cichego — porownywalyby sie wtedy z tym
         * samym starym stanem i zapisaly te sama zmiane dwa razy.
         */
        seenRef.current = new Map(
          tasks.map((t) => [t.id, t as unknown as Record<string, unknown>]),
        );

        for (const c of changes) {
          logAction({
            at: Date.now(),
            /* Ten sam ksztalt co nasze wpisy — dzieki temu `describe` opisuje je
               tym samym slownikiem i z ta sama strzalka „z czego na co". */
            method: 'tasks.task.update',
            taskId: c.taskId,
            /* Surowy opis jako zapas — tak samo jak przy naszych wpisach. */
            label: describeAction('tasks.task.update', { fields: c.fields }),
            error: null,
            params: { fields: c.fields },
            before: c.before,
            source: 'bitrix',
          });
        }
      } else {
        /* Pierwsze pobranie: nie ma z czym porownywac, ale trzeba zapamietac punkt
           odniesienia — inaczej wykrywanie nigdy by nie ruszylo. */
        seenRef.current = new Map(
          tasks.map((t) => [t.id, t as unknown as Record<string, unknown>]),
        );
      }

      setData((prev) => {
        // Story pointy z poprzedniego przebiegu przenosimy po id — swieza lista z
        // `fetchTasks` ma je puste, a bez tego badge'y gaslyby na kazdej cichej
        // sondzie i zapalaly sie od nowa dopiero po tlowym dociagnieciu. Id zadan
        // sa globalne, wiec nie ma ryzyka podmiany miedzy projektami.
        const carried = new Map(prev.tasks.map((t) => [t.id, { sp: t.storyPoints, ep: t.epicId }]));
        return {
          /* Na koncu wlasne zapisy — patrz `applyPins`: lista bywa starsza od nich. */
          tasks: applyPins(
            tasks.map((t) => {
              const c = carried.get(t.id);
              return c ? { ...t, storyPoints: c.sp, epicId: c.ep } : t;
            }),
            pinsRef.current,
          ),
          stages,
          stageNames: new Map(stages.map((s) => [s.id, s.name])),
          stageOrder,
          stageMeta,
          labels,
          activeSprint,
          sprints: allSprints,
          backlogId,
          config,
          projects,
          epics,
          epicNames: new Map(epics.map((e) => [e.id, e])),
          groupId,
        };
      });

      /* Od tej chwili na ekranie sa PRAWDZIWE dane — spozniona migawka ma odpasc. */
      pobrano.current = true;

      /*
       * Migawka na nastepny start. Zapisujemy TO, CO WLASNIE PRZYSZLO, a nie stan
       * ze `setData` — ten jest asynchroniczny, wiec odczytany tu byl jeszcze
       * poprzedni. Story pointy dochodza osobno i dopisuja sie nizej, w callbacku
       * `fetchScrumMeta`.
       */
      void zapiszListe(groupId, {
        tasks,
        stages,
        stageNames: stages.map((s) => [s.id, s.name]),
        stageOrder: [...stageOrder],
        stageMeta: [...stageMeta],
        labels,
        activeSprint,
        sprints: allSprints,
        backlogId,
        config,
        projects,
        epics,
        epicNames: epics.map((e) => [e.id, e]),
        groupId,
      });

      /*
       * Scrumowe pola (story pointy + epik) dociagamy PO pierwszym renderze: to jedno
       * wywolanie na zadanie (~20 batchy dla ~1000 zadan), wiec blokowanie nimi startu
       * zabiloby szybki pierwszy obraz, o ktory cala ta sciezka walczy. Wyniki wpadaja
       * partiami i sa scalane po id; straznik `groupId` odrzuca je po przelaczeniu projektu.
       */
      void fetchScrumMeta(ids, (meta) => {
        setData((d) => {
          if (d.groupId !== groupId) return d;
          const zPolami = {
            ...d,
            tasks: applyPins(
              d.tasks.map((t) => {
                const m = meta.get(t.id);
                return m ? { ...t, storyPoints: m.storyPoints, epicId: m.epicId } : t;
              }),
              pinsRef.current,
            ),
          };
          /*
           * Migawka DOPISYWANA tutaj, a nie tylko wyzej. Story pointy i epiki
           * dochodza po pierwszym renderze, wiec zapisane wczesniej `tasks` nigdy
           * by ich nie mialy — a widok pogrupowany po epiku pokazywalby po
           * przeladowaniu wszystko w kubelku „Bez epika" i bez plakietek SP,
           * zeby po chwili przebudowac sie w prawdziwe grupy. Czyli migotanie
           * przesuniete, a nie usuniete.
           */
          void zapiszListe(groupId, zeStanu(zPolami));
          return zPolami;
        });
      })
        .catch(() => {
          /* Brak story pointow nie moze wywalic widoku — zostaja po prostu puste. */
        })
        .finally(() => setMetaGroup(groupId));
    } catch (e) {
      /*
       * Limit zapytan nie trafia na ekran bledu. `post` ponawia juz sam przez
       * jakies pol minuty; jesli mimo to tu doszlo, portal jest chwilowo zajety i
       * jedyne sensowne zachowanie to sprobowac znowu — bez straszenia czerwonym
       * komunikatem, bo nie ma w nim zadnej informacji do wykorzystania.
       *
       * Przy pierwszym uruchomieniu nie ma jeszcze czego pokazac, wiec spinner
       * zostaje zapalony — wyglada to na dluzsze ladowanie, czyli na to, czym jest.
       */
      if (isRateLimitError(e)) {
        retrying = true;
        retryRef.current = setTimeout(() => loadRef.current(silent), RATE_RETRY_MS);
        return;
      }
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      /* Przy ponowieniu spinner ZOSTAJE zapalony — to wciaz to samo ladowanie,
         tylko dluzsze. Zgaszenie go pokazaloby pusty widok jako gotowy. */
      if (!silent && !retrying) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Timer nie moze przezyc odmontowania — inaczej odpalilby pobranie w nicosc. */
  useEffect(
    () => () => {
      if (retryRef.current !== null) clearTimeout(retryRef.current);
    },
    [],
  );

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

      /*
       * NIE PRZENOSIMY zadan, dopoki na ekranie stoi migawka.
       *
       * Etapy maja identyfikatory WLASNE DLA SPRINTU (patrz `stageOrder`), wiec
       * migawka zapisana w poprzednim sprincie rysuje kolumny o numerach, ktore
       * juz nie istnieja albo naleza do zamknietego sprintu. Przeciagniecie karty
       * w tej jednej sekundzie przed nadejsciem swiezych danych wyslaloby zadanie
       * na martwy etap — w najlepszym razie blad i cofniecie, w gorszym zadanie
       * ladujace w zamknietym sprincie.
       *
       * Blokujemy WYLACZNIE ruchy (etap, sprint). Zmiana statusu, osoby czy
       * priorytetu nie zalezy od identyfikatorow z migawki, wiec nie ma powodu
       * jej wstrzymywac.
       */
      if (!pobrano.current && ('stageId' in patch || 'sprintId' in patch)) {
        toast('Poczekaj chwilę — lista jeszcze się wczytuje, kolumny mogą być z poprzedniego sprintu.');
        return;
      }

      const rollback = Object.fromEntries(
        Object.keys(patch).map((k) => [k, before[k as keyof Task]]),
      ) as Partial<Task>;

      /*
       * Dziennik dostaje stan SPRZED zmiany — zaraz nalozymy ja optymistycznie
       * i `data.tasks` bedzie juz niosl nowa wartosc. Patrz `notePrevious`.
       */
      notePrevious(id, before as unknown as Record<string, unknown>);
      /*
       * Zapisujemy TO, CO ZAPISUJEMY — dziennik potrzebuje tego, zeby nie ogłosic
       * naszej wlasnej zmiany jako cudzej, gdy lista nadgoni po wygasnieciu
       * pinezki. Patrz `noteMine`.
       */
      noteMine(id, patch as unknown as Record<string, unknown>);

      patchTasks(id, patch);
      /*
       * Pinezke zakladamy JUZ TERAZ, a nie po udanym zapisie: odswiezenie moze
       * wejsc w trakcie wywolania (recznemu nigdy nie odmawiamy), a wtedy stara
       * lista zdazylaby cofnac zmiane, zanim zdazymy jej bronic.
       */
      const pin = pinsRef.current.get(id);
      pinsRef.current.set(id, { at: Date.now(), fields: { ...pin?.fields, ...patch } });
      setPending((p) => new Set(p).add(id));

      try {
        const follow = await run();
        /*
         * Skutek zapisu wprowadzony przez SAM Bitrix — dzis status po przesunieciu
         * karty (patrz `moveToStage`). To wciaz nasza zmiana: zapisujemy ja jako
         * wlasna, zeby nie wrocila z nastepna lista jako „zmiana z zewnatrz", i
         * pokazujemy od razu, zamiast trzymac na ekranie stary status do odswiezenia.
         */
        if (follow && typeof follow === 'object') {
          const extra = follow as Partial<Task>;
          noteMine(id, extra as unknown as Record<string, unknown>);
          patchTasks(id, extra);
          const cur = pinsRef.current.get(id);
          pinsRef.current.set(id, { at: Date.now(), fields: { ...cur?.fields, ...extra } });
        }
      } catch (e) {
        patchTasks(id, rollback);
        /* Zapis sie nie udal — nie ma juz czego bronic przed serwerem. */
        const failed = pinsRef.current.get(id);
        if (failed) {
          for (const k of Object.keys(patch)) delete failed.fields[k as keyof Task];
          if (!Object.keys(failed.fields).length) pinsRef.current.delete(id);
        }
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
      /* Nieaktualna lista jeszcze przez chwile zwraca usuniete zadanie. */
      pinsRef.current.set(id, { at: Date.now(), fields: {}, gone: true });
      setPending((p) => new Set(p).add(id));

      try {
        await deleteTask(id);
      } catch (e) {
        pinsRef.current.delete(id);
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
    metaReady: metaGroup !== null && metaGroup === (project ?? data.groupId),
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

/*
 * ETAP jako klucz sortowania istnieje TYLKO w planowaniu.
 *
 * `taskComparator` go nie zna i nie moze: etap to kolumna konkretnego sprintu,
 * a kolejnosc kolumn siedzi w `stageOrder`, ktory jest stanem aplikacji, nie
 * wlasnoscia zadania. W planowaniu ma sens („najpierw to, co juz w toku"),
 * na liscie i tak grupuje sie po etapie.
 */
type PlanSortBy = SortBy | 'stage' | 'wysoki' | 'sp';

const SORTS: { key: SortBy; label: string }[] = [
  { key: 'updated', label: 'Zaktualizowane' },
  { key: 'created', label: 'Utworzone' },
  { key: 'priority', label: 'Priorytet' },
  { key: 'deadline', label: 'Termin' },
  { key: 'title', label: 'Tytuł' },
];

const PLAN_SORTS: { key: PlanSortBy; label: string }[] = [
  /*
   * Kolejnosc waznosci to TRZY OSOBNE POZIOMY, nie jeden zlozony klucz: priorytet
   * Bitriksa, potem tag „Wysoki", potem story pointy malejaco. Zwiniete w jedna
   * pozycje bylyby niewidoczne w liscie i nie dalo by sie poprawic zadnego z nich
   * z osobna — a przy planowaniu wlasnie tak sie z tym pracuje.
   */
  { key: 'wysoki', label: 'Tag „Wysoki”' },
  { key: 'sp', label: 'Story pointy' },
  { key: 'stage', label: 'Etap w sprincie' },
  ...SORTS,
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
  /* Bez grupowania: jedna grupa z PUSTA etykieta — render pomija wtedy naglowek,
     dokladnie tak jak przy wylaczonym podgrupowaniu. */
  if (by === 'flat') {
    return [{ key: '', label: '', order: 0, tasks: [...tasks].sort(taskComparator(sort, me)) }];
  }

  const buckets = new Map<string, Task[]>();

  const keyOf = (t: Task) =>
    by === 'stage'
      ? (stageOf(t) && stageNames.get(stageOf(t) as number)) || NO_SPRINT
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
function matchQuery(list: Task[], query: string, opisy?: Map<number, string> | null): Task[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return list;

  const asId = q.match(/^#?\s*(?:it[\s-]*)?(\d+)$/);
  if (asId) {
    const n = asId[1];
    const exact = list.filter((t) => t.code?.toLowerCase() === `it-${n}` || String(t.id) === n);
    if (exact.length) return exact;
  }

  /*
   * Kod, numer, tytul i tagi zawsze. Opisy TYLKO gdy ktos je pobral — nie ma ich
   * w `LIST_SELECT`, bo waza mniej wiecej tyle co cala reszta listy (`descCache`).
   */
  return list.filter(
    (t) =>
      `${t.code ?? ''} ${t.id} ${t.rawTitle} ${t.tags.join(' ')}`.toLowerCase().includes(q) ||
      (opisy?.get(t.id)?.includes(q) ?? false),
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

  if (c.field === 'observer') {
    // Zadanie ma ZBIOR obserwatorow, wiec te same operatory co przy tagach.
    const has = (v: string) => t.auditorIds.includes(Number(v));
    switch (c.op) {
      case 'allOf':
        return c.values.every(has);
      case 'noneOf':
        return !c.values.some(has);
      default: // anyOf
        return c.values.some(has);
    }
  }

  if (c.field === 'points') {
    const sp = t.storyPoints;

    // Progi: bierzemy JEDNA granice (picker jest przy nich jednokrotny). Zadanie
    // bez oszacowania odpada z obu — patrz NO_POINTS.
    if (c.op === 'between') {
      const lo = Number(c.values[0]);
      const hi = Number(c.values[1]);
      const hasLo = c.values[0] !== '' && Number.isFinite(lo);
      const hasHi = c.values[1] !== '' && Number.isFinite(hi);
      if (!hasLo && !hasHi) return true; // niedokonczony zakres nie zawezaja
      if (sp === null) return false;
      if (hasLo && sp < lo) return false;
      if (hasHi && sp > hi) return false;
      return true;
    }

    const key = sp === null ? NO_POINTS : String(sp);
    const inSet = c.values.includes(key);
    return c.op === 'isNot' ? !inSet : inSet;
  }

  if (c.field === 'deadline') {
    const off = t.deadline ? dayOffset(t.deadline) : null;

    if (c.op === 'between') {
      const lo = Number(c.values[0]);
      const hi = Number(c.values[1]);
      const hasLo = c.values[0] !== '' && Number.isFinite(lo);
      const hasHi = c.values[1] !== '' && Number.isFinite(hi);
      if (!hasLo && !hasHi) return true;
      // Zadanie BEZ terminu nie wpada w zaden zakres — tak samo jak zadanie bez
      // oszacowania nie wpada w zakres pointow. Brak terminu to brak danych.
      if (off === null) return false;
      if (hasLo && off < lo) return false;
      if (hasHi && off > hi) return false;
      return true;
    }

    const key = off === null ? NO_DEADLINE : String(off);
    const inSet = c.values.includes(key);
    return c.op === 'isNot' ? !inSet : inSet;
  }

  // Wymiary jednowartosciowe: wyliczamy klucz zadania (osoba po id, reszta wprost)
  // i sprawdzamy przynaleznosc; `isNot` odwraca wynik.
  const key =
    c.field === 'assignee'
      ? isUnassigned(t.responsibleId)
        ? String(UNASSIGNED_ID)
        : String(t.responsibleId)
      : // Autor NIE dostaje zaslepki "Nieprzypisane": zadanie zawsze ktos zalozyl,
        // a konto-zaslepka bywa autorem naprawde i wtedy ma znaczyc siebie.
        c.field === 'creator'
        ? String(t.creatorId)
        : c.field === 'priority'
        ? t.priority
        : c.field === 'status'
          ? t.status
          : c.field === 'epic'
            ? String(t.epicId ?? 0) // 0 = bez epika
            : (stageOf(t) && stageNames.get(stageOf(t) as number)) || ''; // stage — po nazwie
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
    <HoverNote label="Story points" value={`${sp} SP`} note="w grupie" className="head-sp">
      {sp} SP
    </HoverNote>
  );
}

/**
 * Popover zakresu story pointow: dwa pola liczbowe "od" i "do".
 *
 * Osobny komponent, bo `Picker` jest z natury LISTA wartosci, a zakres to dwie
 * liczby, ktore nie musza wystapic w danych ("od 3 do 8" ma dzialac tez wtedy,
 * gdy nikt nie oszacowal zadania na 7). Chrom (tlo + ramka) jest ten sam, wiec
 * z zewnatrz zachowuje sie jak kazdy inny popover paska filtrow.
 *
 * Obie granice sa OPCJONALNE: samo "od" znaczy "co najmniej", samo "do" —
 * "co najwyzej". Puste oba = warunek nie zawezaja niczego.
 */
function RangeMenu({
  anchor,
  scale,
  from,
  to,
  onChange,
  title,
  markAt,
  markLabel,
  format,
  emptyLabel,
  onUnestimated,
  onClose,
}: {
  anchor: Anchor;
  /** Rosnaca lista story pointow OBECNYCH w danych — patrz komentarz o skali nizej. */
  scale: number[];
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Naglowek panelu — inaczej kazdy zakres przedstawia sie jako "Story points". */
  title: string;
  /** Indeks na skali, ktory dostaje kreske odniesienia (dzis). `undefined` = brak. */
  markAt?: number;
  markLabel?: string;
  /**
   * Jak podpisac wartosc ze skali. Story pointy sa czytelne same z siebie ("8"),
   * termin juz nie — "-7" nie znaczy nic, musi byc "7 dni po terminie".
   */
  format?: (v: number) => string;
  /** Podpis przycisku zaslepki: "Tylko bez oszacowania" / "Tylko bez terminu". */
  emptyLabel: string;
  /** Przejscie na zaslepke — to NIE jest zakres, wiec zmienia takze operator. */
  onUnestimated: () => void;
  onClose: () => void;
}) {
  const width = 268;
  /* Docisk z OBU stron: kotwica bywa blisko lewej krawedzi, a samo `min`
     chronilo tylko prawa i panel wychodzil poza ekran. */
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 190);

  /*
   * Suwak chodzi po INDEKSACH skali, nie po samej liczbie pointow.
   *
   * Estymaty nie sa rozlozone rowno: w tym portalu to 1..10, potem 12, 16, 20,
   * 24, 32, 40 i 120. Na osi liniowej 1-120 wszystko, czego uzywa sie naprawde,
   * scisnelo by sie w pierwszych ~8% toru, a jeden odstajacy rekord decydowalby
   * o czulosci calej reszty. Po indeksach kazdy stopien skali dostaje tyle samo
   * miejsca, a podpisy i tak pokazuja prawdziwe liczby.
   */
  const last = Math.max(0, scale.length - 1);
  const idxOf = (v: string, fallback: number) => {
    if (v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    // Najblizszy istniejacy stopien — granica wpisana recznie (np. 7) nie musi
    // pokrywac sie ze skala, a kciuk musi gdzies stanac.
    let best = fallback;
    let dist = Infinity;
    scale.forEach((sv, i) => {
      const d = Math.abs(sv - n);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };

  /*
   * Pozycja kciukow W TRAKCIE ciagniecia siedzi lokalnie i NIE rusza filtra.
   * Filtr przelicza sie dopiero po puszczeniu (pointerup/keyup): przy 1136
   * zadaniach kazdy piksel przeciagniecia oznaczalby pelne przefiltrowanie,
   * przegrupowanie i przerysowanie listy, wiec suwak szarpalby sie pod palcem.
   * Sam suwak i podpisy chodza plynnie, bo czytaja ten lokalny stan.
   */
  const [drag, setDrag] = useState<[number, number] | null>(null);

  const lo = drag ? drag[0] : idxOf(from, 0);
  const hi = drag ? drag[1] : idxOf(to, last);

  // Pelen rozstaw = brak ograniczenia, wiec zapisujemy granice otwarte — inaczej
  // chip krzyczalby "1-120 SP" o filtrze, ktory niczego nie odsiewa.
  const openLo = (i: number) => (i === 0 ? '' : String(scale[i]));
  const openHi = (i: number) => (i === last ? '' : String(scale[i]));

  // Kciuki nie moga sie minac — para zawsze idzie posortowana.
  const move = (a: number, b: number) => setDrag([Math.min(a, b), Math.max(a, b)]);

  const commit = () => {
    if (!drag) return;
    onChange(openLo(drag[0]), openHi(drag[1]));
    // Czyscimy dopiero PO zapisie: nastepny render czyta juz te same wartosci
    // z propsow, wiec kciuk nie mrugnie w stara pozycje.
    setDrag(null);
  };

  const pct = (i: number) => (last === 0 ? 0 : (i / last) * 100);
  const clean = (v: string) => v.replace(/[^0-9]/g, '');

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="picker range-menu" style={{ left, top, width }}>
        <div className="picker-title">{title}</div>

        {scale.length > 1 && (
          <div className={`range-slider${markAt !== undefined ? ' range-slider-marked' : ''}`}>
            <span className="range-track" />
            {/*
              Kreska ZERA na torze. Bez niej suwak terminu nie ma punktu odniesienia:
              zakres siega od "90 dni po terminie" do "za 90 dni", a granica miedzy
              przeszloscia a przyszloscia jest tu najwazniejsza i nie lezy posrodku
              (skala jest nierowna), wiec nie da sie jej wyliczyc z oka.
            */}
            {markAt !== undefined && markAt >= 0 && (
              <span className="range-zero" style={{ left: `${pct(markAt)}%` }}>
                <span className="range-zero-label">{markLabel}</span>
              </span>
            )}
            <span
              className="range-fill"
              style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
            />
            {/* Dwa natywne suwaki na sobie: klawiatura i czytniki ekranu dostaja
                je za darmo, a nakladanie zalatwia pointer-events w arkuszu. */}
            <input
              type="range"
              min={0}
              max={last}
              value={lo}
              aria-label={format ? 'Termin od' : 'Story points od'}
              onChange={(e) => move(Number(e.target.value), hi)}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
            />
            <input
              type="range"
              min={0}
              max={last}
              value={hi}
              aria-label={format ? 'Termin do' : 'Story points do'}
              onChange={(e) => move(lo, Number(e.target.value))}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
            />
          </div>
        )}

        {format ? (
          /*
           * Przy terminie pola liczbowe nie maja sensu: granica bywa UJEMNA
           * ("7 dni po terminie"), a `clean` i tak zdejmuje minus przy wpisywaniu.
           * Zostaje sam odczyt tego, co ustawily kciuki — suwak jest tu jedynym
           * sposobem wyboru i w zupelnosci wystarcza.
           */
          <div className="range-row range-read">
            {lo === 0 && hi === last ? 'dowolny' : `${format(scale[lo])} – ${format(scale[hi])}`}
          </div>
        ) : (
        <div className="range-row">
          <label className="range-field">
            <span>od</span>
            <input
              className="picker-input"
              inputMode="numeric"
              /* W trakcie ciagniecia pole pokazuje to, co WLASNIE zostanie
                 zapisane — inaczej podpis stoi na starej wartosci do puszczenia. */
              value={drag ? openLo(drag[0]) : from}
              placeholder={scale.length ? String(scale[0]) : ''}
              onChange={(e) => onChange(clean(e.target.value), to)}
              onKeyDown={(e) => e.key === 'Enter' && onClose()}
            />
          </label>
          <label className="range-field">
            <span>do</span>
            <input
              className="picker-input"
              inputMode="numeric"
              value={drag ? openHi(drag[1]) : to}
              placeholder={scale.length ? String(scale[last]) : ''}
              onChange={(e) => onChange(from, clean(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && onClose()}
            />
          </label>
        </div>
        )}

        {/*
          Skrot do zadan BEZ oszacowania. Musi byc tutaj, bo zakres jest domyslnym
          operatorem story pointow, a brak oszacowania nie miesci sie w zadnym
          zakresie (patrz NO_POINTS) - bez tego przycisku trzeba by wiedziec, ze
          trzeba najpierw przelaczyc operator na "to".
        */}
        <button type="button" className="range-none" onClick={onUnestimated}>
          {emptyLabel}
        </button>
      </div>
    </>
  );
}

function ViewsMenu({
  anchor,
  views,
  activeId,
  editingId,
  onApply,
  onDelete,
  onSave,
  onUpdate,
  onReorder,
  onClose,
  autoFocusInput = true,
  showKeys = false,
  hover = false,
  onHoverIn,
  onHoverOut,
}: {
  anchor: Anchor;
  views: SavedView[];
  activeId: string | null;
  /**
   * Widok ZASTOSOWANY, czyli ten, ktory uzytkownik edytuje. Rozni sie od `activeId`
   * dokladnie wtedy, gdy cos juz zmienil — i tylko wtedy ma sens aktualizacja.
   */
  editingId: string | null;
  onApply: (v: SavedView) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
  onUpdate: (id: string) => void;
  /** Zmiana kolejnosci: widok z pozycji `from` ląduje na pozycji `to`. */
  onReorder: (from: number, to: number) => void;
  onClose: () => void;
  /** Menu otwarte najechaniem NIE zabiera focusu — inaczej kradnie klawiature mimochodem. */
  autoFocusInput?: boolean;
  /** Pokaz numery klawiszy 1-9 przy widokach (menu otwarte z klawiatury). */
  showKeys?: boolean;
  /** Otwarte najechaniem — bez tla na caly ekran (patrz nizej). */
  hover?: boolean;
  /** Kursor wrocil nad menu — odwolaj zaplanowane zamkniecie. */
  onHoverIn?: () => void;
  /** Kursor zszedl z menu — zaplanuj zamkniecie. */
  onHoverOut?: () => void;
}) {
  const [name, setName] = useState('');
  /*
   * Przeciagana pozycja i ta, nad ktora wisi kursor. Natywny HTML5 drag&drop, a nie
   * `@dnd-kit` jak na tablicy: tam chodzi o przenoszenie miedzy kolumnami z podgladem
   * pod kursorem, tu o przestawienie kilku wierszy w jednej liscie. Dociaganie calego
   * `DndContext` do popovera byloby wiecej kodu niz sama funkcja.
   *
   * Kolejnosc NIE jest kosmetyczna: `v` + 1-9 stosuje widok o danym NUMERZE, wiec
   * przestawienie listy przestawia tez skroty.
   */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const width = 260;
  const left = Math.max(12, Math.min(anchor.left + 32, window.innerWidth - width - 12));
  const top = anchor.bottom + 4;

  // Biezacy uklad juz odpowiada zapisanemu widokowi (activeId). Zapisywanie go pod
  // nowa nazwa dawaloby duplikat o identycznym „odcisku" — fingerprint dopasowuje
  // wtedy PIERWSZY z nich, wiec drugiego nie da sie potem zaznaczyc. Blokujemy zapis.
  const activeName = views.find((v) => v.id === activeId)?.name ?? null;
  const alreadySaved = activeId != null;

  /*
   * Trzeci stan paska zapisu: widok zastosowany, ale JUZ ZMIENIONY. Poznajemy go po
   * tym, ze pamietamy edytowany widok, a odcisk biezacego ukladu do niego nie pasuje
   * (`activeId` jest wtedy pusty albo wskazuje inny widok).
   *
   * Bez tego jedynym wyjsciem bylo zapisanie kopii pod nowa nazwa albo skasowanie
   * starego widoku i zalozenie go od zera.
   *
   * Warunek `activeId == null` NIE jest tylko skrotem na "uklad sie zmienil". Gdy
   * biezacy uklad pasuje do JAKIEGOKOLWIEK zapisanego widoku, aktualizacja jest
   * zabroniona — inaczej mozna doprowadzic edytowany widok do ksztaltu INNEGO
   * widoku i zrobic dwa wpisy o identycznym odcisku. Dopasowanie po odcisku bierze
   * wtedy PIERWSZY z nich, wiec drugiego nie da sie juz nigdy zaznaczyc. Dokladnie
   * przed tym broni `alreadySaved` przy zapisie; tu potrzebna jest ta sama bariera.
   *
   * Przy okazji zalatwia to powrot do stanu wyjsciowego: gdy cofniesz zmiany recznie,
   * `activeId` znow wskazuje ten widok, przycisk znika i pasek mowi "juz zapisany".
   */
  const edited = activeId == null ? (views.find((v) => v.id === editingId) ?? null) : null;

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
      {/*
        Kursor pilnujemy WYLACZNIE w trybie hover. Menu otwarte KLIKIEM nie ma
        prawa reagowac na ruch myszy: zamyka je klik w tlo, Esc albo wybor widoku.

        Wczesniej te dwa uchwyty wisialy zawsze i menu otwarte klikiem znikalo od
        przypadkowego `mouseleave` — wystarczylo przejechac nad polem nazwy. Tlo
        na caly ekran, przelaczany `disabled` na inpucie i 4-pikselowa szpara
        miedzy przyciskiem a panelem daja kilka roznych sposobow, zeby taki
        `mouseleave` powstal, wiec zamiast lapac je po kolei odbieramy trybowi
        klikanemu cala te sciezke.
      */}
      <div
        className="picker"
        style={{ left, top, width }}
        onMouseEnter={hover ? onHoverIn : undefined}
        onMouseLeave={hover ? onHoverOut : undefined}
      >
        <div className="picker-title">Widoki</div>
          {/* Nazwa widoku SIEDZI W PRZYCISKU, bo nadpisania nie da sie cofnac —
            "Zaktualizuj" samo w sobie pozwalaloby nadpisac nie ten widok. */}
        {edited && (
          <button
            className="btn view-update"
            title={`Zapisz biezacy uklad w widoku „${edited.name}"`}
            onClick={() => {
              onUpdate(edited.id);
              onClose();
            }}
          >
            Zaktualizuj „{edited.name}"
          </button>
        )}
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
          {views.map((v, i) => (
            <div
              key={v.id}
              className={`view-item${v.id === activeId ? ' view-item-on' : ''}${
                dragOver === i && dragFrom !== null && dragFrom !== i ? ' view-item-drop' : ''
              }${dragFrom === i ? ' view-item-dragging' : ''}`}
              onDragOver={(e) => {
                // `preventDefault` na dragover to JEDYNY sposob, zeby element
                // zglosil sie jako cel upuszczenia — bez niego `drop` nie leci.
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOver !== i) setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
            >
              {/*
                Przeciaganie startuje TYLKO z uchwytu, nie z calego wiersza. Gdy
                `draggable` siedzialo na wierszu, kazde chwycenie nazwy groziło
                przeciagnieciem zamiast klikniecia — a nazwa jest tu przyciskiem.
              */}
              <span
                className="view-grip"
                title="Przeciągnij, aby zmienić kolejność (numery skrótów idą za nią)"
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  // Bez tego Firefox nie zaczyna przeciagania w ogole.
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <GripIcon />
              </span>
              <button className="view-apply" onClick={() => onApply(v)}>
                <span className="picker-label">{v.name}</span>
                {/* Numer klawisza tylko przy pierwszych dziewieciu - dalej nie ma juz
                    cyfry, wiec podpowiedz bylaby klamstwem. Chowamy go tez, gdy menu
                    otwarto klikiem w pole nazwy: cyfry naleza wtedy do pola. */}
                {i < 9 && showKeys && <span className="view-key">{i + 1}</span>}
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
 * Selektor zakresu (Sprint / Poza sprintem / Wszystkie) — zwykla lista rozwijana:
 * przycisk z biezaca wartoscia, pod nim opcje z ptaszkiem przy wybranej.
 *
 * Byla tu kiedys karuzela (sasiedzi nad i pod przyciskiem). Wyleciala, bo "co jest
 * teraz wybrane" trzeba bylo wyczytac z ulozenia elementow zamiast z ptaszka.
 *
 * KOLKO ZOSTAJE. To byl osobny mechanizm od samego ukladu i jedyny sposob, zeby
 * przeskoczyc zakres bez otwierania listy — zdjete razem z karuzela tylko dlatego,
 * ze siedzialo w tym samym komponencie.
 */
function ScopePicker({
  scope,
  scopes,
  counts,
  activeSprint,
  onPick,
  blokada,
}: {
  scope: Scope;
  scopes: typeof SCOPES;
  counts: Record<Scope, number>;
  activeSprint: { name: string; dateStart: string | null; dateEnd: string | null } | null;
  onPick: (s: Scope) => void;
  /**
   * Powod, dla ktorego zakres jest nieczynny — albo `null`, gdy dziala.
   *
   * ZOSTAWIAMY wszystkie opcje i tylko odcinamy klikanie. Wyciecie ich z listy
   * kazaloby sie zastanawiac, czy zniknely na stale i czy czegos sie nie zepsulo;
   * nieczynny przelacznik z wyjasnieniem odpowiada na to od razu.
   */
  blokada: string | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const n = scopes.length;
  const sel = Math.max(
    0,
    scopes.findIndex((s) => s.key === scope),
  );
  const cur = scopes[sel] ?? scopes[0];

  /*
   * Kolko myszy przeskakuje zakres — jeden krok na „zabkowanie", takze na
   * ZWINIETYM przycisku, wiec da sie zmienic sprint bez otwierania listy.
   *
   * Listener natywny z `passive: false`, bo tylko taki moze zatrzymac przewijanie
   * strony; React montuje `onWheel` jako pasywny i `preventDefault` nic tam nie
   * daje. Przy jednym zakresie nie ruszamy niczego — wtedy kolko nalezy do strony.
   *
   * `acc` zbiera deltaY do progu, bo gladzik sypie dziesiatkami drobnych zdarzen
   * i bez tego jeden ruch palcem przewijalby przez wszystkie zakresy naraz.
   *
   * `selRef` trzyma biezaca pozycje, zeby listener nie przepinal sie przy kazdej
   * zmianie zakresu — inaczej `addEventListener`/`removeEventListener` chodzilyby
   * w kolko przy samym przewijaniu.
   */
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

  return (
    <div className={`scope-picker-wrap${open ? ' scope-open' : ''}`} ref={wrapRef}>
      {open && <div className="picker-backdrop" onClick={() => setOpen(false)} />}

      {/*
        Gdy zakres jest nieczynny, przycisk zostaje na miejscu i wyglada tak samo,
        tylko przygaszony i nieklikalny — a dymek mowi DLACZEGO. `HoverNote`
        opakowuje go w element, ktory nadal lapie kursor, wiec wyjasnienie da sie
        przeczytac mimo zablokowanego przycisku.
      */}
      <HoverNote
        className="scope-picker-note"
        label={blokada ? 'Zakres nieczynny' : undefined}
        value={blokada ?? 'Zakres'}
        note={blokada ? 'w tym widoku' : undefined}
      >
        <button
          className={`scope-picker${open ? ' scope-picker-open' : ''}${blokada ? ' scope-picker-locked' : ''}`}
          disabled={Boolean(blokada)}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="scope-picker-label">{labelFor(cur)}</span>
          {dates(cur.key)}
          <span className="segment-count">{counts[cur.key]}</span>
          <ChevronIcon open={open} />
        </button>
      </HoverNote>

      {open && (
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
/** Szerokosc elementu na zywo — ResizeObserver, bo zalezy tez od panelu bocznego. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  /*
   * Odczyt OD RAZU po ulozeniu, a nie tylko przez obserwatora.
   *
   * Sam `ResizeObserver` zostawal z zerem: lapal element, zanim uklad policzyl
   * mu szerokosc, a pozniejsze ulozenie nie zawsze wywoluje kolejne zgloszenie.
   * Dlugo tego nie bylo widac, bo `tagsForWidth(0)` oddawalo wtedy 2 chipy —
   * liczba na tyle sensowna, ze wygladala na wynik pomiaru. Dopiero obnizenie
   * dolnego progu do zera pokazalo, ze pomiaru nigdy nie bylo.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
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

const SearchBox = forwardRef<
  SearchHandle,
  {
    onChange: (q: string) => void;
    /**
     * Stan szukania w opisach — cztery, bo „wlaczone" i „ma dane" to nie to samo:
     * `brak` znaczy, ze ustawienie jest wlaczone, ale opisy TEGO projektu nie sa
     * jeszcze pobrane, wiec odznaka musi byc zgaszona.
     */
    stanOpisow: 'off' | 'on' | 'brak' | 'pobieranie';
    /** Klikniecie odznaki: dociaga opisy albo wylacza szukanie w nich. */
    onOpisy: () => void;
  }
>(function SearchBox({ onChange, stanOpisow, onOpisy }, ref) {
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
        {/*
          Przelacznik stoi W POLU, a nie w ustawieniach, bo to decyzja podejmowana
          w trakcie szukania („nie ma tego w tytulach — zajrzyj glebiej"), a nie raz
          na zawsze. Napis zamiast ikony: „opisy" czyta sie wprost, a kazda ikona
          tego znaczenia wymagalaby legendy.
        */}
        <HoverNote
          label="Szukanie w opisach"
          value={
            { off: 'wyłączone', on: 'włączone', brak: 'brak danych', pobieranie: 'pobieram…' }[
              stanOpisow
            ]
          }
          note={
            {
              off: 'kliknij, by pobrać opisy (~1,9 MB, raz na projekt)',
              on: 'fraza trafia w tytuły i w treść opisów',
              brak: 'opisy tego projektu nie są jeszcze pobrane — kliknij',
              pobieranie: 'zaraz będzie gotowe',
            }[stanOpisow]
          }
        >
          <button
            type="button"
            className={`search-opisy${stanOpisow === 'on' ? ' is-on' : ''}`}
            aria-pressed={stanOpisow === 'on'}
            disabled={stanOpisow === 'pobieranie'}
            /* Bez tego klikniecie zabiera kursor z pola i trzeba w nie wracac. */
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpisy}
          >
            opisy
          </button>
        </HoverNote>
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

/** Tag Bitriksa. Odcien wyliczany z nazwy, wiec dla danego tagu stale ten sam. */
function Tag({ name, onPick }: { name: string; onPick?: (name: string) => void }) {
  const body = (
    <>
      <span className="tag-dot" style={{ background: tagHue(name) }} />
      {name}
    </>
  );
  /*
   * Bez akcji to NIE jest przycisk. Wczesniej zawsze byl — a w panelu szczegolow
   * tagi siedza wewnatrz klikalnego pola (`FieldButton`), wiec wychodzil
   * `<button>` w `<button>`: nieprawidlowy HTML, przy ktorym przegladarka potrafi
   * wyciagnac wewnetrzny element na zewnatrz i klik trafia nie tam, gdzie trzeba.
   */
  if (!onPick) {
    return (
      <span className="tag" title={name}>
        {body}
      </span>
    );
  }
  return (
    <button
      className="tag"
      title={`Filtruj po tagu: ${name}`}
      onClick={(e) => {
        e.stopPropagation(); // klik w tag nie ma otwierac zadania
        onPick(name);
      }}
    >
      {body}
    </button>
  );
}

// ─── Wiersz ──────────────────────────────────────────────────────────────────

/**
 * Czy praca jest JUZ ODDANA — a wiec termin nikogo nie goni.
 *
 * Zamkniete (5) i oddane do kontroli (4). Wczesniej tonu pozbawialo tylko 5, wiec
 * zadanie czekajace na czyjas akceptacje swiecilo gleboka czerwienia i liczylo
 * „7 dni po", choc autor zrobil swoje i nie ma juz czego przyspieszac. Licznik
 * rosl przy tym codziennie, mimo ze po stronie zadania nic sie nie dzialo — i to
 * bylo w tym najbardziej mylace. Alarm ma dotyczyc pracy, ktora ktos jeszcze musi
 * wykonac.
 *
 * Ta sama granica co przy mocach w planowaniu: „czeka na kontrole" liczy sie jak
 * zrobione, bo nie zajmie juz niczyjego czasu.
 */
const oddane = (status: string) => CLOSED_STATUSES.has(status) || REVIEW_STATUSES.has(status);

/**
 * Termin w postaci do wiersza: krotka etykieta i ton pilnosci.
 *
 * Etykieta mowi to, co przy wierszu najwazniejsze: ile po terminie, a przy
 * bliskim — „dziś" / „jutro". Dalszy termin to po prostu data. Ton dostaja
 * wylacznie terminy pilne, i nigdy praca juz oddana (patrz `oddane`): jej termin
 * niczego nie wymaga, a rosnacy licznik spoznienia klamalby o stanie zadania.
 */
/** Pelne dni KALENDARZOWE od `od` do `do_`; dodatnie = `do_` jest pozniej. */
function dniKalendarzowe(od: string, do_: string): number | null {
  const a = new Date(od);
  const b = new Date(do_);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const polnoc = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((polnoc(b) - polnoc(a)) / 86400000);
}

/**
 * Kiedy praca zostala ODDANA wzgledem terminu — „oddane 1 dzień po terminie".
 *
 * Moment bierzemy z `closedDate`, ktore Bitrix ustawia, gdy wykonawca konczy
 * zadanie — takze wtedy, gdy trafia ono najpierw do kontroli, a nie wprost do
 * zamkniecia (sprawdzone na 50 zadaniach: `closedDate` co do minuty rowna sie
 * `statusChangedDate`, a pole i tak przychodzi razem z lista, wiec nic nie kosztuje).
 *
 * To odpowiedz na pytanie, ktorego rosnacy licznik „N dni po" nie umial dac:
 * spoznienie zamyka sie w chwili oddania i nie rosnie dalej.
 */
function opisOddania(deadline: string, oddaneDnia: string): string | null {
  const dni = dniKalendarzowe(deadline, oddaneDnia);
  if (dni === null) return null;
  const n = Math.abs(dni);
  const unit = n === 1 ? 'dzień' : 'dni';
  const kiedy = shortDate(oddaneDnia);
  if (dni > 0) return `oddane ${n} ${unit} po terminie (${kiedy})`;
  if (dni === 0) return `oddane w dniu terminu (${kiedy})`;
  return `oddane ${n} ${unit} przed terminem (${kiedy})`;
}

function dueInfo(
  deadline: string,
  zrobione: boolean,
  /** `closedDate` zadania — moment oddania pracy. */
  oddaneDnia?: string | null,
): { label: string; tone: '' | 'late' | 'soon'; distance: string; title: string; days: number } {
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return { label: '', tone: '', distance: '', title: '', days: 0 };
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(end) - midnight(new Date())) / 86400000);

  /*
   * Praca oddana: SAMA DATA, bez „dziś", „jutro" i bez licznika spoznienia.
   * „12 wrz" jest faktem, „7 dni po" — ocena, ktora tu nie ma juz adresata.
   *
   * Pod kursorem mowimy natomiast, KIEDY zostala oddana wzgledem terminu — bo to
   * jest pytanie, ktore przy zamknietym zadaniu ma sens.
   */
  if (zrobione) {
    const oddanie = oddaneDnia ? opisOddania(deadline, oddaneDnia) : null;
    const distance = oddanie ?? (days < 0 ? 'termin minął' : 'przed terminem');
    return {
      label: shortDate(deadline),
      tone: '',
      distance,
      days,
      title: `Termin: ${shortDate(deadline)} · ${distance}`,
    };
  }

  const label =
    days < 0 ? `${-days} ${days === -1 ? 'dzień' : 'dni'} po` : days === 0 ? 'dziś' : days === 1 ? 'jutro' : shortDate(deadline);
  const tone = days < 0 ? 'late' : days <= 1 ? 'soon' : '';
  /*
   * Podpowiedz niesie ODLEGLOSC w dniach — w wierszu jest tylko data albo kolor,
   * a „ile jeszcze / ile po" trzeba bylo liczyc w glowie. „dzień" tylko przy
   * jedynce; od dwoch wzwyz zawsze „dni".
   */
  const n = Math.abs(days);
  const unit = n === 1 ? 'dzień' : 'dni';
  const distance =
    days < 0 ? `${n} ${unit} po terminie` : days === 0 ? 'dziś' : days === 1 ? 'jutro' : `za ${n} ${unit}`;
  return { label, tone, distance, days, title: `Termin: ${shortDate(deadline)} · ${distance}` };
}

/**
 * Kolor odleglosci w karcie — ta sama paleta co dopisek „plan" na wykresie
 * (`paceFill`): zielen (hsl 145) dla zapasu, czerwien (hsl 5) dla spoznienia,
 * zmieszane z przygaszonym kolorem, zeby nie krzyczaly. Dzis i jutro zostaja
 * pomaranczowe, jak w wierszu. Praca oddana nie ma juz czego pilnowac.
 */
function dueFill(days: number, zrobione: boolean): string {
  if (zrobione) return 'var(--fg-dim)';
  if (days <= 1 && days >= 0) return 'var(--accent-orange)';
  if (days < 0) {
    /* Im dluzej po terminie, tym mocniej — od ok. 35% do sufitu wykresu (65%). */
    const t = Math.min(65, 30 + -days * 5);
    return `color-mix(in oklab, hsl(5 52% 55%) ${t}%, var(--fg-dim))`;
  }
  return 'color-mix(in oklab, hsl(145 52% 55%) 45%, var(--fg-dim))';
}

/**
 * Termin pod kursorem — wspolna karta (`HoverNote`) z trescia terminu.
 */
function DueHover({
  deadline,
  zrobione,
  oddaneDnia,
  className,
  children,
}: {
  deadline: string;
  /** Praca oddana — patrz `oddane`. Termin traci wtedy ton i licznik. */
  zrobione: boolean;
  /** `closedDate` — moment oddania. Dzieki niemu karta mowi, czy zdazono. */
  oddaneDnia?: string | null;
  className: string;
  children: ReactNode;
}) {
  const due = dueInfo(deadline, zrobione, oddaneDnia);
  /*
   * Oddane PO terminie dostaje przygaszona czerwien, nie szarosc: to nadal fakt
   * o spoznieniu, tylko zamkniety — ma dac sie zauwazyc przy przegladaniu, ale
   * nie krzyczec jak termin, ktory wciaz leci.
   */
  const spoznione = zrobione && oddaneDnia !== null && oddaneDnia !== undefined
    ? (dniKalendarzowe(deadline, oddaneDnia) ?? 0) > 0
    : false;
  return (
    <HoverNote
      label="Termin"
      value={shortDate(deadline)}
      note={due.distance}
      noteColor={
        spoznione ? 'color-mix(in oklab, hsl(5 52% 55%) 45%, var(--fg-dim))' : dueFill(due.days, zrobione)
      }
      className={className}
    >
      {children}
    </HoverNote>
  );
}

function TaskRow({
  task,
  fraza,
  deadlineLook,
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
  /** Szukana fraza — do podswietlenia trafienia w tytule. */
  fraza: string;
  deadlineLook: DeadlineLook;
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
      <TaskCode code={task.code ?? `#${task.id}`} copy={task.code ?? String(task.id)} onCopied={onCopied} />
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

      <span className="row-title">
        {podzielNaTrafienia(task.title || task.rawTitle, fraza).map((k, i) =>
          k.hit ? <mark key={i}>{k.text}</mark> : k.text,
        )}
      </span>

      {/* Epik ZAWSZE przed tagami: nalezy do zadania na stale, a tagi przychodza
          i znikaja — stojac za nimi skakal w bok przy kazdej zmianie etykiet.
          Klik fi klik filtruje liste po tym epiku. */}
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
      {/* Liczba tagow w wierszu zalezy od szerokosci listy — reszta jako "+N". */}
      {task.tags.length > 0 && <TagStrip tags={task.tags} limit={tagLimit} onPick={onTag} />}


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
        <HoverNote label="Story points" value={task.storyPoints} className="row-sp">
          {task.storyPoints}
        </HoverNote>
      )}

      {deadlineLook === 'chip' ? (
        <>
          {/*
            Slot terminu ZAWSZE zajety, takze bez terminu. Inaczej tytuly w kolejnych
            wierszach konczylyby sie w roznych miejscach i prawa kolumna skakalaby
            za kazdym zadaniem, ktore termin ma.
          */}
          {(() => {
            if (!task.deadline) return <span className="row-due" />;
            const due = dueInfo(task.deadline, oddane(task.status));
            return (
              <DueHover
                deadline={task.deadline}
                zrobione={oddane(task.status)}
                oddaneDnia={task.closedDate}
                className={`row-due${due.tone ? ` due-${due.tone}` : ''}`}
              >
                <CalendarIcon />
                {due.label}
              </DueHover>
            );
          })()}
          <span className="row-meta" title="Ostatnia zmiana">
            {shortDate(task.changedDate)}
          </span>
        </>
      ) : deadlineLook === 'off' ? (
        /* Bez wyroznienia: jedna data, bez ikony i bez koloru — dokladnie to, co
           bylo tu wczesniej. Termin wciaz bije date zmiany, bo to on jest
           terminem; roznicy po prostu nie widac. */
        <span className="row-meta">{shortDate(task.deadline || task.changedDate)}</span>
      ) : task.deadline ? (
        /* Jedno miejsce jak dotad, ale termin ma ikone i jasniejszy kolor —
           data zmiany zostaje przygaszona, wiec widac, ktora jest ktora. Pilny
           termin barwi sie tak samo jak w wariancie z zetonem. */
        <DueHover
          deadline={task.deadline}
          zrobione={oddane(task.status)}
          oddaneDnia={task.closedDate}
          className={`row-meta row-deadline${(() => {
            const tone = dueInfo(task.deadline, oddane(task.status)).tone;
            return tone ? ` due-${tone}` : '';
          })()}`}
        >
          <CalendarIcon />
          {shortDate(task.deadline)}
        </DueHover>
      ) : (
        <span className="row-meta" title="Ostatnia zmiana">
          {shortDate(task.changedDate)}
        </span>
      )}

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

/**
 * Podglad obrazka na pelnym ekranie. Otwiera sie z komentarza i chodzi po WSZYSTKICH
 * obrazkach watku, nie tylko po tym jednym — skoro sie juz oglada, to zwykle po kolei.
 *
 * Renderowany portalem do `body`: panel zadania ma wlasne przewijanie i `overflow`,
 * wiec podglad zostawiony w srodku dalby sie przyciac wlasnym rodzicem.
 */
export interface PreviewItem {
  key: string;
  name: string;
  /** Gotowy adres. Komentarze biora `/api/file/`, zalaczniki `/api/attach/` — to
      dwie rozne metody Bitriksa, wiec podglad dostaje juz rozstrzygniety adres. */
  src: string;
}

function Lightbox({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: PreviewItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const file = files[index];

  /*
   * Powiekszenie. `zoom` 1 = obrazek wpasowany w ekran (nie skala 1:1 pikseli),
   * `pan` to przesuniecie w pikselach EKRANU, nakladane przed skalowaniem.
   *
   * Lustra w refach, bo obsluga kolka jest natywnym listenerem (patrz nizej) i bez
   * nich czytalaby stan z domkniecia sprzed pierwszego renderu.
   */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  /*
   * Po `pointerup` przegladarka wystawia jeszcze `click` — ten sam gest jest wiec
   * i przeciagnieciem, i klikiem. Bez tej flagi kazde przesuniecie powiekszonego
   * obrazka konczylo sie powrotem do wpasowania, bo klik przelacza powiekszenie.
   *
   * Prog 4 px, a nie "jakikolwiek ruch": mysz drgnie o piksel przy samym nacisnieciu
   * przycisku i zwykly klik przestalby dzialac.
   */
  const dragged = useRef(false);

  // Nowe zdjecie zaczyna od wpasowanego — inaczej przewijalibysmy strzalkami w slepo
  // po srodku poprzedniego kadru.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  /*
   * Przy 1 nie ma czego przesuwac. Wyzej ograniczamy przesuw do tego, co faktycznie
   * wystaje poza ekran (plus mala tolerancja), zeby nie dalo sie wyciagnac obrazka
   * calkiem poza kadr i zostac z czarna plansza.
   */
  const clampPan = (z: number, p: { x: number; y: number }) => {
    const el = imgRef.current;
    if (!el || z <= 1) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const w = (r.width / zoomRef.current) * z;
    const h = (r.height / zoomRef.current) * z;
    const mx = Math.max(0, (w - window.innerWidth) / 2 + 24);
    const my = Math.max(0, (h - window.innerHeight) / 2 + 24);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };

  /*
   * Kolko przybliza W PUNKT POD KURSOREM, a nie w srodek kadru: przy czytaniu zrzutu
   * ekranu celuje sie w konkretne miejsce, wiec to ono ma zostac nieruchome.
   *
   * Listener natywny z `passive: false` — React montuje `onWheel` jako pasywny i
   * `preventDefault` nic tam nie daje, wiec strona przewijalaby sie pod podgladem.
   */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const next = Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      if (next === z) return;
      const p = panRef.current;
      const cx = e.clientX - window.innerWidth / 2;
      const cy = e.clientY - window.innerHeight / 2;
      const moved = { x: cx - (cx - p.x) * (next / z), y: cy - (cy - p.y) * (next / z) };
      setPan(clampPan(next, moved));
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /*
   * Podglad jest MODALNY: przechwytujemy klawiature w fazie capture i zatrzymujemy
   * zdarzenie, zeby skroty aplikacji (j/k, x, v, 1-3, Enter otwierajacy zadanie) nie
   * strzelaly w tle do listy, ktorej i tak nie widac. Kombinacje z Ctrl/Cmd puszczamy
   * dalej — to skroty przegladarki, nie nasze.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' && files.length > 1) {
        e.preventDefault();
        onIndex((index + 1) % files.length);
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === 'ArrowLeft' && files.length > 1) {
        e.preventDefault();
        onIndex((index - 1 + files.length) % files.length);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, files.length, onIndex, onClose]);

  if (!file) return null;

  const step = (d: number) => (e: ReactMouseEvent) => {
    // Klik w strzalke nie moze dolecziec do tla, bo tlo zamyka podglad.
    e.stopPropagation();
    onIndex((index + d + files.length) % files.length);
  };

  return createPortal(
    <div
      className="lightbox"
      ref={boxRef}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
    >
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{file.name}</span>
        {zoom !== 1 && <span className="lightbox-zoom">{Math.round(zoom * 100)}%</span>}
        {files.length > 1 && (
          <span className="lightbox-count">
            {index + 1} / {files.length}
          </span>
        )}
        <button className="lightbox-act" onClick={onClose} title="Zamknij (Esc)">
          <CloseIcon />
        </button>
      </div>

      {files.length > 1 && (
        <button className="lightbox-nav lightbox-prev" onClick={step(-1)} title="Poprzedni (←)">
          <ChevronIcon open={false} />
        </button>
      )}

      {/* Klik w SAM obrazek nie zamyka — zamyka dopiero klik obok niego. */}
      <img
        ref={imgRef}
        className={`lightbox-img${zoom > 1 ? ' lightbox-img-zoomed' : ''}`}
        src={file.src}
        alt={file.name}
        draggable={false}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          // Bez animacji w trakcie ciagniecia — inaczej obrazek wlecze sie za kursorem.
          transition: drag.current ? 'none' : 'transform 90ms ease-out',
        }}
        onPointerDown={(e) => {
          if (zoom === 1) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
          setPan(clampPan(zoom, { x: d.ox + dx, y: d.oy + dy }));
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          dragged.current = drag.current?.moved ?? false;
          drag.current = null;
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Koniec przeciagania, nie klik — zostawiamy powiekszenie w spokoju.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          // Klik przelacza wpasowanie <-> 2.5x w PUNKT, w ktory sie kliknelo. Kolko
          // daje plynna regulacje, ale najczestsza potrzeba to "pokaz mi ten fragment".
          if (zoom !== 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            return;
          }
          const cx = e.clientX - window.innerWidth / 2;
          const cy = e.clientY - window.innerHeight / 2;
          setPan(clampPan(2.5, { x: -cx * 1.5, y: -cy * 1.5 }));
          setZoom(2.5);
        }}
      />

      {files.length > 1 && (
        <button className="lightbox-nav lightbox-next" onClick={step(1)} title="Następny (→)">
          <ChevronIcon open={false} />
        </button>
      )}
    </div>,
    document.body,
  );
}

/**
 * „@Imie Nazwisko" → `[USER=id]Imie Nazwisko[/USER]`.
 *
 * Dopiero ten zapis Bitrix rozpoznaje jako wzmianke — samo „@Imie" jest dla niego
 * zwyklym tekstem i nikogo nie powiadomi. Podmieniamy przy wysylce, zeby w polu
 * stalo czytelne „@Imie", a nie znacznik.
 *
 * Dluzsze nazwy najpierw: inaczej „@Damian" zjadloby poczatek „@Damian Chwiejczak".
 */
function withMentions(text: string, people: { id: number; name: string }[]): string {
  return [...people]
    .sort((a, b) => b.name.length - a.name.length)
    .reduce((acc, p) => acc.split(`@${p.name}`).join(`[USER=${p.id}]${p.name}[/USER]`), text);
}

/**
 * Wzmianki JUZ obecne w tresci — po nich odtwarzamy znaczniki przy edycji.
 *
 * Celowo tylko te. W polu edycji stoi czytelne „@Imie" i przy zapisie trzeba je
 * zamienic z powrotem; szukanie po WSZYSTKICH osobach z portalu zamienialoby
 * w powiadomienie kazde „@Imie" dopisane przy okazji poprawki, a powiadomienia
 * nie da sie cofnac. Nowa wzmianke dodaje sie wiec nowym komentarzem, nie edycja.
 */
function mentionsIn(text: string): { id: number; name: string }[] {
  return [...text.matchAll(/\[USER=(\d+)\]([^[]*)\[\/USER\]/g)].map((m) => ({
    id: Number(m[1]),
    name: m[2],
  }));
}

/** Tresc do POLA edycji: znaczniki wzmianek z powrotem na czytelne „@Imie". */
function toDraft(text: string): string {
  return text.replace(/\[USER=\d+\]([^[]*)\[\/USER\]/g, '@$1');
}

/** Data komentarza w milisekundach; brak daty liczy sie jak najstarsza. */
function czas(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Zaznaczony tekst, ale TYLKO gdy w calosci lezy w podanym komentarzu.
 *
 * Bez tego warunku odpowiedz cytowalaby zaznaczenie zrobione gdzie indziej —
 * w innym komentarzu, w opisie zadania albo nawet na liscie po lewej.
 */
function zaznaczenieW(el: Element | null): string {
  const sel = window.getSelection();
  if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0) return '';
  const zakres = sel.getRangeAt(0);
  if (!el.contains(zakres.commonAncestorContainer)) return '';
  return sel.toString().trim();
}

function Comments({
  taskId,
  chatId,
  fraza,
  ready,
  me,
  people,
  onConfirm,
  onError,
}: {
  taskId: number;
  /** Szukana fraza — podswietlana w tresci komentarzy. */
  fraza: string;
  /** Z `tasks.task.get`; bez niego widac tylko forum. */
  chatId: number | null;
  /** Szczegoly zadania juz doszly (albo sie nie udaly) — dopiero wtedy znamy `chatId`. */
  ready: boolean;
  me: number | null;
  /** Osoby do wzmianek `@` — te same, co w filtrze i pickerze osoby. */
  people: Person[];
  /** Pytanie przed nieodwracalnym — okno rysuje App (patrz `Confirm`). */
  onConfirm: (state: ConfirmState) => void;
  onError: (m: string) => void;
}) {
  // Start od CACHE (detailCache.ts): stare komentarze widac od razu, bez "Wczytywanie…".
  const [comments, setComments] = useState<Comment[] | null>(() => getCachedComments(taskId));
  /* Indeks w galerii CALEGO watku, nie w jednym komentarzu — patrz `Lightbox`. */
  const [preview, setPreview] = useState<number | null>(null);
  const gallery = useMemo<PreviewItem[]>(
    () =>
      (comments ?? [])
        .flatMap((c) => c.files.filter((f) => f.image))
        .map((f) => ({ key: String(f.id), name: f.name, src: `/api/file/${f.id}` })),
    [comments],
  );
  const [failed, setFailed] = useState<string | null>(null);
  /*
   * NIEWYSLANY tekst przezywa zamkniecie zadania. Panel montuje sie od nowa przy
   * kazdym zadaniu (`key={task.id}`), wiec bez tego wyjscie w polowie zdania
   * kasowalo zdanie — a to jedyna rzecz w panelu, ktorej nie da sie odtworzyc
   * z Bitriksa, bo jeszcze tam nie dotarla. Czytamy RAZ, przy montowaniu.
   */
  const [zapisany] = useState(() => getDraft(taskId));
  /*
   * Do ktorego momentu watek byl przeczytany PRZY WEJSCIU. Zamrozone, bo znacznik
   * zapisujemy od razu po wczytaniu — gdyby kreska liczyla sie z zywej wartosci,
   * zniknelaby w tej samej chwili, w ktorej ma cos pokazac.
   */
  const [przeczytaneDo] = useState(() => loadRead(taskId));
  const [draft, setDraft] = useState(() => zapisany?.text ?? '');
  /*
   * Komentarz, na ktory odpowiadamy. Cytat NIE idzie do pola — w polu ma stac
   * sama odpowiedz, zeby pisalo sie normalnie, a nie obok cudzego tekstu i
   * kresek. Dokleja sie dopiero przy wysylce (patrz `send`), w formacie
   * Bitriksa, wiec tam wyglada tak samo jak tutaj.
   */
  const [replyTo, setReplyTo] = useState<{ author: string; when: string; body: string } | null>(
    () => zapisany?.replyTo ?? null,
  );
  const [sending, setSending] = useState(false);
  /*
   * Zalaczniki czekajace na wyslanie — wklejone zrzuty ekranu.
   *
   * Trzymamy `Blob`, nie base64: w stanie nie ma po co nosic wersji o jedna
   * trzecia wiekszej, a do IndexedDB (patrz `pasteStore`) blob idzie w oryginale.
   * Na base64 przerabiamy dopiero przy wysylce, bo tego chce Bitrix.
   */
  const [zalaczniki, setZalaczniki] = useState<{ name: string; blob: Blob }[]>([]);

  /* Zrzuty z poprzedniego podejscia — wracaja razem z tekstem komentarza. */
  useEffect(() => {
    let zywe = true;
    void wczytajWklejone(taskId).then((z) => {
      if (zywe && z.length) setZalaczniki(z);
    });
    return () => {
      zywe = false;
    };
  }, [taskId]);

  /*
   * Adresy podgladu. Tworzone RAZ na blob i zwalniane przy zmianie — bez tego
   * kazde przerysowanie zostawialoby w pamieci kolejna kopie obrazka.
   */
  const podglady = useMemo(() => zalaczniki.map((z) => URL.createObjectURL(z.blob)), [zalaczniki]);
  useEffect(() => () => podglady.forEach((u) => URL.revokeObjectURL(u)), [podglady]);

  /* Zapis z opoznieniem, jak przy tekscie — wklejenie kilku zrzutow pod rzad nie
     ma przepisywac magazynu przy kazdym z nich. */
  useEffect(() => {
    const id = window.setTimeout(() => void zapiszWklejone(taskId, zalaczniki), 400);
    return () => window.clearTimeout(id);
  }, [taskId, zalaczniki]);
  /*
   * Edytowany komentarz — klucz `zrodlo:numer`, ten sam, ktorym React rozroznia
   * wypowiedzi w watku. Same numery sie powtarzaja: forum i czat licza osobno.
   */
  const [editing, setEditing] = useState<string | null>(null);
  /*
   * Rozpisane poprawki, klucz → tresc pola. MAPA, nie jedno pole: zamkniecie
   * edycji ma zachowac to, co juz napisane, a nie wyrzucic. Odrzuca dopiero
   * „Anuluj" — patrz `porzucEdycje`.
   */
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>(() => zapisany?.edits ?? {});
  const [saving, setSaving] = useState(false);
  const [computing, setComputing] = useState(false);
  /**
   * Gdy czas przekracza 24 h, nie wstawiamy od razu — pytamy, czy przyciac do godzin
   * pracy. Trzymamy oba warianty (pelny i przyciety), zeby wybor byl natychmiastowy.
   */
  const [bigTime, setBigTime] = useState<{ rawMs: number; intervals: Interval[] } | null>(null);
  /*
   * Godziny pracy trzymamy w STANIE, a nie w stalej: 8-16 to dobry domysl, ale
   * nie regula firmy. Odcinki zostaja w `bigTime`, zeby przesuniecie uchwytu
   * przeliczalo wynik od razu — bez ponownego pytania Bitriksa o dziennik.
   */
  const [work, setWork] = useState<[number, number]>([WORK_START_HOUR, WORK_END_HOUR]);
  const workMs = useMemo(
    () => (bigTime ? clampWorkingMs(bigTime.intervals, work[0], work[1]) : 0),
    [bigTime, work],
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /*
   * Wzmianka `@`. `at` to pozycja malpy w tekscie, `query` — to, co po niej
   * dopisano. Trzymamy jedno i drugie, bo po wyborze osoby trzeba podmienic
   * DOKLADNIE ten fragment, a nie pierwsze lepsze "@" w komentarzu.
   */
  /*
   * `target` mowi, KTORE pole otworzylo liste: `'new'` to pole nowego komentarza,
   * inaczej klucz edytowanego komentarza. Bez tego malpa dzialalaby tylko w
   * jednym polu — a pola edycji wygladaja identycznie, wiec „@Anna" wpisane tam
   * wygladalo na wzmianke i po cichu nia nie bylo.
   */
  const [mention, setMention] = useState<
    { at: number; query: string; anchor: Anchor; target: string } | null
  >(null);
  /** Pola edycji po kluczu — do oddania kursora po wyborze osoby z listy. */
  const editRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  /*
   * Kto zostal wstawiony. Bitrix oczekuje w tresci `[USER=id]Imie[/USER]`, ale
   * pokazywanie tego w polu byloby okrutne — w polu stoi zwykle "@Imie", a na
   * BBCode zamieniamy dopiero przy wysylce, po tej mapie. Gdy ktos rozjedzie
   * nazwe recznie, wzmianka po prostu zostanie tekstem. Zaden komentarz sie
   * przez to nie zepsuje.
   */
  const [mentioned, setMentioned] = useState<Person[]>(() => zapisany?.mentioned ?? []);
  /* To samo, ale per edytowany komentarz — osoby WYBRANE z listy w trakcie poprawki. */
  const [editMentions, setEditMentions] = useState<Record<string, Person[]>>(
    () => zapisany?.editMentions ?? {},
  );

  /**
   * Wykrywanie malpy w polu tekstowym — wspolne dla pola nowego komentarza i
   * KAZDEGO pola edycji. Wczesniej siedzialo wprost w `onChange` jednego pola.
   *
   * Szukamy malpy NAJBLIZSZEJ kursorowi i tylko w biezacym „slowie": po spacji
   * wzmianka sie konczy, a adres e-mail w tekscie nie ma otwierac listy osob
   * (stad wymog spacji albo poczatku linii przed `@`).
   */
  const sledzMalpe = (el: HTMLTextAreaElement, value: string, target: string) => {
    const caret = el.selectionStart ?? value.length;
    const at = value.lastIndexOf('@', caret - 1);
    const query = at === -1 ? '' : value.slice(at + 1, caret);
    const opensWord = at === 0 || /\s/.test(value[at - 1] ?? '');

    if (at === -1 || !opensWord || /\s/.test(query)) {
      dismissedAt.current = null;
      setMention(null);
      return;
    }
    // Ta sama malpa, ktora juz odrzucono — nie otwieramy jej ponownie,
    // dopoki uzytkownik nie napisze nowej.
    if (dismissedAt.current === at) return;
    /*
     * Kotwice liczymy TYLKO przy otwieraniu listy. Mierzona przy kazdej literze
     * sprawiala, ze panel drgal razem z pisaniem; pole i tak nie zmienia
     * polozenia, wiec nie ma czego przeliczac.
     */
    setMention((prev) =>
      prev && prev.target === target
        ? { ...prev, query, at }
        : (() => {
            const r = el.getBoundingClientRect();
            return { at, query, target, anchor: { left: r.left, top: r.top, bottom: r.top } };
          })(),
    );
  };

  /*
   * Zapis wersji roboczej. Z OPOZNIENIEM, bo inaczej kazde nacisniecie klawisza
   * przepisywaloby caly magazyn w localStorage. Pusty szkic KASUJEMY — inaczej
   * zostawalby po nim wpis, ktory tylko zjada limit i nic nie niesie.
   */
  useEffect(() => {
    const pusto =
      !draft.trim() && !replyTo && Object.values(editDrafts).every((t) => !t.trim());
    const id = window.setTimeout(() => {
      if (pusto) clearDraft(taskId);
      else
        storeDraft(taskId, {
          text: draft,
          mentioned,
          replyTo,
          edits: editDrafts,
          editMentions,
        });
    }, 400);
    return () => window.clearTimeout(id);
  }, [taskId, draft, mentioned, replyTo, editDrafts, editMentions]);

  /**
   * Pozycja malpy, ktora uzytkownik ODRZUCIL (Escape / klik w tlo).
   *
   * Bez tego lista wracala przy kazdym nastepnym klawiszu: kasowanie slowa
   * backspace'em to zwykla zmiana tekstu, a `@Woj` wciaz stoi przed kursorem,
   * wiec detekcja odpalala sie od nowa. Pamietamy WYLACZNIE indeks — gdy malpa
   * przesunie sie albo zniknie, odrzucenie samo traci waznosc.
   */
  const dismissedAt = useRef<number | null>(null);

  /*
   * Zamkniecie listy. Focusu NIE trzeba przywracac: picker dostaje filtr z
   * zewnatrz (`externalQuery`), nie ma wlasnego pola i nigdy nie zabiera kursora
   * z pola komentarza. Wczesniej byl tu efekt oddajacy focus po odmontowaniu —
   * zbedny, odkad nie ma czego oddawac.
   */
  const closeMention = useCallback((dismissAt?: number) => {
    if (dismissAt !== undefined) dismissedAt.current = dismissAt;
    setMention(null);
  }, []);
  // Pytanie pojawia sie pod polem komentarza, czesto pod krawedzia panelu —
  // przewijamy je w pole widzenia, zeby nie trzeba bylo szukac go recznie.
  const askRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bigTime) askRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [bigTime]);

  /*
   * `stale` jak przy szczegolach: dwa pobrania tego samego watku (np. po wyslaniu
   * komentarza w trakcie wczytywania) potrafia wrocic w odwrotnej kolejnosci i
   * starsza odpowiedz nadpisalaby nowsza — takze w CACHE.
   */
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    if (!ready) return; // bez chatId pytanie byloby niepelne
    const seq = ++loadSeq.current;
    const cached = getCachedComments(taskId);
    setComments(cached); // z cache (albo null przy pierwszym otwarciu -> "Wczytywanie…")
    setFailed(null);
    fetchComments(taskId, chatId)
      .then((c) => {
        if (seq !== loadSeq.current) return;
        setComments(c);
        setCachedComments(taskId, c);
      })
      /*
       * Blad MUSI wygladac inaczej niz brak komentarzy. Wczesniej obie sytuacje
       * konczyly sie napisem "Brak komentarzy" i nie dalo sie ich rozroznic —
       * przez to awaria pobierania wygladala jak puste zadanie. Gdy mamy cache,
       * zostajemy przy nim zamiast pokazywac blad.
       */
      .catch((e) => seq === loadSeq.current && !cached && setFailed(e instanceof Error ? e.message : String(e)));
  }, [ready, taskId, chatId]);

  useEffect(load, [load]);

  /**
   * Pierwszy komentarz, ktorego jeszcze nie widzialem — nad nim staje kreska.
   *
   * WLASNE wypowiedzi sie nie licza: nikt nie wraca do watku, zeby przeczytac
   * siebie. Przy pierwszej wizycie (`null`) nie ma kreski wcale — inaczej caly
   * watek, lacznie z rokiem archiwum, bylby „nowy".
   */
  const pierwszyNowy = useMemo(() => {
    if (przeczytaneDo === null || !comments) return -1;
    return comments.findIndex((c) => c.authorId !== me && czas(c.date) > przeczytaneDo);
  }, [comments, przeczytaneDo, me]);

  /* Znacznik przesuwamy na najswiezsza wypowiedz w watku — kreska pokazuje sie
     raz, przy tym wejsciu, a przy nastepnym juz nie. */
  useEffect(() => {
    if (!comments?.length) return;
    saveRead(taskId, Math.max(...comments.map((c) => czas(c.date))));
  }, [comments, taskId]);

  /** Komentarz podswietlony po skoku z cytatu — gasnie sam. */
  const [flash, setFlash] = useState<number | null>(null);

  /*
   * PO OTWARCIU ZADANIA ladujemy na koncu watku, nie na jego poczatku.
   *
   * Zadanie otwiera sie zwykle po to, zeby zobaczyc, co sie w nim WLASNIE dzieje,
   * a to jest na dole — przy kilkunastu komentarzach trzeba bylo za kazdym razem
   * przewijac cala droge. Gdy jest kreska „NOWE", celujemy w NIA: wtedy widok
   * zaczyna sie dokladnie tam, gdzie sie skonczylo czytanie.
   *
   * Raz na otwarcie (`skoczylem`) — panel montuje sie od nowa przy kazdym
   * zadaniu, a odswiezenie watku w tle nie moze szarpac widoku pod palcami.
   */
  const sekcjaRef = useRef<HTMLElement>(null);

  /*
   * Czy uzytkownik sam ruszyl widokiem. Slucham KOLKA I PALCA, a nie zdarzenia
   * `scroll` — to drugie odpala takze moje wlasne przewijanie, wiec pierwszy skok
   * natychmiast blokowalby kolejne.
   */
  const uzytkownikRuszyl = useRef(false);
  useEffect(() => {
    const pojemnik = sekcjaRef.current?.closest('.detail-body');
    if (!pojemnik) return;
    const zaznacz = () => {
      uzytkownikRuszyl.current = true;
    };
    pojemnik.addEventListener('wheel', zaznacz, { passive: true });
    pojemnik.addEventListener('touchmove', zaznacz, { passive: true });
    return () => {
      pojemnik.removeEventListener('wheel', zaznacz);
      pojemnik.removeEventListener('touchmove', zaznacz);
    };
  }, []);

  useEffect(() => {
    if (uzytkownikRuszyl.current || !comments?.length) return;

    const skok = () => {
      const kreska = sekcjaRef.current?.querySelector('.comment-new-mark');
      if (kreska) return kreska.scrollIntoView({ block: 'start' });
      /* Bez kreski — na sam dol, razem z polem pisania: tak konczy sie watek. */
      const pojemnik = sekcjaRef.current?.closest('.detail-body');
      if (pojemnik) pojemnik.scrollTop = pojemnik.scrollHeight;
    };

    skok();
    /*
     * Efekt CELOWO odpala sie przy kazdej zmianie watku, a nie raz. Watek dochodzi
     * dwoma turami: najpierw z cache (krotszy), potem swiezy z Bitriksa. Skok
     * zatrzaskiwany po pierwszej turze ladowal 56 px przed koncem i juz sie nie
     * poprawial — dopiero druga tura dokladala reszte.
     *
     * Dwa terminy na doniesione obrazki, ktore zmieniaja wysokosc juz po rysowaniu.
     */
    const timery = [200, 700].map((ms) => window.setTimeout(skok, ms));
    return () => timery.forEach(window.clearTimeout);
  }, [comments]);

  /*
   * Przycisk „Odpowiedz" NAD ZAZNACZENIEM.
   *
   * Cytowanie fragmentu dzialalo juz wczesniej — trzeba bylo tylko wiedziec, ze
   * po zaznaczeniu nalezy trafic w strzalke w naglowku komentarza. Czyli funkcja
   * byla, ale nic o niej nie mowilo. Przycisk przychodzi do zaznaczenia zamiast
   * kazac go szukac; tak samo robia to Medium i Notion.
   */
  const [zaznaczenie, setZaznaczenie] = useState<
    { top: number; left: number; author: string; when: string; body: string } | null
  >(null);

  const sprawdzZaznaczenie = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setZaznaczenie(null);
    const zakres = sel.getRangeAt(0);
    const wezel = zakres.commonAncestorContainer;
    const el = (wezel instanceof Element ? wezel : wezel.parentElement)?.closest('.comment-body');
    /* Tylko TRESC komentarza: zaznaczenie w naglowku, w cytacie albo poza watkiem
       nie jest cudza wypowiedzia, wiec nie ma czego cytowac. */
    if (!el) return setZaznaczenie(null);

    const art = el.closest('[data-comment]') as HTMLElement | null;
    const c = (comments ?? []).find((x) => x.id === Number(art?.dataset.comment));
    const tekst = sel.toString().trim();
    if (!c || !tekst) return setZaznaczenie(null);

    const r = zakres.getBoundingClientRect();
    setZaznaczenie({
      top: r.top,
      left: r.left + r.width / 2,
      author: c.authorName,
      when: dateTime(c.date),
      body: tekst,
    });
  };

  /*
   * Przy przewijaniu i przy zmianie zaznaczenia PRZELICZAMY pozycje, a nie
   * chowamy pigulke.
   *
   * Pierwsza wersja chowala ja na kazde zdarzenie przewijania — i znikala sama,
   * bez dotykania myszy: `capture` lapie przewijanie DOWOLNEGO kontenera, a w
   * panelu wystarczy odswiezenie watku, zeby takie zdarzenie padlo. Przeliczenie
   * zalatwia oba przypadki naraz: gdy zaznaczenie zyje, pigulka jedzie razem
   * z nim; gdy zniknelo, `sprawdzZaznaczenie` samo zwraca `null`.
   *
   * Przez REF, bo funkcja domyka sie nad `comments` i w efekcie zapietym na
   * pustej liscie zaleznosci zostalaby wersja z pierwszego renderu.
   */
  const sprawdzRef = useRef(sprawdzZaznaczenie);
  sprawdzRef.current = sprawdzZaznaczenie;
  useEffect(() => {
    const odswiez = () => sprawdzRef.current();
    document.addEventListener('selectionchange', odswiez);
    window.addEventListener('scroll', odswiez, true);
    return () => {
      document.removeEventListener('selectionchange', odswiez);
      window.removeEventListener('scroll', odswiez, true);
    };
  }, []);

  /*
   * Doczytywanie POCZATKU watku. Pierwsze pobranie bierze ostatnie sto wiadomosci
   * czatu i przy dlugiej dyskusji reszta po prostu nie istniala w panelu — bez
   * sladu, ze cos zostalo uciete.
   */
  const [starszeBrak, setStarszeBrak] = useState(false);
  const [dociagam, setDociagam] = useState(false);

  const pokazStarsze = async () => {
    const najstarszyZCzatu = (comments ?? []).find((c) => c.source === 'chat');
    if (!najstarszyZCzatu || chatId === null || dociagam) return;
    setDociagam(true);
    try {
      const starsze = await fetchOlderComments(chatId, najstarszyZCzatu.id);
      if (!starsze.length) {
        setStarszeBrak(true);
        return;
      }
      setComments((prev) => {
        const znane = new Set((prev ?? []).map((c) => `${c.source}:${c.id}`));
        const nowe = starsze.filter((c) => !znane.has(`${c.source}:${c.id}`));
        if (!nowe.length) {
          setStarszeBrak(true);
          return prev;
        }
        const next = [...nowe, ...(prev ?? [])];
        setCachedComments(taskId, next);
        return next;
      });
    } catch (e) {
      onError(`Nie udało się wczytać starszych: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDociagam(false);
    }
  };

  /**
   * Skok do cytowanego komentarza.
   *
   * Bitrix nie zapisuje, KTORY komentarz jest cytowany — zostaje tylko tekst
   * cytatu (patrz `splitQuote`). Szukamy wiec po tresci: bierzemy poczatek
   * cytatu i sprawdzamy, czyj komentarz tak sie zaczyna. Autor zaweza szukanie,
   * gdy Bitrix go dopisal.
   *
   * Gdy oryginalu nie ma (starszy niz pobrany kawalek watku, albo skasowany),
   * NIE udajemy, ze cos sie stalo — patrz komunikat w `onError`.
   */
  /**
   * Odnajduje CYTOWANY komentarz w watku.
   *
   * Porownanie musi byc luzne, bo cytat nie jest kopia:
   *  - Bitrix przeformatowuje tresc (lista „6.” w oryginale bywa „6)” w cytacie),
   *  - podpisuje cytat nazwa z chwili cytowania — „Klaudiusz Koder”, podczas gdy
   *    komentarz nalezy do „Klaudiusz Koder AI”.
   * Stad: gole litery i cyfry, bez znakow i wielkosci liter, a autor tylko
   * ZAWEZA wybor, nigdy go nie wyklucza.
   */
  const findQuoted = (quote: { author: string | null; body: string }): Comment | undefined => {
    const norm = (t: string) =>
      plainText(t)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

    /* Poczatkowy numer punktu odpada — to wlasnie on rozni sie miedzy oryginalem
       a cytatem. */
    const igla = norm(quote.body).replace(/^\d+\s*/, '').slice(0, 30);
    if (!igla) return undefined;

    const pasuje = (x: Comment) => norm(splitQuote(x.text).rest || x.text).includes(igla);
    const tenSamAutor = (x: Comment) => {
      if (!quote.author) return true;
      const a = norm(x.authorName);
      const b = norm(quote.author);
      return a.includes(b) || b.includes(a);
    };

    const lista = comments ?? [];
    return lista.find((x) => tenSamAutor(x) && pasuje(x)) ?? lista.find(pasuje);
  };

  const scrollToQuoted = (quote: { author: string | null; body: string }) => {
    const cel = findQuoted(quote);
    if (!cel) {
      onError('Nie widzę cytowanego komentarza — może jest starszy niż wczytany fragment wątku.');
      return;
    }
    document.querySelector(`[data-comment="${cel.id}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    setFlash(cel.id);
    window.setTimeout(() => setFlash((v) => (v === cel.id ? null : v)), 1400);
  };

  /** Dokleja gotowa linijke z czasem do pola komentarza (nie wysyla). */
  const insertLine = (ms: number, hoursOnly = false) =>
    setDraft((prev) => {
      const line = `Czas pracy nad zadaniem: ${formatDurationPl(ms, hoursOnly)}`;
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
        setBigTime({ rawMs, intervals });
      } else {
        insertLine(rawMs);
      }
    } catch (e) {
      onError(`Nie udało się policzyć czasu pracy: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setComputing(false);
    }
  };

  /**
   * Zapis poprawionego komentarza.
   *
   * Obie metody Bitriksa podmieniaja tresc W CALOSCI, wiec wysylamy ja w calosci:
   * cytat wraca DOKLADNIE taki, jaki byl (`raw` — z kreskami i kotwica do
   * oryginalu), a zmienia sie tylko to, co stalo pod nim. Sam cytat nie jest do
   * edycji z zalozenia: to cudze slowa.
   *
   * `was` to tresc sprzed edycji — sluzy do rozpoznania, ze nic sie nie zmienilo
   * (wtedy nie ma po co pisac do Bitriksa) i do odtworzenia wzmianek.
   */
  /**
   * Usuniecie wlasnego komentarza. Nieodwracalne, wiec zawsze przez pytanie —
   * i z podgladem tresci, zeby bylo widac, KTORY komentarz znika (w watku stoi
   * ich kilkanascie, a ikony sa male i blisko siebie).
   */
  const removeComment = (c: Comment) => {
    const podglad = plainText(splitQuote(c.text).rest || c.text).slice(0, 80);
    onConfirm({
      title: 'Usunąć ten komentarz?',
      body: `„${podglad}${podglad.length === 80 ? '…' : ''}" zniknie z Bitriksa. Tej operacji nie da się cofnąć.`,
      confirmLabel: 'Usuń',
      danger: true,
      onYes: () => {
        void (async () => {
          try {
            await deleteComment(c, taskId);
            /* Znika lokalnie od razu — patrz `saveEdit`, ten sam powod. */
            setComments((prev) => {
              if (!prev) return prev;
              const next = prev.filter((x) => !(x.source === c.source && x.id === c.id));
              setCachedComments(taskId, next);
              return next;
            });
          } catch (e) {
            onError(`Nie udało się usunąć komentarza: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
      },
    });
  };

  /** Zamyka edycje i ODRZUCA to, co w niej napisano — w odroznieniu od Escape. */
  const porzucEdycje = (key: string) => {
    setEditDrafts(({ [key]: _, ...reszta }) => reszta);
    setEditMentions(({ [key]: _pominiete, ...reszta }) => reszta);
    setEditing(null);
  };

  const saveEdit = async (c: Comment, raw: string, was: string) => {
    const key = `${c.source}:${c.id}`;
    const text = (editDrafts[key] ?? '').trim();
    if (!text || saving) return;
    if (text === toDraft(was).trim()) {
      porzucEdycje(key);
      return;
    }
    setSaving(true);
    try {
      /*
       * Wzmianki z dwoch zrodel: te, ktore w komentarzu JUZ BYLY (odtwarzamy je
       * z oryginalu, bo w polu stoi czytelne „@Imie"), plus WYBRANE z listy
       * w trakcie poprawki. Wpisane recznie i niewybrane zostaja tekstem —
       * dokladnie tak samo jak przy nowym komentarzu.
       */
      const pelny = raw + withMentions(text, [...mentionsIn(was), ...(editMentions[key] ?? [])]);
      await editComment(c, taskId, pelny);
      porzucEdycje(key);
      /*
       * Podmieniamy JEDEN komentarz zamiast przeladowywac watek. Pobranie
       * calosci gasilo na moment cala liste i przewijanie skakalo — a wiadomo
       * dokladnie, co sie zmienilo, bo sami to wyslalismy.
       */
      setComments((prev) => {
        if (!prev) return prev;
        const next = prev.map((x) =>
          x.source === c.source && x.id === c.id ? { ...x, text: pelny } : x,
        );
        setCachedComments(taskId, next);
        return next;
      });
    } catch (e) {
      /*
       * `CANT_EDIT_MESSAGE` nalezy do STAREGO `im.message.update` i po przejsciu
       * na `im.v2.*` nie powinien juz padac (patrz `editComment`). Zostaje na
       * wypadek, gdyby portal kiedys odebral dostep do wersji v2 — wtedy binear
       * wroci na stara sciezke i ten komunikat znowu bedzie jedynym sensownym.
       * Wlasny opis Bitriksa to worek na dwie sprawy naraz: „Time has expired
       * for modification OR you don't have access".
       */
      const code = e instanceof Error ? e.message : String(e);
      onError(
        code === 'CANT_EDIT_MESSAGE'
          ? 'Bitrix nie pozwolił zmienić tego komentarza — minął czas na edycję albo brakuje uprawnień. Zostaje dopisanie nowego.'
          : `Nie udało się zmienić komentarza: ${code}`,
      );
    } finally {
      setSaving(false);
    }
  };

  /** Nad tym rozmiarem odmawiamy — zrzut ekranu wazy setki kilobajtow, nie megabajty. */
  const MAX_ZALACZNIK = 10 * 1024 * 1024;

  /**
   * Wklejony obrazek ze schowka. Zrzuty ekranu to u nas normalny sposob opisania
   * problemu, a dotad kazdy z nich wymagal przejscia do Bitriksa w polowie
   * pisania komentarza.
   *
   * Czytamy `clipboardData.files`, nie tekst — Windows wkleja zrzut jako plik
   * `image/png` bez nazwy, wiec nazwe nadajemy sami (z data, zeby dalo sie je
   * potem odroznic na Dysku).
   */
  const wklej = (e: React.ClipboardEvent) => {
    const obrazki = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!obrazki.length) return;
    e.preventDefault(); // inaczej Chrome wklei do pola sciezke pliku

    for (const plik of obrazki) {
      if (plik.size > MAX_ZALACZNIK) {
        onError(`Załącznik jest za duży (${Math.round(plik.size / 1024 / 1024)} MB, limit 10 MB).`);
        continue;
      }
      const rozszerzenie = (plik.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      setZalaczniki((z) => [
        ...z,
        { name: plik.name || `zrzut-${stempel}.${rozszerzenie}`, blob: plik },
      ]);
    }
  };

  /** `Blob` → gole base64, czyli to, czego chce Bitrix (bez przedrostka `data:`). */
  const naBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const czytnik = new FileReader();
      czytnik.onload = () => {
        const dataUrl = String(czytnik.result);
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
      };
      czytnik.onerror = () => reject(new Error('Nie udało się odczytać załącznika'));
      czytnik.readAsDataURL(blob);
    });

  const send = async () => {
    const text = draft.trim();
    /* Sam zrzut bez slowa komentarza tez jest wypowiedzia — wtedy tekst moze byc pusty. */
    if ((!text && !zalaczniki.length) || !me || sending) return;
    setSending(true);
    try {
      /* Wzmianki na znaczniki Bitriksa — patrz `withMentions`. Tu bierzemy osoby
         WYBRANE z listy, bo tylko one sa zamierzona wzmianka. */
      const body = withMentions(text, mentioned);

      /* Cytat dopiero tutaj — w polu stala sama odpowiedz. */
      const full = replyTo ? buildQuote(replyTo.author, replyTo.when, replyTo.body) + body : body;

      /*
       * Z zalacznikiem idziemy droga czatu (patrz `addCommentWithFiles`) — tylko
       * ona umie doczepic plik. Bez zalacznika zostaje `task.commentitem.add`,
       * bo to ona pozwala podpisac komentarz AUTOREM, a nie wlascicielem
       * webhooka; dzis to ta sama osoba, ale nie musi byc.
       */
      if (zalaczniki.length) {
        if (chatId === null) throw new Error('Zadanie nie ma czatu — nie ma gdzie wgrać załącznika');
        const doWyslania = await Promise.all(
          zalaczniki.map(async (z) => ({ name: z.name, base64: await naBase64(z.blob) })),
        );
        await addCommentWithFiles(taskId, chatId, full, doWyslania);
      } else {
        await addComment(taskId, full, me);
      }
      setDraft('');
      setReplyTo(null);
      setMentioned([]);
      setZalaczniki([]);
      void wyczyscWklejone(taskId);
      /* Wyslane = nie ma juz czego trzymac na pozniej. */
      clearDraft(taskId);
      load();
    } catch (e) {
      onError(`Nie udało się dodać komentarza: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="comments"
      ref={sekcjaRef}
      onMouseUp={sprawdzZaznaczenie}
      onKeyUp={sprawdzZaznaczenie}
    >
      {/*
        Pigulka nad zaznaczeniem. Przez PORTAL i `position: fixed`, bo watek
        przewija sie w kontenerze z `overflow` — w srodku bylaby przycieta przy
        gornej krawedzi. Blokada domyslnej akcji myszy jest tu KONIECZNA: klik
        kasuje zaznaczenie, zanim `onClick` zdazy je przeczytac.
      */}
      {zaznaczenie &&
        createPortal(
          <button
            className="sel-reply"
            style={{ top: zaznaczenie.top, left: zaznaczenie.left }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setReplyTo({
                author: zaznaczenie.author,
                when: zaznaczenie.when,
                body: zaznaczenie.body,
              });
              setZaznaczenie(null);
              window.getSelection()?.removeAllRanges();
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <ReplyIcon />
            Odpowiedz
          </button>,
          document.body,
        )}

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

      {/*
        „Starsze" tylko wtedy, gdy jest z czego: watek ma czesc czatowa i jeszcze
        nie dostalismy pustej odpowiedzi. Przy krotkiej dyskusji znika po jednym
        klikniecu i wiecej nie wraca.
      */}
      {!starszeBrak && chatId !== null && comments?.some((c) => c.source === 'chat') && (
        <button className="link-btn comment-older" disabled={dociagam} onClick={() => void pokazStarsze()}>
          {dociagam ? 'Wczytywanie…' : 'Pokaż starsze'}
        </button>
      )}

      {comments?.map((c, idx) => {
        /*
         * Odpowiedz w Bitriksie to CYTAT WKLEJONY w tresc, nie osobne pole —
         * patrz `splitQuote`. Rozdzielamy je, zeby cudze slowa byly widocznie
         * cudze; wczesniej komentarz wyswietlal sie razem z kreskami i
         * wewnetrznym odnosnikiem `#chat…/…`.
         */
        const { quote, rest, raw } = splitQuote(c.text);
        const key = `${c.source}:${c.id}`;
        return (
        <Fragment key={key}>
        {/* Kreska „nowe" — jedna, nad pierwsza nieprzeczytana wypowiedzia. */}
        {idx === pierwszyNowy && (
          <div className="comment-new-mark" role="separator">
            <span>Nowe</span>
          </div>
        )}
        <article
          className={`comment${flash === c.id ? ' comment-flash' : ''}`}
          data-comment={c.id}
        >
          {/*
            Cytat NAD naglowkiem i w JEDNEJ linii — tak pokazuja odpowiedzi
            Discord, Telegram i iMessage. Wczesniej byl to dwuliniowy blok pod
            naglowkiem, z rozwijaniem: duzo tekstu do przeczytania drugi raz i
            do tego wysuniety z osi, bo tresc komentarza ma wciecie pod awatar.
            Klikniecie przewija do oryginalu, zamiast rozwijac kopie.
          */}
          {quote && (
            <button
              className="comment-quote"
              title="Pokaż cytowany komentarz"
              onClick={() => scrollToQuoted(quote)}
            >
              <ReplyIcon />
              {/* Awatar cytowanej osoby — widac komu odpowiadamy, zanim ktokolwiek
                  przeczyta nazwisko. Zdjecie bierzemy z odnalezionego oryginalu;
                  gdy go nie ma, `Avatar` rysuje inicjaly z samej nazwy. */}
              {quote.author && (
                <Avatar name={quote.author} photo={findQuoted(quote)?.authorPhoto ?? undefined} />
              )}
              {quote.author && <strong>{quote.author}</strong>}
              <span className="comment-quote-body">{plainText(quote.body)}</span>
            </button>
          )}
          <div className="comment-head">
            {/* Autor komentarza to zawsze konkretna osoba — patrz `PersonInline`. */}
            <Avatar name={c.authorName} photo={c.authorPhoto} />
            <strong>{c.authorName}</strong>
            <span className="row-meta">{dateTime(c.date)}</span>
            {/*
              Narzedzia wypowiedzi — IKONY w stalej kolumnie przy prawej
              krawedzi. Jako napisy staly w jednej linii z autorem i data
              i czytaly sie jak dalszy ciag naglowka.
            */}
            <div className="comment-tools">
            {/*
              Odpowiedz = CYTAT w tresci nowego komentarza, w formacie Bitriksa
              (patrz `buildQuote`). Dzieki temu wyglada tak samo tutaj i tam, a
              odpowiadanie z binear nie tworzy drugiego, wlasnego zapisu.
              Cytujemy `rest`, nie caly tekst: inaczej odpowiedz na odpowiedz
              zagniezdzalaby cytat w cytacie i rosla bez konca.
            */}
            {/*
              Dymek z WLASNEJ karty (`HoverNote`), nie z `title`. Podpowiedz
              przegladarki pojawia sie z sekundowym opoznieniem, a przy ikonie bez
              napisu to wlasnie ona jest jedynym miejscem, z ktorego mozna sie
              dowiedziec, co ten znaczek robi — czekanie sekunde na ta odpowiedz
              znaczy, ze pierwszy raz i tak sie jej nie doczeka.
            */}
            {/* Cale wyrazenie w JEDNYM tonie. Rozbite na wartosc i dopisek
                („Odpowiedz" jasne, „cytatem" przygaszone) czytalo sie jak liczba
                z przypisem, a to jest zwykle zdanie — dwa kolory rozrywaly je
                w polowie. Dopisek zostaje dla odczytow z wykresu, nie dla nazw
                czynnosci. */}
            <HoverNote value="Odpowiedz cytatem" className="comment-tool">
              <button
                aria-label="Odpowiedz na ten komentarz"
                /*
                 * Klik zwyczajnie kasuje zaznaczenie, zanim `onClick` zdazy je
                 * przeczytac — a to wlasnie zaznaczenie ma trafic do cytatu.
                 * Blokada domyslnej akcji myszy zostawia je nietkniete.
                 */
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  /*
                   * Zaznaczony FRAGMENT ma pierwszenstwo przed cala wypowiedzia.
                   * Przy komentarzu na dziesiec punktow odpowiedz ma wskazywac
                   * punkt, a nie przyklejac sciane tekstu.
                   *
                   * Cytujemy `rest`, nie caly tekst: inaczej odpowiedz na odpowiedz
                   * zagniezdzalaby cytat w cytacie i rosla bez konca.
                   */
                  const fragment = zaznaczenieW(
                    document.querySelector(`[data-comment="${c.id}"] .comment-body`),
                  );
                  setReplyTo({
                    author: c.authorName,
                    when: dateTime(c.date),
                    body: fragment || rest || c.text,
                  });
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <ReplyIcon />
              </button>
            </HoverNote>
            {/*
              Edycja TYLKO wlasnych komentarzy. Webhook dziala z uprawnieniami,
              ktore poprawilyby takze cudze — ale poprawianie cudzych slow nie
              jest czynnoscia, ktora narzedzie ma proponowac.
            */}
            {me === c.authorId && editing !== key && (
              /* Bez dopisku: „Edytuj" nie zostawia pytania. Przy odpowiedzi
                 zostaje — bo to, ze wklei sie cytat, z ikony nie wynika. */
              <HoverNote value="Edytuj" className="comment-tool">
                <button
                  aria-label="Zmień treść tego komentarza"
                  onClick={() => {
                    setEditing(key);
                    /* Zaczeta wczesniej poprawka WRACA; dopiero gdy jej nie ma,
                       bierzemy tresc komentarza. Bez cytatu: edytuje sie wlasna
                       odpowiedz, nie cudza wypowiedz. */
                    setEditDrafts((d) => (key in d ? d : { ...d, [key]: toDraft(rest || c.text) }));
                  }}
                >
                  <PenIcon />
                </button>
              </HoverNote>
            )}
            {me === c.authorId && (
              <HoverNote value="Usuń" className="comment-tool">
                <button
                  className="comment-tool-danger"
                  aria-label="Usuń ten komentarz"
                  onClick={() => removeComment(c)}
                >
                  <TrashIcon />
                </button>
              </HoverNote>
            )}
            </div>
          </div>
          {editing === key ? (
            <div className="comment-edit">
              <textarea
                className="comment-input"
                ref={(el) => {
                  editRefs.current[key] = el;
                }}
                value={editDrafts[key] ?? ''}
                autoFocus
                disabled={saving}
                /* Malpa dziala tu tak samo jak w polu nowego komentarza — patrz
                   `sledzMalpe`. Bez tego „@Anna" wpisane w poprawce wygladalo na
                   wzmianke i po cichu nia nie bylo. */
                onChange={(e) => {
                  setEditDrafts((d) => ({ ...d, [key]: e.target.value }));
                  sledzMalpe(e.target, e.target.value, key);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void saveEdit(c, raw, rest || c.text);
                  }
                  /* Escape najpierw zamyka LISTE OSOB, dopiero potem edycje —
                     inaczej jedno nacisniecie robilo obie rzeczy naraz. */
                  if (e.key === 'Escape' && mention?.target === key) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeMention(mention.at);
                    return;
                  }
                  /*
                   * Escape ZAMYKA, ale nie wyrzuca napisanego tekstu — pole stoi
                   * w srodku watku i trafia sie w nie odruchowo, a poprawka bywa
                   * dluga. Odrzuca dopiero „Anuluj", i to jest cala roznica
                   * miedzy nimi (napisana wprost pod polem).
                   */
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditing(null);
                  }
                }}
              />
              <div className="comment-foot">
                <span className="comment-hint">
                  @ wspomina · Ctrl+Enter zapisuje · Esc zamyka i zachowuje · Anuluj odrzuca
                </span>
                <div className="comment-actions">
                  <button className="btn" disabled={saving} onClick={() => porzucEdycje(key)}>
                    Anuluj
                  </button>
                  <button
                    className="btn"
                    disabled={saving || !(editDrafts[key] ?? '').trim()}
                    onClick={() => void saveEdit(c, raw, rest || c.text)}
                  >
                    {saving ? 'Zapisywanie…' : 'Zapisz'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            rest && (
              <div className="comment-body">{renderDescription(rest, undefined, fraza)}</div>
            )
          )}
          {c.files.length > 0 && (
            <div className="comment-files">
              {c.files.map((f) =>
                f.image ? (
                  /*
                   * Bajty ida przez `/api/file/<id>`, nigdy prost z Bitriksa: tamte
                   * adresy albo niosa token webhooka, albo wymagaja sesji w portalu.
                   *
                   * `width`/`height` z Bitriksa daja przegladarce proporcje z gory,
                   * wiec watek nie podskakuje, gdy obrazek sie doczyta. Klik otwiera
                   * pelny rozmiar w nowej karcie — tez przez proxy.
                   */
                  /*
                   * Zostaje <a href>, mimo ze klik obsluguje podglad: srodkowy przycisk
                   * i Ctrl+klik nadal otwieraja karte, tak jak przy kazdym innym
                   * odnosniku. Przechwytujemy WYLACZNIE zwykly klik.
                   */
                  <a
                    key={f.id}
                    className="comment-img"
                    href={`/api/file/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title={f.name}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      setPreview(gallery.findIndex((g) => g.key === String(f.id)));
                    }}
                  >
                    <img
                      src={`/api/file/${f.id}`}
                      alt={f.name}
                      loading="lazy"
                      width={f.width ?? undefined}
                      height={f.height ?? undefined}
                    />
                  </a>
                ) : (
                  <a
                    key={f.id}
                    className="comment-file"
                    href={`/api/file/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ClipIcon />
                    {f.name}
                  </a>
                ),
              )}
            </div>
          )}
        </article>
        </Fragment>
        );
      })}

      {preview !== null && gallery.length > 0 && (
        <Lightbox files={gallery} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}

      {/*
        Pasek odpowiedzi NAD polem: kogo cytujemy i poczatek jego slow. Sam cytat
        zostaje poza polem, zeby pisanie odpowiedzi wygladalo jak pisanie
        komentarza, a nie jak edycja cudzego tekstu.
      */}
      {replyTo && (
        <div className="reply-bar">
          <ReplyIcon />
          <span className="reply-bar-text">
            <strong>{replyTo.author}</strong>
            <span className="reply-bar-quote">{plainText(replyTo.body)}</span>
          </span>
          <button
            className="reply-bar-x"
            title="Nie odpowiadaj na ten komentarz"
            onClick={() => setReplyTo(null)}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <textarea
        ref={inputRef}
        className="comment-input"
        value={draft}
        /* Sam zachetnik — skroty stoja pod polem i nie znikaja przy pisaniu. */
        placeholder={me ? 'Napisz komentarz…' : 'Brak identyfikatora użytkownika'}
        onPaste={wklej}
        disabled={!me || sending}
        onChange={(e) => {
          setDraft(e.target.value);
          sledzMalpe(e.target, e.target.value, 'new');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === 'Escape' && mention) {
            e.preventDefault();
            closeMention(mention.at);
          }
        }}
      />

      {mention && (
        <Picker
          title="Wspomnij osobę"
          anchor={mention.anchor}
          /* Filtrem jest to, co wpisano PO malpie — picker nie ma wlasnego pola
             i nie zabiera kursora, wiec komentarz pisze sie jednym ciagiem. */
          externalQuery={mention.query}
          /* Zawsze NAD polem — dolna krawedz stoi w miejscu, lista rosnie w gore
             i nigdy nie zaslania pisanego tekstu. */
          above
          options={people
            .filter((p) => p.id !== UNASSIGNED_ID)
            .map((p) => ({ value: String(p.id), label: p.name, photo: p.photo }))}
          emptyLabel="Brak osób"
          onPick={(value) => {
            const p = people.find((x) => x.id === Number(value));
            if (!p) {
              closeMention(mention.at);
              return;
            }
            setMention(null);
            /*
             * Podmieniamy dokladnie fragment „@to-co-wpisano" na „@Imie " i
             * stawiamy kursor za nim, zeby dalo sie pisac dalej bez klikania.
             * Cel zalezy od tego, ktore pole otworzylo liste (`mention.target`).
             */
            const nowe = mention.target === 'new';
            const biezacy = nowe ? draft : (editDrafts[mention.target] ?? '');
            const before = biezacy.slice(0, mention.at);
            const after = biezacy.slice(mention.at + 1 + mention.query.length);
            const insert = `@${p.name} `;
            const dopisz = (m: Person[]) => (m.some((x) => x.id === p.id) ? m : [...m, p]);

            if (nowe) {
              setDraft(`${before}${insert}${after}`);
              setMentioned(dopisz);
            } else {
              const klucz = mention.target;
              setEditDrafts((d) => ({ ...d, [klucz]: `${before}${insert}${after}` }));
              setEditMentions((m) => ({ ...m, [klucz]: dopisz(m[klucz] ?? []) }));
            }
            dismissedAt.current = null;
            requestAnimationFrame(() => {
              const el = nowe ? inputRef.current : editRefs.current[mention.target];
              if (!el) return;
              const pos = before.length + insert.length;
              el.focus();
              el.setSelectionRange(pos, pos);
            });
          }}
          /* Zamkniecie z KAZDEJ drogi (Escape w liscie, klik w tlo) wraca kursorem
             na koniec tego, co wpisano po malpie — pisze sie dalej bez klikania. */
          onClose={() => closeMention(mention.at)}
        />
      )}
      {bigTime && (
        <div className="worktime-ask" ref={askRef}>
          <p>
            Zadanie było „w toku" przez kilka dni. Przyciąć do godzin pracy (bez
            weekendów)?
          </p>
          {/*
            Dwa uchwyty na jednej osi, a nie dwa osobne suwaki: godziny pracy to
            JEDEN zakres, wiec ma wygladac jak jeden. Natywny `range` ma tylko
            jeden uchwyt, stad dwa nalozone inputy — tlo rysuje kontener, a klikac
            da sie wylacznie uchwyty (`pointer-events`).
          */}
          <div className="wt-range-row">
            <span className="wt-range-val">{String(work[0]).padStart(2, '0')}:00</span>
            <div
              className="wt-range"
              style={
                {
                  '--a': `${(work[0] / 24) * 100}%`,
                  '--b': `${(work[1] / 24) * 100}%`,
                } as React.CSSProperties
              }
            >
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={work[0]}
                aria-label="Początek godzin pracy"
                /* Uchwyty nie moga sie minac ani zejsc do zera dlugosci. */
                onChange={(e) => setWork(([, b]) => [Math.min(Number(e.target.value), b - 1), b])}
              />
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={work[1]}
                aria-label="Koniec godzin pracy"
                onChange={(e) => setWork(([a]) => [a, Math.max(Number(e.target.value), a + 1)])}
              />
            </div>
            <span className="wt-range-val">{String(work[1]).padStart(2, '0')}:00</span>
          </div>
          <div className="worktime-ask-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                insertLine(workMs, true);
                setBigTime(null);
              }}
            >
              Przytnij → {formatDurationPl(workMs, true)}
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
            {/*
              Twarde przejscie do nowej linii. Przy samym `flex-wrap` „Anuluj"
              lądował raz obok „Pelny", raz pod nim — zaleznie od szerokosci
              panelu i od tego, jak dlugi wyszedl czas na przyciskach. Rezygnacja
              nie jest trzecim rownorzednym wyborem i nie ma skakac po ekranie.
            */}
            <span className="wt-break" aria-hidden="true" />
            <button className="btn wt-cancel" onClick={() => setBigTime(null)}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      {/*
        Podpowiedz POD polem, nie w placeholderze.
        W placeholderze znikala dokladnie wtedy, gdy zaczynalo sie pisac — czyli
        w chwili, w ktorej „Ctrl+Enter wysyła" staje sie potrzebne. Tu stoi caly
        czas i czyta sie tak samo jak przy edycji.
      */}
      {/*
        Wklejone zrzuty czekajace na wyslanie. Miniatury, a nie nazwy plikow:
        zrzut rozpoznaje sie po tym, co na nim widac, a nie po „zrzut-2026-09-21".
      */}
      {zalaczniki.length > 0 && (
        <div className="paste-list">
          {zalaczniki.map((z, i) => (
            <span className="paste-item" key={`${z.name}-${i}`}>
              <img src={podglady[i]} alt={z.name} />
              <button
                className="paste-x"
                title="Nie wysyłaj tego załącznika"
                onClick={() => setZalaczniki((lista) => lista.filter((_, j) => j !== i))}
              >
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="comment-foot">
        <span className="comment-hint">
          @ wspomina osobę · Ctrl+V wkleja zrzut · Ctrl+Enter wysyła
        </span>
        <div className="comment-actions">
        <button
          className="btn"
          disabled={computing || sending}
          title="Policz czas w statusie „W toku” i wstaw go do komentarza (nie wysyła)"
          onClick={() => void insertWorkTime()}
        >
          {computing ? 'Liczenie…' : 'Wstaw czas pracy'}
        </button>
        <button
          className="btn"
          disabled={(!draft.trim() && !zalaczniki.length) || !me || sending}
          onClick={() => void send()}
        >
          {sending ? 'Wysyłanie…' : 'Dodaj komentarz'}
        </button>
        </div>
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
/**
 * Ile zostalo do terminu — "za 3 dni", "jutro", "dziś", "2 dni po terminie".
 *
 * Sama data nie mowi nic bez liczenia w pamieci, zwlaszcza na przelomie miesiaca.
 * Dopisek stoi PRZY dacie, a nie w osobnym wierszu: to ta sama informacja, tylko
 * podana inaczej.
 *
 * Liczymy w pelnych dniach KALENDARZOWYCH, nie w dobach — jutrzejszy termin ma byc
 * "jutro" takze o 23:50, a nie "za 0 dni". Dlatego obie strony scinamy do lokalnej
 * polnocy. Bitrix trzyma termin z godzina, ale binear ustawia go polem `type="date"`,
 * wiec godzina i tak jest umowna i nie ma czego odliczac dokladniej.
 */
function DeadlineLeft({ value, zrobione }: { value: string; zrobione: boolean }) {
  /*
   * Przerysowanie O POLNOCY. Bez tego okno zostawione na noc pokazuje rano wczorajsze
   * "dziś". Celujemy w najblizsza polnoc, zamiast budzic sie co minute: ta wartosc
   * zmienia sie doslownie raz na dobe. Efekt przezbraja sie po kazdym tyknieciu.
   */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const t = window.setTimeout(() => setTick((n) => n + 1), next - now.getTime() + 1000);
    return () => clearTimeout(t);
  }, [tick, value]);

  if (Number.isNaN(new Date(value).getTime())) return null;

  /* Odleglosc liczy `dueInfo` — ta sama, ktora obsluguje wiersz i karte pod
     kursorem. Wlasny rachunek stal tu wczesniej i dublowal tamten co do minuty. */
  const { days } = dueInfo(value, zrobione);
  const late = -days;

  /* Praca oddana: sama data, tak samo jak w wierszu — bez rosnacego „N dni po
     terminie", ktore przy zadaniu czekajacym na akceptacje niczego nie znaczy. */
  const label = zrobione
    ? shortDate(value)
    : days < 0
      ? `${late} ${late === 1 ? 'dzień' : 'dni'} po terminie`
      : days === 0
        ? 'dziś'
        : days === 1
          ? 'jutro'
          // Bez "za": wiersz jest juz podpisany "Termin" i stoi przy nim data, wiec
          // przyimek powtarzalby to, co pole samo mowi. Zeton niesie sama miare, a
          // kierunek — przed czy po — bierze sie z "po terminie" i z koloru.
          : `${days} dni`;

  /*
   * Kolor z `dueFill` — TEJ SAMEJ funkcji, ktorej uzywa wiersz listy i karta pod
   * kursorem. Wczesniej stala tu wlasna rampa czerwieni rozciagnieta na dwa
   * tygodnie i ten sam termin mial dwa znaczenia naraz: karta mowila „za 8 dni"
   * na zielono („jest zapas"), a panel obok barwil to samo na 30% czerwieni
   * („robi sie ciasno"). Jedna data nie moze dostawac dwoch sprzecznych ocen.
   *
   * Praca ODDANA zostaje szara bez wzgledu na date — tez z `dueFill`.
   */
  return (
    <span className="dd-deadline" style={{ color: dueFill(days, zrobione) }}>
      {label}
    </span>
  );
}

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
        /*
         * Wysylamy date Z GODZINA I Z JAWNA STREFA, nie sama date.
         *
         * Goly „2026-09-18" Bitrix czyta jako polnoc we WLASNEJ strefie (+03:00),
         * czyli u nas (+02:00) 17.09 o 23:00 — termin ladowal dzien wczesniej,
         * niz wybrales. Samo dopisanie „T23:00:00" naprawia dzien, ale nie
         * godzine: Bitrix nadal czyta ja u siebie i pokazuje 22:00.
         *
         * Z jawnym przesunieciem chwila jest jednoznaczna — 23:00 znaczy 23:00
         * po obu stronach. Przesuniecie liczymy DLA WYBRANEGO DNIA, nie dla
         * dzisiaj, zeby zmiana czasu letniego nie przesunela terminu o godzine.
         */
        onChange={(e) => {
          /* Wyczyszczenie pola to PUSTA wartosc — nie ma dnia, do ktorego dokladac
             godzine i strefe (`new Date('T23:00:00')` to Invalid Date i NaN-y). */
          if (!e.target.value) {
            onChange('');
            return;
          }
          const at = new Date(`${e.target.value}T23:00:00`);
          const off = -at.getTimezoneOffset();
          const sign = off < 0 ? '-' : '+';
          const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
          onChange(`${e.target.value}T23:00:00${sign}${pad(off / 60)}:${pad(off % 60)}`);
        }}
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
  fraza,
  people,
  stageName,
  stage,
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
  onConfirm,
  onHistory,
  onError,
}: {
  task: Task;
  /** Szukana fraza — podswietlana w opisie i w komentarzach. */
  fraza: string;
  /** Osoby projektu — do wzmianek `@` w komentarzu. */
  people: Person[];
  stageName: string;
  /** Kolor i postep kolumny — do pierscienia przy polu. `null` poza sprintem. */
  stage: { color: string | null; progress: number | null } | null;
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
  /** To samo okno dla drobniejszych nieodwracalnych — dzis: usuniecie komentarza. */
  onConfirm: (state: ConfirmState) => void;
  /** Otwiera dziennik zawezony do tego zadania. */
  onHistory: (taskId: number) => void;
  onError: (m: string) => void;
}) {
  // Opis nie jedzie w liscie (bylby kilka MB dla ~1000 zadan) — dociagamy przy otwarciu.
  // Startujemy od CACHE (patrz detailCache.ts): przy ponownym otwarciu widac je od
  // razu, bez pustki. Potem i tak pytamy Bitrix i podmieniamy, gdy cos sie zmienilo.
  const [detail, setDetail] = useState<TaskDetail | null>(() => getCachedDetail(task.id));
  const [detailError, setDetailError] = useState(false);

  /*
   * Podglad obrazkow Z OPISU. Trzymamy komplet (lista + pozycja) w jednym stanie, bo
   * przy obrazku spoza zalacznikow galeria sklada sie tylko z niego — sam indeks nie
   * mialby wtedy do czego wskazywac.
   */
  const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number } | null>(null);

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

  /* Wszystkie obrazki zadania — takze te doczepione, a nie wstawione w opis; skoro
     podglad juz jest, ma po czym chodzic strzalkami. */
  const descGallery = useMemo<PreviewItem[]>(
    () =>
      (detail?.attachments ?? [])
        .filter((a) => a.image)
        .map((a) => ({ key: String(a.id), name: a.name, src: `/api/attach/${a.id}` })),
    [detail],
  );

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
  /** Otwarty wybor osob: ktore pole zadania i pod czym powiesic popover. */
  const [peoplePick, setPeoplePick] = useState<{
    field: 'ACCOMPLICES' | 'AUDITORS';
    anchor: Anchor;
    /*
     * Kolejnosc osob ZAMROZONA na moment otwarcia: juz dopisani na gorze, reszta pod
     * nimi. Gdyby liczyc ja na biezaco, kazde klikniecie przerzucalo by osobe na gore
     * i lista skakalaby pod kursorem — przy dopisywaniu kilku osob z rzedu nie dalo by
     * sie trafic w kolejna. Ptaszki zmieniaja sie od razu, pozycje dopiero po ponownym
     * otwarciu.
     */
    order: number[];
  } | null>(null);

  /*
   * Dopisanie/zdjecie osoby. Optymistycznie, tak samo jak checklista: `detail` to
   * stan lokalny panelu, wiec i zmiana, i cofniecie ida przez `setDetail`.
   *
   * Toggle, a nie osobne "dodaj"/"usun": picker jest wielokrotny i pokazuje ptaszki
   * przy juz wybranych, wiec ten sam klik naturalnie znaczy raz jedno, raz drugie.
   */
  const toggleParticipant = (field: 'ACCOMPLICES' | 'AUDITORS', person: Person) => {
    const key = field === 'AUDITORS' ? 'auditors' : 'accomplices';
    const before = detail?.[key] ?? [];
    const next = before.some((p) => p.id === person.id)
      ? before.filter((p) => p.id !== person.id)
      : [...before, person];

    setDetail((d) => (d ? { ...d, [key]: next } : d));
    updateParticipants(task.id, field, next.map((p) => p.id)).catch((e) => {
      setDetail((d) => (d ? { ...d, [key]: before } : d));
      onError(`Nie udało się zmienić osób: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

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

  /* Szczegoly TEGO zadania, a nie jakiekolwiek — patrz `TaskDetail.taskId`. */
  const mine = detail?.taskId === task.id ? detail : null;

  return (
    <aside className="detail" style={{ width }}>
      <div className="detail-resizer" onMouseDown={startResize} title="Przeciągnij, aby zmienić szerokość" />
      <div className="detail-head">
        {/*
          Numer zadania zostaje widoczny TAKZE po nadaniu kodu IT: kod idzie w
          galaz i commit, ale numer to adres zadania i to po nim szuka Bitrix.
          Oba kopiuja sie kliknieciem.
        */}
        <span className="detail-codes">
          <TaskCode code={task.code ?? `#${task.id}`} copy={task.code ?? String(task.id)} onCopied={() => {}} />
          {task.code && <TaskCode code={`#${task.id}`} copy={String(task.id)} onCopied={() => {}} />}
        </span>
        <div className="detail-head-right">
          {/*
            Droga w druga strone niz z dziennika do zadania: stad pytamy „co
            binear zrobil TEMU zadaniu". Bez tego trzeba bylo otworzyc dziennik
            i szukac w nim wierszy tego zadania recznie.
          */}
          <button
            className="icon-btn"
            onClick={() => onHistory(task.id)}
            title="Co binear zapisał w tym zadaniu"
          >
            <HistoryIcon />
          </button>
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
          {/*
            Pola w TRZECH grupach, tym samym podzialem co menu „+ Filtr" (patrz
            `FILTER_FIELDS`): gdzie w procesie — kto — o czym.
            Wczesniej szly w kolejnosci dopisywania i dlatego czytalo sie to jak
            wysypana szuflada: „Osoba" i „Autor" odpowiadaja na to samo pytanie,
            a stali po dwoch stronach panelu; „Utworzone" wchodzilo miedzy termin
            a status; story pointy siedzialy miedzy epikiem a priorytetem.
          */}
          {/* ── gdzie w procesie ────────────────────────────────────────── */}
          {/* Etap pierwszy — to on niesie stan pracy w tej grupie. */}
          <dt title={PICKER_HELP.stage}>Etap</dt>
          <dd>
            <FieldButton kind="stage" onPick={onPick}>
              {/*
                Pierscien jak przy statusie i priorytecie obok — a przede
                wszystkim TEN SAM, ktory to zadanie ma w wierszu listy i na
                karcie tablicy. Poza sprintem etapu nie ma, wiec nie ma tez czego
                rysowac: zostaje sama nazwa („Poza sprintem").
              */}
              {stage && <StageIcon progress={stage.progress} color={stage.color} />}{' '}
              {stageName}
            </FieldButton>
          </dd>
          {/*
            Status ZARAZ POD ETAPEM, choc przygaszony.
            Kiedys stal na samym koncu, zeby nie udawal stanu pracy — wtedy byl od
            etapu niezalezny. Dzis przeniesienie karty do kolumny samo go ustawia
            (patrz `moveToStage`), wiec to dwa odczyty tej samej rzeczy. Obok
            siebie widac, gdy sie ROZJADA — „Wdrożone" przy statusie „W toku" to
            sygnal, ze cos poszlo nie tak; rozdzielone czterema wierszami bylo
            niewidoczne. Rangi nie zrownuje: etap jest pierwszy i pelna jasnoscia.
          */}
          <dt title={PICKER_HELP.status}>Status</dt>
          <dd className="dd-dim">
            <FieldButton kind="status" onPick={onPick}>
              <StatusIcon status={task.status} /> {labels.status[task.status] ?? task.status}
            </FieldButton>
          </dd>
          <dt title={PICKER_HELP.sprint}>Sprint</dt>
          <dd>
            <FieldButton kind="sprint" onPick={onPick}>
              {sprintName}
            </FieldButton>
          </dd>
          <dt title={PICKER_HELP.priority}>Priorytet</dt>
          <dd>
            <FieldButton kind="priority" onPick={onPick}>
              <PriorityIcon priority={task.priority} /> {labels.priority[task.priority] ?? '—'}
            </FieldButton>
          </dd>
          <dt>Termin</dt>
          <dd className="dd-deadline-cell">
            <DateField value={task.deadline} onChange={onDeadline} />
            {task.deadline && <DeadlineLeft value={task.deadline} zrobione={oddane(task.status)} />}
          </dd>

          {/* ── kto ─────────────────────────────────────────────────────── */}
          <div className="props-gap" />
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
          {detail?.creatorName && (
            <>
              <dt>Autor</dt>
              <dd>
                <PersonInline name={detail.creatorName} photo={detail.creatorPhoto} />
              </dd>
            </>
          )}
          {/* Data zalozenia trzyma sie autora — „kto i kiedy" to jedno pytanie. */}
          <dt>Utworzone</dt>
          <dd>{shortDate(task.createdDate) || '—'}</dd>

          {/* ── o czym ──────────────────────────────────────────────────── */}
          <div className="props-gap" />
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
        </dl>

        {/* Relacje zadania w JEDNEJ sekcji: nadrzedne (hierarchia Bitriksa) + powiazane
            (DEPENDS_ON). Oddzielone kreska od opisu/podzadan ponizej. */}
        <div className="rel-block">
          {/* Nadrzędne: selektor (ustaw/zmień/odepnij — ten sam picker „parent") w naglowku,
              a pod nim wiersz do PRZEJSCIA do rodzica, gdy jest ustawiony. */}
          <div className={`rel-head${parent || task.parentId ? '' : ' rel-head-empty'}`}>
            <span className="relation-kind">Nadrzędne</span>
            {/*
              Pusty rodzic dostaje DOKLADNIE ten sam przycisk co "Powiązane": ten sam
              ksztalt, ten sam rozmiar, to samo zachowanie pod kursorem. Wczesniej
              stal tu `FieldButton`, ktory sam dokłada strzalke — wiec nawet po
              zrownaniu znaku ("+" zamiast kreski) jeden wiersz pokazywal na hover
              strzalke, a drugi nic. Dwa sasiadujace wiersze robiace to samo nie moga
              inaczej reagowac na najechanie.

              Gdy rodzic JEST ustawiony, wraca `FieldButton` ze strzalka — bo to juz
              WARTOSC do zmiany, jak priorytet czy osoba, a nie puste miejsce do
              wypelnienia.
            */}
            {parent || task.parentId ? (
              <FieldButton kind="parent" onPick={onPick}>
                {parent ? (parent.code ?? `#${parent.id}`) : `#${task.parentId}`}
              </FieldButton>
            ) : (
              <button
                className="rel-add"
                title="Ustaw zadanie nadrzędne"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onPick('parent', { left: r.left, top: r.top, bottom: r.bottom });
                }}
              >
                +
              </button>
            )}
          </div>
          {parent && (
            <button className="relation" onClick={() => onOpenTask(parent.id)}>
              <StatusIcon status={parent.status} />
              <span className="row-code">{parent.code ?? `#${parent.id}`}</span>
              <span className="relation-title">{parent.title || parent.rawTitle}</span>
            </button>
          )}

          <div className={`rel-head${related.length ? '' : ' rel-head-empty'}`}>
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

        {/*
          Klik w obrazek z opisu otwiera ten sam podglad, co w komentarzach. Lapiemy
          go DELEGACJA na kontenerze, a nie uchwytem na samym <img>: obrazki rysuje
          `renderDescription`, ktory jest zwyklym parserem tekstu i nie ma prawa
          wiedziec niczego o podgladzie.
        */}
        <div
          className="desc"
          onClick={(e) => {
            const el = e.target as HTMLElement;
            if (!(el instanceof HTMLImageElement) || !el.classList.contains('desc-img')) return;
            const src = el.getAttribute('src') ?? '';
            const i = descGallery.findIndex((g) => g.src === src);
            // Obrazek spoza listy zalacznikow (sciezka awaryjna) tez ma sie powiekszac —
            // wtedy galeria sklada sie z niego jednego.
            setPreview(
              i >= 0
                ? { items: descGallery, index: i }
                : { items: [{ key: src, name: el.getAttribute('alt') || '', src }], index: 0 },
            );
          }}
        >
          {detailError && <p className="desc-dim">Nie udało się pobrać szczegółów.</p>}
          {!detailError && detail === null && <p className="desc-dim">Wczytywanie…</p>}
          {/* Opis idzie przez parser markdown/BB — najbardziej „obcy" input w calej
              aplikacji. Wlasna siatka bezpieczenstwa, zeby jeden dziwny opis psul
              najwyzej swoja ramke, a nie caly panel zadania. */}
          {detail &&
            (detail.description.trim() ? (
              <ErrorBoundary where="opis zadania">
                {renderDescription(detail.description, (objectId) => {
                  /*
                   * Opis wskazuje obrazek numerem obiektu na Dysku, a bajty wydaje
                   * dopiero rekord DOCZEPIENIA — stad przeklad przez `attachments`.
                   * Gdy zadanie nie ma pasujacego doczepienia (obrazek z innego
                   * zadania, plik usuniety), probujemy jeszcze zwyklej sciezki
                   * dyskowej: dla czesci plikow dziala, a gdy nie — renderer
                   * pokaze "[obrazek niedostępny]" zamiast polamanej ikonki.
                   */
                  const a = detail.attachments.find((x) => x.objectId === objectId);
                  return a ? `/api/attach/${a.id}` : `/api/file/${objectId}`;
                }, fraza)}
              </ErrorBoundary>
            ) : (
              <p className="desc-dim">Brak opisu.</p>
            ))}
        </div>

        {/*
          Pliki doczepione do zadania. Bitrix pokazuje je osobna sekcja pod trescia i
          my tak samo: obrazek wstawiony W OPIS to co innego niz plik DOCZEPIONY, a
          zadanie miewa wylacznie te drugie — wtedy bez tej sekcji opis mowi o pliku,
          ktorego nigdzie nie widac (np. 116137: opis wspomina "image (173).png",
          a sam plik wisial niepokazany).

          Lista jest PELNA, tak jak w Bitriksie: obrazek uzyty w opisie pojawia sie
          i tu, i tam. Ukrywanie go tutaj wymagaloby zgadywania, ktore wystapienie
          jest "tym wlasciwym", a licznik "Pliki: N" przestalby zgadzac sie z Bitriksem.
        */}
        {detail && detail.attachments.length > 0 && (
          <div className="attachments">
            <div className="attachments-head">
              <ClipIcon />
              Pliki: {detail.attachments.length}
            </div>
            <div className="attachments-grid">
              {detail.attachments.map((a) =>
                a.image ? (
                  <button
                    key={a.id}
                    className="attach-card"
                    title={a.name}
                    onClick={() => {
                      const i = descGallery.findIndex((g) => g.key === String(a.id));
                      setPreview({
                        items: i >= 0 ? descGallery : [{ key: String(a.id), name: a.name, src: `/api/attach/${a.id}` }],
                        index: i >= 0 ? i : 0,
                      });
                    }}
                  >
                    <img src={`/api/attach/${a.id}`} alt={a.name} loading="lazy" />
                    <span className="attach-name">{a.name}</span>
                  </button>
                ) : (
                  <a
                    key={a.id}
                    className="attach-file"
                    href={`/api/attach/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title={a.name}
                  >
                    <ClipIcon />
                    <span className="attach-name">{a.name}</span>
                  </a>
                ),
              )}
            </div>
          </div>
        )}

        {preview && (
          <Lightbox
            files={preview.items}
            index={preview.index}
            onIndex={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
            onClose={() => setPreview(null)}
          />
        )}

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

        {/*
          Sekcja stoi ZAWSZE, takze przy pustych listach. Wczesniej pojawiala sie
          dopiero, gdy ktos byl juz dopisany — czyli w zadaniu bez obserwatorow nie
          bylo ani naglowka, ani sladu, ze cos takiego istnieje, a tym bardziej
          sposobu, zeby kogos dodac.
        */}
        {detail && (
          <section className="subtasks">
            {([
              { field: 'ACCOMPLICES', label: 'Współwykonawcy', list: detail.accomplices },
              { field: 'AUDITORS', label: 'Obserwatorzy', list: detail.auditors },
            ] as const).map(({ field, label, list }) => (
              <div key={field} className={`people-group${list.length ? '' : ' people-group-empty'}`}>
                {/*
                  "+" siedzi PRZY NAGLOWKU, nie w rzedzie osob. Przy pustej liscie
                  samotny krazek zajmowal caly wiersz tylko po to, zeby nic nie
                  pokazac — i lgnal do naglowka sekcji ponizej. Na etykiecie kosztuje
                  zero miejsca i jest w tym samym punkcie niezaleznie od tego, czy
                  ktos juz jest dopisany.
                */}
                <h2 className="people-head">
                  {label}
                  <button
                    className="people-edit"
                    title={`Dodaj lub usuń: ${label.toLowerCase()}`}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const chosen = new Set(list.map((p) => p.id));
                      setPeoplePick({
                        field,
                        anchor: { left: r.left, top: r.top, bottom: r.bottom },
                        order: [
                          ...people.filter((p) => chosen.has(p.id)),
                          ...people.filter((p) => !chosen.has(p.id)),
                        ].map((p) => p.id),
                      });
                    }}
                  >
                    +
                  </button>
                </h2>
                {/* Pusta lista nie rezerwuje wiersza — nie ma czego w nim pokazac. */}
                {list.length > 0 && (
                <div className="people">
                  {list.map((p) => (
                    <span key={p.id} className="person">
                      <PersonInline name={p.name} photo={p.photo} />
                      {/*
                        Usuwanie WPROST z osoby. Wczesniej jedyna droga bylo otwarcie
                        "+" i odklikniecie ptaszka — czyli usuwanie schowane pod
                        przyciskiem, ktory glosi "dodaj". Nikt tego nie znajdzie.
                      */}
                      <button
                        className="person-del"
                        title={`Usuń: ${p.name}`}
                        onClick={() => toggleParticipant(field, p)}
                      >
                        <CloseIcon />
                      </button>
                    </span>
                  ))}
                </div>
                )}
              </div>
            ))}
          </section>
        )}

        {peoplePick && detail && (
          <Picker
            multi
            title={peoplePick.field === 'AUDITORS' ? 'Obserwatorzy' : 'Współwykonawcy'}
            anchor={peoplePick.anchor}
            placeholder="Szukaj osoby…"
            options={(() => {
              const byId = new Map(people.map((p) => [p.id, p]));
              const chosen = new Set(
                (peoplePick.field === 'AUDITORS' ? detail.auditors : detail.accomplices).map((p) => p.id),
              );
              // Kreska pod ostatnim JUZ DOPISANYM — granica miedzy "ci sa" a "tych mozna dodac".
              let drew = false;
              return peoplePick.order
                .map((id) => byId.get(id))
                .filter((p): p is Person => Boolean(p))
                .map((p) => {
                  const first = !chosen.has(p.id) && !drew;
                  if (first) drew = true;
                  return {
                    value: String(p.id),
                    label: p.name,
                    photo: p.photo,
                    divider: first && chosen.size > 0,
                  };
                });
            })()}
            selected={(peoplePick.field === 'AUDITORS' ? detail.auditors : detail.accomplices).map((p) =>
              String(p.id),
            )}
            emptyLabel="Brak osób"
            onToggle={(value) => {
              const p = people.find((x) => x.id === Number(value));
              if (p) toggleParticipant(peoplePick.field, p);
            }}
            onPick={() => {}}
            onClose={() => setPeoplePick(null)}
          />
        )}

        {/*
          `key` wymusza swiezy komponent na kazde zadanie. Bez tego React trzymal
          jedna instancje i wolniejsze zapytanie z POPRZEDNIEGO zadania potrafilo
          nadpisac wynik biezacego — komentarze pojawialy sie i znikaly zaleznie
          od tego, ktora odpowiedz przyszla ostatnia. Przy okazji czysci sie
          niedokonczona tresc w polu komentarza.
        */}
        {/*
          `chatId` MUSI pochodzic z detalu TEGO zadania.
          Panel nie jest kluczowany po zadaniu, wiec przy przelaczeniu renderuje sie
          najpierw z `detail` POPRZEDNIEGO (czyszczenie leci w efekcie, czyli po
          renderze). `Comments` — kluczowane — montowalo sie wtedy z nowym `taskId`,
          starym `chatId` i `ready` juz `true`, a `fetchComments` sklada forum ZADANIA
          z czatem CHAT-ID. Wynik: cudzy watek, zapisany w cache pod nowym id — stad
          komentarze, ktore nie mijaly po przelaczeniu zadania.
        */}
        <Comments
          key={task.id}
          taskId={task.id}
          fraza={fraza}
          chatId={mine?.chatId ?? null}
          ready={mine !== null || detailError}
          me={me}
          people={people}
          onConfirm={onConfirm}
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
  { keys: ['X'], label: 'Wyczyść filtry i wyszukiwanie' },
  { keys: ['V'], label: 'Zapisane widoki — potem 1…9 wybiera widok' },
  { keys: ['1', '2', '3', '4'], label: 'Lista / Tablica / Wykresy / Planowanie' },
  { keys: ['W'], label: 'Sprint — wrzuć do sprintu albo do backlogu' },
  { keys: ['M'], label: 'Etap w sprincie' },
  { keys: ['A'], label: 'Osoba odpowiedzialna' },
  { keys: ['P'], label: 'Priorytet' },
  { keys: ['S'], label: 'Status (z potwierdzeniem)' },
  { keys: [MOD, 'Enter'], label: 'Wyślij komentarz' },
  { keys: ['D'], label: 'Dziennik akcji — co binear zapisał do Bitriksa' },
  { keys: ['?'], label: 'Ta ściągawka' },
];

/**
 * "Uzupelnij braki" przed wejsciem do sprintu.
 *
 * Okno PYTA, nie blokuje. Zadanie bez story pointow jest niewidoczne dla wykresu
 * spalania i dla kazdej sumy SP, a bez osoby nie da sie rozlozyc obciazenia —
 * czyli przepada dokladnie to, po co planowanie istnieje. Ale bywa, ze chodzi
 * o szybkie i brudne wrzucenie, wiec "Wrzuć tak czy siak" jest rownorzednym
 * wyjsciem, a nie schowanym linkiem.
 *
 * Braki tylko POKAZUJEMY. Uzupelnia sie je w panelu zadania, gdzie sa wszystkie
 * pola i podpowiedzi — powielanie tych kontrolek tutaj znaczyloby drugie miejsce
 * do utrzymania i drugi zestaw bledow.
 */
function GapPrompt({
  tasks,
  sprintName,
  onOpen,
  onSkip,
  onCancel,
}: {
  tasks: Task[];
  sprintName: string;
  onOpen: (id: number) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const gaps = (t: Task) =>
    [
      t.storyPoints === null ? 'story pointy' : null,
      isUnassigned(t.responsibleId) ? 'osoba' : null,
      t.tags.length === 0 && !t.epicId ? 'tag lub epik' : null,
    ].filter(Boolean) as string[];

  return (
    <>
      <div className="palette-backdrop" onClick={onCancel} />
      <div className="palette shortcuts" role="dialog" aria-label="Uzupełnij braki">
        <div className="palette-section">
          {tasks.length === 1 ? 'Temu zadaniu czegoś brakuje' : `Tym zadaniom czegoś brakuje (${tasks.length})`}
        </div>

        <div className="palette-list">
          {tasks.map((t) => (
            <button key={t.id} className="gap-row" onClick={() => onOpen(t.id)}>
              <span className="gap-code">{t.code ?? `#${t.id}`}</span>
              <span className="gap-title">{t.title || t.rawTitle}</span>
              <span className="gap-what">{gaps(t).join(', ')}</span>
            </button>
          ))}
        </div>

        <div className="palette-foot gap-foot">
          <span>
            Bez story pointów zadanie nie pojawi się na wykresie spalania ani w żadnej sumie SP.
            Kliknij wiersz, żeby otworzyć zadanie i uzupełnić.
          </span>
          <span className="gap-actions">
            <button className="btn" onClick={onCancel}>
              Anuluj
            </button>
            <button className="btn btn-primary" onClick={onSkip}>
              Wrzuć do „{sprintName}” tak czy siak
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

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
  style,
  dataGroup,
  children,
}: {
  id: string;
  tag: 'section' | 'div';
  disabled?: boolean;
  className?: string;
  /** Nosnik `--group-tint` — koloru grupy nie da sie zapisac w arkuszu. */
  style?: CSSProperties;
  dataGroup?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id, disabled });
  const cls = [className, isOver && active ? 'group-over' : null].filter(Boolean).join(' ');

  return tag === 'section' ? (
    <section ref={setNodeRef} className={cls || undefined} style={style} data-group={dataGroup}>
      {children}
    </section>
  ) : (
    <div ref={setNodeRef} className={cls || undefined} style={style}>
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
    /** Wariant kolorowania grup listy — do porownania na zywo. */
    tint: ListTint;
    deadline: DeadlineLook;
    empty: boolean;
    counters: boolean;
    /** Kafelki do wyboru w panelu olowka — klucz, podpis, czy widoczny. */
    counterTiles: { key: string; label: string; shown: boolean }[];
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
    tint: (v: ListTint) => void;
    deadline: (v: DeadlineLook) => void;
    empty: () => void;
    counters: () => void;
    counterTile: (key: string) => void;
    toggleColumn: (name: string) => void;
    clearFilters: () => void;
    reload: () => void;
    palette: () => void;
    theme: (t: Theme) => void;
    font: (f: Font) => void;
  };
}) {
  const Control = DisplaySelect;
  /* 372, nie 300: czwarta zakladka („Planowanie") nie miescila sie obok ikony
     i podpis wchodzil na sasiedni. Szerszy panel daje tez oddech wierszom
     „etykieta + kontrolka" ponizej. */
  const width = 372;
  const height = 510;
  const rowClass = 'ds-row';
  // Tablica to zawsze kanban po etapach — grupowanie i podgrupowanie jej nie dotycza,
  // wiec na tablicy oba wiersze sa wyszarzone i nieklikalne (patrz .ds-row-off).
  // Wykresy i planowanie, tak jak tablica, nie maja czego grupowac — kazdy z nich
  // ma wlasny, staly podzial. Stad warunek "cokolwiek poza lista".
  const boardMode = state.view !== 'list';
  /* Planowanie ma wlasne filtry i wlasny podzial — czesc wierszy panelu go nie dotyczy. */
  const planMode = state.view === 'planning';
  const groupRow = `${rowClass}${boardMode ? ' ds-row-off' : ''}`;

  // Panel „Kolumny/Grupy" wyskakuje jako OSOBNY panel obok (panel w panelu), nie sekcja.
  const [colsOpen, setColsOpen] = useState(false);
  /* Panel olowka przy „Pokaż liczniki": ktore kafelki maja byc widoczne. */
  const [tilesOpen, setTilesOpen] = useState(false);
  const tilesOff = !state.counters || planMode;
  useEffect(() => {
    if (tilesOff) setTilesOpen(false);
  }, [tilesOff]);
  const [permsOpen, setPermsOpen] = useState(false);
  // Nazwa mowi, po co ten panel jest: trzymac PUSTE kategorie widoczne mimo braku zadan.
  const colTitle = boardMode
    ? 'Puste kolumny'
    : state.subGroup
      ? 'Puste podgrupy'
      : 'Puste grupy';

  // `height` sluzy tylko do tego, by panel nie wyjechal pod dolna krawedz ekranu.
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
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
          <button
            role="tab"
            aria-selected={state.view === 'charts'}
            className={`ds-tab${state.view === 'charts' ? ' ds-tab-on' : ''}`}
            onClick={() => on.view('charts')}
          >
            <ChartIcon /> Wykresy
          </button>
          <button
            role="tab"
            aria-selected={state.view === 'planning'}
            className={`ds-tab${state.view === 'planning' ? ' ds-tab-on' : ''}`}
            onClick={() => on.view('planning')}
          >
            <PlanIcon /> Planowanie
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
              ...GROUPS.filter((g) => g.key !== state.group && g.key !== 'flat').map((g) => ({
                value: g.key,
                label: g.label,
              })),
            ]}
            onPick={(v) => on.subGroup(v === 'none' ? null : (v as GroupBy))}
            /* Bez grupowania podgrupy nie maja sie w czym zawrzec. Kontrolka
               zostaje widoczna, ale nieklikalna — zeby bylo widac, ze to skutek
               wyboru obok, a nie brak funkcji. */
            disabled={boardMode || state.group === 'flat'}
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

        {/* Kolor grup listy — trzy warianty obok siebie, zeby dalo sie je porownac
            na zywo zamiast wybierac z opisu. */}
        <div className={rowClass}>
          <span className="ds-label">Kolor grup</span>
          <Control
            value={state.tint}
            options={LIST_TINTS.map((t) => ({ value: t.key, label: t.label }))}
            onPick={(v) => on.tint(v as ListTint)}
          />
        </div>

        {/* Termin w wierszu — dwa warianty, tak samo do porownania na zywo. */}
        <div className={rowClass}>
          <span className="ds-label">Termin</span>
          <Control
            value={state.deadline}
            options={DEADLINE_LOOKS.map((d) => ({ value: d.key, label: d.label }))}
            onPick={(v) => on.deadline(v as DeadlineLook)}
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
        {/*
          W planowaniu ten przelacznik nie dziala — ten widok ma wlasny odsiew,
          w swoim menu „Opcje" (osobno zakonczone, osobno oddane do akceptacji,
          bo w Bitriksie to status 5 i 4, a nie jedno). Wygaszamy go tutaj,
          zamiast zostawiac przycisk, ktory nic nie robi.
        */}
        {check('Pokaż zakończone', state.done, on.done, planMode)}
        {/* Liczniki sa tylko nad lista i tablica — w planowaniu nie ma ich czym chowac. */}
        {/*
          Olowek obok: dobor kafelkow. Wygaszony, gdy licznikow nie ma — nie ma
          wtedy czego dobierac.
        */}
        {/*
          Kolejnosc: podpis, olowek, przelacznik — przelacznik zostaje na prawej
          krawedzi, w jednej linii z pozostalymi. Olowek NIE moze siedziec w
          `<label>`: przycisk jest kontrolka, wiec label przejalby go i klik w
          podpis otwieralby panel zamiast przelaczac. Stad `htmlFor`.
        */}
        <div className={`ds-check ds-check-row${planMode ? ' ds-check-off' : ''}`}>
          <label htmlFor="ds-show-counters" className="ds-check-row-label">
            Pokaż liczniki
          </label>
          <button
            className={`ds-check-edit${tilesOpen ? ' ds-check-edit-on' : ''}`}
            disabled={tilesOff}
            title={tilesOff ? 'Włącz liczniki, żeby wybrać kafelki' : 'Wybierz, które kafelki widać'}
            onClick={() => {
              setColsOpen(false);
              setPermsOpen(false);
              setTilesOpen((o) => !o);
            }}
          >
            <PenIcon />
          </button>
          <input
            id="ds-show-counters"
            type="checkbox"
            checked={state.counters}
            disabled={planMode}
            onChange={on.counters}
          />
        </div>

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
        {/* Co ten webhook potrafi — przydatne po podmianie tokenu na inny portal. */}
        <button
          className={`menu-item${permsOpen ? ' menu-item-on' : ''}`}
          onClick={() => setPermsOpen((o) => !o)}
        >
          <span className="menu-check" />
          <span className="menu-label">Uprawnienia webhooka</span>
          <span className="menu-flyarrow">
            <ChevronIcon open={permsOpen} />
          </span>
        </button>
      </div>

      {permsOpen && <PermsFlyout left={flyLeft} top={top} width={flyW} />}

      {/* Dobor kafelkow licznikow — ten sam panel obok co „Puste grupy". */}
      {tilesOpen && (
        <div className="menu view-cols-flyout" style={{ left: flyLeft, top, width: flyW }}>
          <div className="ds-colhead">Kafelki liczników</div>
          <div className="ds-colhint">Odznacz te, których nie potrzebujesz. Liczby się nie zmieniają.</div>
          {state.counterTiles.map((t) => (
            <label key={t.key} className="ds-check">
              <span>{t.label}</span>
              <input type="checkbox" checked={t.shown} onChange={() => on.counterTile(t.key)} />
            </label>
          ))}
        </div>
      )}

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

/**
 * „Uprawnienia webhooka" — co ten token potrafi, a czego nie.
 *
 * Binear da sie uruchomic na dowolnym webhooku i wtedy pierwsze pytanie brzmi
 * „czego mu brakuje". Dotad odpowiedz wymagala recznego strzelania do kilkunastu
 * metod i czytania kodow bledu; tu wystarczy jedno klikniecie.
 *
 * Sondy ida BEZ PARAMETROW, wiec niczego nie zapisuja — nawet te przy metodach
 * kasujacych. Patrz `probeMethod`.
 */
function PermsFlyout({ left, top, width }: { left: number; top: number; width: number }) {
  /* Klucz to POZYCJA na liscie, nie nazwa metody: `timeman.status` wystepuje
     trzy razy, za kazdym razem z innym pytaniem. */
  const [wyniki, setWyniki] = useState<Record<number, { stan: ProbeStan; opis: string }>>({});
  const [trwa, setTrwa] = useState(false);
  /* `null` = schowek odmowil. Trojstan, bo „nie udalo sie" musi wygladac inaczej
     niz „jeszcze nie klikales". */
  const [skopiowane, setSkopiowane] = useState<boolean | null>(false);

  const sprawdz = async () => {
    if (trwa) return;
    setTrwa(true);
    setWyniki({});

    /*
     * Kontekst: kim jestem i kto JESZCZE istnieje. Bez drugiej osoby nie da sie
     * zapytac „czy widze cudze dane", a to jedno z dwoch pytan, po ktore sie tu
     * przychodzi. Data sprzed tygodnia sluzy drugiemu — „czy widze wstecz".
     */
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => null);
    const ja = Number(cfg?.userId) || null;
    const tydzienTemu = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    let ktosInny: number | null = null;
    try {
      const lista = (await probeMethod('user.get')).wynik as { ID?: string }[] | undefined;
      ktosInny = lista?.map((u) => Number(u?.ID)).find((id) => id && id !== ja) ?? null;
    } catch {
      /* Bez drugiej osoby te jedna sonde po prostu pominiemy. */
    }
    const kontekst: Kontekst = { ja, ktosInny, dawno: tydzienTemu };

    /* Po kolei, nie rownolegle: kilkanascie metod naraz wchodzi prosto w limit
       zapytan portalu, a tu nie zalezy nam na czasie, tylko na wyniku. */
    for (const [i, p] of POZYCJE.entries()) {
      const params = p.params?.(kontekst);
      if (p.params && !params) {
        setWyniki((w) => ({ ...w, [i]: { stan: 'blad', opis: 'brak danych do sprawdzenia' } }));
        continue;
      }
      /*
       * Limit czasu na sonde. Bez niego jedno zapytanie, ktore wpadlo w limit
       * portalu, ponawia sie po cichu nawet pol godziny — a panel wyglada wtedy
       * na zawieszony. Lepiej powiedziec „nie zdazylo" i isc dalej.
       */
      const r = await Promise.race([
        probeMethod(p.method, params ?? {}),
        new Promise<{ stan: ProbeStan; opis: string; wynik?: unknown }>((res) =>
          setTimeout(() => res({ stan: 'blad', opis: 'brak odpowiedzi — limit zapytań portalu?' }), 12000),
        ),
      ]);
      /*
       * Trzy stopnie, nie dwa. „Osiagalna" (odbila sie o brak parametrow) to co
       * innego niz „odpowiedziala" — a ta druga dzieli sie jeszcze na „z danymi"
       * i „pusto". Doklejamy wiec do werdyktu streszczenie tresci, bo inaczej
       * pusty raport czasu pracy wyglada jak dzialajacy raport czasu pracy.
       */
      const ocena = p.ocena && r.stan === 'ok'
        ? p.ocena(r.wynik, kontekst)
        : r.stan === 'ok' && 'wynik' in r
          ? { stan: r.stan, opis: `działa — ${opisWyniku(r.wynik)}` }
          : r;
      setWyniki((w) => ({ ...w, [i]: ocena }));
    }
    setTrwa(false);
  };

  const zrobione = Object.keys(wyniki).length;

  return (
    <div className="menu perms-flyout" style={{ left, top, width: width + 120 }}>
      <div className="ds-colhead">Uprawnienia webhooka</div>
      <div className="ds-colhint">
        Sprawdza, co ten token potrafi. Nic nie zapisuje — wołamy wyłącznie odczyty, a resztę
        bez parametrów. „Osiągalna” znaczy tylko tyle, że metoda istnieje; dopiero „działa —
        N poz.” znaczy, że są dane.
      </div>
      <div className="perms-actions">
        <button className="btn perms-run" disabled={trwa} onClick={() => void sprawdz()}>
          {trwa ? `Sprawdzanie… ${zrobione}/${POZYCJE.length}` : 'Sprawdź'}
        </button>
        {/* Panel czesto uruchamia sie na CUDZYM webhooku (np. administratora),
            wiec wynik musi dac sie stamtad wyniesc jednym kliknieciem. */}
        <button
          className="btn"
          disabled={!zrobione}
          onClick={() => {
            const tekst = SPRAWDZENIA.map((g) =>
              [
                `## ${g.nazwa}`,
                ...g.pozycje.map((p) => {
                  const r = wyniki[POZYCJE.indexOf(p)];
                  return `[${r?.stan ?? '?'}] ${p.po_co} — ${p.method} — ${r?.opis ?? 'nie sprawdzono'}`;
                }),
              ].join('\n'),
            ).join('\n\n');
            /* Potwierdzenie i obsluga odmowy jak przy kopiowaniu kodu zadania
               (`TaskCode`) — schowek potrafi odmowic i cisza znaczylaby wtedy
               „skopiowane". */
            void navigator.clipboard
              .writeText(tekst)
              .then(() => {
                setSkopiowane(true);
                setTimeout(() => setSkopiowane(false), 1200);
              })
              .catch(() => setSkopiowane(null));
          }}
        >
          {skopiowane === null ? 'Nie udało się' : skopiowane ? 'Skopiowano' : 'Kopiuj wynik'}
        </button>
      </div>

      <div className="perms-list">
        {SPRAWDZENIA.map((g) => (
          <Fragment key={g.nazwa}>
            <div className="perms-group">{g.nazwa}</div>
            {g.pozycje.map((p) => {
              const r = wyniki[POZYCJE.indexOf(p)];
              return (
                <div key={`${g.nazwa}:${p.po_co}`} className={`perms-row${r ? ` perms-${r.stan}` : ''}`}>
                  <span className="perms-dot" />
                  <span className="perms-what">
                    {p.po_co}
                    {p.wymagane && <span className="perms-req" title="Bez tego binear nie ruszy">wymagane</span>}
                    <span className="perms-method">{p.method}</span>
                  </span>
                  <span className="perms-verdict">{r ? r.opis : '—'}</span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
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
/**
 * Dziennik akcji — co binear zapisal do Bitriksa.
 *
 * Czyta z `localStorage` przez `readHistory`, a nie z jakiegokolwiek stanu
 * aplikacji: wpisy powstaja w `bitrix.ts`, czesto poza cyklem Reacta, i maja
 * przezyc przeladowanie strony. `onHistoryChange` odswieza panel od razu, gdy
 * cos dopisze sie w tle.
 *
 * Numer zadania zamieniamy na kod (IT-NNN) TU, przy wyswietlaniu — kod bywa
 * nadany dopiero po akcji, wiec zapisany w chwili zdarzenia czesto bylby pusty.
 */
/**
 * Dziennik akcji — co binear zapisal do Bitriksa.
 *
 * Wpis powstaje w `bitrix.ts`, daleko od Reacta, wiec siedza w nim SUROWE
 * identyfikatory („etap → 4681"). Dopiero tutaj, gdzie sa slowniki etapow, osob
 * i statusow, skladamy opis jeszcze raz — ta sama funkcja `describe`, tyle ze z
 * podpowiadaczem nazw. Zapisany `label` zostaje zapasem: dla starych wpisow
 * sprzed tej zmiany i dla identyfikatorow, ktorych juz nie ma w slownikach.
 */
/*
 * O kogo juz pytalismy. NA POZIOMIE MODULU, nie w refie: panel odmontowuje sie
 * przy zamknieciu, wiec ref gubil pamiec i kazde kolejne otwarcie dziennika
 * powtarzalo te same zapytania — razem z tymi, ktore konczyly sie bledem.
 */
const askedAuthors = new Set<number>();

/** Pelna lista osob — raz na sesje, wspolna dla kazdego otwarcia dziennika. */
let staffCache: Person[] = [];

function History({
  initialFocus,
  focusSeq,
  stageNames,
  people,
  labels,
  sprints,
  backlogId,
  stageMeta,
  onOpen,
  isLive,
  onClose,
}: {
  /** Zadanie, do ktorego dziennik otwiera sie zawezony — z panelu zadania. */
  initialFocus: number | null;
  /** Rosnie przy KAZDEJ prosbie o zawezenie — patrz `histSeq`. */
  focusSeq: number;
  stageNames: Map<number, string>;
  people: Person[];
  labels: FieldEnums;
  sprints: Sprint[];
  /** Rejestr to tez byt scruma, ale nie sprint — bez tego wychodzilo „sprint → #229". */
  backlogId: number | null;
  stageMeta: Map<number, { color: string | null; progress: number | null }>;
  /** Otwiera panel zadania. Dziennik sam go nie zna — patrz `isLive`. */
  onOpen: (taskId: number) => void;
  /** Czy zadanie wciaz istnieje w projekcie. Do samego POKAZANIA wpisu niepotrzebne. */
  isLive: (taskId: number) => boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryEntry[]>(() => readHistory());
  useEffect(() => onHistoryChange(() => setItems(readHistory())), []);

  /*
   * Zawezenie do jednego zadania — „co binear zrobil TEMU zadaniu".
   *
   * Zwykle po to sie tu przychodzi: cos jest nie tak z konkretnym zadaniem i
   * pytanie brzmi „czy to ja, i kiedy". Filtrujemy po `taskId`, nie po nazwie,
   * wiec dziala tez dla zadania, ktore juz nie istnieje.
   */
  const [focus, setFocus] = useState<number | null>(initialFocus);
  /*
   * Zrodlo zapisu jako filtr. „Czy to my to zrobilismy" jest przy przegladaniu
   * dziennika osobnym pytaniem od „co sie stalo" — a odsianie jednej strony
   * wzrokiem, po samym wyciszeniu wiersza, przy stu wpisach nie dziala.
   */
  const [source, setSource] = useState<'all' | 'binear' | 'out'>('all');

  /*
   * `useState(initialFocus)` czyta propa TYLKO przy montowaniu — a panel potrafi
   * byc juz otwarty, gdy przychodzi zadanie do zawezenia. Sciezka: dziennik jest
   * otwarty, klikasz wiersz, na wierzchu otwiera sie panel zadania, w nim
   * naciskasz „historia" — `initialFocus` sie zmienia, ale `useState` to ignoruje
   * i dziennik dalej pokazuje WSZYSTKO zamiast czterech wpisow tego zadania.
   *
   * `null` swiadomie pomijamy: zerowanie idzie z zamkniecia panelu, a nie z
   * prosby „pokaz wszystko", i skasowaloby zawezenie klikniete w samym dzienniku.
   */
  useEffect(() => {
    if (initialFocus !== null) setFocus(initialFocus);
  }, [initialFocus, focusSeq]);
  /*
   * Szukanie i odsiew nieudanych. Przy oknie TYGODNIOWYM przewijanie przestalo
   * wystarczac — wpisow bywa kilkaset, a szuka sie zwykle jednego konkretnego
   * zadania albo jednej rzeczy, ktora sie nie zapisala.
   */
  const [query, setQuery] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);

  /*
   * Zadania skasowane — rozpoznane Z SAMEGO DZIENNIKA, po udanym wpisie
   * `tasks.task.delete`, a nie po nieobecnosci w liscie zadan.
   *
   * Nieobecnosc klamie: zadanie potrafi zniknac z `tasks.task.list` na kilka
   * minut po zapisie, moze tez byc w innym projekcie. Wpis o usunieciu to fakt,
   * ktory sami zanotowalismy, i zostaje prawda takze po przeladowaniu strony.
   */
  const deleted = useMemo(
    () =>
      new Set(
        items
          .filter((e) => e.method === 'tasks.task.delete' && !e.error && e.taskId !== null)
          .map((e) => e.taskId as number),
      ),
    [items],
  );
  /*
   * Tozsamosc zawezonego zadania bierzemy ze WSZYSTKICH jego wpisow, nie z
   * przefiltrowanych: przy wlaczonym szukaniu na ekranie moze nie byc ani
   * jednego wiersza, a naglowek i tak ma powiedziec, o ktore zadanie chodzi.
   */
  const focused = useMemo(() => {
    if (focus === null) return null;
    const mine = items.filter((e) => e.taskId === focus);
    return mine.find((e) => e.title) ?? mine[0] ?? null;
  }, [focus, items]);

  /*
   * PELNA lista osob firmy — do nazwisk w dzienniku.
   *
   * `people` powstaje z BIEZACYCH przypisan, wiec nie zna nikogo, kto nie jest
   * w tej chwili za nic odpowiedzialny. A dziennik z natury mowi o przeszlosci:
   * „kto to byl, zanim to zmieniono". Wpis o odpieciu zadania od Anny pokazywal
   * przez to `#387`, choc w chwili zmiany byla odpowiedzialna.
   *
   * `fetchEmployees` bierze takze konta WYLACZONE, wiec byli pracownicy tez maja
   * nazwisko. Pobranie jest jedno na sesje i tylko po otwarciu panelu.
   */
  const [staff, setStaff] = useState<Person[]>(() => staffCache);
  useEffect(() => {
    if (staffCache.length) return;
    let stop = false;
    void fetchEmployees()
      .then((list) => {
        staffCache = list;
        if (!stop) setStaff(list);
      })
      .catch(() => {
        /* Brak listy tylko cofa nas do stanu sprzed zmiany: zostaje `#id`. */
      });
    return () => {
      stop = true;
    };
  }, []);

  /*
   * Nazwy wracaja OZNACZONE, zeby dalo sie je pozniej wyroznic w tekscie.
   *
   * `describe` sklada jedno zdanie i zwraca string — jest jeden dla zapisu i dla
   * wyswietlania, i tak ma zostac (inaczej slownik pol zylby w dwoch miejscach).
   * Zeby mimo to pokolorowac same nazwy, wkladamy wokol nich znaczniki i
   * rozbieramy zdanie tuz przed renderem. Znaczniki nie opuszczaja tego
   * komponentu i nigdy nie trafiaja do `localStorage`.
   */
  const resolve = useCallback<Resolve>(
    (kind, id) => {
      const n = Number(id);
      const name =
        kind === 'stage'
          ? stageNames.get(n)
          : kind === 'person'
            ? (people.find((p) => p.id === n)?.name ?? staff.find((p) => p.id === n)?.name)
            : kind === 'status'
              ? labels.status[id]
              : kind === 'priority'
                ? (labels.priority[id] ?? FALLBACK_PRIORITY[id])
                : kind === 'sprint'
                  ? n === backlogId
                    ? 'Rejestr'
                    : sprints.find((sp) => sp.id === n)?.name
                  : undefined;
      /*
       * Sama nazwa, BEZ znacznikow — owija je `describe`, i tylko ono.
       *
       * Wczesniej znakowal tez ten resolver, bo znaczniki powstaly wlasnie tutaj.
       * Gdy trafily do `describe` (zeby objac takze pola bez identyfikatora, jak
       * tagi czy termin), kazda rozpoznana nazwa byla owijana DWA RAZY i
       * rozpadala sie na dwa czlony: pierwszy z sama ikona, drugi z ikona i
       * tekstem. Stad podwojne pierscienie i po dwa awatary w jednym wierszu.
       */
      return name;
    },
    [stageNames, people, staff, labels, sprints, backlogId],
  );

  /*
   * Rozbiera oznaczone zdanie na kawalki. Etap dostaje swoj kolor z Bitriksa —
   * ten sam, ktorym pomalowane sa kolumny tablicy, wiec „W toku" w dzienniku
   * i „W toku" na tablicy to wzrokowo ta sama rzecz.
   */
  const renderWhat = useCallback(
    (text: string) =>
      text.split(MARK).map((chunk, i) => {
        const at = chunk.indexOf(SEP);
        if (at < 0) return <span key={i}>{chunk}</span>;
        const [kind, id, name] = chunk.split(SEP);

        /*
         * Osoba dostaje twarz. Nazwisko czyta sie sekunde, twarz poznaje sie od
         * razu — a w dzienniku najczestsze pytanie brzmi „kto", nie „jak sie
         * nazywa". Zdjecie bierzemy z listy osob; gdy kogos juz tam nie ma
         * (odszedl z firmy), `Avatar` sam rysuje inicjaly z nazwy z wpisu.
         */
        if (kind === 'person') {
          const n = Number(id);
          const person = people.find((pp) => pp.id === n) ?? staff.find((pp) => pp.id === n);
          /*
           * Awatar dostaje ten, kogo UMIEMY NAZWAC. Przy nieznanym id `Avatar`
           * rysowalby inicjaly z samego „#387", czyli kolko z krzyzykiem tuz przy
           * napisie „#387" — czytalo sie to jak „##387".
           *
           * Konto-zaslepka dostaje PUSTY krazek, a nie nic. Wczesniej bylo tu
           * odwrotnie — z mysla, ze „Nieprzypisane" to brak osoby, wiec nie ma czego
           * rysowac. W zdaniu wyglada to jednak tak, jakby jednej stronie strzalki
           * czegos brakowalo: „X → Nieprzypisane" traci rytm, gdy tylko lewa strona
           * ma krazek. Pusty krazek jest wtedy znakiem „nikt", a nie ozdobnikiem.
           */
          return (
            <span key={i} className="hist-name hist-name-person">
              {isUnassigned(n) ? (
                <Avatar name={null} />
              ) : (
                person && <Avatar name={person.name} photo={person.photo} />
              )}
              {name}
            </span>
          );
        }

        /*
         * Ikona TA SAMA, ktorej aplikacja uzywa w tym znaczeniu gdzie indziej —
         * kolko statusu z listy, chorągiewka priorytetu, pierscien etapu. Dzieki
         * temu wpis czyta sie tym samym slownikiem obrazkow co reszta programu,
         * zamiast uczyc drugiego. Rodzaje bez wlasnej ikony (sprint) zostaja
         * samym tekstem — dorabianie im znaczka znaczyloby tylko „cos tu jest".
         */
        const icon =
          kind === 'stage' ? (
            (() => {
              const meta = stageMeta.get(Number(id));
              return <StageIcon progress={meta?.progress ?? null} color={meta?.color ?? null} />;
            })()
          ) : kind === 'status' ? (
            <StatusIcon status={id} />
          ) : kind === 'priority' ? (
            <PriorityIcon priority={id} />
          ) : kind === 'deadline' ? (
            <CalendarIcon />
          ) : kind === 'tags' ? (
            <TagIcon />
          ) : kind === 'title' ? (
            <PenIcon />
          ) : kind === 'people' ? (
            <PersonIcon />
          ) : kind === 'points' ? (
            <HashIcon />
          ) : kind === 'epic' ? (
            <LayersIcon />
          ) : kind === 'related' ? (
            <LinkIcon />
          ) : kind === 'comment' ? (
            <CommentIcon />
          ) : kind === 'check' ? (
            <CheckIcon />
          ) : kind === 'delete' ? (
            <TrashIcon />
          ) : null;

        const color = kind === 'stage' ? stageMeta.get(Number(id))?.color : null;
        return (
          <span
            key={i}
            className={`hist-name hist-name-${kind}`}
            style={color ? ({ '--tint': `#${color}` } as CSSProperties) : undefined}
          >
            {icon}
            {name}
          </span>
        );
      }),
    [stageMeta, people],
  );

  /*
   * ZWIJANIE wejscia do sprintu w jeden wiersz.
   *
   * `moveToSprint` robi cztery zapisy: przynaleznosc, karta na tablicy, kolumna
   * wejsciowa (tam wisi automatyzacja nadajaca IT-NNN) i dopiero kolumna
   * docelowa. Dla czytajacego to bylo JEDNO przeciagniecie, a dziennik pokazywal
   * cztery wiersze — czyli slad wywolan REST zamiast zamiaru.
   *
   * Warunkiem zwiniecia jest obecnosc `kanban.addTask`, ktore wystepuje WYLACZNIE
   * w tej sciezce. Celowo NIE zwijamy po samym „ten sam task w oknie kilku
   * sekund": taka regula sklejalaby tez dwie niezalezne decyzje (zmiane etapu i
   * zaraz potem priorytetu) w jedna, ktorej nikt nie podjal.
   *
   * Nieudana proba NIGDY nie wpada do grupy. Po nia sie tu przychodzi, wiec musi
   * zostac osobnym wierszem — nawet gdy stoi w srodku serii.
   */
  /** Rozwiniete grupy — zwiniecie ma byc skrotem, nigdy ukryciem. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  /*
   * Podsumowanie wejscia do sprintu: DOKAD trafilo i W KTOREJ kolumnie stanelo.
   *
   * Skladamy je z gotowych, oznaczonych kawalkow tych samych wpisow — nazwa
   * sprintu z `kanban.addTask` (tam jest zawsze), a kolumna z OSTATNIEGO zapisu
   * etapu w grupie, bo to on mowi, gdzie karta faktycznie stanela. Dzieki temu
   * podsumowanie niesie te same ikony i kolory co wiersze pod spodem.
   */
  const summarize = useCallback(
    (items: HistoryEntry[]) => {
      const chunk = (e: HistoryEntry, kind: string) =>
        (e.params ? describeAction(e.method, e.params, resolve, e.before) : '')
          .split(MARK)
          .find((c) => c.startsWith(`${kind}${SEP}`));

      const card = items.find((e) => e.method === 'tasks.api.scrum.kanban.addTask');
      const sprint = card && chunk(card, 'sprint');
      /* `items` sa od najnowszego, wiec pierwszy etap w tablicy to ten koncowy. */
      const lastStage = items.find(
        (e) => e.method === 'tasks.task.update' && chunk(e, 'stage'),
      );
      const stage = (lastStage && chunk(lastStage, 'stage')) ?? (card && chunk(card, 'stage'));

      const wrap = (c: string | undefined) => (c ? `${MARK}${c}${MARK}` : '');
      if (!sprint) return `wejście do sprintu, kolumna ${wrap(stage)}`;
      return stage
        ? `wrzucone do ${wrap(sprint)}, kolumna ${wrap(stage)}`
        : `wrzucone do ${wrap(sprint)}`;
    },
    [resolve],
  );

  /*
   * Tekst do szukania: to samo zdanie, ktore widac w wierszu (bez znacznikow),
   * plus kod i tytul zadania. Szuka sie po tym, co na ekranie — nie po nazwach
   * metod REST, ktorych nikt nie pamieta.
   */
  const haystack = useCallback(
    (e: HistoryEntry) => {
      const sentence = e.params
        ? describeAction(e.method, e.params, resolve, e.before)
            .split(MARK)
            .map((c) => (c.includes(SEP) ? c.split(SEP)[2] : c))
            .join('')
        : e.label;
      return `${sentence} ${e.code ?? ''} ${e.title ?? ''} ${e.taskId ?? ''} ${e.error ?? ''}`.toLowerCase();
    },
    [resolve],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((e) => {
      if (focus !== null && e.taskId !== focus) return false;
      if (source === 'binear' && e.source === 'bitrix') return false;
      if (source === 'out' && e.source !== 'bitrix') return false;
      if (onlyFailed && !e.error) return false;
      if (q && !haystack(e).includes(q)) return false;
      return true;
    });
  }, [items, focus, source, onlyFailed, query, haystack]);

  /*
   * Nazwiska do zmian z zewnatrz — dociagane DOPIERO TUTAJ, gdy panel jest
   * otwarty, i tylko dla zadan, ktore faktycznie widac. Jedno wywolanie na
   * zadanie, raz: wynik wpisuje sie do dziennika na stale (`noteAuthor`).
   */
  useEffect(() => {
    const missing = [
      ...new Set(
        shown
          .filter(
            (e) =>
              e.source === 'bitrix' &&
              !e.by &&
              e.taskId !== null &&
              /*
               * Skasowanego zadania nie ma juz o co pytac — portal odpowiada 400,
               * a autor i tak nie przyjdzie. Bez tego kazde otwarcie panelu
               * strzelalo seria bledow za zadania, ktore sami usunelismy.
               */
              !deleted.has(e.taskId),
          )
          .map((e) => e.taskId as number),
      ),
    ].filter((id) => !askedAuthors.has(id));
    if (!missing.length) return;

    let stop = false;
    void (async () => {
      /* Po kilka na raz — panel ma sie wypelniac, a nie zalewac portal naraz. */
      for (const id of missing.slice(0, 10)) {
        if (stop) return;
        askedAuthors.add(id);
        const rows = await fetchTaskHistory(id).catch(() => []);
        const by = rows[rows.length - 1]?.by;
        if (by && !stop) noteAuthor(id, by);
      }
    })();
    return () => {
      stop = true;
    };
  }, [shown, deleted]);

  /* Wejscie do sprintu to jedna pozycja — regula w `foldEntries`. */
  const rows = useMemo(
    () =>
      foldEntries(shown).map((items, i) => ({
        /*
         * Indeks jest tu KONIECZNY, nie ozdoba. Bez niego kluczem byly czas +
         * metoda + liczba wpisow — a wrzucenie kilku zadan naraz daje kilka
         * wierszy o IDENTYCZNEJ milisekundzie i metodzie, czyli o tym samym
         * kluczu. React przy duplikatach nie usuwa wezlow, ktore wypadly z
         * listy: po zawezeniu do jednego zadania na ekranie ZOSTAWALY wiersze
         * innych zadan, mimo ze dane byly juz przefiltrowane poprawnie.
         */
        key: `${items[0].at}-${items[0].taskId}-${items[0].method}-${i}`,
        at: items[0].at,
        items,
      })),
    [shown],
  );

  /*
   * Dni jako naglowki, a nie data w kazdym wierszu.
   *
   * Wczesniej wpis z wczoraj niosl „10.09 13:33" w kolumnie szerokiej na
   * „09:58" i napis wchodzil na tresc obok. Data powtarzana przy kilkunastu
   * wpisach z tego samego dnia to zreszta szum: zmienia sie raz na kilkadziesiat
   * wierszy, wiec nalezy do naglowka.
   */
  const days = useMemo(() => {
    const key = (at: number) => {
      const d = new Date(at);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const today = key(Date.now());
    const yesterday = key(Date.now() - 86_400_000);
    const out: { label: string; rows: typeof rows }[] = [];
    for (const r of rows) {
      const k = key(r.at);
      const d = new Date(r.at);
      const label =
        k === today
          ? 'Dzisiaj'
          : k === yesterday
            ? 'Wczoraj'
            : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [rows]);

  const time = (at: number) => {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  /* Ile jest czego — liczone PRZED filtrem zrodla, inaczej wlaczenie go
     zmienialoby liczby na samych przyciskach, ktore je wlaczaja. */
  const bySource = useMemo(() => {
    const scoped = items.filter((e) => focus === null || e.taskId === focus);
    const out = scoped.filter((e) => e.source === 'bitrix').length;
    return { all: scoped.length, out, binear: scoped.length - out };
  }, [items, focus]);

  /* Licznik z calosci (albo z zawezonego zadania) — inaczej wlaczenie filtra
     zmienialoby liczbe, ktora sama ten filtr wlacza. */
  const failedAll = useMemo(
    () => items.filter((e) => e.error && (focus === null || e.taskId === focus)).length,
    [items, focus],
  );

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette hist-panel" role="dialog" aria-label="Dziennik akcji">
        {/*
          Naglowek mowi, CO to za lista i jak daleko siega — bez tego „ostatnie
          sto wpisow" trzeba bylo doczytac ze stopki pod przewinieciem. Nieudane
          proby wymienia osobno, bo to one sa powodem, dla ktorego ktos tu
          zaglada.
        */}
        <header className="hist-head">
          {focus === null ? (
            <>
              <h2>Dziennik akcji</h2>
              <p>
                Każdy zapis, który binear wysłał do Bitriksa w ciągu ostatnich{' '}
                {HISTORY_DAYS} dni, najnowsze u góry. Odczytów nie zapisujemy. Kliknij zadanie
                w wierszu, żeby zobaczyć wyłącznie jego historię.
              </p>
            </>
          ) : (
            <>
              <div className="hist-focus">
                <button className="hist-back" onClick={() => setFocus(null)} title="Wróć do całości">
                  <ChevronIcon open={false} />
                  Cały dziennik
                </button>
                {/* Otwarcie zadania to JEDYNE miejsce, gdzie dziennik potrzebuje
                    zywego zadania — samo pokazanie wpisow dziala i bez niego. */}
                {deleted.has(focus) || !isLive(focus) ? (
                  <span
                    className="hist-gone"
                    title={
                      deleted.has(focus)
                        ? 'binear usunął to zadanie — wpisy zostają'
                        : 'Zadania nie ma w tym projekcie'
                    }
                  >
                    {deleted.has(focus) ? 'zadanie usunięte' : 'zadania nie ma w projekcie'}
                  </span>
                ) : (
                  <button
                    className="hist-open"
                    onClick={() => {
                      onOpen(focus);
                      onClose();
                    }}
                  >
                    Otwórz zadanie
                  </button>
                )}
              </div>
              <h2>
                <span className="hist-focus-code">{focused?.code ?? `#${focus}`}</span>
                {focused?.title && <span className="hist-focus-title">{focused.title}</span>}
              </h2>
              <p>
                {shown.length === 1 ? '1 zapis' : `${shown.length} zapisów`} binear w tym zadaniu.
              </p>
            </>
          )}
        </header>

        {/*
          Szukanie po TYM, CO WIDAC w wierszu — zdaniu, kodzie i tytule zadania.
          Licznik nieudanych jest przelacznikiem, a nie tylko liczba: po nie sie
          tu przychodzi, wiec ma byc jednym klikiem, nie przewijaniem.
        */}
        <div className="hist-tools">
          <SearchIcon />
          <input
            className="hist-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj w dzienniku…"
            aria-label="Szukaj w dzienniku"
          />
          {query && (
            <button className="hist-x" onClick={() => setQuery('')} title="Wyczyść">
              <CloseIcon />
            </button>
          )}
          {/*
            Trzy stany, nie przelacznik: „tylko nasze" i „tylko cudze" to dwa
            rozne pytania, a nie jedno z zaprzeczeniem — przelacznik zmuszalby do
            zgadywania, ktora strone wlasnie widac.
          */}
          <div className="hist-src" role="group" aria-label="Źródło zapisu">
            {(
              [
                ['all', 'Wszystkie', bySource.all],
                ['binear', 'binear', bySource.binear],
                ['out', 'Poza binear', bySource.out],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                className={`hist-src-btn${source === key ? ' hist-src-on' : ''}`}
                onClick={() => setSource(key)}
                disabled={count === 0 && source !== key}
                title={
                  key === 'all'
                    ? 'Wszystkie zapisy'
                    : key === 'binear'
                      ? 'Tylko to, co zrobiliśmy z binear'
                      : 'Tylko zmiany zrobione poza binear'
                }
              >
                {label} ({count})
              </button>
            ))}
          </div>
          <button
            className={`hist-fails${onlyFailed ? ' hist-fails-on' : ''}`}
            onClick={() => setOnlyFailed((v) => !v)}
            disabled={!onlyFailed && failedAll === 0}
            title={
              failedAll === 0
                ? 'Wszystko, co binear wysłał, zostało zapisane'
                : onlyFailed
                  ? 'Pokaż wszystkie zapisy'
                  : 'Pokaż tylko te zapisy, których Bitrix nie przyjął'
            }
          >
            {/* „Nieudanych" samo w sobie nie mowi czego — przycisk ma nazywac
                SWOJE dzialanie, a liczba jest dopiskiem. */}
            Tylko nieudane ({failedAll})
          </button>
        </div>

        <div className="palette-list">
          {shown.length === 0 ? (
            <div className="hist-empty">
              {/* Pusty WYNIK to co innego niz pusty dziennik — inaczej filtr wyglada
                  jak zepsuta aplikacja. */}
              {query || onlyFailed || focus !== null
                ? 'Nic nie pasuje do tego, czego szukasz.'
                : 'Nic jeszcze nie zapisano. Trafia tu każda zmiana, którą binear wysyła do Bitriksa — razem z próbami nieudanymi.'}
            </div>
          ) : (
            days.map((day) => (
              <section key={day.label} className="hist-day">
                <h3 className="hist-day-head">{day.label}</h3>
                {day.rows.map((row) => {
                  const lead = row.items[0];
                  const grouped = row.items.length > 1;
                  const expanded = openGroups.has(row.key);

                  /* Nazwy tylko wtedy, gdy wpis niesie parametry — stare ich nie maja. */
                  const sentence = (e: HistoryEntry) =>
                    e.params ? describeAction(e.method, e.params, resolve, e.before) : e.label;

                  return (
                    <div key={row.key} className="hist-row">
                      <div
                        className={`hist${lead.error ? ' hist-fail' : ''}${
                          lead.source === 'bitrix' ? ' hist-out' : ''
                        }${focus === null && lead.taskId !== null ? ' hist-pick' : ''}`}
                        /*
                         * Zawezenie bierze CALY wiersz, nie sam znacznik zadania.
                         * Znacznik to kilkanascie pikseli w drugiej linii — naglowek
                         * pisal „kliknij zadanie w wierszu", wiec klikniecie w wiersz
                         * bylo naturalne i nie robilo NIC, co wyglada jak zepsuty filtr.
                         * Skrot „N zapisy" zostaje wylaczony, bo rozwija, a nie zaweza.
                         */
                        onClick={(e) => {
                          if (focus !== null || lead.taskId === null) return;
                          if ((e.target as HTMLElement).closest('.hist-more')) return;
                          setFocus(lead.taskId);
                        }}
                      >
                        <span className="hist-time">{time(row.at)}</span>
                        <div className="hist-body">
                          {/*
                            Gorna linia: zdanie po lewej, autor przy PRAWEJ krawedzi.
                            Wczesniej autor stal w drugiej linii, zaraz za znacznikiem
                            zadania — czyli w miejscu zaleznym od dlugosci tytulu, wiec
                            przy przewijaniu skakal. Dociśniety do krawedzi ma zawsze te
                            sama pozycje i czyta sie go jak kolumne, a nie jak dopisek.
                          */}
                          <span className="hist-line">
                            <span className="hist-what">
                              {grouped ? renderWhat(summarize(row.items)) : renderWhat(sentence(lead))}
                            </span>
                            {lead.source === 'bitrix' && (
                              <span className="hist-out-tag" title="Zmiana spoza binear">
                                {lead.by ?? 'poza binear'}
                              </span>
                            )}
                          </span>
                          {/*
                            Kod i tytul Z WPISU, nie z listy zadan — zadania moze juz nie byc.
                            Klikniecie zaweza dziennik do tego jednego zadania; w trybie
                            zawezonym wiersz go nie powtarza, bo wszystkie sa te same.
                          */}
                          <span className="hist-meta">
                            {focus === null && lead.taskId !== null && (
                              <button
                                className={`hist-on${deleted.has(lead.taskId) ? ' hist-on-dead' : ''}`}
                                title={`${lead.method} — pokaż historię tego zadania`}
                                onClick={() => setFocus(lead.taskId)}
                              >
                                <span className="hist-code">{lead.code ?? `#${lead.taskId}`}</span>
                                {lead.title && <span className="hist-title">{lead.title}</span>}
                                {deleted.has(lead.taskId) && (
                                  <span className="hist-dead">usunięte</span>
                                )}
                              </button>
                            )}
                            {/* Zwiniete zawsze da sie rozwinac — skrot nie moze niczego ukryc. */}
                            {grouped && (
                              <button
                                className="hist-more"
                                onClick={() =>
                                  setOpenGroups((prev) => {
                                    const next = new Set(prev);
                                    if (!next.delete(row.key)) next.add(row.key);
                                    return next;
                                  })
                                }
                              >
                                <ChevronIcon open={expanded} />
                                {row.items.length} zapisy
                              </button>
                            )}
                          </span>
                          {lead.error && (
                            <span className="hist-err">nie udało się: {lead.error}</span>
                          )}
                        </div>
                      </div>

                      {grouped && expanded && (
                        <div className="hist-sub">
                          {row.items
                            .slice()
                            .reverse()
                            .map((e: HistoryEntry, k: number) => (
                              <div key={`${e.at}-${k}`} className="hist hist-step">
                                <span className="hist-time">{time(e.at)}</span>
                                <div className="hist-body">
                                  <span className="hist-what">{renderWhat(sentence(e))}</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}


function ContextMenu({
  task,
  stageName,
  sprintName,
  labels,
  count,
  anchor,
  canEnterSprint,
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
  /** Czy jest aktywny sprint, do ktorego wybor etapu moze zadanie wciagnac. */
  canEnterSprint: boolean;
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
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
  const top = Math.min(anchor.top, window.innerHeight - height - 12);

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="menu" style={{ left, top, width }}>
        <div className="menu-head">
          {/*
            Przy zaznaczeniu mowimy, CZEGO DOTKNIE wybor, a nie ile jest
            zaznaczonych. „Zaznaczono: 3" opisywalo stan listy i trzeba bylo
            zgadywac, czy klikniecie zmieni jedno zadanie czy wszystkie trzy.
          */}
          {bulk ? `Zmiana obejmie ${count} ${tasksWord(count)}` : (task.code ?? `#${task.id}`)}
        </div>

        {MENU_ITEMS.map(({ kind, key }) => {
          /*
           * "Etap" bywal tu wygaszony dla zadania spoza sprintu — bo etapy zyja
           * w sprincie, wiec bez sprintu nie bylo z czego wybierac.
           *
           * Juz nie: wybor kolumny SAM wciaga zadanie do aktywnego sprintu (i
           * odpala automatyzacje nadajaca numer IT-NNN). Wygaszanie zmuszaloby do
           * dwoch krokow — najpierw "Sprint", potem "Etap" — na cos, co jest
           * jedna decyzja: "to zadanie idzie do roboty, o tutaj".
           *
           * Zostaje wygaszone tylko wtedy, gdy naprawde nie ma dokad wrzucic:
           * projekt bez aktywnego sprintu.
           */
          const disabled = kind === 'stage' && !bulk && !task.sprintId && !canEnterSprint;
          return (
            <button
              key={kind}
              className="menu-item"
              disabled={disabled}
              title={PICKER_HELP[kind]}
              onClick={() => !disabled && onPick(kind)}
            >
              {MENU_ICON[kind]}
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
              {/* Strzalka „w prawo" — ta sama, ktora w liscie rozwija wiersz. */}
              <ChevronIcon open={false} />
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
    sprints,
    backlogId,
    config,
    projects,
    epics,
    epicNames,
    groupId,
    metaReady,
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
  /** Przycisk „Widok:" w pasku — skrot `v` wiesza menu dokladnie pod nim. */
  const viewsBtnRef = useRef<HTMLButtonElement>(null);
  /** Zapisane widoki (globalne, localStorage) i otwarte menu „Widoki". */
  const [views, setViews] = useState<SavedView[]>(loadViews);
  /** `hover: true` = menu wyskoczylo samo, bez klikniecia (nie kradnie wtedy focusu). */
  const [viewsMenu, setViewsMenu] = useState<(Anchor & { hover?: boolean; kb?: boolean }) | null>(null);
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
  /* Dziennik akcji — osobno od `helpOpen`, bo to dwa rozne panele. */
  const [histOpen, setHistOpen] = useState(false);
  /** Zadanie, do ktorego dziennik ma byc zawezony po otwarciu (`null` = caly). */
  const [histFocus, setHistFocus] = useState<number | null>(null);
  /*
   * Licznik PROSB o zawezenie, nie tylko jej wartosc. Samo id nie wystarcza: po
   * powrocie na „Caly dziennik" prosba o TO SAMO zadanie nie zmienia `histFocus`,
   * wiec panel nie ma z czego poznac, ze pytano go drugi raz — i zostaje pelna
   * lista, mimo ze nacisnales „historia".
   */
  const [histSeq, setHistSeq] = useState(0);
  /* Okno "uzupelnij braki" przed wejsciem do sprintu — patrz `planMove`. */
  const [gapPrompt, setGapPrompt] = useState<{
    tasks: Task[];
    all: number[];
    sprintId: number;
  } | null>(null);
  // Motyw i kroj stoja poza SETTINGS_KEY, bo czyta je tez skrypt w <head>.
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [font, setFont] = useState<Font>(loadFont);
  // Domyslnie wlaczone — na starcie interesuja mnie moje zadania, nie caly zespol.
  const [onlyMine, setOnlyMine] = useState(saved.onlyMine);
  const [withUnassigned, setWithUnassigned] = useState(saved.withUnassigned);
  const [showDone, setShowDone] = useState(saved.showDone);
  const [planDone, setPlanDone] = useState(saved.planDone ?? false);
  const [planReview, setPlanReview] = useState(saved.planReview ?? true);
  /*
   * Sortowanie planowania to STOS kluczy, nie jeden: "po priorytecie, a przy
   * remisie po terminie". Lista ma jeden klucz i tak zostaje — tam sortuje sie
   * raz i na dlugo, tu przestawia sie to co chwile, szukajac czym sie zajac.
   */
  const [planMoce, setPlanMoce] = useState<number | null>(saved.planMoce ?? null);
  const [planKolejka, setPlanKolejka] = useState<number[]>(saved.planKolejka ?? []);
  const [planPominieci, setPlanPominieci] = useState<number[]>(saved.planPominieci ?? []);
  const [planTura, setPlanTura] = useState(saved.planTura ?? 0);
  const [planTylkoDoStartu, setPlanTylkoDoStartu] = useState(saved.planTylkoDoStartu ?? true);
  const [planPrzeniesienie, setPlanPrzeniesienie] = useState(saved.planPrzeniesienie ?? true);
  const [planKolejkaWl, setPlanKolejkaWl] = useState(saved.planKolejkaWl ?? true);
  /*
   * Zapis SPRAWDZAMY, a nie bierzemy na slowo. Zapisane ustawienia bywaja
   * starsze od dzisiejszego kodu albo po prostu uszkodzone — `{cols: null}`
   * wystarczylo, zeby panele dostaly `flex-grow: NaN` i widok zostal rozjechany
   * na zawsze, bo zla wartosc wracala z kazdym odswiezeniem. Ulamek poza
   * zakresem uchwytu tez odrzucamy: 0 znaczy panel sciscniety do zera, ktorego
   * nie da sie juz zlapac.
   */
  const [planPodzial, setPlanPodzial] = useState(() => {
    const ulamek = (v: unknown, dom: number) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0.12 && v <= 0.88 ? v : dom;
    return {
      cols: ulamek(saved.planPodzial?.cols, 0.5),
      split: ulamek(saved.planPodzial?.split, 0.8),
    };
  });
  const [planZwiniete, setPlanZwiniete] = useState<number[]>(() =>
    Array.isArray(saved.planZwiniete) ? saved.planZwiniete.filter((v) => Number.isFinite(v)) : [],
  );
  /* Kiedy (kolejnosc) zadanie weszlo do sprintu w widoku planowania — Bitrix tego nie trzyma. */
  const [planDodane, setPlanDodane] = useState<Dodane>({});
  const planDodaneNext = useRef(1);
  const [planSort, setPlanSort] = useState<{ by: PlanSortBy; dir: 'asc' | 'desc' }[]>(
    () => saved.planSort ?? (SORT_DOMYSLNY as { by: PlanSortBy; dir: 'asc' | 'desc' }[]),
  );
  /* Zapisane ustawienie moze pochodzic ze starszej wersji (byl tez wariant sam
     naglowek) — nieznana wartosc wraca do "bez koloru", zamiast zostawiac klase,
     ktorej arkusz juz nie zna. */
  const [deadlineLook, setDeadlineLook] = useState<DeadlineLook>(() =>
    DEADLINE_LOOKS.some((d) => d.key === saved.deadlineLook) ? saved.deadlineLook : 'mark',
  );
  const [listTint, setListTint] = useState<ListTint>(() =>
    LIST_TINTS.some((t) => t.key === saved.listTint) ? saved.listTint : 'fade',
  );
  const [showEmpty, setShowEmpty] = useState(saved.showEmpty);
  const [showCounters, setShowCounters] = useState(saved.showCounters ?? true);
  const [hiddenCounters, setHiddenCounters] = useState<string[]>(() =>
    Array.isArray(saved.hiddenCounters) ? saved.hiddenCounters.filter((k) => typeof k === 'string') : [],
  );
  const [shownEmpty, setShownEmpty] = useState<string[]>(saved.shownEmpty);
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

  /** Podmien CALY zestaw wartosci warunku — przy progach wybor jest jednokrotny. */
  const setCondValues = useCallback(
    (condId: string, values: string[]) =>
      setFilters((f) => f.map((c) => (c.id === condId ? { ...c, values } : c))),
    [],
  );

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
      setFilters((f) =>
        f.map((c) => {
          if (c.id !== condId) return c;
          /*
           * Wejscie w zakres zasiewa granice tym, co juz bylo wybrane: po "to jedno
           * z: 2 SP, 5 SP" zostaje zakres 2-5, a nie puste pola. "Bez oszacowania"
           * odpada, bo nie jest liczba i nie moze byc granica.
           */
          if (isRange(c.field, op)) {
            const nums = c.values
              .filter((v) => v !== NO_POINTS && v !== '' && Number.isFinite(Number(v)))
              .map(Number)
              .sort((x, y) => x - y);
            const from = nums.length ? String(nums[0]) : '';
            const to = nums.length > 1 ? String(nums[nums.length - 1]) : '';
            return { ...c, op, values: [from, to] };
          }
          // Wyjscie z zakresu w liste wartosci: puste granice nie sa wartosciami.
          if (isRange(c.field, c.op)) {
            return { ...c, op, values: c.values.filter((v) => v !== '') };
          }
          return { ...c, op };
        }),
      ),
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
  /*
   * Opisy zadan do wyszukiwania po tresci. `null` = jeszcze ich nie pobrano dla
   * tego projektu — i tak zostaje, dopoki ktos sam o nie nie poprosi, bo waza
   * mniej wiecej tyle co cala reszta listy (patrz `descCache.ts`).
   */
  const [opisy, setOpisy] = useState<Map<number, Opis> | null>(null);
  /** Czy fraza ma trafiac takze w opisy — przelacznik w polu wyszukiwania. */
  const [wOpisach, setWOpisach] = useState(saved.szukajWOpisach);
  /** Postep pobierania opisow: `[gotowe, wszystkie]`, albo `null` gdy nie trwa. */
  const [opisyPostep, setOpisyPostep] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(saved.collapsed));
  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(
    () => new Set(saved.collapsedTasks),
  );
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
  /*
   * Zakres ma sens tylko tam, gdzie cokolwiek zaweza. W PLANOWANIU nie zaweza:
   * `planBase` bierze zadania wprost z `tasks`, bo caly ten widok polega na
   * porownaniu rejestru ze sprintami — odsianie „tylko sprint" zabraloby lewy
   * panel. Zostawiony przelacznik obiecywalby wiec dzialanie, ktorego nie ma.
   */
  const scopes = useMemo(
    () => (activeSprint ? SCOPES : SCOPES.filter((s) => s.key === 'all')),
    [activeSprint],
  );

  /* Czemu zakres bywa nieczynny — tekst idzie do dymka przy przelaczniku. */
  const blokadaZakresu =
    viewMode === 'planning'
      ? 'Planowanie zestawia rejestr ze sprintami, więc zawsze patrzy na wszystkie zadania.'
      : viewMode === 'charts'
        ? 'Wykresy liczą cały projekt — zakres, filtry i szukanie ich nie dotyczą.'
        : null;
  const scope: Scope = activeSprint && viewMode !== 'planning' ? scopePref : 'all';

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
      setCard(null);
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

  /*
   * AUTORZY zadan — osobno od `people` (osoby odpowiedzialne), bo to inne zbiory:
   * pol firmy zaklada zadania, ktorych nigdy nie prowadzi, i odwrotnie. Wspolna
   * lista dawalaby w obu filtrach pozycje bez ani jednego trafienia.
   *
   * Liczymy z zadan, nie z rosteru: filtrowanie po kims, kto nie zalozyl tu nic,
   * zwraca pusto — a autor bywa tez osoba, ktorej juz nie ma w firmie, wiec w
   * rosterze (`FILTER[ACTIVE]`) by jej zabraklo.
   */
  const creators = useMemo(() => {
    const map = new Map<number, Person>();
    for (const t of tasks) {
      if (t.creatorId && !map.has(t.creatorId)) {
        map.set(t.creatorId, {
          id: t.creatorId,
          name: t.creatorName ?? `#${t.creatorId}`,
          photo: t.creatorPhoto,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) => Number(b.id === me) - Number(a.id === me) || a.name.localeCompare(b.name, 'pl'),
    );
  }, [tasks, me]);

  /*
   * Ksiazka adresowa CALEJ firmy - osobno od `people`, ktore powstaje z zadan.
   * Te dwie listy odpowiadaja na dwa rozne pytania: `people` na "po kim moge
   * filtrowac" (po kims bez zadan nie ma sensu), roster na "kogo moge wspomniec"
   * (kazdego). Sciagamy raz, przy starcie, i tylko do wzmianek.
   */
  const [directory, setDirectory] = useState<Employee[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchEmployees()
      .then((list) => alive && setDirectory(list))
      // Cicho: bez rosteru wzmianki nadal dzialaja, tylko na wezszej liscie.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Opisy z poprzedniego razu — jesli ktos juz kiedys wlaczyl szukanie w nich dla
   * tego projektu, ma je od razu i bez pytania. Przy zmianie projektu czyscimy,
   * zeby fraza nie trafiala w opisy z poprzedniego.
   */
  useEffect(() => {
    let alive = true;
    setOpisy(null);
    if (groupId === null) return;
    void wczytajOpisy(groupId)
      .then((m) => alive && m && setOpisy(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [groupId]);

  /** Pobranie opisow — wolane przez przelacznik w polu wyszukiwania. */
  const pobierzOpisy = useCallback(async () => {
    if (groupId === null || opisyPostep) return;
    setOpisyPostep([0, 0]);
    try {
      const m = await fetchDescriptions(groupId, (a, b) => setOpisyPostep([a, b]));
      setOpisy(m);
      void zapiszOpisy(groupId, m);
    } catch {
      toast('Nie udało się pobrać opisów.');
    } finally {
      setOpisyPostep(null);
    }
  }, [groupId, opisyPostep]);

  /*
   * Czy szukanie w opisach DZIALA, a nie tylko jest zadeklarowane. Ustawienie
   * `wOpisach` jest globalne i przezywa zmiane projektu, ale opisy sa pobierane
   * per projekt — wiec po przelaczeniu na nowy projekt przelacznik bylby wlaczony,
   * a fraza i tak nie trafialaby w opisy. Odznaka pokazuje ten stan faktyczny.
   */
  const opisyDzialaja = wOpisach && opisy !== null;

  /**
   * Klikniecie przelacznika. Gdy odznaka jest zgaszona z braku danych, klik ma je
   * DOCIAGNAC — a nie wylaczyc ustawienie, ktore i tak nic nie robi. Wylaczamy
   * tylko wtedy, gdy szukanie w opisach faktycznie dziala.
   */
  const przelaczOpisy = useCallback(() => {
    if (opisyDzialaja) {
      setWOpisach(false);
      return;
    }
    setWOpisach(true);
    if (!opisy) void pobierzOpisy();
  }, [opisyDzialaja, opisy, pobierzOpisy]);

  /*
   * Roster, a gdy go nie ma - lista z zadan. Nie SUMA obu: kto odszedl z firmy,
   * ten wypada z `FILTER[ACTIVE]`, ale jego stare zadania zostaja, wiec suma
   * wracalaby z byłymi pracownikami dokladnie tam, gdzie ich nie chcemy.
   */
  /*
   * Do WSKAZYWANIA osoby (wzmianki, dopisywanie obserwatorow) bierzemy tylko konta
   * czynne — podpowiadanie kogos, kogo nie ma juz w firmie, nikomu nie sluzy.
   */
  const roster = useMemo(() => directory.filter((p) => p.active), [directory]);
  const mentionPeople = roster.length ? roster : people;

  /*
   * Obserwatorzy WYSTEPUJACY w danych — jak `creators`, z tego samego powodu:
   * po kims, kto niczego nie obserwuje, nie ma czego filtrowac.
   *
   * Nazwiska bierzemy z `people`/`creators`/rosteru, bo lista zadan oddaje dla tego
   * pola same identyfikatory. Kogo nie znajdziemy, pokazujemy jako `#id` — lepiej to
   * niz wyciecie go z listy i udawanie, ze nie obserwuje.
   */
  const observers = useMemo(() => {
    const seen = new Set<number>();
    for (const t of tasks) for (const id of t.auditorIds) seen.add(id);
    const known = new Map<number, Person>();
    for (const p of [...directory, ...people, ...creators]) if (!known.has(p.id)) known.set(p.id, p);
    return [...seen]
      .map((id) => known.get(id) ?? { id, name: `#${id}`, photo: null })
      .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }, [tasks, directory, people, creators]);


  const sprintId = activeSprint?.id ?? null;

  /*
   * Liczniki nad lista (patrz counters.ts). Licza CALA grupe — bez zakresu,
   * przelacznikow i filtrow — bo odpowiadaja na pytanie „ile tego jest", a nie „ile
   * widze". Klikniecie karty podmienia liste na dokladnie te zadania, ktore liczy.
   */
  const [card, setCard] = useState<CounterKey | null>(null);
  const answered = useAnsweredTasks(tasks, {
    closed: CLOSED_STATUSES,
    itDepartments: config?.itDepartments ?? [],
    itUsers: config?.itUsers ?? [],
    me,
    groupId,
    enabled: metaReady,
  });
  const counterCtx = useMemo<CounterCtx>(
    () => ({ sprintId, closed: CLOSED_STATUSES, answered }),
    [sprintId, answered],
  );
  const counterDefs = useMemo(
    () => COUNTERS.filter((d) => !d.needsSprint || activeSprint),
    [activeSprint],
  );
  const counterValues = useMemo(
    () => countAll(tasks, counterCtx, counterDefs),
    [tasks, counterCtx, counterDefs],
  );
  /* Dopoki nie doszlo swieze pobranie ze story pointami, na ekranie jest migawka z
     poprzedniej sesji — liczba bylaby wczorajsza, wiec pokazujemy wielokropek. */
  const counterPending = useMemo(() => {
    const s = new Set<CounterKey>();
    for (const d of counterDefs) {
      if (!metaReady || ((d.key === 'odpowiedzi' || d.key === 'czeka') && answered === null)) {
        s.add(d.key);
      }
    }
    return s;
  }, [counterDefs, metaReady, answered]);
  const counterSnap = useMemo<DaySnapshot>(() => {
    const s: DaySnapshot = {};
    for (const d of counterDefs) if (!counterPending.has(d.key)) s[d.key] = counterValues[d.key].count;
    if (!counterPending.has('sprint') && counterValues.sprint?.points != null) {
      s.sprintPoints = counterValues.sprint.points;
    }
    return s;
  }, [counterDefs, counterPending, counterValues]);
  const counterPrev = useCounterHistory(groupId, counterSnap);
  const cardTasks = useMemo(
    () => (card ? tasks.filter((t) => counterDef(card).match(t, counterCtx)) : null),
    [card, tasks, counterCtx],
  );
  /*
   * Karta USTAWIA pasek pod siebie: zakres, „Pokaż zakończone" i filtry maja
   * mowic, co naprawde jest na liscie. Wczesniej karta podmieniala liste, a pasek
   * dalej pokazywal np. „Aktywny sprint" nad zadaniami spoza sprintu.
   *
   * Karta liczy cala grupe, wiec filtry i „Tylko moje" schodza; zakonczone widac
   * tylko przy „W sprincie" (tylko ona je liczy).
   */
  const stanKarty = (k: CounterKey) => ({
    scope: (k === 'sprint' ? 'sprint' : k === 'poza' || k === 'wycena' ? 'outside' : 'all') as Scope,
    done: k === 'sprint',
  });
  const pickCard = useCallback((k: CounterKey | null) => {
    setCard(k);
    if (!k) return;
    const st = stanKarty(k);
    setScope(st.scope);
    setShowDone(st.done);
    setOnlyMine(false);
    setFilters(EMPTY_FILTERS);
    /*
     * Wyszukiwanie tez schodzi, tak jak przy wyborze widoku zapisanego (applyView):
     * karta pokazuje to, co liczy, a wpisana wczesniej fraza zostawiala z niej pusta
     * liste. SearchBox trzyma wlasny draft, wiec sam `setQuery` zostawilby w polu tekst.
     * Po wybraniu karty mozna znowu szukac — fraza zaweza wtedy zawartosc karty.
     */
    setQuery('');
    searchRef.current?.setValue('');
    setEditingViewId(null);
  }, []);
  /* Kazda RECZNA zmiana paska rozjezdza go z karta — wtedy wracasz do zwyklego
     widoku. Porownujemy ze stanem karty zamiast reagowac na sama zmiane, bo
     ustawienie paska przez karte tez jest zmiana. */
  useEffect(() => {
    if (!card) return;
    const st = stanKarty(card);
    if (scopePref !== st.scope || showDone !== st.done || onlyMine || anyFilter(filters)) setCard(null);
  }, [card, filters, onlyMine, showDone, scopePref]);

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
  /*
   * Opisy malymi literami, policzone RAZ na komplet — a nie przy kazdym znaku.
   * `matchQuery` biegnie na kazda zmiane frazy po 1300 zadaniach; obnizanie
   * wielkosci liter 1,9 MB tekstu w tej petli byloby odczuwalne.
   */
  const opisyIndeks = useMemo(() => {
    /* Wylaczony przelacznik = opisy zostaja w cache'u, ale fraza w nie nie trafia.
       Nie kasujemy ich: ponowne wlaczenie ma byc natychmiastowe, nie kosztowac
       drugiego pobrania. */
    if (!opisy || !wOpisach) return null;
    const m = new Map<number, string>();
    for (const [id, o] of opisy) m.set(id, o.d.toLowerCase());
    return m;
  }, [opisy, wOpisach]);

  const queriedBase = useMemo(
    () => matchQuery(base, query, opisyIndeks),
    [base, query, opisyIndeks],
  );

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
  const panelIds = useMemo(
    () => new Set([...queriedBase, ...(cardTasks ?? [])].map((t) => t.id)),
    [queriedBase, cardTasks],
  );

  /*
   * Ile trafien przyszlo WYLACZNIE z opisu. To jedyna odpowiedz na pytanie „czy
   * wlaczenie tego cokolwiek dalo" — bez niej pasek mowi, ze szuka w opisach,
   * i nie wiadomo, czy to zmienilo wynik.
   */
  const trafioneZOpisu = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !opisyIndeks) return 0;
    let n = 0;
    for (const t of queriedBase) {
      const wTytule = `${t.code ?? ''} ${t.id} ${t.rawTitle} ${t.tags.join(' ')}`
        .toLowerCase()
        .includes(q);
      if (!wTytule) n++;
    }
    return n;
  }, [queriedBase, query, opisyIndeks]);

  const filtered = useMemo(() => {
    // Aktywna karta licznika: lista = dokladnie to, co karta liczy (plus szukanie).
    if (cardTasks) return matchQuery(cardTasks, query, opisyIndeks);
    const inScope = base.filter((t) => {
      const inSprint = sprintId !== null && t.sprintId === sprintId;
      if (scope === 'sprint' && !inSprint) return false;
      if (scope === 'outside' && inSprint) return false;
      return true;
    });
    return matchQuery(inScope, query, opisyIndeks);
  }, [base, scope, sprintId, query, opisyIndeks, cardTasks]);

  /** Wszystkie tagi wystepujace w grupie, z liczba uzyc — do palety i filtra. */
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'));
  }, [tasks]);

  /**
   * Story pointy OBECNE w danych, rosnaco - skala suwaka zakresu. Bierzemy ja z
   * zadan, a nie z wymyslonej listy, bo kazdy zespol szacuje inaczej.
   */
  const pointsScale = useMemo(() => {
    const seen = new Set<number>();
    for (const t of tasks) if (t.storyPoints !== null) seen.add(t.storyPoints);
    return [...seen].sort((a, b) => a - b);
  }, [tasks]);

  /** Etykieta pojedynczej wartosci filtra — do podpisu chipa. */
  const filterValueLabel = useCallback(
    (field: FilterField, value: string): string => {
      if (field === 'assignee')
        return Number(value) === UNASSIGNED_ID
          ? UNASSIGNED_LABEL
          : (people.find((p) => p.id === Number(value))?.name ?? `#${value}`);
      if (field === 'creator') return creators.find((p) => p.id === Number(value))?.name ?? `#${value}`;
      if (field === 'observer') return observers.find((p) => p.id === Number(value))?.name ?? `#${value}`;
      if (field === 'priority') return labels.priority[value] ?? value;
      if (field === 'status') return labels.status[value] ?? value;
      if (field === 'epic')
        return value === '0' ? 'Bez epika' : (epicNames.get(Number(value))?.name ?? `#${value}`);
      if (field === 'tag' && value === NO_TAGS) return 'Bez tagów';
      if (field === 'points') return value === NO_POINTS ? 'Bez oszacowania' : `${value} SP`;
      if (field === 'deadline') return value === NO_DEADLINE ? 'Bez terminu' : dayLabel(Number(value));
      return value; // etap i tag — wartoscia jest sama nazwa
    },
    [people, creators, observers, labels, epicNames],
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
      if (isPersonField(field)) {
        /* Konto-zaslepka ma byc pustym krazkiem NAPRAWDE — to jedyny taki przypadek. */
        if (field === 'assignee' && Number(value) === UNASSIGNED_ID) return <Avatar name={null} />;
        /*
         * Szukamy we WSZYSTKICH trzech listach osob, zaczynajac od wlasciwej dla
         * tego wymiaru. Kazda powstaje z innego pola zadan (odpowiedzialny, autor,
         * obserwator), wiec ktos moze byc obserwatorem, nie bedac nigdzie
         * odpowiedzialnym — i odwrotnie. Zdjecie jest to samo niezaleznie od tego,
         * ktora lista je przyniosla, wiec nie ma powodu odpuszczac.
         */
        const id = Number(value);
        const order =
          field === 'creator'
            ? [creators, people, observers]
            : field === 'observer'
              ? [observers, people, creators]
              : [people, creators, observers];
        const p = order.map((list) => list.find((x) => x.id === id)).find(Boolean);
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
    [people, creators, observers, stageIconByName, epicNames],
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
      // Story pointy nie maja wlasnego koloru — to skala liczbowa, nie kategoria.
      if (field === 'points') return 'var(--fg)';
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
  /** Wymiary, ktorych wartoscia jest OSOBA — wszystkie rysuja awatar. */
  const isPersonField = (f: FilterField) =>
    f === 'assignee' || f === 'creator' || f === 'observer';

  const filterToken = useCallback(
    (field: FilterField, v: string, i: number): ReactNode => {
      const color = filterValueColor(field, v);
      const hasIcon = field === 'status' || field === 'stage';
      const tinted =
        hasIcon || field === 'tag' || field === 'epic' || field === 'priority' || field === 'points';
      // Priorytet ma WLASNY, kolorowy znak (slupki), wiec jego moneta jest tylko lekko
      // podbarwiona (28%), zeby slupki zostaly czytelne; reszta (pierscien/tag) 55%.
      // Story pointy niosa CYFRE, wiec tlo musi zejsc jeszcze nizej niz przy priorytecie.
      const tintPct = field === 'points' ? 14 : field === 'priority' ? 28 : 55;
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
          {/*
            KAZDY wymiar osobowy idzie po awatar, nie tylko „assignee".
            `creator` i `observer` nie lapaly sie na zadna gałąź i spadaly do
            ostatniej — czyli po ikone PRIORYTETU, ktora dla wartosci nie bedacej
            priorytetem rysuje pusta podkladke. Stad pusty krazek w chipie przy
            osobie, ktora w pickerze miala normalne zdjecie.
          */}
          {isPersonField(field) ? (
            filterValueIcon(field, v)
          ) : hasIcon ? (
            filterValueIcon(field, v)
          ) : field === 'tag' || field === 'epic' ? (
            <span className="filter-chip-tagcore" style={{ background: color }} />
          ) : field === 'points' ? (
            /* Story point NIE ma ikony — jest liczba, wiec liczba jest znakiem.
               W facepile („2" „3" „5") to jedyne, co odroznia monety od siebie;
               bez tego wpadalyby w golasy `filterValueIcon('priority')` ponizej. */
            <span className="filter-chip-points">{v === NO_POINTS ? '–' : v}</span>
          ) : field === 'deadline' ? (
            /* Poza zakresem termin ma tylko zaslepke "bez terminu" — ta sama kreska
               co przy braku oszacowania, bo znaczy dokladnie to samo: brak danych. */
            <span className="filter-chip-points">{v === NO_DEADLINE ? '–' : v}</span>
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
        return {
          value: f.field,
          label: f.label,
          icon: f.icon,
          hint: n ? String(n) : undefined,
          divider: f.divider,
        };
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
    if (field === 'creator')
      return creators.map((p) => ({ value: String(p.id), label: p.name, photo: p.photo }));
    if (field === 'observer')
      return observers.map((p) => ({ value: String(p.id), label: p.name, photo: p.photo }));
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
    if (field === 'deadline') {
      /*
       * Poza zakresem termin ma tylko JEDNO sensowne pytanie: czy w ogole jest.
       * Konkretna liczba dni ("dokladnie za 5") nikogo nie interesuje, wiec lista
       * wartosci ogranicza sie do zaslepki — reszta nalezy do suwaka.
       */
      const missing = tasks.filter((t) => !t.deadline).length;
      return [{ value: NO_DEADLINE, label: 'Bez terminu', hint: String(missing) }];
    }
    if (field === 'points') {

      /*
       * Wartosci bierzemy Z DANYCH, nie z wymyslonej skali: kazdy zespol szacuje
       * inaczej (Fibonacci, koszulki przeliczone na liczby, cokolwiek), a lista
       * ktorej nie ma w zadnym zadaniu to same puste wyniki.
       */
      const seen = new Map<number, number>();
      for (const t of tasks) {
        if (t.storyPoints === null) continue;
        seen.set(t.storyPoints, (seen.get(t.storyPoints) ?? 0) + 1);
      }
      const values = [...seen.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sp, count]) => ({ value: String(sp), label: `${sp} SP`, hint: String(count) }));

      const missing = tasks.filter((t) => t.storyPoints === null).length;
      return [
        { value: NO_POINTS, label: 'Bez oszacowania', hint: String(missing) },
        ...values,
      ];
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
  }, [filters, filterPick, people, creators, observers, labels, stages, sprintId, stageMeta, allTags, epics, tasks]);

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
        /*
         * Bez grupowania NIE MA podgrup — takze wtedy, gdy w stanie zostala ich
         * os. Zapisany widok sprzed tej opcji albo starsze ustawienia moga taka
         * pare przyniesc, a wtedy jedyna grupa rozpadlaby sie na podgrupy mimo
         * wyboru „bez grupowania".
         */
        subs: groupBy !== 'flat' && subGroupBy
          ? bucket(g.tasks, subGroupBy, stageNames, stageOrder, labels.status, me, sort, emptyKeysFor(subGroupBy)).map((s) => ({
              ...s,
              nodes: nest(s.tasks, collapsedTasks),
            }))
          : [{ key: '', label: '', order: 0, tasks: g.tasks, nodes: nest(g.tasks, collapsedTasks) }],
      })),
    [groups, groupBy, subGroupBy, stageNames, stageOrder, labels.status, collapsedTasks, me, sort, emptyKeysFor],
  );

  /** Klucz zwijania podgrupy musi byc unikalny w obrebie calej listy. */
  /**
   * Kolor grupy. Nie ma jednego zrodla — zalezy od tego, PO CZYM grupujemy:
   * etap ma kolor z Bitriksa, status swoj wlasny, osoba odcien z nazwiska.
   * "Nieprzypisane" i etap bez koloru zostaja bez odcienia (null).
   */
  const groupTint = useCallback(
    (key: string): string | null => {
      if (groupBy === 'stage') {
        const meta = stageIconByName.get(key);
        return meta?.color ? `#${meta.color}` : null;
      }
      if (groupBy === 'status') return statusColor(key);
      if (groupBy === 'flat') return null;
      return key === UNASSIGNED_LABEL ? null : personColor(key);
    },
    [groupBy, stageIconByName],
  );

  const subKey = (groupKey: string, sub: string) => `${groupKey}\u0000${sub}`;

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
      planDone,
      planReview,
      planSort,
      planMoce,
      planKolejka,
      planPominieci,
      planTura,
      planTylkoDoStartu,
      planPrzeniesienie,
      planKolejkaWl,
      planPodzial,
      planZwiniete,
      listTint,
      deadlineLook,
      szukajWOpisach: wOpisach,
      showEmpty,
      showCounters,
      hiddenCounters,
      shownEmpty,
      detailWidth,
      collapsed: [...collapsed],
      collapsedTasks: [...collapsedTasks],
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // brak miejsca / tryb prywatny — ustawienia po prostu nie przezyja odswiezenia
    }
  }, [viewMode, groupBy, subGroupBy, sort, scopePref, onlyMine, withUnassigned, showDone, planDone, planReview, planSort, planMoce, planKolejka, planPominieci, planTura, planTylkoDoStartu, planPrzeniesienie, planKolejkaWl, planPodzial, planZwiniete, listTint, deadlineLook, wOpisach, showEmpty, showCounters, hiddenCounters, shownEmpty, detailWidth, collapsed, collapsedTasks]);

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

  /**
   * Zdjecie CALEGO zawezenia listy: filtry + wyszukiwanie. Jedna definicja na
   * dwa wejscia - przycisk "x" w pasku i skrot `x` - zeby nie rozjechaly sie
   * w tym, co dokladnie czyszcza.
   */
  /*
   * Widok, ktory zostal ZASTOSOWANY — czyli ten, ktory wlasnie edytujemy.
   *
   * To NIE jest `activeViewId`. Tamten powstaje z odcisku biezacego ukladu, wiec
   * znika w chwili, gdy cokolwiek zmienisz — a to jest dokladnie ten moment, w
   * ktorym chce sie widok zaktualizowac. Ta wartosc zmiane przezywa i dlatego jest
   * jedyna rzecza, ktora wie, CO nadpisac.
   */
  const [editingViewId, setEditingViewId] = useState<string | null>(null);

  const clearAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setQuery('');
    // Zdjecie calego zawezenia to nie jest juz "ten widok po zmianach".
    setEditingViewId(null);
    // SearchBox trzyma wlasny draft, wiec sam `setQuery` zostawilby w polu tekst.
    searchRef.current?.setValue('');
  }, []);

  const applyView = useCallback((v: SavedView) => {
    // Od teraz edytujemy TEN widok — takze gdy zastosowano go z klawiatury (v + 1-9).
    setEditingViewId(v.id);
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
    // Menu zostaje otwarte — mozna przeklikiwac widoki i patrzec na wynik bez
    // ponownego otwierania listy. Zamyka je klikniecie poza (backdrop) albo Esc.
  }, []);

  const saveView = useCallback(
    (name: string) => {
      const n = name.trim();
      if (!n) return;
      const id = `v${Date.now()}`;
      setViews((vs) => [...vs, { id, name: n, ...viewSnapshot }]);
      // Swiezo zapisany widok jest tym, ktory od teraz edytujemy.
      setEditingViewId(id);
    },
    [viewSnapshot],
  );

  /**
   * Nadpisanie zapisanego widoku biezacym ukladem. Nazwa i id zostaja — zmienia sie
   * tylko to, CO widok pokazuje.
   *
   * Nieodwracalne (widoki nie maja historii), dlatego przycisk, ktory to wola, nosi
   * nazwe widoku: "Zaktualizuj «Sprint 65»", a nie samo "Zaktualizuj".
   */
  /**
   * Przestawienie widoku na liscie. Kolejnosc nie jest ozdoba: skrot `v` + 1-9
   * stosuje widok o danym NUMERZE, wiec to takze przypisanie skrotow.
   */
  const reorderViews = useCallback((from: number, to: number) => {
    setViews((vs) => {
      if (from === to || from < 0 || to < 0 || from >= vs.length || to >= vs.length) return vs;
      const next = [...vs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const updateView = useCallback(
    (id: string) =>
      setViews((vs) => vs.map((v) => (v.id === id ? { ...v, ...viewSnapshot } : v))),
    [viewSnapshot],
  );

  const deleteView = useCallback((id: string) => {
    setViews((vs) => vs.filter((v) => v.id !== id));
    // Skasowanego widoku nie ma juz czego aktualizowac.
    setEditingViewId((cur) => (cur === id ? null : cur));
  }, []);

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
      /*
       * Otwarte "Widoki": cyfra 1-9 stosuje widok o tym numerze. Chord jest tu
       * WIDOCZNY, a nie zapamietany - `v` najpierw pokazuje liste z numerami,
       * wiec nie trzeba niczego wiedziec z gory ani zdazyc przed timeoutem.
       * Gdy focus siedzi w polu nazwy (menu otwarte klikiem), cyfry nalezą do
       * pola - inaczej nie dalo by sie nazwac widoku "Sprint 65".
       */
      if (viewsMenu) {
        const inField =
          e.target instanceof HTMLElement &&
          (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        if (e.key === 'Escape') {
          clearViewsTimer();
          setViewsMenu(null);
          return;
        }
        if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const n = Number(e.key);
          if (Number.isInteger(n) && n >= 1 && n <= 9 && views[n - 1]) {
            e.preventDefault();
            applyView(views[n - 1]);
            clearViewsTimer();
            setViewsMenu(null);
          }
        }
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

      /*
       * Wykresy nie maja wierszy. Kursor listy nadal gdzies wskazuje, wiec bez
       * tego Enter otwieral panel LOSOWEGO zadania - tego, na ktorym kursor stal
       * przed przelaczeniem widoku. To samo dotyczy j/k, strzalek i klawiszy akcji
       * (W/M/A/P/S): wszystkie dzialaja na `current`, wiec na wykresach musi byc
       * pusty. Klawisze globalne (widoki, filtry, odswiezenie, sciagawka) zostaja.
       */
      const rowless = viewMode === 'charts';
      const current = rowless ? undefined : flat[cursor];

      if (rowless && ['j', 'k', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
        return;

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
      } else if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
        /*
         * Widoki pod cyframi w KOLEJNOSCI ZAKLADEK z panelu widoku. Osobny
         * klawisz tylko dla wybranych bylby wyjatkiem bez reguly - kazdy widok
         * dostaje swoja cyfre.
         */
        e.preventDefault();
        setViewMode((['list', 'board', 'charts', 'planning'] as const)[Number(e.key) - 1]);
      } else if (e.key === 'v') {
        /*
         * Menu kotwiczymy do PRZYCISKU, nie do srodka ekranu: to samo miejsce,
         * co po kliknieciu, wiec klawisz i mysz otwieraja jedno i to samo, a nie
         * dwa rozne panele. Bez przycisku (waski pasek) skrot po prostu milczy.
         */
        const el = viewsBtnRef.current;
        if (!el) return;
        e.preventDefault();
        clearViewsTimer();
        const r = el.getBoundingClientRect();
        // `kb` = otwarte z klawiatury: NIE zabieramy focusu do pola nazwy, bo
        // inaczej cyfry wpadalyby w "Zapisz biezacy widok" zamiast wybierac widok.
        setViewsMenu({ left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4, kb: true });
      } else if (e.key === 'x') {
        /*
         * To samo, co "x" w pasku: filtry ORAZ wyszukiwanie. Rozdzielanie tych
         * dwoch myli — z paska widac jedno zawezenie listy, wiec jeden gest ma je
         * zdejmowac w calosci. Pole szukania czyscimy przez `setValue`, bo trzyma
         * wlasny stan (niekontrolowany input), a sam `setQuery` zostawilby w nim
         * tekst przy pustym juz filtrze.
         */
        clearAllFilters();
      } else if (e.key.toLowerCase() === 'd') {
        /*
         * Dziennik. „D" jak dziennik — wolne, a reszta liter z tego rzedu jest
         * juz zajeta przez wybieraki pola (M, A, P, S).
         */
        e.preventDefault();
        setHistFocus(null);
        setHistOpen(true);
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
    clearAllFilters,
    clearViewsTimer,
    viewsMenu,
    views,
    applyView,
    viewMode,
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

      /* Bez grupowania grupa nie niesie zadnej wartosci — nie ma czego ustawic. */
      if (axis === 'flat') return;

      /*
       * Rejestr nie jest etapem. Upuszczenie tutaj znaczy „wyjmij ze sprintu" i
       * idzie ta sama droga co reczna zmiana sprintu — wczesniej kod szukal etapu
       * o nazwie „Poza sprintem", nie znajdowal go i zglaszal zadanie jako
       * pominiete, choc bylo w sprincie i dalo sie je przeniesc.
       */
      if (key === NO_SPRINT) {
        if (backlogId === null) {
          toast('Nie znam rejestru tego projektu — spróbuj odświeżyć.');
          return;
        }
        for (const id of ids) {
          if (!tasks.find((x) => x.id === id)?.sprintId) continue;
          /*
           * Zerujemy SAMA przynaleznosc, etap zostaje. Bitrix go nie kasuje przy
           * wyjsciu ze sprintu, wiec kasowanie go u siebie robiloby z lokalnego
           * stanu cos innego niz portal. Na ekranie i tak go nie widac — patrz
           * `stageOf`: etap nalezy do sprintu, wiec bez sprintu nie ma etapu.
           */
          void mutate(id, { sprintId: null }, () => moveToSprint(id, backlogId), 'sprint');
        }
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
        // TEMP-TEST-UNLOCK (2026-09-10): zadanie z backlogu wchodzi do aktywnego sprintu na upuszczony etap. Do usuniecia po tescie.
        const into =
          !t?.sprintId && activeSprint
            ? stages.find((s) => s.sprintId === activeSprint.id && s.name === key)
            : undefined;
        if (into) {
          void mutate(id, { sprintId: into.sprintId, stageId: into.id }, () => moveToSprint(id, into.sprintId, into.id), 'sprint');
          continue;
        }
        // /TEMP-TEST-UNLOCK
        if (!st) skipped++;
        else if (t?.stageId !== st.id) applyStage(id, st.id);
      }
      if (skipped > 0) {
        toast(`Pominięto ${skipped} ${tasksWord(skipped)} — nie są w sprincie, więc nie mają etapów.`);
      }
    },
    [people, tasks, stages, mutate, applyStage, toast, activeSprint, backlogId], // TEMP-TEST-UNLOCK: + activeSprint
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

  /*
   * Braki, o ktore pytamy przed wejsciem do sprintu. Kolejnosc jest kolejnoscia
   * w oknie: najpierw to, bez czego wykres spalania nic nie pokaze.
   */
  const gapsOf = useCallback(
    (t: Task) => ({
      points: t.storyPoints === null,
      assignee: isUnassigned(t.responsibleId),
      label: t.tags.length === 0 && !t.epicId,
    }),
    [],
  );

  /*
   * Propozycja KOLEJNEGO sprintu — nazwa i daty, nic wiecej.
   *
   * Numer: o jeden wiekszy niz ten w nazwie aktywnego. Daty: sprinty w tym
   * projekcie ida styk w styk (Sprint 49 zaczyna sie w dniu, w ktorym konczy sie
   * 48), wiec start bierzemy z konca aktywnego, a dlugosc kopiujemy z niego —
   * zamiast zaszywac „tydzien", bo bywaly i dwutygodniowe.
   */
  const nastepnySprint = useMemo(() => {
    if (!activeSprint?.dateStart || !activeSprint.dateEnd) return null;
    const odMs = Date.parse(activeSprint.dateStart);
    const doMs = Date.parse(activeSprint.dateEnd);
    if (!Number.isFinite(odMs) || !Number.isFinite(doMs) || doMs <= odMs) return null;

    const dni = Math.max(1, Math.round((doMs - odMs) / 86400000));
    const start = new Date(doMs);
    const koniec = new Date(doMs);
    koniec.setDate(koniec.getDate() + dni);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    /* „Sprint 68" -> „Sprint 69". Gdy w nazwie nie ma liczby, nie zgadujemy. */
    const m = /^(.*?)(\d+)\s*$/.exec(activeSprint.name);
    return m
      ? { name: `${m[1]}${Number(m[2]) + 1}`, dateStart: iso(start), dateEnd: iso(koniec), dni }
      : null;
  }, [activeSprint]);

  /*
   * DZIALY do kolejki — epiki grupy, w kolejnosci zapisanej przez uzytkownika.
   *
   * „Ogolne" wypada: to epik na tematy wielodzialowe, wiec nie ma kogo wyslac po
   * zadanie. Epiki spoza zapisu dopisujemy na koniec (doszedl nowy dzial),
   * a zapisane, ktorych juz nie ma, po cichu znikaja.
   */
  const dzialy = useMemo(() => {
    const pula = epics.filter((e) => e.name.trim().toLowerCase() !== 'ogólne');
    const wg = new Map(pula.map((e) => [e.id, e]));
    const zapisane = planKolejka.filter((id) => wg.has(id));
    const reszta = pula.filter((e) => !zapisane.includes(e.id)).map((e) => e.id);
    const pomin = new Set(planPominieci);
    return [...zapisane, ...reszta].map((id) => ({
      id,
      nazwa: wg.get(id)!.name,
      color: wg.get(id)!.color,
      obecny: !pomin.has(id),
    }));
  }, [epics, planKolejka, planPominieci]);

  /**
   * Dzial, ktorego JEST tura — liczony po obecnych, wiec pominiecie nie zostawia
   * dziury. `null` takze przy WYLACZONEJ kolejce: nikt nie wybiera, wiec rejestr
   * nie ma sie do czego zawezac (`Planning` czyta to wprost z `teraz`).
   */
  const teraz = useMemo(() => {
    if (!planKolejkaWl) return null;
    const obecni = dzialy.filter((d) => d.obecny);
    return obecni.length ? obecni[planTura % obecni.length] : null;
  }, [dzialy, planTura, planKolejkaWl]);

  /*
   * Losowanie kolejnosci — Fisher-Yates na PELNEJ liscie, razem z nieobecnymi.
   * Nieobecnosc jest chwilowa (ktos nie przyszedl), a kolejnosc ma przezyc jego
   * powrot; wyrzucenie go z losowania kazaloby losowac jeszcze raz nazajutrz.
   * Tura wraca na poczatek, bo po przelosowaniu stara pozycja nic nie znaczy.
   */
  const losujKolejnosc = useCallback(() => {
    const ids = dzialy.map((d) => d.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setPlanKolejka(ids);
    setPlanTura(0);
  }, [dzialy]);

  /** Przestawienie dzialu w kolejce (przeciagniecie). */
  const przestawDzial = useCallback(
    (z: number, na: number) => {
      const ids = dzialy.map((d) => d.id);
      if (z < 0 || z >= ids.length || na < 0 || na >= ids.length || z === na) return;
      const [ruszony] = ids.splice(z, 1);
      ids.splice(na, 0, ruszony);
      setPlanKolejka(ids);
      setPlanTura(0);
    },
    [dzialy],
  );

  /** Obecnosc dzialu — pominiety nie dostaje tury. */
  const przelaczObecnosc = useCallback((id: number) => {
    setPlanPominieci((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }, []);

  /** Zalozenie kolejnego sprintu — z potwierdzeniem, bo to zapis widoczny dla calego zespolu. */
  const zalozSprint = useCallback(() => {
    /* `me` jest wymagane przez Bitrix jako `createdBy` — bez niego nie ma kogo
       wpisac jako zakladajacego, wiec przycisku po prostu nie pokazujemy. */
    if (!nastepnySprint || groupId === null || me === null) return;
    const { name, dateStart, dateEnd, dni } = nastepnySprint;
    setConfirm({
      title: `Założyć „${name}"?`,
      body: `Powstanie w Bitriksie i będzie widoczny dla całego zespołu: od ${shortDate(dateStart)} do ${shortDate(dateEnd)} (${dni} dni), zaraz po „${activeSprint?.name}".`,
      confirmLabel: 'Załóż sprint',
      onYes: () => {
        void createSprint(groupId, name, dateStart, dateEnd, me)
          .then(() => {
            toast(`Założono „${name}".`);
            void reload(true);
          })
          /*
           * OPIS, nie kod. Scrumowe metody oddaja `error: "0"` przy kazdej
           * odmowie i cala tresc trzymaja w `description` — komunikat „Nie udalo
           * sie zalozyc sprintu: 0" nie mowil nic i sam wymagal sledztwa.
           */
          .catch((e) =>
            toast(
              `Nie udało się założyć sprintu: ${
                (e instanceof BxError && e.description) || (e instanceof Error ? e.message : String(e))
              }`,
            ),
          );
      },
    });
  }, [nastepnySprint, groupId, activeSprint, me, reload]);

  /*
   * Kolejny sprint do planowania: najwczesniejszy ze statusem `planned`.
   * Sprinty przychodza posortowane po dacie startu, wiec wystarczy pierwszy.
   */
  const nextSprint = useMemo(
    () => sprints.find((sp) => sp.status === 'planned') ?? null,
    [sprints],
  );

  /**
   * SAMO przeniesienie — jedyne miejsce, w ktorym zadanie zmienia sprint w tym
   * widoku. Wchodzi sie tu dwiema drogami: wprost (nie bylo brakow) albo przez
   * „Wrzuć tak czy siak" w oknie brakow. Wczesniej ta druga droga miala WLASNA
   * kopie tego kodu — i kopia nie przesuwala kolejki, wiec pominiecie brakow
   * zabieralo zadanie, a tura zostawala przy tym samym dziale.
   */
  const planApply = useCallback(
    (list: number[], sprintId: number | null) => {
      /*
       * WZIECIE ZADANIA KONCZY TURE. Kolejka przechodzi dalej dopiero tutaj —
       * w miejscu, w ktorym zadanie naprawde idzie do planowanego sprintu.
       * Nie przy samym upuszczeniu, bo droga przez okno „uzupelnij braki"
       * daje sie jeszcze anulowac, a wtedy dzial nic nie wybral i tura
       * nalezy nadal do niego.
       *
       * Tylko sprint PLANOWANY: przelozenie czegos do aktywnego albo z
       * powrotem do rejestru nie jest wyborem w tej rundzie.
       */
      if (nextSprint !== null && sprintId === nextSprint.id) {
        setPlanTura((t) => t + list.length);
      }
      const zapis = zapiszPrzeniesienie(planDodane, list, sprintId !== null, planDodaneNext.current);
      planDodaneNext.current = zapis.nastepny;
      setPlanDodane(zapis.dodane);
      return Promise.all(
        list.map((id) =>
          mutate(
            id,
            { sprintId, stageId: null },
            () => moveToSprint(id, sprintId ?? backlogId ?? 0),
            'sprint',
          ),
        ),
      ).then(() => reload(true));
    },
    [nextSprint, mutate, backlogId, reload, planDodane],
  );

  /**
   * Zmiana przynaleznosci do sprintu z widoku planowania.
   *
   * Wejscie do sprintu idzie przez `moveToSprint`, ktory sam prowadzi karte przez
   * kolumne wejsciowa — tam wisi automatyzacja nadajaca numer IT-NNN.
   *
   * Zanim cokolwiek wyslemy, sprawdzamy BRAKI (story pointy, osoba, tag/epik).
   * Zadanie bez oszacowania nie istnieje dla wykresu ani dla zadnej sumy SP, a
   * bez osoby nie da sie rozlozyc obciazenia — czyli dokladnie tego, po co ten
   * widok powstal. Okno tylko PYTA: da sie je pominac jednym klikiem, bo czasem
   * chodzi o to, zeby wrzucic szybko i brudno.
   */
  const planMove = useCallback(
    (ids: number[], sprintId: number | null) => {
      /* Wyjscie do backlogu niczego nie wymaga — nie ma czego uzupelniac. */
      if (sprintId === null) {
        void planApply(ids, sprintId);
        return;
      }

      const incomplete = ids
        .map((id) => tasks.find((t) => t.id === id))
        .filter((t): t is Task => Boolean(t))
        .filter((t) => {
          const g = gapsOf(t);
          return g.points || g.assignee || g.label;
        });

      if (incomplete.length === 0) {
        void planApply(ids, sprintId);
        return;
      }

      setGapPrompt({ tasks: incomplete, all: ids, sprintId });
    },
    [tasks, gapsOf, planApply],
  );

  /*
   * Ile zespol NAPRAWDE dowiozl ostatnio — odniesienie dla planowanego sprintu.
   *
   * Liczymy z zadan, ktore ZOSTALY w domknietym sprincie. To nie jest skrot:
   * przenoszac ogon do kolejnego sprintu Bitrix zabiera zadanie ze starego, wiec
   * w zamknietym sprincie zostaje dokladnie to, co w nim dowieziono (sprawdzone
   * na Sprincie 65: 109 SP, tyle samo pokazuje wykres Bitriksa).
   *
   * Uwaga: z tego samego powodu NIE da sie tak odtworzyc, ile bylo ZAPLANOWANE —
   * i dlatego pokazujemy tylko "dowiezione".
   */
  const lastDone = useMemo(() => {
    const done = [...sprints].reverse().find((sp) => sp.status === 'completed');
    if (!done) return null;
    const points = tasks
      .filter((t) => t.sprintId === done.id)
      .reduce((a, t) => a + (t.storyPoints ?? 0), 0);
    return points > 0 ? { name: done.name, points } : null;
  }, [sprints, tasks]);

  /*
   * WLASNA baza planowania: te same filtry i wyszukiwanie co lista, ale BEZ
   * dwoch przelacznikow panelu — „Pokaż zakończone" i „Pokaż do zatwierdzenia".
   *
   * Bez tego planowanie filtrowalo dwa razy: raz globalnie (w `base`), raz swoim
   * chipem. Gdy przelacznik panelu byl juz wylaczony, zadania znikaly zanim
   * planowanie je zobaczylo — i jego wlasny chip nie robil nic. Wygladalo to na
   * zepsuty przycisk, a bylo podwojne sito.
   */
  const planBase = useMemo(
    () =>
      tasks.filter((t) => {
        const mineOrFree =
          t.responsibleId === me || (withUnassigned && isUnassigned(t.responsibleId));
        if (onlyMine && !mineOrFree) return false;
        if (!matchFilters(t, filters, stageNames)) return false;
        return true;
      }),
    [tasks, onlyMine, withUnassigned, filters, stageNames, me],
  );

  /*
   * Komparator zlozony ze STOSU kluczy — patrz `planComparator` (planSort.ts).
   * Osie wspolne z lista ida przez ten sam `compareBy`, ktorego uzywa lista —
   * inaczej "po priorytecie" znaczyloby tu co innego niz tam.
   */
  const planCmp = useMemo(() => {
    /*
     * Pozycja zadania w procesie. Zadanie poza sprintem nie ma etapu — laduje na
     * koncu, bo "jeszcze nigdzie nie doszlo" jest dalej niz kazda kolumna.
     */
    const stageRank = (t: Task): number => {
      if (!t.stageId) return Number.MAX_SAFE_INTEGER;
      const name = stageNames.get(t.stageId);
      const at = name === undefined ? undefined : stageOrder.get(name);
      return at ?? Number.MAX_SAFE_INTEGER;
    };
    return planComparator(planSort, {
      axis: (by, a, b) => compareBy(by as SortBy, a, b),
      stageRank,
      me,
    });
  }, [planSort, me, stageNames, stageOrder]);

  /*
   * Odsiew po statusie NIE jest tu robiony — robi go `Planning`, bo rozni sie
   * miedzy panelami: rejestr zawsze pomija prace domknieta i oddana do
   * akceptacji (nie ma czego planowac), a sprinty slucha przelacznikow.
   *
   * KOPIA przed sortowaniem — tak samo jak w liscie (`[...filtered].sort(...)`).
   *
   * Bez niej sortowanie w tym widoku nie dzialalo wcale. Przy pustej frazie
   * `matchQuery` oddaje TE SAMA tablice, ktora dostalo, wiec `.sort()` ukladal
   * `planBase` w miejscu i zwracal niezmieniona referencje. Memo w `Planning`
   * jest kluczowane po `tasks`, wiec nie mialo po czym poznac zmiany i nadal
   * pokazywalo poprzednia kolejnosc — chip zmienial sie na „Tytuł", lista nie
   * drgnela. Przy okazji przestajemy mutowac wynik cudzego `useMemo`.
   */
  const planTasks = useMemo(
    () => [...matchQuery(planBase, query)].sort(planCmp),
    [planBase, query, planCmp],
  );

  /*
   * Zadania do PANELI SPRINTU — wszystkie, bez filtrow i bez szukania.
   *
   * Filtr zaweza w planowaniu tylko REJESTR. Wczesniej dotykal wszystkiego, wiec
   * kazdy filtr albo wpisana fraza zmienialy sumy SP i licznik mocy sprintu, choc
   * w samym sprincie nic sie nie zmienilo — liczba, ktora ma byc podstawa decyzji,
   * zalezala od tego, czego ktos wlasnie szukal. Rejestr przeciwnie: tam sie szuka
   * i zawezanie jest cala jego robota.
   */
  const planAll = useMemo(() => [...tasks].sort(planCmp), [tasks, planCmp]);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingId(null);
      const id = parseDrag(e.active.id);
      const target = e.over ? parseDrop(e.over.id) : null;
      if (id === null || !target) return;

      if (target.kind === 'col') {
        // TEMP-TEST-UNLOCK (2026-09-10): karta z backlogu upuszczona na kolumne wchodzi do sprintu tej kolumny. Do usuniecia po tescie.
        const into = stages.find((s) => s.id === target.stageId);
        if (into && !tasks.find((x) => x.id === id)?.sprintId) {
          void mutate(id, { sprintId: into.sprintId, stageId: into.id }, () => moveToSprint(id, into.sprintId, into.id), 'sprint');
          return;
        }
        // /TEMP-TEST-UNLOCK
        applyStage(id, target.stageId);
        return;
      }
      if (target.kind === 'sub') {
        dropOnGroup(target.groupKey, targetsFor(id), target.subKey);
        return;
      }
      /*
       * Widok planowania. Cel to caly sprint albo backlog — kolumne wejsciowa
       * dobiera `moveToSprint`, bo to ona odpala automatyzacje nadajaca IT-NNN.
       */
      if (target.kind === 'plan') {
        planMove(targetsFor(id), target.sprintId);
        return;
      }
      // Upuszczenie w tej samej sekcji nic nie zmienia — nie wysylamy zapytania.
      const source = groupNodes.find((x) =>
        x.subs.some((s) => s.nodes.some((n) => n.task.id === id)),
      );
      if (source?.key === target.groupKey) return;
      dropOnGroup(target.groupKey, targetsFor(id));
    },
    [applyStage, dropOnGroup, groupNodes, targetsFor, stages, tasks, mutate, planMove], // TEMP-TEST-UNLOCK: + stages, tasks, mutate
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
  const colAxis: GroupBy | null =
    viewMode === 'board' ? 'stage' : (subGroupBy ?? (groupBy === 'flat' ? null : groupBy));

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
      {
        id: 'view-charts',
        section: 'Widok',
        label: 'Wykresy (spalanie i prędkość zespołu)',
        run: () => setViewMode('charts'),
      },
      {
        id: 'view-planning',
        section: 'Widok',
        label: 'Planowanie (rejestr obok sprintów)',
        run: () => setViewMode('planning'),
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
           * Etap MUSIMY podac sami — wbrew temu, co tu kiedys stalo, Bitrix nadaje
           * go tylko przy wejsciu do sprintu z interfejsu. Po samym `entityId`
           * zadanie zostaje bez etapu i wypada z `tasks.task.list({SPRINT_ID})`,
           * czyli znika ze sprintu (sprawdzone na zywo). Bierzemy pierwsza kolumne
           * procesu: oznaczona przez Bitriksa jako NEW, a gdy takiej nie ma —
           * najwczesniejsza po `sort`.
           */
          const pickFirst = (list: Stage[]) =>
            [...list]
              .filter((st) => st.sprintId === entityId)
              .sort((a, b) => Number(b.type === 'NEW') - Number(a.type === 'NEW') || a.sort - b.sort)[0];

          /*
           * `stages` w stanie sa TYLKO dla sprintow, ktore juz maja zadania (patrz
           * `sprintIds` przy wczytywaniu). Przenoszac zadanie do sprintu SWIEZO
           * zalozonego, jeszcze pustego, nie znalezlibysmy tu zadnej kolumny —
           * i wpadli dokladnie w blad opisany wyzej: zadanie bez etapu wypada ze
           * sprintu. Dlatego przy pudle dociagamy etapy tego sprintu na miejscu.
           */
          let firstStage = toSprint ? pickFirst(stages) : undefined;
          if (toSprint && !firstStage) {
            firstStage = pickFirst(await fetchStages([entityId]).catch(() => []));
          }

          await Promise.all(
            targets.map((id) =>
              mutate(
                id,
                /*
                 * Do sprintu: przynaleznosc I kolumna wejsciowa. Do rejestru: sama
                 * przynaleznosc — etapu NIE zerujemy, bo Bitrix tez go nie kasuje,
                 * a na ekranie i tak go nie widac (patrz `stageOf`). Kasowanie go
                 * tutaj rozjezdzaloby lokalny stan z portalem.
                 */
                toSprint
                  ? { sprintId: entityId, stageId: firstStage?.id ?? null }
                  : { sprintId: null },
                () => moveToSprint(id, entityId, firstStage?.id),
                'sprint',
              ),
            ),
          );
          await reload(true);
        },
      };
    }
    /*
     * Etapy zyja w konkretnym sprincie. Zadanie, ktore w zadnym nie jest, dawniej
     * dostawalo tu pusta liste i komunikat "Zadanie nie jest w sprincie" — czyli
     * slepy zaulek: zeby nadac etap, trzeba bylo najpierw osobno wrzucic zadanie
     * do sprintu.
     *
     * Teraz pytamy o etapy AKTYWNEGO sprintu, a wybor kolumny sam wciaga tam
     * zadanie (`moveToSprint`), razem z nadaniem numeru IT-NNN. Jedna decyzja
     * zamiast dwoch, i dokladnie to samo, co daje upuszczenie karty na kolumne.
     */
    const stageSprintId = pickerTask.sprintId ?? activeSprint?.id ?? null;
    const entering = pickerTask.sprintId === null;
    const sprintStages = stages.filter((s) => s.sprintId === stageSprintId);
    return {
      title: !stageSprintId
        ? 'Projekt nie ma aktywnego sprintu'
        : entering
          ? `Etap — wrzuci do „${activeSprint?.name ?? ''}”`
          : 'Etap',
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
      apply: async (value: string) => {
        const stageId = Number(value);

        /*
         * Zaznaczenie bywa mieszane, wiec dzielimy je na trzy kubelki:
         *  - JUZ w tym sprincie -> sama zmiana kolumny,
         *  - w ZADNYM sprincie  -> wejscie do sprintu na te kolumne,
         *  - w INNYM sprincie   -> pomijamy.
         *
         * Ten trzeci przypadek zostaje pominiety swiadomie: przerzucanie zadania
         * miedzy sprintami to inna decyzja niz wybor kolumny i nie powinna
         * przydarzyc sie przy okazji. Mowimy o tym wprost.
         */
        const move: number[] = [];
        const enter: number[] = [];
        let skipped = 0;
        for (const id of targets) {
          const t = tasks.find((x) => x.id === id);
          if (!t) continue;
          if (t.sprintId === stageSprintId) move.push(id);
          else if (t.sprintId === null) enter.push(id);
          else skipped += 1;
        }
        if (skipped > 0) {
          toast(`Pominięto ${skipped} ${tasksWord(skipped)} z innego sprintu — najpierw przenieś je tutaj.`);
        }

        await Promise.all([
          ...move.map((id) => applyStage(id, stageId)),
          ...enter.map((id) =>
            mutate(
              id,
              { sprintId: stageSprintId, stageId },
              () => moveToSprint(id, stageSprintId as number, stageId),
              'sprint',
            ),
          ),
        ]);

        /*
         * Wejscie do sprintu zmienia przynaleznosc, wiec lista musi sie przeliczyc.
         * UWAGA: `tasks.task.list` potrafi przez kilka minut nie widziec swiezo
         * przeniesionego zadania — wtedy pojawi sie dopiero przy kolejnym
         * odswiezeniu. To ograniczenie Bitriksa, nie tego wywolania.
         */
        if (enter.length) await reload(true);
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
          {/*
            Przelacznik widoku ZAWSZE na wierzchu. Ten sam wybor jest w panelu
            widoku (zakladki z podpisami), ale tam trzeba go najpierw otworzyc —
            a zmiana widoku to najczestsza rzecz, jaka sie tu robi. Tutaj same
            ikony: pasek jest waski, a podpisy i tak sa w panelu i pod cyframi.
          */}
          <span className="mode-group" role="group" aria-label="Widok">
            {(
              [
                { key: 'list', icon: <ListIcon />, label: 'Lista (1)' },
                { key: 'board', icon: <BoardIcon />, label: 'Tablica (2)' },
                { key: 'charts', icon: <ChartIcon />, label: 'Wykresy (3)' },
                { key: 'planning', icon: <PlanIcon />, label: 'Planowanie (4)' },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                className={`mode-btn${viewMode === m.key ? ' mode-btn-on' : ''}`}
                title={m.label}
                aria-label={m.label}
                aria-pressed={viewMode === m.key}
                onClick={() => setViewMode(m.key)}
              >
                {m.icon}
              </button>
            ))}
          </span>

          <SearchBox
            key={groupId ?? 'none'}
            ref={searchRef}
            onChange={setQuery}
            stanOpisow={
              opisyPostep !== null
                ? 'pobieranie'
                : opisyDzialaja
                  ? 'on'
                  : wOpisach
                    ? 'brak'
                    : 'off'
            }
            onOpisy={przelaczOpisy}
          />
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
            {/* Bez ikony widoku: biezacy tryb pokazuje przelacznik w pasku, a ten
                przycisk mowi o GRUPOWANIU. Dwa wskazniki tego samego stanu w jednym
                rzedzie tylko kaza sprawdzac, ktory z nich jest aktualny. */}
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
            onClick={() => {
              setHistFocus(null);
              setHistOpen(true);
            }}
            title="Dziennik akcji — co binear zapisał do Bitriksa (D)"
          >
            <HistoryIcon />
          </button>
          <button
            className="icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Skróty klawiszowe (?)"
          >
            ?
          </button>
        </header>

        {/* Liczniki pod samym naglowkiem, nad zakresem i filtrami: licza cala grupe,
            wiec stoja ponad tym, co pasek nizej zaweza. */}
        {showCounters && (viewMode === 'list' || viewMode === 'board') && tasks.length > 0 && (
          <CountersBar
            defs={counterDefs.filter((d) => !hiddenCounters.includes(d.key))}
            values={counterValues}
            pending={counterPending}
            prev={counterPrev}
            active={card}
            onPick={pickCard}
          />
        )}

        {/* Zakres jest zawsze na wierzchu — wyjscie poza aktywny sprint to jedno klikniecie. */}
        {/* Wybor Lista/Tablica siedzi wylacznie w panelu widoku (zakladki na gorze) —
            tu byl duplikat tej samej kontrolki. */}
        {/*
          Na WYKRESACH caly pasek jest martwy: `Dashboard` dostaje tylko `groupId`
          i `people`, wiec ani zakres, ani filtry, ani szukanie do niego nie
          docieraja. Zamiast go chowac — co przesuwaloby cala tresc przy kazdym
          przelaczeniu widoku — wygaszamy go i odcinamy od klikniec.
        */}
        <div
          className={`scopebar${viewMode === 'charts' ? ' scopebar-locked' : ''}`}
          title={viewMode === 'charts' ? 'Na wykresach te ustawienia nic nie zmieniają' : undefined}
          aria-disabled={viewMode === 'charts' || undefined}
        >
          {/*
            Przezroczysta warstwa na czas wykresow. Sam pasek ma odciete klikanie,
            a `pointer-events: none` zabija razem z nim najechanie — wiec dymek
            musi siedziec na czyms, co kursor nadal lapie. Przy okazji warstwa
            przechwytuje klikniecia, ktore inaczej trafialyby w kontrolki.
          */}
          {viewMode === 'charts' && (
            <HoverNote
              className="scopebar-veil"
              przyKursorze
              label="Pasek nieczynny"
              value="Wykresy liczą cały projekt"
              note="zakres, filtry i szukanie ich nie dotyczą"
            >
              <span />
            </HoverNote>
          )}

          <ScopePicker
            scope={scope}
            scopes={scopes}
            counts={scopeCounts}
            activeSprint={activeSprint}
            onPick={(s) => {
              setCard(null);
              setScope(s);
            }}
            blokada={blokadaZakresu}
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
            ref={viewsBtnRef}
            className="views-btn"
            title="Zapisane widoki (V)"
            onMouseEnter={(e) => openViewsSoon(e.currentTarget)}
            /*
             * Zjechanie kursorem zamyka TYLKO menu otwarte najechaniem.
             *
             * Po kliknieciu menu przestaje byc "hover" i dostaje pelnoekranowa
             * przeslone, ktora natychmiast przykrywa przycisk — przegladarka
             * wystawia wtedy `mouseleave`, choc mysz nawet nie drgnela. Menu
             * gaslo samo 260 ms po kliknieciu, przeslona znikala razem z nim,
             * spod niej szedl `mouseenter` i menu wracalo: stad mrugniecie
             * przy kazdym kliknieciu w juz otwarta liste.
             *
             * Menu otwarte KLIKIEM ma sie zamykac klikiem (w przeslone), Esc
             * albo wyborem widoku — nie tym, ze mysz odjechala.
             */
            onMouseLeave={() => {
              if (!viewsMenu || viewsMenu.hover) closeViewsSoon();
            }}
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
              onClick={clearAllFilters}
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
                    {isRange(c.field, c.op) ? (
                      /* Zakres to JEDNA wartosc do przeczytania ("3-8"), a nie dwie
                         monety obok siebie: facepile sugerowalaby wybor z listy. */
                      <span className="filter-chip-val">
                        <span className="filter-chip-range">{rangeLabel(c.field, c.values)}</span>
                      </span>
                    ) : c.values.length === 1 ? (
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
        {viewMode === 'charts' ? (
          <Dashboard groupId={groupId} people={people} />
        ) : viewMode === 'planning' ? (
          /*
           * Planowanie dostaje zadania PO filtrach i wyszukiwaniu — dzieki temu
           * sumy w panelach mowia o tym, co widac. To byla glowna pretensja do
           * planowania Bitriksa: filtrujesz, a liczby dalej dotycza calosci.
           */
          <Planning
            /*
             * DWA zestawy, bo filtr dotyczy tylko rejestru:
             *  - `planAll` do paneli sprintu — wszystko, zeby sumy SP i licznik
             *    mocy nie zalezaly od tego, czego ktos wlasnie szuka,
             *  - `planTasks` do rejestru — po filtrach i po frazie.
             * Oba posortowane tym samym stosem kluczy i oba bez odsiewu po
             * statusie: ten robi `Planning`, bo rozni sie miedzy panelami.
             * Zakresu nie ma w zadnym — widok sam dzieli zadania na rejestr i sprinty.
             */
            tasks={planAll}
            rejestrTasks={planTasks}
            activeSprint={activeSprint}
            nextSprint={nextSprint}
            onCreateSprint={nastepnySprint && me !== null ? zalozSprint : undefined}
            lastDone={lastDone}
            people={people}
            showReview={planReview}
            onToggleReview={() => setPlanReview((v) => !v)}
            showDone={planDone}
            onToggleDone={() => setPlanDone((v) => !v)}
            moce={planMoce}
            onMoce={setPlanMoce}
            dzialy={dzialy}
            teraz={teraz}
            kolejkaWl={planKolejkaWl}
            onKolejkaWl={() => setPlanKolejkaWl((v) => !v)}
            podzial={planPodzial}
            onPodzial={setPlanPodzial}
            zwiniete={planZwiniete}
            onZwin={(id) =>
              setPlanZwiniete((z) => (z.includes(id) ? z.filter((v) => v !== id) : [...z, id]))
            }
            onLosuj={losujKolejnosc}
            onPomin={() => setPlanTura((t) => t + 1)}
            onPrzestaw={przestawDzial}
            onObecny={przelaczObecnosc}
            tylkoDoStartu={planTylkoDoStartu}
            przeniesienie={planPrzeniesienie}
            onPrzeniesienie={() => setPlanPrzeniesienie((v) => !v)}
            onTylkoDoStartu={() => setPlanTylkoDoStartu((v) => !v)}
            sort={planSort}
            dodane={planDodane}
            sortFields={PLAN_SORTS}
            onSort={(next) => setPlanSort(next as { by: PlanSortBy; dir: 'asc' | 'desc' }[])}
            /*
             * Wiersz rysuje TEN SAM komponent co lista. Wlasny, gestszy wiersz
             * wygladal jak inna aplikacja i gubil polowe informacji (epik, podzadania,
             * termin, zdjecie osoby) — a to wlasnie po nich poznaje sie, czy zadanie
             * nadaje sie do sprintu.
             */
            /* Limit tagow przychodzi Z PANELU — on zna swoja szerokosc.
               Gdy go nie poda, zostaje globalny, liczony z szerokosci listy. */
            renderRow={(t, limitTagow) => (
              <TaskRow
                task={t}
                fraza={query}
                deadlineLook={deadlineLook}
                active={false}
                selected={openId === t.id}
                busy={pending.has(t.id)}
                depth={0}
                childCount={0}
                hiddenSubCount={childStats.get(t.id)?.hidden ?? 0}
                elsewhereSubCount={0}
                collapsed={false}
                onToggle={() => {}}
                marked={marked.has(t.id)}
                isNew={newIds.has(t.id)}
                hasRelated={relatedIds.has(t.id)}
                epic={epicOf(t)}
                onEpic={toggleEpicFilter}
                stage={t.stageId ? stageMeta.get(t.stageId) : undefined}
                parentRef={t.parentId ? parentInfo(t.parentId) : undefined}
                tagLimit={limitTagow ?? tagLimit}
                onCopied={(code) =>
                  toast(code ? `Skopiowano ${code}` : 'Nie udało się skopiować do schowka')
                }
                onOpenParent={setOpenId}
                onMark={(e) => markRow(e, t.id)}
                onSelect={(e) => clickRow(e, t.id)}
                onMenu={(anchor) => setMenu({ taskId: t.id, targets: targetsFor(t.id), anchor })}
                onTag={(name) => toggleTag(name)}
              />
            )}
          />
        ) : viewMode === 'board' ? (
          <Board
            tasks={boardTasks}
            fraza={query}
            stages={boardStages}
            showDone={showDone}
            shownEmpty={pinnedStages}
            epicOf={epicOf}
            subCounts={childStats}
            relatedIds={relatedIds}
            pending={pending}
            activeId={flat[cursor]?.id ?? null}
            openId={openId}
            marked={marked}
            newIds={newIds}
            parentLabels={parentLabels}
            onCopied={(code) =>
              toast(code ? `Skopiowano ${code}` : 'Nie udało się skopiować do schowka')
            }
            onOpen={(id, e) => clickRow(e, id)}
            onMenu={(id, anchor) => {
              setCursor(flat.findIndex((x) => x.id === id));
              setMenu({ taskId: id, targets: targetsFor(id), anchor });
            }}
          />
        ) : (
        <div className="list">
          {/*
            Pasek pojawia sie WYLACZNIE przy wpisanej frazie — bez niej jest to
            informacja o niczym. Mowi wprost, czego wyszukiwarka NIE przeszukala,
            bo cicha niepelnosc jest gorsza niz brak funkcji: bez tego „nie ma
            takiego zadania" znaczy naprawde „nie ma go w tytule".
          */}
          {query.trim() && (
            <div className="desc-search">
              {opisyPostep ? (
                <span className="desc-search-note">
                  Pobieram opisy… {opisyPostep[0]}/{opisyPostep[1] || '?'}
                </span>
              ) : opisyDzialaja ? (
                <span className="desc-search-note">
                  Szukam też w opisach
                  {trafioneZOpisu > 0 && <> — {trafioneZOpisu} z nich trafiło tylko tam</>}
                </span>
              ) : (
                <span className="desc-search-note">
                  Przeszukano tytuły, kody i tagi — opisy pomijam (przełącznik „opisy” w polu
                  wyszukiwania).
                </span>
              )}
            </div>
          )}

          {!error && !loading && groupNodes.length === 0 && (
            <div className="empty">Brak zadań pasujących do filtra.</div>
          )}

          {groupNodes.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <DropZone
                key={g.key}
                tag="section"
                id={groupDropId(g.key)}
                dataGroup={g.key}
                className={listTint === 'off' ? undefined : `tint-${listTint}`}
                style={
                  listTint === 'off'
                    ? undefined
                    : ({ '--group-tint': groupTint(g.key) ?? 'var(--fg-dim)' } as CSSProperties)
                }
              >
                {/* Bez grupowania nie ma czego nazwac ani zwijac — naglowek znika,
                    zostaje sama lista. Ta sama zasada co przy podgrupach. */}
                {g.label !== '' && (
                <div className="group-head" onClick={() => toggleGroup(g.key)}>
                  <ChevronIcon open={!isCollapsed} />
                  <span className="group-label">{g.label}</span>
                  <HoverNote
                    label="Zadania"
                    value={g.tasks.length}
                    note="w grupie"
                    className="group-count"
                  >
                    {g.tasks.length}
                  </HoverNote>
                  <GroupPoints tasks={g.tasks} />
                </div>
                )}
                {/*
                  Zanik pod naglowkiem jako WLASNY element, nie `::after` naglowka.
                  `position: sticky` ZAWSZE tworzy kontekst ukladania, wiec pseudo-element
                  naglowka nie ma jak zejsc pod wiersze — cala grupa malowala sie wtedy
                  nad nimi i tekst pierwszych zadan blakl. Osobny element z `z-index: -1`
                  laduje pod trescia sekcji, a `sticky` trzyma go tuz pod naglowkiem
                  przez cale przewijanie grupy.
                */}
                {listTint === 'fade' && !isCollapsed && <div className="tint-veil" aria-hidden />}
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
                            <HoverNote
                              label="Zadania"
                              value={sub.tasks.length}
                              note="w podgrupie"
                              className="group-count"
                            >
                              {sub.tasks.length}
                            </HoverNote>
                            <GroupPoints tasks={sub.tasks} />
                          </div>
                        )}
                        {!subCollapsed &&
                          sub.nodes.map(({ task: t, depth, childCount: visibleKids, parentOutside }) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      fraza={query}
                      deadlineLook={deadlineLook}
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
                      stage={stageOf(t) ? stageMeta.get(stageOf(t) as number) : undefined}
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
          fraza={query}
          people={mentionPeople}
          stageName={(stageOf(openTask) && stageNames.get(stageOf(openTask) as number)) || NO_SPRINT}
          /* Kolor i postep kolumny — do pierscienia przy polu „Etap". */
          stage={stageOf(openTask) ? (stageMeta.get(stageOf(openTask) as number) ?? null) : null}
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
          onHistory={(id) => {
            setHistFocus(id);
            setHistSeq((n) => n + 1);
            setHistOpen(true);
          }}
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
          onConfirm={setConfirm}
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
              stageName={(stageOf(t) && stageNames.get(stageOf(t) as number)) || NO_SPRINT}
              sprintName={sprintLabel(t)}
              labels={labels}
              count={menu.targets.length}
              anchor={menu.anchor}
              canEnterSprint={activeSprint !== null}
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
          editingId={editingViewId}
          onApply={applyView}
          onDelete={deleteView}
          onSave={saveView}
          onUpdate={updateView}
          onReorder={reorderViews}
          /* Otwarte najechaniem: nie zabieramy focusu i pilnujemy kursora nad menu. */
          autoFocusInput={!viewsMenu.hover && !viewsMenu.kb}
          showKeys={!!viewsMenu.kb}
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
        // Prog to JEDNA granica, wiec picker przestaje byc wielokrotny: dwie
        // granice naraz nie zawezalyby niczego sensownie (a matchCondition i tak
        // czyta tylko pierwsza). Zakres sklada sie z dwoch osobnych warunkow.
        // Zakres ma wlasny popover (dwa pola), nie liste wartosci.
        if (isRange(cond.field, cond.op)) {
          return (
            <RangeMenu
              anchor={filterPick.anchor}
              scale={cond.field === 'deadline' ? DEADLINE_SCALE : pointsScale}
              title={FILTER_LABEL[cond.field]}
              markAt={cond.field === 'deadline' ? DEADLINE_SCALE.indexOf(0) : undefined}
              markLabel="dziś"
              from={cond.values[0] ?? ''}
              to={cond.values[1] ?? ''}
              onChange={(from, to) => setCondValues(cond.id, [from, to])}
              format={cond.field === 'deadline' ? dayLabel : undefined}
              emptyLabel={cond.field === 'deadline' ? 'Tylko bez terminu' : 'Tylko bez oszacowania'}
              onUnestimated={() => {
                setCondOp(cond.id, 'is');
                setCondValues(cond.id, [cond.field === 'deadline' ? NO_DEADLINE : NO_POINTS]);
                setFilterPick(null);
              }}
              onClose={() => {
                // Zakres bez zadnej granicy to warunek, ktory niczego nie robi.
                if (!(cond.values[0] || cond.values[1])) removeCondition(cond.id);
                setFilterPick(null);
              }}
            />
          );
        }
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
            /*
             * Droga POWROTNA do suwaka. "Tylko bez terminu" (i bez oszacowania)
             * przelacza operator na "to", czyli zamienia panel zakresu na zwykla
             * liste wartosci — i bez tego przycisku nie bylo stad wyjscia inaczej
             * niz przez skasowanie filtra i zalozenie go od nowa. Operator da sie
             * zmienic klikajac w nazwe wymiaru na chipie, ale nikt tego nie zgadnie.
             *
             * Wyjscia maja byc symetryczne: skoro zakres oferuje przejscie do
             * zaslepki, zaslepka musi oferowac powrot do zakresu.
             */
            footer={
              opsFor(cond.field).includes('between') && cond.op !== 'between' ? (
                <button
                  type="button"
                  className="range-none"
                  onClick={() => {
                    setCondOp(cond.id, 'between');
                    setFilterPick(null);
                  }}
                >
                  Wróć do zakresu
                </button>
              ) : undefined
            }
            onClose={() => {
              // Porzucony, pusty warunek (np. "+ Filtr" bez wyboru) nie zostaje wiszacy.
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
            tint: listTint,
            deadline: deadlineLook,
            empty: showEmpty,
            counters: showCounters,
            counterTiles: counterDefs.map((d) => ({
              key: d.key,
              label: d.label,
              shown: !hiddenCounters.includes(d.key),
            })),
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
              /*
               * Bez grupowania nie ma czego dzielic na podgrupy — podgrupowanie
               * schodzi do zera. Poza tym: podgrupowanie po tej samej osi co
               * grupowanie nic by nie dalo.
               */
              setSubGroupBy((s) => (g === 'flat' || s === g ? null : s));
            },
            subGroup: setSubGroupBy,
            sort: patchSort,
            scope: setScope,
            mine: () => setOnlyMine((v) => !v),
            unassigned: () => setWithUnassigned((v) => !v),
            done: () => setShowDone((v) => !v),
            tint: setListTint,
            deadline: setDeadlineLook,
            empty: () => setShowEmpty((v) => !v),
            /* Schowane karty nie zostawiaja wybranej — nie byloby jak z niej wyjsc. */
            counters: () => {
              setShowCounters((v) => !v);
              setCard(null);
            },
            /* Schowanie wybranej karty wychodzi z jej widoku — jak przy schowaniu wszystkich. */
            counterTile: (key) => {
              setHiddenCounters((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
              if (card === key) setCard(null);
            },
            toggleColumn,
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
      {histOpen && (
        <History
          initialFocus={histFocus}
          focusSeq={histSeq}
          stageNames={stageNames}
          people={people}
          labels={labels}
          /* Tylko aktywny sprint: pelna lista sprintow przychodzi z widokiem
             planowania, ktory jeszcze nie jest zacommitowany. Pozostale pokaza
             sie jako `#id` — czyli „szukalismy i nie ma". */
          sprints={sprints}
          backlogId={backlogId}
          stageMeta={stageMeta}
          onOpen={setOpenId}
          isLive={(id) => tasks.some((t) => t.id === id)}
          onClose={() => {
            setHistOpen(false);
            setHistFocus(null);
          }}
        />
      )}
      {gapPrompt && (
        <GapPrompt
          tasks={gapPrompt.tasks}
          sprintName={
            sprints.find((sp) => sp.id === gapPrompt.sprintId)?.name ?? 'sprintu'
          }
          onOpen={(id) => {
            setGapPrompt(null);
            setOpenId(id);
          }}
          onCancel={() => setGapPrompt(null)}
          /* Ta sama droga co bez brakow — razem z przejsciem kolejki dalej. */
          onSkip={() => {
            const { all, sprintId } = gapPrompt;
            setGapPrompt(null);
            void planApply(all, sprintId);
          }}
        />
      )}

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
