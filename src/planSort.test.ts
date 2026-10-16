import { describe, expect, it } from 'vitest';
import type { Task } from './bitrix';
import { paybackRank } from './counters';
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

describe('sortowanie po zwrocie', () => {
  const d = { ...deps, paybackRank };
  const zwrot = [{ by: 'zwrot', dir: 'asc' as const }];

  it('od najkrotszego zwrotu do najdluzszego, na koncu zadania bez okresu zwrotu', () => {
    const tasks = [
      task(3, { tags: ['ZWROT-12+'] }),
      task(1, { tags: ['ZWROT-12'] }),
      task(5),
      task(2, { tags: ['ZWROT-3'] }),
      task(4, { tags: ['ZWROT-6'] }),
    ];
    expect(ids(tasks, zwrot, d)).toEqual([2, 4, 1, 3, 5]);
  });

  it('wymogi na poczatku, od najblizszego terminu; wymog bez terminu za tymi z terminem', () => {
    const tasks = [
      task(2, { tags: ['ZWROT-3'] }),
      task(10, { tags: ['WYMOG'], deadline: '2026-11-20T00:00:00+02:00' }),
      task(11, { tags: ['wymog'], deadline: '2026-10-05T00:00:00+02:00' }),
      task(12, { tags: ['WYMOG'], deadline: null }),
    ];
    expect(ids(tasks, zwrot, d)).toEqual([11, 10, 12, 2]);
  });

  it('STRATEGIA to zwykly tag: sortowanie po zwrocie jej nie wyroznia', () => {
    const tasks = [
      task(2, { tags: ['ZWROT-3'] }),
      task(20, { tags: ['STRATEGIA'] }),
      task(10, { tags: ['WYMOG'], deadline: '2026-11-20T00:00:00+02:00' }),
      task(3, { tags: ['ZWROT-12+'] }),
      task(5),
    ];
    expect(ids(tasks, zwrot, d)).toEqual([10, 2, 3, 20, 5]);
  });

  it('w tym samym przedziale rozstrzyga kolejny poziom stosu', () => {
    const tasks = [task(2, { tags: ['ZWROT-3'], storyPoints: 2 }), task(7, { tags: ['ZWROT-3'], storyPoints: 9 })];
    expect(
      ids(tasks, [{ by: 'zwrot', dir: 'asc' }, { by: 'sp', dir: 'desc' }], d),
    ).toEqual([7, 2]);
  });

  it('odwrocony kierunek daje najgorszy zwrot na gorze', () => {
    const tasks = [task(2, { tags: ['ZWROT-3'] }), task(3, { tags: ['ZWROT-12+'] }), task(5)];
    expect(ids(tasks, [{ by: 'zwrot', dir: 'desc' }], d)).toEqual([5, 3, 2]);
  });
});

describe('stos z pulami: plomien, pula, Wysoki, zwrot, SP malejaco', () => {
  const d = { ...deps, paybackRank };
  const STOS_PULA = [
    { by: 'priority', dir: 'asc' },
    { by: 'pula', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'zwrot', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ] as const;

  it('plomien (priorytet 2) jest nad wszystkim — takze nad pula', () => {
    const tasks = [
      task(1, { priority: '1', tags: ['CIAGLOSC'] }),
      task(2, { priority: '2', tags: ['DZIAL', 'ZWROT-12+'] }),
      task(3, { priority: '1', tags: ['RDZEN'] }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([2, 1, 3]);
  });

  it('pule ida kolejno: CIAGLOSC, RDZEN, DZIAL, a zadania bez puli na koncu', () => {
    const tasks = [
      task(1, { tags: ['ZWROT-3'] }),
      task(2, { tags: ['DZIAL', 'ZWROT-3'] }),
      task(3, { tags: ['RDZEN'] }),
      task(4, { tags: ['CIAGLOSC', 'ZWROT-12+'] }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([4, 3, 2, 1]);
  });

  it('pula jest nad tagiem Wysoki i nad zwrotem', () => {
    const tasks = [
      task(1, { tags: ['DZIAL', 'Wysoki', 'ZWROT-3'] }),
      task(2, { tags: ['RDZEN'] }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([2, 1]);
  });

  it('w obrebie puli tag Wysoki rozstrzyga PRZED zwrotem', () => {
    const tasks = [
      task(1, { tags: ['DZIAL', 'ZWROT-3'] }),
      task(2, { tags: ['DZIAL', 'Wysoki', 'ZWROT-12'] }),
      task(3, { tags: ['DZIAL'] }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([2, 1, 3]);
  });

  it('w RDZEN bez zwrotu po Wysoki decyduja story pointy malejaco', () => {
    const tasks = [
      task(1, { tags: ['RDZEN'], storyPoints: 4 }),
      task(2, { tags: ['RDZEN'], storyPoints: 20 }),
      task(3, { tags: ['RDZEN', 'Wysoki'], storyPoints: 2 }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([3, 2, 1]);
  });

  it('w obrebie tej samej puli i Wysoki zwrot rosnaco: ZWROT-3, 6, 12, 12+, a bez zwrotu na koncu', () => {
    const tasks = [
      task(1, { tags: ['DZIAL', 'ZWROT-12+'] }),
      task(2, { tags: ['DZIAL'] }),
      task(3, { tags: ['DZIAL', 'ZWROT-3'] }),
      task(4, { tags: ['DZIAL', 'ZWROT-12'] }),
      task(5, { tags: ['DZIAL', 'ZWROT-6'] }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([3, 5, 4, 1, 2]);
  });

  it('wymog (z terminem) idzie przed przedzialami zwrotu w tej samej puli', () => {
    const tasks = [
      task(1, { tags: ['DZIAL', 'ZWROT-3'] }),
      task(2, { tags: ['DZIAL', 'WYMOG'], deadline: '2026-11-20T00:00:00+02:00' }),
    ];
    expect(ids(tasks, [...STOS_PULA], d)).toEqual([2, 1]);
  });

  it('sortowanie niczego nie ukrywa — zadania bez puli tez sa na liscie', () => {
    const tasks = [task(1), task(2, { tags: ['ZWROT-6'] }), task(3, { tags: ['RDZEN'] })];
    expect(ids(tasks, [...STOS_PULA], d)).toHaveLength(3);
  });

  it('dwie pule na jednym zadaniu: liczy sie pierwsza z listy', () => {
    const tasks = [task(1, { tags: ['DZIAL', 'RDZEN'] }), task(2, { tags: ['CIAGLOSC', 'DZIAL'] })];
    expect(ids(tasks, [{ by: 'pula', dir: 'asc' }], d)).toEqual([2, 1]);
  });

  it('poziom pula mozna odwrocic albo wyjac ze stosu', () => {
    const tasks = [task(1, { tags: ['CIAGLOSC'] }), task(2)];
    expect(ids(tasks, [{ by: 'pula', dir: 'desc' }], d)).toEqual([2, 1]);
    expect(ids(tasks, [{ by: 'sp', dir: 'desc' }], d)).toEqual([2, 1]); // remis → id malejaco
  });
});

describe('migratePlanSort', () => {
  const STARY = [
    { by: 'priority', dir: 'asc' as const },
    { by: 'wysoki', dir: 'asc' as const },
    { by: 'sp', dir: 'desc' as const },
  ];

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

  it('wlasny stos z poziomem strategia dostaje pule w tym samym miejscu i kierunku', () => {
    expect(
      migratePlanSort([
        { by: 'sp', dir: 'desc' as const },
        { by: 'strategia', dir: 'desc' as const },
      ]),
    ).toEqual([
      { by: 'sp', dir: 'desc' },
      { by: 'pula', dir: 'desc' },
    ]);
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

describe('domyslna kolejnosc planowania: plomien, macierz A-D, zwrot, mniejsze SP', () => {
  const d = { ...deps, paybackRank };

  it('domyslny stos to priorytet, macierz, zwrot, SP rosnaco', () => {
    expect(PLAN_SORT_DOMYSLNY).toEqual([
      { by: 'priority', dir: 'asc' },
      { by: 'macierz', dir: 'asc' },
      { by: 'zwrot', dir: 'asc' },
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

  it('w obrebie litery najpierw zwrot, potem mniejsze SP, a bez wyceny na koncu', () => {
    const tasks = [
      task(1, { tags: ['B', 'ZWROT-6'], storyPoints: 2 }),
      task(2, { tags: ['B', 'ZWROT-3'], storyPoints: 20 }),
      task(3, { tags: ['B', 'ZWROT-3'], storyPoints: 4 }),
      task(4, { tags: ['B', 'ZWROT-3'] }),
    ];
    expect(ids(tasks, PLAN_SORT_DOMYSLNY, d)).toEqual([3, 2, 4, 1]);
  });

  it('stary domyslny stos z pulami jest zastepowany nowym', () => {
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
});
