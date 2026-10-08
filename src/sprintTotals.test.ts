import { describe, expect, it } from 'vitest';
import { efficiency, share, summarizeSprint, summaryState } from './sprintTotals';

const WORK = new Set([4779]);
const nazwa = (id: number | null) => (id === 1 ? 'Magazyn' : id === 2 ? 'Handlowy' : 'Bez epika');

const t = (id: number, o: Partial<Parameters<typeof summarizeSprint>[0][number]> = {}) => ({
  id,
  parentId: null as number | null,
  title: `Zadanie ${id}`,
  status: '2',
  sprintId: 70,
  stageId: 4777 as number | null,
  storyPoints: 4 as number | null,
  epicId: 1 as number | null,
  ...o,
});

describe('summaryState', () => {
  it('status ma pierwszenstwo: 5 wdrozone, 4 PR, 6 wstrzymane', () => {
    expect(summaryState({ status: '5', stageId: 4779 }, WORK)).toBe('wdrozone');
    expect(summaryState({ status: '4', stageId: 4779 }, WORK)).toBe('pr');
    expect(summaryState({ status: '6', stageId: 4779 }, WORK)).toBe('wstrzymane');
  });

  it('w toku: status 3 albo etap „W toku"; reszta czeka', () => {
    expect(summaryState({ status: '3', stageId: 4777 }, WORK)).toBe('wtoku');
    expect(summaryState({ status: '2', stageId: 4779 }, WORK)).toBe('wtoku');
    expect(summaryState({ status: '2', stageId: 4777 }, WORK)).toBe('czeka');
    expect(summaryState({ status: '2', stageId: null }, WORK)).toBe('czeka');
  });
});

describe('efficiency', () => {
  it('wydajnosc to dowiezione SP przez moce, a odwrotnosc to godziny mocy na punkt', () => {
    expect(efficiency(100, 140)).toEqual({ pct: (100 / 140) * 100, hPerSp: 1.4 });
    expect(efficiency(140, 140)?.pct).toBe(100);
  });

  it('ponad 100%, gdy dowiezlismy wiecej niz moce', () => {
    expect(efficiency(150, 100)?.pct).toBe(150);
  });

  it('bez dowiezionych SP odwrotnosc nie istnieje; bez mocy nie ma wyniku', () => {
    expect(efficiency(0, 100)).toEqual({ pct: 0, hPerSp: null });
    expect(efficiency(10, null)).toBeNull();
    expect(efficiency(10, 0)).toBeNull();
  });
});

describe('summarizeSprint', () => {
  it('sumuje SP i zadania w podziale na stany; liczy tylko ten sprint', () => {
    const d = summarizeSprint(
      [t(1, { status: '5', storyPoints: 8 }), t(2, { status: '4', storyPoints: 4 }), t(3, { status: '3' }), t(4), t(5, { sprintId: 69 })],
      70,
      WORK,
      nazwa,
    );
    expect(d.totals.points).toBe(20);
    expect(d.totals.count).toBe(4);
    expect(d.totals.by).toEqual({ wdrozone: 8, pr: 4, wtoku: 4, czeka: 4, wstrzymane: 0 });
    expect(share(d.totals, 'wdrozone')).toBeCloseTo(0.4);
  });

  it('rodzic z podzadaniami w sprincie jest folderem: liczą się dzieci, nie rodzic', () => {
    const d = summarizeSprint(
      [t(1, { storyPoints: 0, title: 'Temat' }), t(2, { parentId: 1, status: '5', storyPoints: 6, epicId: null }), t(3, { parentId: 1, storyPoints: 2, epicId: null })],
      70,
      WORK,
      nazwa,
    );
    expect(d.totals.count).toBe(2);
    expect(d.totals.points).toBe(8);
    // dziecko bez epika bierze dzial rodzica, a temat to rodzic
    expect(d.depts).toHaveLength(1);
    expect(d.depts[0].name).toBe('Magazyn');
    expect(d.depts[0].topics).toHaveLength(1);
    expect(d.depts[0].topics[0]).toMatchObject({ rootId: 1, title: 'Temat' });
    expect(d.depts[0].topics[0].totals.points).toBe(8);
  });

  it('dzialy posortowane po SP malejaco; zadanie bez epika ma wlasny dzial', () => {
    const d = summarizeSprint(
      [t(1, { epicId: 2, storyPoints: 3 }), t(2, { epicId: 1, storyPoints: 9 }), t(3, { epicId: null, storyPoints: 1 })],
      70,
      WORK,
      nazwa,
    );
    expect(d.depts.map((x) => x.name)).toEqual(['Magazyn', 'Handlowy', 'Bez epika']);
  });

  it('zadania bez SP sa policzone, ale nie dodaja punktow', () => {
    const d = summarizeSprint([t(1, { storyPoints: null }), t(2, { storyPoints: 0 }), t(3)], 70, WORK, nazwa);
    expect(d.totals).toMatchObject({ count: 3, points: 4, unestimated: 2 });
  });

  it('suma stanow dzialu zgadza sie z sumami tematow i calego sprintu', () => {
    const d = summarizeSprint(
      [t(1, { epicId: 1, status: '5' }), t(2, { epicId: 1 }), t(3, { epicId: 2, status: '3' })],
      70,
      WORK,
      nazwa,
    );
    const suma = d.depts.reduce((n, x) => n + x.totals.points, 0);
    expect(suma).toBe(d.totals.points);
    for (const dep of d.depts) expect(dep.topics.reduce((n, x) => n + x.totals.points, 0)).toBe(dep.totals.points);
  });

  it('sprint bez zadan daje pusty wynik', () => {
    const d = summarizeSprint([], 70, WORK, nazwa);
    expect(d.totals.points).toBe(0);
    expect(d.depts).toEqual([]);
    expect(share(d.totals, 'wdrozone')).toBe(0);
  });
});
