import { describe, expect, it } from 'vitest';
import { guardianKey, guardianTiles, NO_GUARDIAN } from './guardianTiles';

const PULA = new Set([11, 12]);

describe('guardianKey', () => {
  it('odpowiedzialny z puli to jego opiekun', () => {
    expect(guardianKey(11, PULA)).toBe('11');
  });

  it('konto techniczne, wspolne albo osoba spoza puli — bez opiekuna', () => {
    expect(guardianKey(90, PULA)).toBe(NO_GUARDIAN);
    expect(guardianKey(null, PULA)).toBe(NO_GUARDIAN);
  });

  it('pusta pula — wszyscy bez opiekuna', () => {
    expect(guardianKey(11, new Set())).toBe(NO_GUARDIAN);
  });
});

describe('guardianTiles', () => {
  it('kafelek na osobe z puli i kafelek „Bez opiekuna", liczba zadan w backlogu', () => {
    const g = guardianTiles([
      { id: 11, name: 'Osoba A' },
      { id: 12, name: 'Osoba B' },
    ]);
    expect(g?.tiles.map((t) => t.name)).toEqual(['Osoba A', 'Osoba B', 'Bez opiekuna']);
    for (const t of g?.tiles ?? []) {
      expect(t.scope).toBe('outside');
      expect(t.measure).toBe('count');
      expect(t.filters).toContainEqual({ field: 'kind', op: 'isNot', values: ['parent'] });
    }
    expect(g?.tiles[0].filters.at(-1)).toEqual({ field: 'guardian', op: 'is', values: ['11'] });
    expect(g?.tiles[2].filters.at(-1)).toEqual({ field: 'guardian', op: 'is', values: [NO_GUARDIAN] });
  });

  it('bez puli opiekunow nie ma grupy', () => {
    expect(guardianTiles([])).toBeNull();
  });
});
