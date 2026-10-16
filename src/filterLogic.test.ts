import { describe, expect, it } from 'vitest';

import { groupedKeys, matchGrouped, moveCondition, normalizeGroups, refreshGroups, toggleJoin } from './filterLogic';

interface C {
  id: string;
  v: boolean;
  or?: string;
}
const mk = (id: string, v: boolean, or?: string): C => ({ id, v, ...(or ? { or } : {}) });
const t = (c: C) => c.v;
let seq = 0;
const ng = () => `g${++seq}`;

describe('matchGrouped', () => {
  it('bez grup to ORAZ', () => {
    expect(matchGrouped([mk('a', true), mk('b', true)], t)).toBe(true);
    expect(matchGrouped([mk('a', true), mk('b', false)], t)).toBe(false);
  });
  it('grupa LUB wymaga jednego', () => {
    expect(matchGrouped([mk('a', false, 'x'), mk('b', true, 'x')], t)).toBe(true);
    expect(matchGrouped([mk('a', false, 'x'), mk('b', false, 'x')], t)).toBe(false);
  });
  it('(A LUB B) ORAZ C', () => {
    expect(matchGrouped([mk('a', false, 'x'), mk('b', true, 'x'), mk('c', false)], t)).toBe(false);
    expect(matchGrouped([mk('a', false, 'x'), mk('b', true, 'x'), mk('c', true)], t)).toBe(true);
  });
  it('puste = prawda', () => expect(matchGrouped([], t)).toBe(true));
});

describe('toggleJoin', () => {
  it('laczy sasiadow w grupe LUB i rozlacza z powrotem', () => {
    const joined = toggleJoin([mk('a', true), mk('b', true), mk('c', true)], 'b', ng);
    expect(joined[0].or).toBeTruthy();
    expect(joined[0].or).toBe(joined[1].or);
    expect(joined[2].or).toBeUndefined();
    const split = toggleJoin(joined, 'b', ng);
    expect(split.every((c) => !c.or)).toBe(true);
  });
  it('dolacza kolejny warunek do istniejacej grupy', () => {
    const j1 = toggleJoin([mk('a', true), mk('b', true), mk('c', true)], 'b', ng);
    const j2 = toggleJoin(j1, 'c', ng);
    expect(new Set(j2.map((c) => c.or)).size).toBe(1);
  });
  it('rozlaczenie w srodku grupy trzech zostawia nawias z dwoma', () => {
    const all = toggleJoin(toggleJoin([mk('a', true), mk('b', true), mk('c', true)], 'b', ng), 'c', ng);
    const split = toggleJoin(all, 'c', ng);
    expect(split[0].or).toBe(split[1].or);
    expect(split[2].or).toBeUndefined();
  });
});

describe('normalizeGroups / refreshGroups / groupedKeys', () => {
  it('zdejmuje nawias z jednym warunkiem', () => {
    expect(normalizeGroups([mk('a', true, 'x'), mk('b', true)])[0].or).toBeUndefined();
  });
  it('odswieza id grup, zachowujac podzial', () => {
    const r = refreshGroups([mk('a', true, 'x'), mk('b', true, 'x'), mk('c', true, 'y')], ng);
    expect(r[0].or).toBe(r[1].or);
    expect(r[0].or).not.toBe(r[2].or);
    expect(r[0].or).not.toBe('x');
  });
  it('odcisk nie zalezy od id grup ani kolejnosci', () => {
    const key = (c: C) => c.id;
    expect(groupedKeys([mk('a', true, 'x'), mk('b', true, 'x')], key)).toEqual(
      groupedKeys([mk('b', true, 'q'), mk('a', true, 'q')], key),
    );
    expect(groupedKeys([mk('a', true, 'x'), mk('b', true, 'x')], key)).not.toEqual(
      groupedKeys([mk('a', true), mk('b', true)], key),
    );
  });
});

describe('moveCondition', () => {
  it('przenosi chip na miejsce docelowe', () => {
    const r = moveCondition([mk('a', true), mk('b', true), mk('c', true)], 'a', 'c');
    expect(r.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(moveCondition([mk('a', true), mk('b', true), mk('c', true)], 'c', 'a').map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });
  it('wyjmuje przenoszony chip z grupy LUB i zdejmuje nawias z jednym warunkiem', () => {
    const r = moveCondition([mk('a', true, 'x'), mk('b', true, 'x'), mk('c', true)], 'a', 'c');
    expect(r.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(r.every((c) => !c.or)).toBe(true);
  });
  it('bez zmian, gdy to samo miejsce albo nieznane id', () => {
    const l = [mk('a', true), mk('b', true)];
    expect(moveCondition(l, 'a', 'a')).toEqual(l);
    expect(moveCondition(l, 'x', 'a')).toEqual(l);
  });
});
