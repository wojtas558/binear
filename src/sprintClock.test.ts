import { describe, expect, it } from 'vitest';
import {
  capacityLevel,
  OVER_RATIO,
  sprintCapacity,
  sprintDeadline,
  workHoursBetween,
  type CapacityTask,
} from './sprintClock';

/*
 * Daty budujemy z lokalnych składników (`new Date(rok, miesiąc, ...)`), nie z
 * napisów ISO — dzięki temu testy przechodzą w każdej strefie czasowej.
 * 2026-09-30 to środa, 2026-10-05 to poniedziałek.
 */
const at = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min);

describe('workHoursBetween', () => {
  it('środa 8:00 → poniedziałek 9:00: środa, czwartek, piątek po 8 h i godzina w poniedziałek', () => {
    expect(workHoursBetween(at(9, 30, 8), at(10, 5, 9))).toBe(3 * 8 + 1);
  });

  it('środa po południu liczy tylko resztę dnia', () => {
    expect(workHoursBetween(at(9, 30, 14), at(10, 5, 9))).toBe(2 + 2 * 8 + 1);
  });

  it('po godzinach i przed otwarciem nie dolicza nic z tego dnia', () => {
    expect(workHoursBetween(at(9, 30, 18), at(10, 1, 8))).toBe(0);
    expect(workHoursBetween(at(9, 30, 6), at(9, 30, 9))).toBe(1);
  });

  it('weekend nie liczy się w ogóle', () => {
    expect(workHoursBetween(at(10, 3, 8), at(10, 5, 8))).toBe(0);
  });

  it('ułamek godziny, gdy „teraz" wypada w jej środku', () => {
    expect(workHoursBetween(at(10, 2, 15, 30), at(10, 5, 9))).toBe(0.5 + 1);
  });

  it('koniec przed początkiem daje zero', () => {
    expect(workHoursBetween(at(10, 5, 12), at(10, 5, 9))).toBe(0);
  });
});

describe('sprintDeadline', () => {
  it('północ poniedziałku → poniedziałek 9:00', () => {
    expect(sprintDeadline(at(10, 5, 0).toISOString())).toEqual(at(10, 5, 9));
  });

  it('północ przesunięta o godzinę wstecz (23:00 dzień wcześniej) też wskazuje poniedziałek', () => {
    expect(sprintDeadline(at(10, 4, 23).toISOString())).toEqual(at(10, 5, 9));
  });

  it('północ przesunięta o godzinę w przód (1:00) też wskazuje poniedziałek', () => {
    expect(sprintDeadline(at(10, 5, 1).toISOString())).toEqual(at(10, 5, 9));
  });

  it('brak albo zła data → null', () => {
    expect(sprintDeadline(null)).toBeNull();
    expect(sprintDeadline('to nie data')).toBeNull();
  });
});

describe('capacityLevel', () => {
  it('mieści się albo równo → ok', () => {
    expect(capacityLevel(0, 0)).toBe('ok');
    expect(capacityLevel(40, 40)).toBe('ok');
    expect(capacityLevel(10, 40)).toBe('ok');
  });

  it('trochę ponad pojemność → warn', () => {
    expect(capacityLevel(41, 40)).toBe('warn');
    expect(capacityLevel(59, 40)).toBe('warn');
  });

  it('od progu w górę → over', () => {
    expect(capacityLevel(40 * OVER_RATIO, 40)).toBe('over');
    expect(capacityLevel(100, 40)).toBe('over');
  });

  it('brak pojemności przy czymkolwiek do zrobienia → over', () => {
    expect(capacityLevel(1, 0)).toBe('over');
  });
});

describe('sprintCapacity', () => {
  const waiting = new Set([10]);
  const zadanie = (o: Partial<CapacityTask>): CapacityTask => ({
    storyPoints: 8,
    stageId: 10,
    sprintId: 69,
    responsibleId: 1,
    ...o,
  });
  const base = {
    now: at(9, 30, 8),
    dateEnd: at(10, 5, 0).toISOString(),
    devs: 4,
    sprintId: 69,
    waitingStageIds: waiting,
    excludedIds: [] as number[],
  };

  it('pojemność to godziny razy programiści', () => {
    const r = sprintCapacity({ ...base, tasks: [] });
    expect(r?.hoursLeft).toBe(25);
    expect(r?.capacity).toBe(100);
    expect(r?.demand).toBe(0);
    expect(r?.level).toBe('ok');
  });

  it('moce z grafiku zastępują godziny × programiści, a „ile osób” to etaty efektywne', () => {
    const r = sprintCapacity({ ...base, tasks: [], teamCapacity: 50 });
    expect(r?.capacity).toBe(50);
    expect(r?.devs).toBe(2); // 50 h przy 25 h do końca
  });

  it('liczy tylko zadania czekające, z tego sprintu i z oszacowaniem', () => {
    const r = sprintCapacity({
      ...base,
      tasks: [
        zadanie({ storyPoints: 8 }),
        zadanie({ storyPoints: 12 }),
        zadanie({ storyPoints: 40, stageId: 11 }), // w toku — nie wiemy, ile zostało
        zadanie({ storyPoints: 40, sprintId: 70 }), // inny sprint
        zadanie({ storyPoints: 40, sprintId: null }), // poza sprintem
        zadanie({ storyPoints: null }), // bez oszacowania
      ],
    });
    expect(r?.demand).toBe(20);
  });

  it('zadania wskazanych osób odejmuje od tego, co czeka, i pokazuje osobno', () => {
    const r = sprintCapacity({
      ...base,
      excludedIds: [7],
      tasks: [
        zadanie({ storyPoints: 40, responsibleId: 7 }),
        zadanie({ storyPoints: 16, responsibleId: 1 }),
        zadanie({ storyPoints: 4, responsibleId: null }),
      ],
    });
    expect(r?.demand).toBe(20);
    expect(r?.excluded).toBe(40);
  });

  it('bez odjęcia to samo zestawienie byłoby czerwone, z odjęciem jest zielone', () => {
    const tasks = [zadanie({ storyPoints: 40, responsibleId: 7 }), zadanie({ storyPoints: 90, responsibleId: 1 })];
    expect(sprintCapacity({ ...base, tasks })?.level).toBe('warn');
    expect(sprintCapacity({ ...base, excludedIds: [7], tasks })?.level).toBe('ok');
  });

  it('kolor idzie za progami: do pojemności, lekko ponad, grubo ponad', () => {
    const z = (sp: number) => [zadanie({ storyPoints: sp })];
    expect(sprintCapacity({ ...base, tasks: z(100) })?.level).toBe('ok');
    expect(sprintCapacity({ ...base, tasks: z(120) })?.level).toBe('warn');
    expect(sprintCapacity({ ...base, tasks: z(150) })?.level).toBe('over');
  });

  it('bez daty końca albo sprintu nie ma czego liczyć', () => {
    expect(sprintCapacity({ ...base, dateEnd: null, tasks: [] })).toBeNull();
    expect(sprintCapacity({ ...base, sprintId: null, tasks: [] })).toBeNull();
  });
});
