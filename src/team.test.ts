import { describe, expect, it } from 'vitest';
import {
  addMember,
  EMPTY_TEAM,
  fmtFte,
  fteOnDay,
  isoDate,
  isPresent,
  mondayOf,
  removeMember,
  setFte,
  teamHoursBetween,
  teamWeekHours,
  togglePresence,
  weekDays,
  type TeamConfig,
} from './team';

// 5.10.2026 to poniedzialek.
const PN = new Date(2026, 9, 5);
const at = (day: number, h = 8, m = 0) => new Date(2026, 9, day, h, m);

const team = (): TeamConfig => {
  let t = addMember(EMPTY_TEAM, { id: 1, name: 'A' }, 1);
  t = addMember(t, { id: 2, name: 'B' }, 1);
  t = addMember(t, { id: 3, name: 'C' }, 0.5);
  return t;
};

describe('daty tygodnia', () => {
  it('poniedzialek tygodnia z dowolnego dnia, takze z niedzieli', () => {
    expect(isoDate(mondayOf(new Date(2026, 9, 8)))).toBe('2026-10-05');
    expect(isoDate(mondayOf(new Date(2026, 9, 11)))).toBe('2026-10-05'); // niedziela
    expect(isoDate(mondayOf(PN))).toBe('2026-10-05');
  });

  it('pieciu dni roboczych od poniedzialku', () => {
    expect(weekDays(PN).map(isoDate)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  });
});

describe('obecnosc', () => {
  it('domyslnie wszyscy sa w pracy w dni robocze, nikt w weekend', () => {
    const t = team();
    expect(isPresent(t, 1, PN)).toBe(true);
    expect(isPresent(t, 1, new Date(2026, 9, 10))).toBe(false); // sobota
  });

  it('klik przelacza nieobecnosc i przywraca obecnosc; zapisuje tylko wyjatki', () => {
    let t = togglePresence(team(), 2, new Date(2026, 9, 7));
    expect(isPresent(t, 2, new Date(2026, 9, 7))).toBe(false);
    expect(t.off['2']).toEqual(['2026-10-07']);
    t = togglePresence(t, 2, new Date(2026, 9, 7));
    expect(isPresent(t, 2, new Date(2026, 9, 7))).toBe(true);
    expect(t.off).toEqual({});
  });

  it('etaty danego dnia sumuja wymiary obecnych', () => {
    const t = togglePresence(team(), 1, PN);
    expect(fteOnDay(t, PN)).toBe(1.5); // B (1) + C (0,5)
    expect(fteOnDay(team(), PN)).toBe(2.5);
  });
});

describe('moce', () => {
  it('pelny tydzien: etaty × 8 h × 5 dni', () => {
    expect(teamWeekHours(team(), PN)).toBe(2.5 * 8 * 5);
  });

  it('nieobecnosc jednej osoby obniza moce tygodnia o jej dzien', () => {
    const t = togglePresence(team(), 1, new Date(2026, 9, 6)); // A nieobecny we wtorek
    expect(teamWeekHours(t, PN)).toBe(2.5 * 40 - 8);
  });

  it('zmiana etatu zmienia moce proporcjonalnie', () => {
    const t = setFte(team(), 3, 1);
    expect(teamWeekHours(t, PN)).toBe(3 * 40);
  });

  it('przedzial od–do liczy tylko godziny robocze w nim zawarte', () => {
    const t = team(); // 2,5 etatu
    // pn 12:00 -> pn 16:00 = 4 h × 2,5
    expect(teamHoursBetween(t, at(5, 12), at(5, 16))).toBe(10);
    // caly pn + wt = 16 h × 2,5
    expect(teamHoursBetween(t, at(5, 6), at(6, 20))).toBe(40);
    // weekend nie dodaje nic
    expect(teamHoursBetween(t, new Date(2026, 9, 10, 8), new Date(2026, 9, 11, 20))).toBe(0);
  });

  it('pusty zespol albo odwrocony przedzial to zero', () => {
    expect(teamHoursBetween(EMPTY_TEAM, at(5), at(9))).toBe(0);
    expect(teamHoursBetween(team(), at(9), at(5))).toBe(0);
  });

  it('nieobecnosc obniza moce takze w przedziale', () => {
    const t = togglePresence(team(), 3, PN); // C (0,5) nieobecna w pn
    expect(teamHoursBetween(t, at(5, 8), at(5, 16))).toBe(16); // 2 etaty × 8 h
  });
});

describe('edycja zespolu', () => {
  it('dodanie tej samej osoby drugi raz niczego nie zmienia', () => {
    const t = team();
    expect(addMember(t, { id: 1, name: 'A' })).toBe(t);
  });

  it('usuniecie osoby kasuje tez jej nieobecnosci', () => {
    const t = removeMember(togglePresence(team(), 2, PN), 2);
    expect(t.members.map((m) => m.id)).toEqual([1, 3]);
    expect(t.off).toEqual({});
  });

  it('etaty w napisie z przecinkiem', () => {
    expect(fmtFte(3.5)).toBe('3,5');
    expect(fmtFte(4)).toBe('4');
    expect(fmtFte(0.75)).toBe('0,75');
  });
});
