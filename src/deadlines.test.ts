import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  compareDeadlines,
  deadlineBar,
  deadlineLevel,
  deadlineVerdict,
  isHardDeadline,
  sprintsNeeded,
} from './deadlines';

/* Daty z lokalnych składników, żeby testy przechodziły w każdej strefie. 2026-10-22 to czwartek. */
const at = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h);
const iso = (m: number, d: number) => at(m, d).toISOString();

/* Poniedziałkowa rada 26.10, następna 2.11. */
const NOW = at(10, 26, 11);
const NEXT_COUNCIL = at(11, 2, 9);

describe('deadlineBar', () => {
  it('30 dni i więcej to pełny pasek', () => {
    expect(deadlineBar(30).fill).toBe(1);
    expect(deadlineBar(90).fill).toBe(1);
  });

  it('pasek kurczy się liniowo do zera w dniu terminu', () => {
    expect(deadlineBar(15).fill).toBeCloseTo(0.5);
    expect(deadlineBar(0)).toMatchObject({ fill: 0, overdue: false });
  });

  it('po terminie pasek jest pusty i oznaczony', () => {
    expect(deadlineBar(-3)).toMatchObject({ fill: 0, overdue: true });
  });
});

describe('deadlineLevel', () => {
  const t = (deadline: string, storyPoints: number | null) => ({ deadline, storyPoints, tags: [] as string[] });
  const lv = (deadline: string, sp: number | null) => deadlineLevel(t(deadline, sp), NEXT_COUNCIL, NOW);

  it('ten sam termin, różna wycena: 4 h może poczekać, 8 h musi wejść w obecnym sprincie', () => {
    expect(lv(iso(11, 2), 8)).toBe('red');
    expect(lv(iso(11, 2), 4)).toBe('yellow');
  });

  it('zadanie, które zmieści się jeszcze po kolejnej radzie, jest zielone', () => {
    expect(lv(iso(11, 20), 8)).toBe('green');
  });

  it('żółte: zdąży po następnej radzie, ale nie po kolejnej', () => {
    expect(lv(iso(11, 9), 40)).toBe('yellow');
  });

  it('po terminie jest czerwone', () => {
    expect(lv(iso(10, 20), 4)).toBe('red');
  });

  it('bez sprintu liczymy po dniach: do 7 czerwony, do 14 żółty', () => {
    expect(deadlineLevel(t(iso(10, 30), 8), null, NOW)).toBe('red');
    expect(deadlineLevel(t(iso(11, 5), 8), null, NOW)).toBe('yellow');
    expect(deadlineLevel(t(iso(12, 5), 8), null, NOW)).toBe('green');
  });
});

describe('sprintsNeeded', () => {
  it('do 40 h i brak wyceny to jeden sprint', () => {
    expect(sprintsNeeded(null)).toBe(1);
    expect(sprintsNeeded(40)).toBe(1);
  });

  it('ponad 40 h potrzebuje kolejnych sprintów', () => {
    expect(sprintsNeeded(41)).toBe(2);
    expect(sprintsNeeded(80)).toBe(2);
    expect(sprintsNeeded(81)).toBe(3);
  });
});

describe('deadlineVerdict', () => {
  const task = (deadline: string | null, storyPoints: number | null = 8, tags: string[] = []) => ({
    deadline,
    storyPoints,
    tags,
  });
  const v = (deadline: string | null, sp: number | null = 8, tags: string[] = []) =>
    deadlineVerdict(task(deadline, sp, tags), NEXT_COUNCIL, NOW);

  it('zadanie bez terminu nie ma werdyktu', () => {
    expect(v(null)).toBeNull();
  });

  it('termin przed następną radą: musi wejść teraz', () => {
    expect(v(iso(10, 30))?.mustEnter).toBe(true);
  });

  it('4 h z terminem w poniedziałek następnej rady: zmieści się po 10:00, może poczekać', () => {
    expect(v(iso(11, 2), 4)?.mustEnter).toBe(false);
    expect(v(iso(11, 2), 4)?.hoursLeft).toBe(6);
  });

  it('8 h z tym samym terminem: po następnej radzie się nie uda, musi wejść teraz', () => {
    expect(v(iso(11, 2), 8)?.mustEnter).toBe(true);
  });

  it('24 h (3 dni) z terminem w środę po radzie: tylko 22 h do końca środy, musi wejść teraz', () => {
    const w = v(iso(11, 4), 24);
    expect(w?.hoursLeft).toBe(22);
    expect(w?.mustEnter).toBe(true);
  });

  it('16 h z terminem w środę po radzie: mieści się, może poczekać', () => {
    expect(v(iso(11, 4), 16)?.mustEnter).toBe(false);
  });

  it('zadanie po terminie wpada zawsze', () => {
    const w = v(iso(10, 20));
    expect(w?.mustEnter).toBe(true);
    expect(w?.days).toBe(-6);
  });

  it('zadanie ponad 40 h wchodzi wcześniej: do wyceny dochodzą 40 h na rozbicie', () => {
    const d = iso(11, 11);
    expect(v(d, 40)?.mustEnter).toBe(false);
    const dlugie = v(d, 48);
    expect(dlugie?.longTask).toBe(true);
    expect(dlugie?.mustEnter).toBe(true);
  });

  it('brak wyceny jest oznaczony i zostaje na liście z tygodniem zapasu', () => {
    expect(v(iso(11, 5), null)?.bezWyceny).toBe(true);
    expect(v(iso(11, 5), null)?.mustEnter).toBe(true);
    expect(v(iso(11, 20), null)?.mustEnter).toBe(false);
  });

  it('tag TERMIN-TWARDY potwierdza termin, wielkość liter nie gra roli', () => {
    expect(isHardDeadline(['termin-twardy'])).toBe(true);
    expect(isHardDeadline(['DO-STARTU'])).toBe(false);
    expect(v(iso(10, 30), 8, ['TERMIN-TWARDY'])?.hard).toBe(true);
  });
});

describe('compareDeadlines', () => {
  it('najbliższy termin pierwszy, a przy remisie twardy przed niepotwierdzonym', () => {
    const v = (days: number, hard: boolean) => ({ days, hard, mustEnter: true, longTask: false, bezWyceny: false, hoursLeft: 0 });
    const list = [v(5, false), v(2, false), v(2, true)].sort(compareDeadlines);
    expect(list.map((x) => [x.days, x.hard])).toEqual([
      [2, true],
      [2, false],
      [5, false],
    ]);
  });
});

describe('calendarDays', () => {
  it('liczy dni kalendarzowe, nie 24-godzinne odcinki', () => {
    expect(calendarDays(at(10, 22, 23), at(10, 23, 1))).toBe(1);
  });
});
