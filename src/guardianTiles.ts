/*
 * Opiekunowie zadan w backlogu: odpowiedzialny w backlogu to opiekun, ktory precyzuje zadanie do DO-STARTU,
 * w sprincie — wykonawca. Pula opiekunow siedzi w konfiguracji zespolu (`guardian` w binear-team.json),
 * nie w kodzie.
 *
 * Kafelki opiekunow nie sa zapisanym widokiem: generujemy je z puli przy kazdym renderze, osobna grupa
 * „OPIEKUNOWIE" — jeden kafelek na osobe i jeden „Bez opiekuna". Licza zadania (nie godziny) w backlogu
 * tak jak „Poza sprintem": otwarte, bez odlozonych, bez KONCEPCJA i bez folderow.
 *
 * Czysta logika, bez Reacta (guardianTiles.test.ts).
 */
import type { CustomTile, TileCondition, TileGroup } from './customTiles';

/** Wartosc filtra „Opiekun" dla zadania, ktorego odpowiedzialny jest spoza puli. */
export const NO_GUARDIAN = 'none';
export const GUARDIAN_GROUP_ID = 'opiekunowie';
const TILE_PREFIX = 'opiekun-';

/**
 * Klucz opiekuna zadania: id odpowiedzialnego, gdy jest w puli, inaczej „bez opiekuna" — konto techniczne,
 * konto wspolne albo osoba spoza IT jako odpowiedzialny to brak opiekuna (tak samo brak odpowiedzialnego).
 */
export function guardianKey(responsibleId: number | null, pool: ReadonlySet<number>): string {
  return responsibleId !== null && pool.has(responsibleId) ? String(responsibleId) : NO_GUARDIAN;
}

/** Wspolne warunki kafelkow opiekunow: backlog jak „Poza sprintem" (zakres kafelka to `outside`). */
const BACKLOG: TileCondition[] = [
  { field: 'status', op: 'isNot', values: ['6'] },
  { field: 'tag', op: 'noneOf', values: ['KONCEPCJA'] },
  { field: 'kind', op: 'isNot', values: ['parent'] },
];

const tile = (id: string, name: string, key: string, color: string, icon: string): CustomTile => ({
  id: `${TILE_PREFIX}${id}`,
  name,
  scope: 'outside',
  filters: [...BACKLOG, { field: 'guardian', op: 'is', values: [key] }],
  onlyMine: false,
  showDone: false,
  measure: 'count',
  color,
  icon,
  group: GUARDIAN_GROUP_ID,
});

/** Grupa kafelkow opiekunow z puli; `null`, gdy pula jest pusta (bez puli „bez opiekuna" znaczyloby wszystko). */
export function guardianTiles(
  guardians: readonly { id: number; name: string }[],
): { group: TileGroup; tiles: CustomTile[] } | null {
  if (!guardians.length) return null;
  return {
    group: { id: GUARDIAN_GROUP_ID, name: 'OPIEKUNOWIE' },
    tiles: [
      ...guardians.map((g) => tile(String(g.id), g.name, String(g.id), 'blue', 'person')),
      tile(NO_GUARDIAN, 'Bez opiekuna', NO_GUARDIAN, 'orange', 'alert'),
    ],
  };
}
