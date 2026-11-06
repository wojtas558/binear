import { describe, expect, it } from 'vitest';
import type { Task } from './bitrix';
import { migratePlanSort, PLAN_SORT_DOMYSLNY, planComparator, stackComparator, type Cmp } from './planSort';

/** Zadanie z samymi polami, ktore czyta sortowanie planowania. */
const task = (id: number, p: Partial<Task> = {}): Task =>
  ({ id, priority: '1', tags: [], storyPoints: null, responsibleId: null, stageId: null, ...p }) as Task;

/* Os priorytetu jak w liscie: 2 (wysoki) przed 1 przed 0. */
const RANK: Record<string, number> = { '2': 0, '1': 1, '0': 2 };
const deps = {
  axis: (by: string, a: Task, b: Task) => (by === 'priority' ? RANK[a.priority] - RANK[b.priority] : 0),
  stageRank: (t: Task) => t.stageId ?? Number.MAX_SAFE_INTEGER,
  me: null as number | null,
};

const ids = (tasks: Task[], sort: Parameters<typeof planComparator>[0], d = deps) =>
  [...tasks].sort(planComparator(sort, d)).map((t) => t.id);

describe('stackComparator', () => {
  it('siega do kolejnego poziomu tylko przy remisie', () => {
    const calls: string[] = [];
    const first: Cmp = () => (calls.push('1'), 0);
    const second: Cmp = () => (calls.push('2'), -1);
    expect(stackComparator([first, second], () => 99)(task(1), task(2))).toBe(-1);
    expect(calls).toEqual(['1', '2']);
  });

  it('ogon rozstrzyga dopiero remis po CALYM stosie', () => {
    const tie: Cmp = () => 0;
    expect(stackComparator([tie, tie], () => 7)(task(1), task(2))).toBe(7);
  });

  it('pierwszy rozstrzygajacy poziom konczy porownanie', () => {
    const later: Cmp = () => {
      throw new Error('nie powinien byc wolany');
    };
    expect(stackComparator([() => 1, later], () => 0)(task(1), task(2))).toBe(1);
  });
});

describe('planComparator', () => {
  /*
   * Blad, ktory to naprawia: pierwszy poziom nigdy nie oddawal remisu, wiec
   * przy tym samym priorytecie SP nic nie znaczyly.
   */
  it('przy tym samym priorytecie sortuje po SP (drugi poziom dziala)', () => {
    const tasks = [
      task(1, { priority: '1', storyPoints: 2 }),
      task(2, { priority: '1', storyPoints: 8 }),
      task(3, { priority: '2', storyPoints: 1 }),
      task(4, { priority: '1', storyPoints: 5 }),
    ];
    expect(
      ids(tasks, [
        { by: 'priority', dir: 'asc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual([3, 2, 4, 1]);
  });

  it('domyslna kolejnosc waznosci: priorytet, potem tag Wysoki, potem SP malejaco', () => {
    /* Kolejnosc po id (ogon) jest inna niz oczekiwana — test nie zda przypadkiem. */
    const tasks = [
      task(1, { priority: '1', tags: ['wysoki'], storyPoints: 5 }),
      task(2, { priority: '1', tags: ['Wysoki'], storyPoints: 1 }),
      task(3, { priority: '1', storyPoints: 8 }),
      task(4, { priority: '2', storyPoints: 1 }),
    ];
    expect(
      ids(tasks, [
        { by: 'priority', dir: 'asc' },
        { by: 'wysoki', dir: 'asc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual([4, 1, 2, 3]);
  });

  it('kierunek odwraca tylko swoj poziom', () => {
    const tasks = [
      task(1, { priority: '1', storyPoints: 2 }),
      task(2, { priority: '2', storyPoints: 2 }),
      task(3, { priority: '1', storyPoints: 9 }),
    ];
    expect(
      ids(tasks, [
        { by: 'priority', dir: 'desc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual([3, 1, 2]);
  });

  it('bez SP liczy sie jako 0', () => {
    const tasks = [task(1, { storyPoints: null }), task(2, { storyPoints: 3 })];
    expect(ids(tasks, [{ by: 'sp', dir: 'desc' }])).toEqual([2, 1]);
  });

  it('zadanie bez etapu idzie na koniec', () => {
    const tasks = [task(1), task(2, { stageId: 3 }), task(3, { stageId: 1 })];
    expect(ids(tasks, [{ by: 'stage', dir: 'asc' }])).toEqual([3, 2, 1]);
  });

  it('pelny remis: moje wyzej, potem id malejaco', () => {
    const tasks = [task(1), task(2, { responsibleId: 7 }), task(3)];
    expect(ids(tasks, [{ by: 'sp', dir: 'desc' }], { ...deps, me: 7 })).toEqual([2, 3, 1]);
  });
});

describe('os „terminy"', () => {
  /* Ranga z mapy id → ranga: 0 czerwony, 1 zolty, reszta 2. */
  const rangi: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 };
  const d = { ...deps, deadlineRank: (t: Task) => rangi[t.id] ?? 2 };
  const dl = (id: number, deadline: string | null, p: Partial<Task> = {}) => task(id, { deadline, ...p });

  it('najpierw kolor: czerwone przed zoltymi przed reszta', () => {
    const tasks = [dl(4, null), dl(3, '2026-11-02'), dl(1, '2026-11-02')];
    expect(ids(tasks, [{ by: 'terminy', dir: 'asc' }], d)).toEqual([1, 3, 4]);
  });

  it('w obrebie koloru decyduje data terminu, a nie kolejnosc zadan', () => {
    const tasks = [dl(1, '2026-11-05'), dl(2, '2026-11-02')];
    expect(ids(tasks, [{ by: 'terminy', dir: 'asc' }], d)).toEqual([2, 1]);
  });

  it('zielone i bez terminu nie sa porzadkowane data — rozstrzyga kolejny poziom stosu', () => {
    const tasks = [
      dl(4, '2026-12-30', { tags: ['B'] }),
      dl(5, null, { tags: ['A'] }),
    ];
    const stack = [{ by: 'terminy', dir: 'asc' as const }, { by: 'macierz', dir: 'asc' as const }];
    expect(ids(tasks, stack, d)).toEqual([5, 4]);
  });

  it('domyslny stos: plomien, potem terminy wg koloru i daty, potem macierz A–D', () => {
    expect(PLAN_SORT_DOMYSLNY.map((l) => l.by)).toEqual(['priority', 'terminy', 'macierz', 'oszczednosc', 'sp']);
    const tasks = [
      dl(5, null, { tags: ['A'] }),
      dl(3, '2026-11-09', { tags: ['A'] }),
      dl(2, '2026-11-04', { tags: ['D'] }),
      dl(1, '2026-11-02', { tags: ['D'] }),
      dl(6, null, { priority: '2' }),
    ];
    // plomien (6) na gorze, potem czerwone wg daty (1, 2), zolte (3), na koncu A bez terminu (5)
    expect(ids(tasks, PLAN_SORT_DOMYSLNY, { ...d, axis: deps.axis })).toEqual([6, 1, 2, 3, 5]);
  });
});

describe('migratePlanSort', () => {
  const STARY = [
    { by: 'priority', dir: 'asc' as const },
    { by: 'wysoki', dir: 'asc' as const },
    { by: 'sp', dir: 'desc' as const },
  ];

  it('domyslny stos sprzed osi terminy tez zamienia na nowy', () => {
    expect(
      migratePlanSort([
        { by: 'priority', dir: 'asc' as const },
        { by: 'macierz', dir: 'asc' as const },
        { by: 'zwrot', dir: 'asc' as const },
        { by: 'sp', dir: 'asc' as const },
      ]),
    ).toEqual(PLAN_SORT_DOMYSLNY);
  });

  it('kazdy stary domyslny (zapisany w przegladarce) zamienia na nowy', () => {
    expect(migratePlanSort(STARY)).toEqual(PLAN_SORT_DOMYSLNY);
    expect(migratePlanSort([...STARY.slice(0, 2), { by: 'zwrot', dir: 'asc' as const }, STARY[2]])).toEqual(PLAN_SORT_DOMYSLNY);
    // poprzednia wersja domyslnego: strategia, priorytet, Wysoki, zwrot, SP
    expect(
      migratePlanSort([
        { by: 'strategia', dir: 'asc' as const },
        { by: 'priority', dir: 'asc' as const },
        { by: 'wysoki', dir: 'asc' as const },
        { by: 'zwrot', dir: 'asc' as const },
        { by: 'sp', dir: 'desc' as const },
      ]),
    ).toEqual(PLAN_SORT_DOMYSLNY);
  });

  it('poprzedni domyslny (strategia, zwrot, Wysoki) tez zamienia na nowy', () => {
    expect(
      migratePlanSort([
        { by: 'priority', dir: 'asc' as const },
        { by: 'strategia', dir: 'asc' as const },
        { by: 'zwrot', dir: 'asc' as const },
        { by: 'wysoki', dir: 'asc' as const },
        { by: 'sp', dir: 'desc' as const },
      ]),
    ).toEqual(PLAN_SORT_DOMYSLNY);
  });

  it('obecny domyslny przechodzi bez zmian', () => {
    expect(migratePlanSort(PLAN_SORT_DOMYSLNY)).toEqual(PLAN_SORT_DOMYSLNY);
  });

  it('stos ulozony przez uzytkownika zostaje bez zmian', () => {
    const wlasny = [{ by: 'sp', dir: 'desc' as const }, { by: 'deadline', dir: 'asc' as const }];
    expect(migratePlanSort(wlasny)).toBe(wlasny);
    const odwrocony = [{ ...STARY[0], dir: 'desc' as const }, STARY[1], STARY[2]];
    expect(migratePlanSort(odwrocony)).toBe(odwrocony);
  });

  it('brak zapisu → brak wartosci (wchodzi domyslny z ustawien)', () => {
    expect(migratePlanSort(undefined)).toBeUndefined();
  });
});

describe('domyslna kolejnosc planowania: plomien, terminy, macierz A-D, oszczednosc, mniejsze SP', () => {
  /* Oszczednosc w zl / mies. zapisana w zadaniu testowym jako pole pomocnicze (w aplikacji — z czatu). */
  const ZL = new Map<number, number>();
  const d = { ...deps, savings: (t: Task) => ZL.get(t.id) ?? null };

  it('domyslny stos to priorytet, terminy, macierz, oszczednosc, SP rosnaco', () => {
    expect(PLAN_SORT_DOMYSLNY).toEqual([
      { by: 'priority', dir: 'asc' },
      { by: 'terminy', dir: 'asc' },
      { by: 'macierz', dir: 'asc' },
      { by: 'oszczednosc', dir: 'asc' },
      { by: 'sp', dir: 'asc' },
    ]);
  });

  it('macierz idzie A, B, C, D, a bez tagu na koncu; BUG i B2B to nie macierz', () => {
    const tasks = [
      task(1, { tags: ['BUG'] }),
      task(2, { tags: ['D'] }),
      task(3, { tags: ['a'] }),
      task(4, { tags: ['C'] }),
      task(5, { tags: ['B'] }),
      task(6, { tags: ['B2B'] }),
    ];
    expect(ids(tasks, PLAN_SORT_DOMYSLNY, d)).toEqual([3, 5, 4, 2, 6, 1]);
  });

  it('plomien jest nad macierza', () => {
    const tasks = [task(1, { tags: ['A'] }), task(2, { priority: '2', tags: ['D'] })];
    expect(ids(tasks, PLAN_SORT_DOMYSLNY, d)).toEqual([2, 1]);
  });

  it('w obrebie litery najpierw wieksza oszczednosc, przy remisie mniej godzin, bez kwoty na koncu', () => {
    ZL.clear();
    ZL.set(1, 300).set(2, 1200).set(3, 1200).set(5, 1200);
    const tasks = [
      task(1, { tags: ['B'], storyPoints: 2 }),
      task(2, { tags: ['B'], storyPoints: 20 }),
      task(3, { tags: ['B'], storyPoints: 4 }),
      task(4, { tags: ['B'], storyPoints: 1 }),
      task(5, { tags: ['B'] }),
    ];
    expect(ids(tasks, PLAN_SORT_DOMYSLNY, d)).toEqual([3, 2, 5, 1, 4]);
  });

  it('odwrocona oszczednosc daje najmniejsza kwote na gorze, ale bez kwoty dalej na koncu', () => {
    ZL.clear();
    ZL.set(1, 300).set(2, 1200);
    const tasks = [task(1), task(2), task(3)];
    expect(ids(tasks, [{ by: 'oszczednosc', dir: 'desc' }], d)).toEqual([1, 2, 3]);
    expect(ids(tasks, [{ by: 'oszczednosc', dir: 'asc' }], d)).toEqual([2, 1, 3]);
  });

  it('bez zrodla kwot os oszczednosci niczego nie rozstrzyga', () => {
    const tasks = [task(1), task(2)];
    expect(ids(tasks, [{ by: 'oszczednosc', dir: 'asc' }])).toEqual([2, 1]);
  });
});

describe('migratePlanSort — wycofane osie', () => {
  it('stare domyslne z okresem zwrotu i z pulami zastepuje nowy', () => {
    const zeZwrotem = [
      { by: 'priority', dir: 'asc' as const },
      { by: 'terminy', dir: 'asc' as const },
      { by: 'macierz', dir: 'asc' as const },
      { by: 'zwrot', dir: 'asc' as const },
      { by: 'sp', dir: 'asc' as const },
    ];
    expect(migratePlanSort(zeZwrotem)).toEqual(PLAN_SORT_DOMYSLNY);
    expect(
      migratePlanSort([
        { by: 'priority', dir: 'asc' },
        { by: 'pula', dir: 'asc' },
        { by: 'wysoki', dir: 'asc' },
        { by: 'zwrot', dir: 'asc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual(PLAN_SORT_DOMYSLNY);
  });

  it('wlasny stos: zwrot staje sie oszczednoscia w tym samym miejscu, pula i strategia znikaja', () => {
    expect(
      migratePlanSort([
        { by: 'sp', dir: 'desc' },
        { by: 'pula', dir: 'asc' },
        { by: 'zwrot', dir: 'desc' },
        { by: 'strategia', dir: 'asc' },
      ]),
    ).toEqual([
      { by: 'sp', dir: 'desc' },
      { by: 'oszczednosc', dir: 'asc' },
    ]);
  });

  it('bez dubla, gdy oszczednosc juz jest w stosie', () => {
    expect(
      migratePlanSort([
        { by: 'oszczednosc', dir: 'asc' },
        { by: 'zwrot', dir: 'asc' },
      ])?.map((l) => l.by),
    ).toEqual(['oszczednosc']);
  });
});
