import { describe, expect, it } from 'vitest';
import { ostatnioDodaneNaGorze, zapiszPrzeniesienie } from './planRecent';

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
