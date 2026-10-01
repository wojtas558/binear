import { describe, expect, it } from 'vitest';
import { podzielNaZespolIKierownika, pozaLimitem, sumaDoLimitu, sumaKierownika } from './planCapacity';

const t = (id: number, responsibleId: number | null, storyPoints: number | null) => ({ id, responsibleId, storyPoints });
const KIER = [7];

describe('pozaLimitem', () => {
  it('zadanie kierownika jest poza limitem, cudze i nieprzypisane nie', () => {
    expect(pozaLimitem(t(1, 7, 8), KIER)).toBe(true);
    expect(pozaLimitem(t(2, 3, 8), KIER)).toBe(false);
    expect(pozaLimitem(t(3, null, 8), KIER)).toBe(false);
  });

  it('bez skonfigurowanych kierownikow nic nie jest poza limitem', () => {
    expect(pozaLimitem(t(1, 7, 8), [])).toBe(false);
  });
});

describe('podzielNaZespolIKierownika', () => {
  const lista = [t(1, 7, 40), t(2, 3, 8), t(3, null, 4), t(4, 7, 2)];

  it('dzieli po odpowiedzialnym, zachowujac kolejnosc', () => {
    const { zespol, kierownik } = podzielNaZespolIKierownika(lista, KIER);
    expect(zespol.map((x) => x.id)).toEqual([2, 3]);
    expect(kierownik.map((x) => x.id)).toEqual([1, 4]);
  });

  it('bez kierownikow wszystko jest zespolem', () => {
    const { zespol, kierownik } = podzielNaZespolIKierownika(lista, []);
    expect(zespol).toHaveLength(4);
    expect(kierownik).toHaveLength(0);
  });
});

describe('sumaDoLimitu / sumaKierownika', () => {
  const lista = [t(1, 7, 40), t(2, 3, 8), t(3, null, 4), t(4, 7, 2), t(5, 3, null)];

  it('limit zespolu nie zawiera zadan kierownika (40 SP inwentaryzacji nie zjada pojemnosci)', () => {
    expect(sumaDoLimitu(lista, KIER)).toBe(12);
  });

  it('kierownik ma swoja sume, osobno', () => {
    expect(sumaKierownika(lista, KIER)).toBe(42);
  });

  it('razem daja caly sprint', () => {
    expect(sumaDoLimitu(lista, KIER) + sumaKierownika(lista, KIER)).toBe(54);
  });

  it('bez kierownikow limit liczy wszystko, a kierownik ma zero', () => {
    expect(sumaDoLimitu(lista, [])).toBe(54);
    expect(sumaKierownika(lista, [])).toBe(0);
  });

  it('zadania bez oszacowania nie wchodza do sumy', () => {
    expect(sumaDoLimitu([t(1, 3, null)], KIER)).toBe(0);
  });
});
