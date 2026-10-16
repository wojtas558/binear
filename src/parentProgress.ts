/**
 * Postep zadania nadrzednego liczony z jego podzadan.
 *
 * Rodzic niesie 0 SP, a punkty siedza na dzieciach (zasada wyceny), wiec sam rodzic nic nie mowi o
 * wielkosci pracy. Tu skladamy z dzieci: sume SP i pasek, w ktorym kazde podzadanie zajmuje
 * kawalek proporcjonalny do swoich SP i ma jeden z trzech stanow.
 */

export type ChildState = 'done' | 'doing' | 'waiting';

export interface ChildSlice {
  id: number;
  sp: number;
  state: ChildState;
}

export interface ParentProgress {
  /** Ile podzadan ma rodzic (takze bez SP). */
  count: number;
  /** Suma SP wszystkich podzadan. */
  points: number;
  done: number;
  doing: number;
  waiting: number;
  /** Podzadania z SP > 0 — tylko te maja kawalek paska. */
  slices: ChildSlice[];
  /** Podzadania bez SP — nie wchodza do paska ani do sumy. */
  unestimated: number;
}

type ChildTask = { id: number; parentId: number | null; status: string; storyPoints: number | null };

/**
 * Stan podzadania ze statusu Bitriksa: 4 (czeka na kontrole) i 5 (zakonczone) to praca ZROBIONA
 * — oddana do akceptacji nie zabiera juz niczyjego czasu; 3 to w toku; reszta (nowe, oczekujace,
 * odlozone) czeka. Status, nie etap: dziala tez poza sprintem, gdzie kolumn nie ma.
 */
export function childState(status: string): ChildState {
  if (status === '4' || status === '5') return 'done';
  if (status === '3') return 'doing';
  return 'waiting';
}

/** Podzadania pogrupowane po rodzicu — jedno przejscie po liscie, a nie `filter` na kazdy wiersz. */
export function groupChildren<T extends ChildTask>(tasks: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = out.get(t.parentId);
    if (list) list.push(t);
    else out.set(t.parentId, [t]);
  }
  return out;
}

/** `null`, gdy zadanie nie ma podzadan. */
export function parentProgress(children: ChildTask[] | undefined): ParentProgress | null {
  if (!children || children.length === 0) return null;
  const p: ParentProgress = {
    count: children.length,
    points: 0,
    done: 0,
    doing: 0,
    waiting: 0,
    slices: [],
    unestimated: 0,
  };
  for (const c of children) {
    const sp = c.storyPoints ?? 0;
    if (sp <= 0) {
      p.unestimated++;
      continue;
    }
    const state = childState(c.status);
    p.points += sp;
    p[state] += sp;
    p.slices.push({ id: c.id, sp, state });
  }
  return p;
}
