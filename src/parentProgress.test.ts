import { describe, expect, it } from 'vitest';
import { childState, groupChildren, parentProgress } from './parentProgress';

const c = (id: number, status: string, storyPoints: number | null, parentId = 1) => ({
  id,
  parentId,
  status,
  storyPoints,
});

describe('parentProgress', () => {
  it('bez podzadan nie ma postepu', () => {
    expect(parentProgress(undefined)).toBeNull();
    expect(parentProgress([])).toBeNull();
  });

  it('stan podzadania: 4 i 5 to zrobione, 3 w toku, reszta czeka', () => {
    expect(childState('5')).toBe('done');
    expect(childState('4')).toBe('done');
    expect(childState('3')).toBe('doing');
    for (const s of ['1', '2', '6']) expect(childState(s)).toBe('waiting');
  });

  it('sumuje SP dzieci i rozbija je na zrobione / w toku / czeka', () => {
    const p = parentProgress([c(10, '5', 8), c(11, '3', 4), c(12, '2', 6), c(13, '4', 2)]);
    expect(p).toMatchObject({ count: 4, points: 20, done: 10, doing: 4, waiting: 6, unestimated: 0 });
    expect(p!.done + p!.doing + p!.waiting).toBe(p!.points);
  });

  it('kazde podzadanie ma kawalek o swoich SP; kolejnosc dzieci zostaje', () => {
    const p = parentProgress([c(10, '5', 8), c(11, '3', 4)]);
    expect(p!.slices).toEqual([
      { id: 10, sp: 8, state: 'done' },
      { id: 11, sp: 4, state: 'doing' },
    ]);
  });

  it('podzadania bez SP albo z zerem sa tylko zliczone, nie maja kawalka', () => {
    const p = parentProgress([c(10, '5', null), c(11, '2', 0), c(12, '2', 3)]);
    expect(p).toMatchObject({ count: 3, points: 3, unestimated: 2 });
    expect(p!.slices).toHaveLength(1);
  });

  it('same podzadania bez SP: suma zero, pasek pusty', () => {
    const p = parentProgress([c(10, '2', null)]);
    expect(p).toMatchObject({ points: 0, unestimated: 1, slices: [] });
  });
});

describe('groupChildren', () => {
  it('grupuje po rodzicu i pomija zadania bez rodzica', () => {
    const m = groupChildren([c(10, '2', 1, 1), c(11, '2', 1, 1), c(12, '2', 1, 2), { id: 13, parentId: null, status: '2', storyPoints: 1 }]);
    expect(m.get(1)!.map((t) => t.id)).toEqual([10, 11]);
    expect(m.get(2)!.map((t) => t.id)).toEqual([12]);
    expect(m.size).toBe(2);
  });
});
