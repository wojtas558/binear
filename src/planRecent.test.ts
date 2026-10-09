import { describe, expect, it } from 'vitest';
import { NA_GORZE, ostatnioDodaneNaGorze, tylkoOstatnie, zapiszPrzeniesienie } from './planRecent';

const t = (id: number) => ({ id });

describe('ostatnio dodane na gorze', () => {
  it('bez zadnego przeniesienia zwraca ta sama liste', () => {
    const l = [t(1), t(2)];
    expect(ostatnioDodaneNaGorze(l, {})).toBe(l);
  });

  it('nowo dodane ida nad stare, reszta zachowuje kolejnosc', () => {
    let st = zapiszPrzeniesienie({}, [10], true, 1);
    st = zapiszPrzeniesienie(st.dodane, [20], true, st.nastepny);
    const wynik = ostatnioDodaneNaGorze([t(1), t(10), t(2), t(20)], st.dodane);
    expect(wynik.map((x) => x.id)).toEqual([20, 10, 1, 2]);
  });

  it('paczka: pierwszy z przeciagnietych jest na samej gorze', () => {
    const st = zapiszPrzeniesienie({}, [5, 6, 7], true, 1);
    expect(ostatnioDodaneNaGorze([t(7), t(6), t(5)], st.dodane).map((x) => x.id)).toEqual([5, 6, 7]);
  });

  it('cofniecie do rejestru kasuje znacznik', () => {
    const st = zapiszPrzeniesienie({}, [5], true, 1);
    const cofniete = zapiszPrzeniesienie(st.dodane, [5], false, st.nastepny);
    expect(cofniete.dodane[5]).toBeUndefined();
  });
});

describe('tylko ostatnie', () => {
  it('na gorze zostaje NA_GORZE najnowszych, starsze wracaja do zwyklego sortowania', () => {
    let st = zapiszPrzeniesienie({}, [1], true, 1);
    for (const id of [2, 3, 4, 5, 6, 7]) st = zapiszPrzeniesienie(st.dodane, [id], true, st.nastepny);
    const zostaje = tylkoOstatnie(st.dodane);
    expect(Object.keys(zostaje).map(Number).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);
    expect(Object.keys(zostaje)).toHaveLength(NA_GORZE);
  });

  it('gdy znacznikow jest malo, nic nie obcina', () => {
    const st = zapiszPrzeniesienie({}, [1, 2], true, 1);
    expect(tylkoOstatnie(st.dodane)).toBe(st.dodane);
  });
});
