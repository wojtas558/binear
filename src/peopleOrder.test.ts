import { describe, expect, it } from 'vitest';

import { teamFirst } from './peopleOrder';

const p = (id: number) => ({ id });

describe('teamFirst', () => {
  it('skroty, potem zespol, potem reszta; podpisy na pierwszych pozycjach grup', () => {
    const r = teamFirst([p(1), p(2), p(3), p(4), p(5)], new Set([3, 5]), new Set([1]));
    expect(r.map((x) => x.item.id)).toEqual([1, 3, 5, 2, 4]);
    expect(r.map((x) => x.section)).toEqual([undefined, 'Zespół', undefined, 'Pozostali', undefined]);
  });
  it('bez zespolu albo bez reszty nie ma podpisow', () => {
    expect(teamFirst([p(1), p(2)], new Set()).every((x) => !x.section)).toBe(true);
    expect(teamFirst([p(1), p(2)], new Set([1, 2])).every((x) => !x.section)).toBe(true);
  });
});
