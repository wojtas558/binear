import { describe, expect, it } from 'vitest';
import { carryOverCount } from './carryOver';

const sprint = (dateEnd: string, status = 'completed') => ({ status, dateEnd });
const etap = (createdDate: string, nazwa = 'W toku') => ({ createdDate, field: 'STAGE', from: nazwa, to: nazwa });
const wejscie = (createdDate: string) => ({ createdDate, field: 'MOVE_TO_SPRINT', from: '', to: '' });

const S1 = '2026-10-19T10:00:00+02:00';
const S2 = '2026-10-26T10:00:00+01:00';

describe('carryOverCount', () => {
  it('zmiana etapu na kolumne o tej samej nazwie tuz po zamknieciu sprintu = przeniesienie', () => {
    expect(carryOverCount([etap('2026-10-19T10:05:00+02:00')], [sprint(S1)])).toBe(1);
  });

  it('liczy kazde zamkniecie osobno', () => {
    const h = [etap('2026-10-19T10:05:00+02:00', 'Nowe'), etap('2026-10-26T10:02:00+01:00')];
    expect(carryOverCount(h, [sprint(S1), sprint(S2)])).toBe(2);
  });

  it('poza oknem 30 minut albo przed zamknieciem — nie przeniesienie', () => {
    expect(carryOverCount([etap('2026-10-19T10:45:00+02:00')], [sprint(S1)])).toBe(0);
    expect(carryOverCount([etap('2026-10-19T09:55:00+02:00')], [sprint(S1)])).toBe(0);
  });

  it('wejscie z backlogu (MOVE_TO_SPRINT obok) nie jest przeniesieniem', () => {
    const h = [etap('2026-10-19T10:05:00+02:00'), wejscie('2026-10-19T10:05:02+02:00')];
    expect(carryOverCount(h, [sprint(S1)])).toBe(0);
  });

  it('zmiana na kolumne o innej nazwie i sprinty niezamkniete sie nie licza', () => {
    const inna = { createdDate: '2026-10-19T10:05:00+02:00', field: 'STAGE', from: 'Nowe', to: 'W toku' };
    expect(carryOverCount([inna], [sprint(S1)])).toBe(0);
    expect(carryOverCount([etap('2026-10-19T10:05:00+02:00')], [sprint(S1, 'active')])).toBe(0);
  });

  it('kilka zmian etapu po jednym zamknieciu liczy sie raz', () => {
    const h = [etap('2026-10-19T10:05:00+02:00'), etap('2026-10-19T10:06:00+02:00', 'Nowe')];
    expect(carryOverCount(h, [sprint(S1)])).toBe(1);
  });
});
