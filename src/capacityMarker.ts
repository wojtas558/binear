/**
 * Kreska pozostalej mocy na slupku osoby. Slupek idzie od lewej: Nowe, W toku (i inne etapy pracy), na koncu
 * Wdrozone. Kreska stoi w odleglosci rownej POZOSTALEJ mocy (h = SP) od lewej krawedzi:
 *  - za cala praca do zrobienia (nie-wdrozona) → zdazy (`ok`),
 *  - wewnatrz etapu pracy (zolty, „W toku") → moze nie zdazyc ukonczyc tego, co rozpoczete (`warn`),
 *  - wewnatrz etapu Nowe (niebieski) → nie zdazy nawet z tym, co jeszcze nie ruszylo (`late`).
 */
export type CapacityState = 'ok' | 'warn' | 'late';

export interface MarkerSegment {
  type: string;
  sp: number;
}

/** Stan kreski dla pozostalej mocy `remaining` wobec kolejnych etapow slupka (kolejnosc jak na slupku). */
export function capacityState(segments: readonly MarkerSegment[], remaining: number): CapacityState {
  let at = 0;
  const work = segments.filter((s) => s.type !== 'FINISH').reduce((n, s) => n + s.sp, 0);
  if (remaining >= work) return 'ok';
  for (const s of segments) {
    if (s.type === 'FINISH') break;
    at += s.sp;
    if (remaining < at) return s.type === 'NEW' ? 'late' : 'warn';
  }
  return 'ok';
}

/** Okno liczenia mocy: od poniedzialku 8:00 do piatku 16:00 tygodnia, w ktorym zaczal sie sprint. */
export function weekWindow(sprintStart: Date, now: Date, startHour = 8, endHour = 16): { from: Date; to: Date } {
  const back = (sprintStart.getDay() + 6) % 7;
  const monday = new Date(sprintStart.getFullYear(), sprintStart.getMonth(), sprintStart.getDate() - back);
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), startHour);
  const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4, endHour);
  return { from: now.getTime() > start.getTime() ? now : start, to: end };
}
