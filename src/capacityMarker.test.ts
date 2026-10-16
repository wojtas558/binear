import { describe, expect, it } from 'vitest';

import { capacityState, weekWindow } from './capacityMarker';

const seg = [
  { type: 'NEW', sp: 20 },
  { type: 'WORK', sp: 15 },
  { type: 'FINISH', sp: 10 },
];

describe('capacityState', () => {
  it('moc starcza na cala nie-wdrozona prace', () => {
    expect(capacityState(seg, 35)).toBe('ok');
    expect(capacityState(seg, 40)).toBe('ok');
  });
  it('kreska w etapie pracy = ostrzezenie', () => {
    expect(capacityState(seg, 30)).toBe('warn');
    expect(capacityState(seg, 20)).toBe('warn');
  });
  it('kreska w etapie Nowe = nie zdazy', () => {
    expect(capacityState(seg, 19)).toBe('late');
    expect(capacityState(seg, 0)).toBe('late');
  });
  it('brak pracy do zrobienia to zawsze ok', () => {
    expect(capacityState([{ type: 'FINISH', sp: 5 }], 0)).toBe('ok');
  });
});

describe('weekWindow', () => {
  const start = new Date(2026, 9, 12, 10, 30); // poniedzialek
  it('przed startem liczy od poniedzialku 8:00, do piatku 16:00', () => {
    const w = weekWindow(start, new Date(2026, 9, 12, 7));
    expect(w.from).toEqual(new Date(2026, 9, 12, 8));
    expect(w.to).toEqual(new Date(2026, 9, 16, 16));
  });
  it('w trakcie tygodnia liczy od teraz', () => {
    const now = new Date(2026, 9, 14, 12);
    expect(weekWindow(start, now).from).toEqual(now);
  });
  it('start w srodku tygodnia nadal bierze poniedzialek tego tygodnia', () => {
    expect(weekWindow(new Date(2026, 9, 14), new Date(2026, 9, 12, 7)).to).toEqual(new Date(2026, 9, 16, 16));
  });
});
