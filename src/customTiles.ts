/*
 * Wlasne kafelki: zapisany widok (zakres + filtry) z ustawieniami wyswietlania — nazwa, kolor, ikona,
 * grupa, kolejnosc. Dzieki temu licznik nie jest wpisany w kod pod jeden proces (IT), tylko kazdy dzial
 * sklada sobie wlasne kafelki z tych samych filtrow, ktorych uzywa na liscie.
 *
 * Sama logika i zapis w przegladarce, bez Reacta (patrz customTiles.test.ts).
 */

import { groupedKeys } from './filterLogic';

export type TileScope = 'sprint' | 'outside' | 'all';

/** Warunek filtra w postaci zapisywalnej (bez `id` — ten powstaje dopiero przy zastosowaniu na pasku). */
export interface TileCondition {
  field: string;
  op: string;
  values: string[];
  /** Id grupy LUB: warunki z tym samym `or` wystarczy spelnic jeden z nich (patrz filterLogic.ts). */
  or?: string;
}

/** Co kafelek pokazuje jako liczbe: liczbe zadan albo sume story pointow. */
export type TileMeasure = 'count' | 'points';

export interface CustomTile {
  id: string;
  name: string;
  scope: TileScope;
  filters: TileCondition[];
  /** „Tylko moje" w momencie zapisu widoku. */
  onlyMine: boolean;
  /** „Pokaz zakonczone" w momencie zapisu widoku. */
  showDone: boolean;
  measure: TileMeasure;
  /** Klucz z `TILE_COLORS`. */
  color: string;
  /** Klucz z `TILE_ICONS`. */
  icon: string;
  /** Id grupy; kafelki jednej grupy stoja razem pod jej podpisem. */
  group: string;
}

export interface TileGroup {
  id: string;
  name: string;
  /** Grupa bez podpisu i sumy nad kafelkami (kafelki "luzem"). */
  hideCaption?: boolean;
}

export const LOOSE_GROUP_NAME = 'Luzem';

export interface TilesConfig {
  groups: TileGroup[];
  /** Kolejnosc kafelkow = kolejnosc w tablicy (w obrebie grupy). */
  tiles: CustomTile[];
}

/** Paleta: klucz → zmienna CSS albo kolor. Klucz zapisujemy, wiec motyw moze zmienic odcien. */
export const TILE_COLORS: Record<string, { label: string; css: string }> = {
  green: { label: 'Zielony', css: 'var(--accent-green)' },
  blue: { label: 'Niebieski', css: '#58a6ff' },
  teal: { label: 'Morski', css: '#2bb8c9' },
  purple: { label: 'Fioletowy', css: '#a371f7' },
  amber: { label: 'Żółty', css: 'var(--accent-amber)' },
  orange: { label: 'Pomarańczowy', css: 'var(--accent-orange)' },
  red: { label: 'Czerwony', css: 'var(--danger)' },
  grey: { label: 'Szary', css: '#8b949e' },
};

/** Klucze ikon do wyboru; same rysunki mapuje warstwa UI (`TilesBar`). */
export const TILE_ICON_KEYS = [
  'list',
  'check',
  'pen',
  'history',
  'comment',
  'hash',
  'calendar',
  'flame',
  'bug',
  'bulb',
  'parent',
  'layers',
  'tag',
  'person',
  'eye',
  'star',
  'heart',
  'bell',
  'flag',
  'zap',
  'target',
  'alert',
  'clock',
  'users',
  'lock',
  'shield',
  'box',
  'truck',
  'warehouse',
  'cart',
  'gift',
  'dollar',
  'mail',
  'phone',
  'wrench',
  'cpu',
  'globe',
  'camera',
  'board',
  'plan',
  'chart',
  'columns',
  'bars',
  'subtask',
  'link',
  'pin',
  'clip',
  'search',
  'refresh',
  'smile',
  'plusCircle',
  // dla zadan malo waznych, do odlozenia albo do usuniecia
  'trash',
  'xCircle',
  'ban',
  'archive',
  'arrowDown',
  'moon',
  'eyeOff',
  'pause',
] as const;

/** Kolor kafelka: klucz z palety albo dowolny kolor w zapisie #rrggbb (wybrany z pickera). */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export const validColor = (v: unknown): v is string => isHexColor(v) || (typeof v === 'string' && v in TILE_COLORS);
/** CSS koloru kafelka; nieznany klucz → domyslny. */
export const colorCss = (key: string): string => (isHexColor(key) ? key : (TILE_COLORS[key]?.css ?? TILE_COLORS.blue.css));

/** Liczba zadan i suma SP kafelka (oba liczymy zawsze — kafelek pokazuje jedno z nich, grupa sumuje oba). */
export interface TileNumbers {
  count: number;
  points: number;
}

/** To, co kafelek pokazuje jako swoja liczbe. */
export const shownValue = (tile: Pick<CustomTile, 'measure'>, v: TileNumbers): number =>
  tile.measure === 'points' ? v.points : v.count;

/**
 * Suma kafelkow grupy (zadania i SP) — do podpisu grupy. Kafelki to osobne widoki i moga sie
 * nakladac, wiec to SUMA KAFELKOW, a nie liczba roznych zadan.
 */
export function groupTotals(tiles: readonly Pick<CustomTile, 'id'>[], values: ReadonlyMap<string, TileNumbers>): TileNumbers {
  return tiles.reduce(
    (n, t) => {
      const v = values.get(t.id);
      return v ? { count: n.count + v.count, points: n.points + v.points } : n;
    },
    { count: 0, points: 0 },
  );
}

export const DEFAULT_COLOR = 'blue';
export const DEFAULT_ICON = 'list';
export const DEFAULT_GROUP_NAME = 'Moje kafelki';

let seq = 0;
/** Id niepowtarzalne takze po odswiezeniu strony (czas + licznik). */
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`;

export const emptyConfig = (): TilesConfig => ({ groups: [], tiles: [] });

const isScope = (v: unknown): v is TileScope => v === 'sprint' || v === 'outside' || v === 'all';

/** Zbiera wejscie (z localStorage albo z pliku) do poprawnej konfiguracji; zle elementy pomija. */
export function normalizeConfig(raw: unknown): TilesConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<TilesConfig>;
  const groups: TileGroup[] = [];
  for (const g of Array.isArray(src.groups) ? src.groups : []) {
    if (g && typeof g.id === 'string' && typeof g.name === 'string' && g.name.trim() && !groups.some((x) => x.id === g.id)) {
      groups.push({ id: g.id, name: g.name.trim().slice(0, 40), ...(g.hideCaption === true ? { hideCaption: true } : {}) });
    }
  }
  const tiles: CustomTile[] = [];
  for (const t of Array.isArray(src.tiles) ? src.tiles : []) {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || !t.name.trim()) continue;
    if (tiles.some((x) => x.id === t.id)) continue;
    const filters: TileCondition[] = (Array.isArray(t.filters) ? t.filters : [])
      .filter((c) => c && typeof c.field === 'string' && typeof c.op === 'string' && Array.isArray(c.values))
      .map((c) => ({
        field: c.field,
        op: c.op,
        values: c.values.map(String),
        ...(typeof c.or === 'string' && c.or ? { or: c.or } : {}),
      }));
    // Kafelek bez istniejacej grupy trafia do pierwszej (albo do nowej domyslnej) — nic nie znika po cichu.
    let group = typeof t.group === 'string' && groups.some((g) => g.id === t.group) ? t.group : '';
    if (!group) {
      if (!groups.length) groups.push({ id: newId('g'), name: DEFAULT_GROUP_NAME });
      group = groups[0].id;
    }
    tiles.push({
      id: t.id,
      name: t.name.trim().slice(0, 40),
      scope: isScope(t.scope) ? t.scope : 'all',
      filters,
      onlyMine: t.onlyMine === true,
      showDone: t.showDone === true,
      measure: t.measure === 'points' ? 'points' : 'count',
      color: validColor(t.color) ? t.color : DEFAULT_COLOR,
      icon: typeof t.icon === 'string' && (TILE_ICON_KEYS as readonly string[]).includes(t.icon) ? t.icon : DEFAULT_ICON,
      group,
    });
  }
  return { groups, tiles };
}

/** Grupy z ich kafelkami w kolejnosci wyswietlania; pustych grup nie zwraca. */
export function groupedTiles(cfg: TilesConfig): { group: TileGroup; tiles: CustomTile[] }[] {
  return cfg.groups
    .map((group) => ({ group, tiles: cfg.tiles.filter((t) => t.group === group.id) }))
    .filter((g) => g.tiles.length > 0);
}

/** Dodaje kafelek; gdy grupy nie ma, zaklada domyslna. */
export function addTile(cfg: TilesConfig, tile: Omit<CustomTile, 'group'> & { group?: string }): TilesConfig {
  let groups = cfg.groups;
  let group = tile.group && groups.some((g) => g.id === tile.group) ? tile.group : groups[0]?.id;
  if (!group) {
    group = newId('g');
    groups = [...groups, { id: group, name: DEFAULT_GROUP_NAME }];
  }
  return { ...cfg, groups, tiles: [...cfg.tiles, { ...tile, group }] };
}

export const updateTile = (cfg: TilesConfig, id: string, patch: Partial<CustomTile>): TilesConfig => ({
  ...cfg,
  tiles: cfg.tiles.map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)),
});

export const removeTile = (cfg: TilesConfig, id: string): TilesConfig => ({
  ...cfg,
  tiles: cfg.tiles.filter((t) => t.id !== id),
});

/** Przesuwa kafelek o jedno miejsce w obrebie jego grupy (-1 w gore, +1 w dol). */
export function moveTile(cfg: TilesConfig, id: string, dir: -1 | 1): TilesConfig {
  const tile = cfg.tiles.find((t) => t.id === id);
  if (!tile) return cfg;
  const inGroup = cfg.tiles.filter((t) => t.group === tile.group);
  const at = inGroup.findIndex((t) => t.id === id);
  const other = inGroup[at + dir];
  if (!other) return cfg;
  const tiles = [...cfg.tiles];
  const i = tiles.findIndex((t) => t.id === id);
  const j = tiles.findIndex((t) => t.id === other.id);
  [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  return { ...cfg, tiles };
}

/** Przenosi kafelek do innej grupy (na jej koniec). */
export function moveToGroup(cfg: TilesConfig, id: string, groupId: string): TilesConfig {
  if (!cfg.groups.some((g) => g.id === groupId)) return cfg;
  const tile = cfg.tiles.find((t) => t.id === id);
  if (!tile || tile.group === groupId) return cfg;
  return { ...cfg, tiles: [...cfg.tiles.filter((t) => t.id !== id), { ...tile, group: groupId }] };
}

export const addGroup = (cfg: TilesConfig, name: string): TilesConfig =>
  name.trim() ? { ...cfg, groups: [...cfg.groups, { id: newId('g'), name: name.trim().slice(0, 40) }] } : cfg;

/** Grupa bez podpisu ("Luzem") — tworzona przy pierwszym uzyciu; zwraca konfiguracje i id grupy. */
export function ensureLooseGroup(cfg: TilesConfig): { cfg: TilesConfig; id: string } {
  const found = cfg.groups.find((g) => g.hideCaption);
  if (found) return { cfg, id: found.id };
  const id = newId('g');
  return { cfg: { ...cfg, groups: [...cfg.groups, { id, name: LOOSE_GROUP_NAME, hideCaption: true }] }, id };
}

export const setGroupCaption = (cfg: TilesConfig, id: string, show: boolean): TilesConfig => ({
  ...cfg,
  groups: cfg.groups.map((g) => {
    if (g.id !== id) return g;
    const { hideCaption: _h, ...rest } = g;
    return show ? rest : { ...rest, hideCaption: true };
  }),
});

export const renameGroup = (cfg: TilesConfig, id: string, name: string): TilesConfig =>
  name.trim() ? { ...cfg, groups: cfg.groups.map((g) => (g.id === id ? { ...g, name: name.trim().slice(0, 40) } : g)) } : cfg;

/** Przesuwa grupe o jedno miejsce. */
export function moveGroup(cfg: TilesConfig, id: string, dir: -1 | 1): TilesConfig {
  const i = cfg.groups.findIndex((g) => g.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cfg.groups.length) return cfg;
  const groups = [...cfg.groups];
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return { ...cfg, groups };
}

/** Usuwa grupe razem z jej kafelkami; zwraca tez, ile kafelkow poszlo. */
export function removeGroup(cfg: TilesConfig, id: string): TilesConfig {
  return { ...cfg, groups: cfg.groups.filter((g) => g.id !== id), tiles: cfg.tiles.filter((t) => t.group !== id) };
}

/** Czy aktualny stan listy to dokladnie widok tego kafelka — do podswietlenia kafelka. */
export function sameView(
  tile: CustomTile,
  state: { scope: TileScope; filters: readonly TileCondition[]; onlyMine: boolean; showDone: boolean },
): boolean {
  const key = (c: TileCondition) => `${c.field}|${c.op}|${[...c.values].sort().join(',')}`;
  const a = groupedKeys(tile.filters.filter((c) => c.values.length), key);
  const b = groupedKeys(state.filters.filter((c) => c.values.length), key);
  return (
    tile.scope === state.scope &&
    tile.onlyMine === state.onlyMine &&
    a.length === b.length &&
    a.every((x, i) => x === b[i])
  );
}

/** Wartosc kafelka dla juz przefiltrowanych zadan. */
export function tileValue(tile: Pick<CustomTile, 'measure'>, tasks: readonly { storyPoints: number | null }[]): number {
  return tile.measure === 'points' ? tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0) : tasks.length;
}

/* ---------- eksport / import ---------- */

export const EXPORT_VERSION = 1;

export function exportConfig(cfg: TilesConfig): string {
  return JSON.stringify({ binearTiles: EXPORT_VERSION, groups: cfg.groups, tiles: cfg.tiles }, null, 2);
}

/**
 * Import z pliku: `null`, gdy to nie jest plik kafelkow. Id grup i kafelkow sa generowane od nowa, wiec
 * import dodaje do istniejacej konfiguracji, a nie nadpisuje jej ani nie dubluje identyfikatorow.
 */
export function importConfig(text: string, current: TilesConfig): TilesConfig | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || (data as { binearTiles?: unknown }).binearTiles !== EXPORT_VERSION) return null;
  const clean = normalizeConfig(data);
  if (!clean.tiles.length) return null;
  const groupMap = new Map(clean.groups.map((g) => [g.id, newId('g')]));
  const groups = [...current.groups, ...clean.groups.map((g) => ({ ...g, id: groupMap.get(g.id) as string }))];
  const tiles = [
    ...current.tiles,
    ...clean.tiles.map((t) => ({ ...t, id: newId('t'), group: groupMap.get(t.group) as string })),
  ];
  return { ...current, groups, tiles };
}

/* ---------- zapis w przegladarce ---------- */

const STORAGE_KEY = 'binear.tiles.v1';

/** Wczytuje konfiguracje; brak albo zepsuty zapis daje pusty zestaw. */
export function loadTiles(): TilesConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeConfig(JSON.parse(raw)) : emptyConfig();
  } catch {
    return emptyConfig();
  }
}

export function saveTiles(cfg: TilesConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* Brak miejsca albo zablokowany zapis — konfiguracja zyje do konca sesji. */
  }
}
