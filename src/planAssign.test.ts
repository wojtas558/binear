import { describe, expect, it } from 'vitest';
import { isIt, ownerOnEnteringSprint, type ItContext } from './planAssign';

/* Wymyslone numery: 1 = konto binear, 2 = zaslepka IT, 3 = kierownik IT, 10 = dzial IT, 20 = dzial handlowy. */
const ctx = (o: Partial<ItContext> = {}): ItContext => ({
  me: 1,
  itUsers: [],
  itDepartments: [10],
  kierownicy: [3],
  unassignedId: 2,
  departmentsOf: new Map<number, number[]>([
    [4, [10]], // programista z IT
    [5, [20]], // handlowiec
    [6, [10, 20]], // w dwoch dzialach, jeden to IT
    [7, []], // bez dzialu
  ]),
  ...o,
});
const zadanie = (responsibleId: number | null) => ({ responsibleId });

describe('isIt', () => {
  it('konto binear, zaslepka, konta z listy IT i kierownik to IT', () => {
    expect(isIt(1, ctx())).toBe(true);
    expect(isIt(2, ctx())).toBe(true);
    expect(isIt(3, ctx())).toBe(true);
    expect(isIt(99, ctx({ itUsers: [99] }))).toBe(true);
  });

  it('osoba z dzialu IT to IT, nawet jesli ma tez inny dzial', () => {
    expect(isIt(4, ctx())).toBe(true);
    expect(isIt(6, ctx())).toBe(true);
  });

  it('osoba z innego dzialu albo bez dzialu to nie IT', () => {
    expect(isIt(5, ctx())).toBe(false);
    expect(isIt(7, ctx())).toBe(false);
  });

  it('osoba spoza spisu to „nie wiemy", a nie „nie IT"', () => {
    expect(isIt(50, ctx())).toBeNull();
  });
});

describe('ownerOnEnteringSprint', () => {
  it('zadanie spoza IT wchodzace z rejestru do sprintu przechodzi na zaslepke IT', () => {
    expect(ownerOnEnteringSprint(zadanie(5), null, 70, ctx())).toBe(2);
    expect(ownerOnEnteringSprint(zadanie(7), null, 70, ctx())).toBe(2);
  });

  it('jesli odpowiedzialny jest z IT, zostaje', () => {
    expect(ownerOnEnteringSprint(zadanie(4), null, 70, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(6), null, 70, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(3), null, 70, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(1), null, 70, ctx())).toBeNull();
  });

  it('zadanie juz na zaslepce albo bez osoby zostaje', () => {
    expect(ownerOnEnteringSprint(zadanie(2), null, 70, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(null), null, 70, ctx())).toBeNull();
  });

  it('gdy o osobie nic nie wiemy, nie ruszamy zadania', () => {
    expect(ownerOnEnteringSprint(zadanie(50), null, 70, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(5), null, 70, ctx({ departmentsOf: new Map() }))).toBeNull();
  });

  it('tylko rejestr → sprint: przeniesienie miedzy sprintami i powrot do rejestru niczego nie zmieniaja', () => {
    expect(ownerOnEnteringSprint(zadanie(5), 69, 70, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(5), 70, null, ctx())).toBeNull();
    expect(ownerOnEnteringSprint(zadanie(5), null, null, ctx())).toBeNull();
  });
});
