/*
 * Kolejnosc zadan w widoku planowania — STOS kluczy: pierwszy rozstrzyga,
 * kolejny wchodzi dopiero przy remisie, a remis po calym stosie rozstrzyga ogon
 * (moje wyzej, potem po id).
 *
 * Osobno od App.tsx, zeby dalo sie to przetestowac: blad, ktory tu siedzial,
 * byl niewidoczny w kodzie, a widoczny dopiero w kolejnosci wierszy.
 */
import type { Task } from './bitrix';
import { pula, TAGS_PULA } from './counters';

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

/** Pula: CIAGLOSC, RDZEN, DZIAL (w tej kolejnosci), bez puli na koncu. */
const pulaRank = (t: Task) => {
  const p = pula(t);
  return p === null ? TAGS_PULA.length : TAGS_PULA.indexOf(p);
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
 *   4. okres zwrotu rosnaco (ZWROT-3 przed ZWROT-6 itd.; wymogi po terminie, zadania bez zwrotu na koncu),
 *   5. story pointy rosnaco — mniejsze pierwsze, bez wyceny na koncu.
 * Pula i tag „Wysoki" zostaja dostepne jako poziomy, tylko nie sa juz w domyslnym stosie.
 */
export const PLAN_SORT_DOMYSLNY: PlanSortLevel[] = [
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
  /* Wlasny stos: poziom „strategia" (tag STRATEGIA juz nic nie znaczy) zamieniamy na „pula" w tym samym miejscu. */
  if (!saved.some((l) => l.by === 'strategia')) return saved;
  // Bez dubla: stos, ktory ma juz „pula", traci tylko „strategia".
  const hasPula = saved.some((l) => l.by === 'pula');
  return saved.flatMap((l) => (l.by !== 'strategia' ? [l] : hasPula ? [] : [{ ...l, by: 'pula' as const }]));
}

/**
 * Komparator planowania dla wybranego stosu.
 *
 * `axis` to rosnace porownanie osi wspolnych z lista (priorytet, daty, tytul) —
 * podawane z zewnatrz, zeby „po priorytecie" znaczylo tu to samo co na liscie.
 * `stageRank` to pozycja etapu w procesie; zadanie bez etapu idzie na koniec.
 * `paybackRank` to miejsce w sortowaniu „po zwrocie" (patrz `paybackRank` w counters.ts);
 * bez niej ta os niczego nie rozstrzyga.
 */
export function planComparator(
  sort: PlanSortLevel[],
  deps: {
    axis: (by: string, a: Task, b: Task) => number;
    stageRank: (t: Task) => number;
    me: number | null;
    paybackRank?: (t: Task) => number;
    /**
     * Ranga terminu zadania: 0 — musi wejsc w obecnym sprincie (czerwony), 1 — w nastepnym (zolty),
     * 2 — reszta (zielony albo bez terminu). Bez niej os „terminy" niczego nie rozstrzyga.
     */
    deadlineRank?: (t: Task) => number;
  },
): Cmp {
  /*
   * „Po zwrocie": wymogi na poczatku, od najblizszego terminu (wymog ma date, nie
   * ranking), potem przedzialy od najlepszego, na koncu zadania bez okresu zwrotu.
   * Zadania w tym samym przedziale zostaja w remisie — rozstrzyga kolejny poziom stosu.
   */
  const rankOf = deps.paybackRank ?? (() => 0);
  const byPayback: Cmp = (a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r !== 0 || rankOf(a) !== 0) return r;
    return deadlineTime(a) - deadlineTime(b);
  };

  /*
   * „Terminy": najpierw kolor, w obrebie koloru data. Zielone i bez terminu to jedna ranga bez daty —
   * kolejnosc miedzy nimi rozstrzygaja dalsze poziomy stosu (macierz, zwrot, SP), a nie odlegly termin.
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
        : lvl.by === 'pula'
          ? (a, b) => pulaRank(a) - pulaRank(b)
          : lvl.by === 'wysoki'
          ? (a, b) => wysokiRank(a) - wysokiRank(b)
          : lvl.by === 'sp'
            ? spComparator(lvl.dir)
            : lvl.by === 'terminy'
              ? byDeadlines
              : lvl.by === 'macierz'
              ? (a, b) => macierzRank(a) - macierzRank(b)
              : lvl.by === 'zwrot'
              ? byPayback
              : (a, b) => deps.axis(lvl.by, a, b);
    /* SP ma wlasny kierunek (zadania bez wyceny zawsze na koncu), wiec nie przechodzi przez odwrocenie. */
    return lvl.by === 'sp' || lvl.dir === 'asc' ? f : (a, b) => -f(a, b);
  });

  /* Remis po CALYM stosie, tak samo jak w liscie: moje wyzej, potem po id malejaco. */
  const mineRank = (t: Task) => (deps.me !== null && t.responsibleId === deps.me ? 0 : 1);
  return stackComparator(levels, (a, b) => mineRank(a) - mineRank(b) || b.id - a.id);
}
