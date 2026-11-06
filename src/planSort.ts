/*
 * Kolejnosc zadan w widoku planowania — STOS kluczy: pierwszy rozstrzyga,
 * kolejny wchodzi dopiero przy remisie, a remis po calym stosie rozstrzyga ogon
 * (moje wyzej, potem po id).
 *
 * Osobno od App.tsx, zeby dalo sie to przetestowac: blad, ktory tu siedzial,
 * byl niewidoczny w kodzie, a widoczny dopiero w kolejnosci wierszy.
 */
import type { Task } from './bitrix';

export type Cmp = (a: Task, b: Task) => number;

export interface PlanSortLevel {
  by: string;
  dir: 'asc' | 'desc';
}

/**
 * Sklada stos poziomow w jeden komparator.
 *
 * Kazdy poziom musi umiec ODDAC REMIS (zwrocic 0). Wczesniej poziomy skladano
 * z komparatora listy, ktory sam dokladal ogon i nigdy nie zwracal zera — wtedy
 * „priorytet, potem tag Wysoki, potem SP" konczylo sie na priorytecie. Dlatego
 * ogon dochodzi tu RAZ, po calym stosie.
 */
export function stackComparator(levels: Cmp[], tail: Cmp): Cmp {
  return (a, b) => {
    for (const cmp of levels) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return tail(a, b);
  };
}

/** Story pointy w wybranym kierunku; zadania bez wyceny zawsze na koncu, takze przy malejacym. */
const spComparator =
  (dir: 'asc' | 'desc'): Cmp =>
  (a, b) => {
    const x = a.storyPoints;
    const y = b.storyPoints;
    const missA = x == null || x === 0;
    const missB = y == null || y === 0;
    if (missA !== missB) return missA ? 1 : -1;
    const d = (x ?? 0) - (y ?? 0);
    return dir === 'asc' ? d : -d;
  };

/** Termin zadania jako czas; brak terminu idzie na koniec (najdalej). */
const deadlineTime = (t: Task): number => {
  const ms = t.deadline ? Date.parse(t.deadline) : NaN;
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
};

/**
 * Oszczednosc w zl / mies. — rosnaco znaczy „wieksza oszczednosc wyzej" (tak, jak sortuje sie kolejka w literze).
 * Zadania bez kwoty (bez wiadomosci WARTOŚĆ albo „bez kwoty") zawsze na koncu, takze przy odwrotnym kierunku.
 */
const savingsComparator =
  (dir: 'asc' | 'desc', savings: (t: Task) => number | null): Cmp =>
  (a, b) => {
    const x = savings(a);
    const y = savings(b);
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    const d = (y ?? 0) - (x ?? 0);
    return dir === 'asc' ? d : -d;
  };

/**
 * Macierz Eisenhowera: tag A, B, C albo D (ranga 0–3), bez tagu na koncu. Przy kilku tagach liczy sie najwazniejszy.
 * Tagi to dokladnie jedna litera — „BUG" ani „B2B" nie sa macierza.
 */
export const TAGS_MACIERZ = ['A', 'B', 'C', 'D'] as const;
export const macierzRank = (t: Task): number => {
  const ranks = t.tags.map((g) => TAGS_MACIERZ.indexOf(g.trim().toUpperCase() as (typeof TAGS_MACIERZ)[number])).filter((i) => i >= 0);
  return ranks.length ? Math.min(...ranks) : TAGS_MACIERZ.length;
};

/** Ma tag „Wysoki" (bez wzgledu na wielkosc liter) — ranga 0, inaczej 1. */
const wysokiRank = (t: Task) => (t.tags.some((g) => g.toLowerCase() === 'wysoki') ? 0 : 1);

/**
 * Domyslna kolejnosc waznosci (macierz Eisenhowera):
 *   1. priorytet Bitriksa — plomien to awaria, firma nie moze pracowac, wiec nic go nie wyprzedza,
 *   2. terminy: najpierw KOLOR (czerwony — musi wejsc w obecnym sprincie, zolty — w nastepnym),
 *      w obrebie koloru data terminu; zielone i bez terminu przechodza do kolejnego poziomu,
 *   3. macierz: tag A, B, C, D (bez tagu na koncu),
 *   4. oszczednosc w zl / mies. — wieksza wyzej, zadania bez kwoty na koncu,
 *   5. story pointy rosnaco — mniejsze pierwsze, bez wyceny na koncu.
 * Tag „Wysoki" zostaje dostepny jako poziom, tylko nie jest w domyslnym stosie.
 */
export const PLAN_SORT_DOMYSLNY: PlanSortLevel[] = [
  { by: 'priority', dir: 'asc' },
  { by: 'terminy', dir: 'asc' },
  { by: 'macierz', dir: 'asc' },
  { by: 'oszczednosc', dir: 'asc' },
  { by: 'sp', dir: 'asc' },
];

/** Domyslny stos z okresem zwrotu (przed oszczednoscia w zl) — kto go nie ruszal, dostaje nowy. */
const DOMYSLNY_ZE_ZWROTEM: PlanSortLevel[] = [
  { by: 'priority', dir: 'asc' },
  { by: 'terminy', dir: 'asc' },
  { by: 'macierz', dir: 'asc' },
  { by: 'zwrot', dir: 'asc' },
  { by: 'sp', dir: 'asc' },
];

/** Domyslny stos sprzed osi „terminy" — kto go nie ruszal, dostaje nowy. */
const DOMYSLNY_BEZ_TERMINOW: PlanSortLevel[] = [
  { by: 'priority', dir: 'asc' },
  { by: 'macierz', dir: 'asc' },
  { by: 'zwrot', dir: 'asc' },
  { by: 'sp', dir: 'asc' },
];

/** Domyslny stos z pulami (przed macierza) — kto go nie ruszal, dostaje nowy. */
const DOMYSLNY_Z_PULA: PlanSortLevel[] = [
  { by: 'priority', dir: 'asc' },
  { by: 'pula', dir: 'asc' },
  { by: 'wysoki', dir: 'asc' },
  { by: 'zwrot', dir: 'asc' },
  { by: 'sp', dir: 'desc' },
];

/** Dawne domyslne stosy — kto ich nie ruszal, dostaje nowy domyslny, a nie zamrozony stary. */
const STARE_DOMYSLNE: PlanSortLevel[][] = [
  DOMYSLNY_ZE_ZWROTEM,
  DOMYSLNY_BEZ_TERMINOW,
  DOMYSLNY_Z_PULA,
  [
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
  [
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'zwrot', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
  [
    { by: 'strategia', dir: 'asc' },
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'zwrot', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
  [
    { by: 'priority', dir: 'asc' },
    { by: 'strategia', dir: 'asc' },
    { by: 'zwrot', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
];

const takSamo = (a: PlanSortLevel[], b: PlanSortLevel[]) =>
  a.length === b.length && a.every((l, i) => l.by === b[i].by && l.dir === b[i].dir);

/**
 * Zapisane w przegladarce sortowanie planowania. Zapisany jest CALY stos, wiec kto nigdy go nie
 * zmienil, mial w localStorage stary domyslny — i nowa kolejnosc nigdy by do niego nie dotarla. Stary domyslny zastepujemy nowym; stos ulozony przez uzytkownika zostaje jak byl.
 */
export function migratePlanSort(saved: PlanSortLevel[] | undefined): PlanSortLevel[] | undefined {
  if (!saved) return undefined;
  if (STARE_DOMYSLNE.some((s) => takSamo(saved, s))) return PLAN_SORT_DOMYSLNY;
  /*
   * Wlasny stos: osie wycofanych pojec znikaja. „Okres zwrotu" zamieniamy na „Oszczednosc" w tym samym miejscu
   * (ta sama rola w kolejce), a „pula" i „strategia" wypadaja. Bez dubla, gdy oszczednosc juz jest w stosie.
   */
  if (!saved.some((l) => WYCOFANE_OSIE.has(l.by))) return saved;
  const out: PlanSortLevel[] = [];
  for (const l of saved) {
    const by = l.by === 'zwrot' ? 'oszczednosc' : l.by;
    if (WYCOFANE_OSIE.has(by) || out.some((x) => x.by === by)) continue;
    out.push(by === l.by ? l : { by, dir: 'asc' });
  }
  return out;
}

/** Osie, ktorych juz nie ma: pule wycofane, okres zwrotu zastapila oszczednosc w zl / mies. */
const WYCOFANE_OSIE = new Set(['pula', 'strategia', 'zwrot']);

/**
 * Komparator planowania dla wybranego stosu.
 *
 * `axis` to rosnace porownanie osi wspolnych z lista (priorytet, daty, tytul) —
 * podawane z zewnatrz, zeby „po priorytecie" znaczylo tu to samo co na liscie.
 * `stageRank` to pozycja etapu w procesie; zadanie bez etapu idzie na koniec.
 * `savings` to oszczednosc zadania w zl / mies. z wiadomosci WARTOŚĆ (`null` = bez kwoty); bez niej
 * os „oszczednosc" niczego nie rozstrzyga.
 */
export function planComparator(
  sort: PlanSortLevel[],
  deps: {
    axis: (by: string, a: Task, b: Task) => number;
    stageRank: (t: Task) => number;
    me: number | null;
    savings?: (t: Task) => number | null;
    /**
     * Ranga terminu zadania: 0 — musi wejsc w obecnym sprincie (czerwony), 1 — w nastepnym (zolty),
     * 2 — reszta (zielony albo bez terminu). Bez niej os „terminy" niczego nie rozstrzyga.
     */
    deadlineRank?: (t: Task) => number;
  },
): Cmp {
  const savings = deps.savings ?? (() => null);

  /*
   * „Terminy": najpierw kolor, w obrebie koloru data. Zielone i bez terminu to jedna ranga bez daty —
   * kolejnosc miedzy nimi rozstrzygaja dalsze poziomy stosu (macierz, oszczednosc, SP), a nie odlegly termin.
   */
  const urgency = deps.deadlineRank ?? (() => 2);
  const byDeadlines: Cmp = (a, b) => {
    const r = urgency(a) - urgency(b);
    if (r !== 0 || urgency(a) >= 2) return r;
    return deadlineTime(a) - deadlineTime(b);
  };

  const levels = sort.map((lvl): Cmp => {
    /* Kazda os ROSNACO — kierunek doklada dopiero `odwroc`. */
    const f: Cmp =
      lvl.by === 'stage'
        ? (a, b) => deps.stageRank(a) - deps.stageRank(b)
        : lvl.by === 'wysoki'
          ? (a, b) => wysokiRank(a) - wysokiRank(b)
          : lvl.by === 'sp'
            ? spComparator(lvl.dir)
            : lvl.by === 'oszczednosc'
              ? savingsComparator(lvl.dir, savings)
              : lvl.by === 'terminy'
                ? byDeadlines
                : lvl.by === 'macierz'
                  ? (a, b) => macierzRank(a) - macierzRank(b)
                  : (a, b) => deps.axis(lvl.by, a, b);
    /* SP i oszczednosc maja wlasny kierunek (braki zawsze na koncu), wiec nie przechodza przez odwrocenie. */
    return lvl.by === 'sp' || lvl.by === 'oszczednosc' || lvl.dir === 'asc' ? f : (a, b) => -f(a, b);
  });

  /* Remis po CALYM stosie, tak samo jak w liscie: moje wyzej, potem po id malejaco. */
  const mineRank = (t: Task) => (deps.me !== null && t.responsibleId === deps.me ? 0 : 1);
  return stackComparator(levels, (a, b) => mineRank(a) - mineRank(b) || b.id - a.id);
}
