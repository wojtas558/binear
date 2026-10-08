/*
 * Podsumowanie biezacego sprintu: ile pracy jest wdrozone, ile czeka na wdrozenie, ile w toku, ile
 * czeka — razem i w podziale na dzialy (epiki) oraz tematy. Te same liczby, ktore idzie omawiac na
 * Radzie Priorytetow, ale z zywych danych, wiec dziala przed zamknieciem sprintu.
 *
 * Sama arytmetyka, bez sieci i bez Reacta (patrz sprintTotals.test.ts).
 *
 * Zasady:
 *  - liczymy LISCIE: zadanie nadrzedne z podzadaniami w sprincie jest folderem (punkty siedza na
 *    dzieciach), wiec samo nie wchodzi do sum — inaczej liczylibysmy je dwa razy,
 *  - dzial i temat bierzemy z KORZENIA: dziecko moze nie miec epika, a temat to zadanie nadrzedne,
 *  - stan ze statusu Bitriksa i etapu: 5 wdrozone, 4 czeka na wdrozenie (PR), 6 wstrzymane,
 *    3 albo etap „W toku" — w toku, reszta czeka.
 */

export type SummaryState = 'wdrozone' | 'pr' | 'wtoku' | 'czeka' | 'wstrzymane';

export const SUMMARY_STATES: SummaryState[] = ['wdrozone', 'pr', 'wtoku', 'czeka', 'wstrzymane'];

export const STATE_LABELS: Record<SummaryState, string> = {
  wdrozone: 'Wdrożone',
  pr: 'Czeka na wdrożenie',
  wtoku: 'W toku',
  czeka: 'Czeka',
  wstrzymane: 'Wstrzymane',
};

export type StateSums = Record<SummaryState, number>;

export interface Totals {
  /** Suma SP wszystkich stanow. */
  points: number;
  /** Liczba zadan (lisci). */
  count: number;
  /** SP w kazdym stanie. */
  by: StateSums;
  /** Liczba zadan w kazdym stanie. */
  counts: StateSums;
  /** Zadania bez SP — liczone w `count`, ale bez wkladu do `points`. */
  unestimated: number;
}

export interface Topic {
  rootId: number;
  title: string;
  totals: Totals;
}

export interface Dept {
  epicId: number | null;
  name: string;
  totals: Totals;
  topics: Topic[];
}

export interface SprintSummaryData {
  totals: Totals;
  depts: Dept[];
}

type SummaryTask = {
  id: number;
  parentId: number | null;
  title: string;
  status: string;
  sprintId: number | null;
  stageId: number | null;
  storyPoints: number | null;
  epicId: number | null;
};

const zero = (): StateSums => ({ wdrozone: 0, pr: 0, wtoku: 0, czeka: 0, wstrzymane: 0 });
export const emptyTotals = (): Totals => ({ points: 0, count: 0, by: zero(), counts: zero(), unestimated: 0 });

/** Stan zadania: status Bitriksa ma pierwszenstwo, potem etap „W toku". */
export function summaryState(t: Pick<SummaryTask, 'status' | 'stageId'>, workStageIds: ReadonlySet<number>): SummaryState {
  if (t.status === '5') return 'wdrozone';
  if (t.status === '4') return 'pr';
  if (t.status === '6') return 'wstrzymane';
  if (t.status === '3' || (t.stageId !== null && workStageIds.has(t.stageId))) return 'wtoku';
  return 'czeka';
}

function add(totals: Totals, state: SummaryState, sp: number | null): void {
  const pts = sp != null && sp > 0 ? sp : 0;
  totals.count += 1;
  totals.counts[state] += 1;
  if (pts > 0) {
    totals.points += pts;
    totals.by[state] += pts;
  } else {
    totals.unestimated += 1;
  }
}

/** Korzen drzewa podzadan (zadanie nadrzedne najwyzszego poziomu); chroni przed cyklem. */
function rootOf(id: number, byId: Map<number, SummaryTask>): SummaryTask | undefined {
  let cur = byId.get(id);
  const seen = new Set<number>();
  while (cur && cur.parentId !== null && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return cur;
}

export function summarizeSprint(
  tasks: readonly SummaryTask[],
  sprintId: number,
  workStageIds: ReadonlySet<number>,
  epicName: (epicId: number | null) => string,
): SprintSummaryData {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const inSprint = tasks.filter((t) => t.sprintId === sprintId);
  const hasChild = new Set<number>();
  for (const t of inSprint) if (t.parentId !== null) hasChild.add(t.parentId);

  const totals = emptyTotals();
  const depts = new Map<string, Dept>();

  for (const t of inSprint) {
    if (hasChild.has(t.id)) continue; // folder: punkty maja dzieci
    const state = summaryState(t, workStageIds);
    const root = rootOf(t.id, byId) ?? t;
    const epicId = root.epicId ?? t.epicId;
    const key = String(epicId ?? 0);

    let dept = depts.get(key);
    if (!dept) {
      dept = { epicId, name: epicName(epicId), totals: emptyTotals(), topics: [] };
      depts.set(key, dept);
    }
    let topic = dept.topics.find((x) => x.rootId === root.id);
    if (!topic) {
      topic = { rootId: root.id, title: root.title, totals: emptyTotals() };
      dept.topics.push(topic);
    }
    add(totals, state, t.storyPoints);
    add(dept.totals, state, t.storyPoints);
    add(topic.totals, state, t.storyPoints);
  }

  const list = [...depts.values()];
  for (const d of list) d.topics.sort((a, b) => b.totals.points - a.totals.points || a.title.localeCompare(b.title, 'pl'));
  list.sort((a, b) => b.totals.points - a.totals.points || a.name.localeCompare(b.name, 'pl'));
  return { totals, depts: list };
}

/** Udzial stanu w sumie (0–1) — do szerokosci kawalka paska. */
export const share = (totals: Totals, state: SummaryState): number =>
  totals.points > 0 ? totals.by[state] / totals.points : 0;

/**
 * Wydajnosc zespolu: ile punktow dowiozl na godzine mocy. `pct` to dowiezione SP przez moce (1 SP = 1 h
 * mocy, wiec 100% = dokladnie tyle, ile pozwalaly moce), `hPerSp` to odwrotnosc — ile godzin mocy
 * poszlo na jeden punkt. `null`, gdy nie ma mocy albo nic nie dowiezlismy (odwrotnosc by nie istniala).
 */
export function efficiency(
  delivered: number,
  capacity: number | null,
): { pct: number; hPerSp: number | null } | null {
  if (capacity === null || capacity <= 0) return null;
  return { pct: (delivered / capacity) * 100, hPerSp: delivered > 0 ? capacity / delivered : null };
}
