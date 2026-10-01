/*
 * Odliczanie do końca sprintu: ile godzin roboczych zostało i czy zespół zdąży
 * zrobić to, co jeszcze czeka na start.
 *
 * Sama arytmetyka, bez sieci i bez Reacta — da się ją sprawdzić na wymyślonych
 * danych (patrz sprintClock.test.ts).
 *
 * Zasady liczenia (ustalone z zespołem):
 *  - dzień roboczy to 8–16, od poniedziałku do piątku,
 *  - sprint kończy się w poniedziałek o 9:00, więc poniedziałkowa godzina 8–9
 *    dolicza się jako ostatnia,
 *  - pojemność = godziny × liczba programistów, bo jeden punkt to jedna godzina,
 *  - liczy się WYŁĄCZNIE to, co czeka (etap typu NEW): nie wiemy, na jakim etapie
 *    jest zadanie „w toku", więc nie zgadujemy, ile mu jeszcze zostało,
 *  - zadania wskazanych osób (kierownik) nie wchodzą do limitu — odejmujemy je
 *    od tego, co czeka, zanim porównamy z pojemnością.
 */

export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 16;
export const SPRINT_END_HOUR = 9;

/** Od tego stosunku „czeka / pojemność" mówimy, że się nie wyrobimy. */
export const OVER_RATIO = 1.5;

const HOUR_MS = 3_600_000;

/**
 * Chwila, w której sprint naprawdę się kończy.
 *
 * Bitrix trzyma `dateEnd` jako północ (czasem z przesunięciem strefy, więc lokalnie
 * wypada 23:00 dzień wcześniej albo 01:00 tego dnia). Bierzemy NAJBLIŻSZĄ północ
 * lokalną i dokładamy godzinę zakończenia — dzięki temu ani przesunięcie strefy,
 * ani zmiana czasu nie przesuwa końca o dzień.
 */
export function sprintDeadline(dateEnd: string | null): Date | null {
  if (!dateEnd) return null;
  const t = Date.parse(dateEnd);
  if (Number.isNaN(t)) return null;
  const nearest = new Date(t + 12 * HOUR_MS);
  return new Date(nearest.getFullYear(), nearest.getMonth(), nearest.getDate(), SPRINT_END_HOUR, 0, 0, 0);
}

/** Godziny robocze (pn–pt, 8–16) w przedziale od–do; ułamek, gdy „teraz" wypada w środku godziny. */
export function workHoursBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let ms = 0;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (day.getTime() <= to.getTime()) {
    const dow = day.getDay();
    if (dow >= 1 && dow <= 5) {
      const open = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_START_HOUR).getTime();
      const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_END_HOUR).getTime();
      const a = Math.max(open, from.getTime());
      const b = Math.min(close, to.getTime());
      if (b > a) ms += b - a;
    }
    day.setDate(day.getDate() + 1);
  }
  return ms / HOUR_MS;
}

export type CapacityLevel = 'ok' | 'warn' | 'over';

/** Zielono: mieścimy się. Pomarańczowo: trochę za dużo. Czerwono: od `OVER_RATIO` w górę. */
export function capacityLevel(demand: number, capacity: number): CapacityLevel {
  if (demand <= capacity) return 'ok';
  if (capacity <= 0) return 'over';
  return demand / capacity >= OVER_RATIO ? 'over' : 'warn';
}

/** Kawałek zadania, którego potrzebuje rachunek — bez reszty pól. */
export interface CapacityTask {
  storyPoints: number | null;
  stageId: number | null;
  sprintId: number | null;
  responsibleId: number | null;
}

export interface SprintCapacity {
  /** Godziny robocze do końca sprintu. */
  hoursLeft: number;
  /** Ilu programistów liczymy. */
  devs: number;
  /** `hoursLeft × devs` — tyle punktów da się jeszcze zrobić. */
  capacity: number;
  /** Punkty zadań, które czekają na start i wchodzą do limitu. */
  demand: number;
  /** Punkty czekających zadań poza limitem (osoby wskazane w konfiguracji). */
  excluded: number;
  level: CapacityLevel;
}

export function sprintCapacity(opts: {
  now: Date;
  dateEnd: string | null;
  devs: number;
  sprintId: number | null;
  /** Etapy sprintu, na których zadanie czeka (typ NEW). */
  waitingStageIds: ReadonlySet<number>;
  /** Odpowiedzialni, których zadania nie liczą się do limitu. */
  excludedIds: readonly number[];
  tasks: readonly CapacityTask[];
}): SprintCapacity | null {
  const { now, dateEnd, devs, sprintId, waitingStageIds, excludedIds, tasks } = opts;
  const end = sprintDeadline(dateEnd);
  if (!end || sprintId === null) return null;

  const hoursLeft = workHoursBetween(now, end);
  const capacity = hoursLeft * devs;

  const skip = new Set(excludedIds);
  let demand = 0;
  let excluded = 0;
  for (const t of tasks) {
    if (t.sprintId !== sprintId || t.stageId === null || !waitingStageIds.has(t.stageId)) continue;
    if (t.storyPoints === null) continue;
    if (t.responsibleId !== null && skip.has(t.responsibleId)) excluded += t.storyPoints;
    else demand += t.storyPoints;
  }

  return { hoursLeft, devs, capacity, demand, excluded, level: capacityLevel(demand, capacity) };
}
