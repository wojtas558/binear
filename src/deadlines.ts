/*
 * Terminy zadań: pasek odliczający i reguła „musi wejść do planowanego sprintu".
 *
 * Sama arytmetyka, bez Reacta i bez sieci — da się ją sprawdzić na wymyślonych
 * danych (patrz deadlines.test.ts).
 *
 * Zasady (ustalone z kierownikiem IT):
 *  - termin w polu Bitriksa jest zarezerwowany dla terminów TWARDYCH, czyli takich,
 *    których nie wolno przekroczyć (kampania, urząd, umowa). Twardość potwierdza tag
 *    `TERMIN-TWARDY`, który nadaje audyt razem z wiadomością `TERMIN:` w czacie zadania,
 *  - pełny pasek to 30 dni do terminu i kurczy się wraz z jego zbliżaniem; KOLOR mówi, w którym
 *    sprincie zadanie musi się znaleźć: zielony — ani w tym, ani w następnym, żółty — w następnym,
 *    czerwony — w obecnym. Dwa zadania z tym samym terminem mają więc różny kolor, jeśli różnią się wyceną,
 *  - na poniedziałkowej radzie lista „Terminy" ma wszystkie zadania, których NIE da się już
 *    zrobić, jeśli poczekamy do następnej rady: liczymy godziny robocze od 10:00 w poniedziałek
 *    następnej rady do końca dnia terminu i porównujemy z wyceną (4 h zmieści się
 *    w poniedziałek po radzie, 8 h już nie — musi wejść teraz),
 *  - zadanie dłuższe niż 40 h wchodzi na listę wcześniej: do wyceny dokładamy 40 h na każdy
 *    kolejny 40-godzinny blok, bo trzeba je najpierw rozbić na kawałki.
 */

import { WORK_END_HOUR, workHoursBetween } from './sprintClock';

/** Tag, który nadaje audyt, gdy termin jest potwierdzony jako nieprzekraczalny. */
export const HARD_DEADLINE_TAG = 'TERMIN-TWARDY';

/** Tyle dni do terminu to pełny pasek. */
export const BAR_FULL_DAYS = 30;

/** Próg kluczowy dla zespołu: tydzień do terminu. */
export const KEY_DAYS = 7;

/** Wycena, od której zadanie nie mieści się w jednym sprincie (limit skali). */
export const SPRINT_HOURS_LIMIT = 40;

/** Od tej godziny po poniedziałkowej radzie można zacząć pracę nad zadaniem. */
export const COUNCIL_END_HOUR = 10;

const DAY_MS = 86_400_000;

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Pełne dni KALENDARZOWE od `from` do `to`; ujemne = `to` jest wcześniej. */
export function calendarDays(from: Date, to: Date): number {
  return Math.round((midnight(to).getTime() - midnight(from).getTime()) / DAY_MS);
}

export function isHardDeadline(tags: readonly string[]): boolean {
  return tags.some((t) => t.toUpperCase() === HARD_DEADLINE_TAG);
}

/** Pasek terminu: pełny przy 30 dniach i więcej, pusty w dniu terminu i po nim. */
export function deadlineBar(days: number): { fill: number; overdue: boolean } {
  return { fill: Math.min(1, Math.max(0, days / BAR_FULL_DAYS)), overdue: days < 0 };
}

export type DeadlineLevel = 'red' | 'yellow' | 'green';

/** Kolory poziomów — pasek i jego obwódka biorą ten sam. */
export const LEVEL_COLOR: Record<DeadlineLevel, string> = {
  red: 'hsl(5 70% 50%)',
  yellow: 'hsl(42 92% 48%)',
  green: 'hsl(145 55% 42%)',
};

/**
 * W którym sprincie zadanie musi się znaleźć.
 *  - czerwony: nie da się już zrobić w terminie, jeśli poczekamy do następnej rady, więc musi wejść
 *    w obecnym (planowanym) sprincie,
 *  - żółty: da się jeszcze zrobić po następnej radzie, ale już nie po kolejnej, więc musi wejść
 *    w następnym sprincie,
 *  - zielony: nie musi wejść ani w obecnym, ani w następnym.
 *
 * `nextCouncil` to poniedziałek następnej rady (koniec obecnego sprintu). Bez niego (brak sprintu)
 * zostaje przybliżenie po dniach: do 7 czerwony, do 14 żółty.
 */
export function deadlineLevel(
  task: DeadlineCandidate,
  nextCouncil: Date | null,
  now: Date = new Date(),
): DeadlineLevel {
  if (!task.deadline) return 'green';
  if (!nextCouncil) {
    const days = calendarDays(now, new Date(task.deadline));
    return days <= KEY_DAYS ? 'red' : days <= 2 * KEY_DAYS ? 'yellow' : 'green';
  }
  if (deadlineVerdict(task, nextCouncil, now)?.mustEnter) return 'red';
  const councilAfter = new Date(nextCouncil.getFullYear(), nextCouncil.getMonth(), nextCouncil.getDate() + 7, nextCouncil.getHours());
  return deadlineVerdict(task, councilAfter, now)?.mustEnter ? 'yellow' : 'green';
}

/**
 * Ile 40-godzinnych bloków ma zadanie. Brak wyceny liczymy jak jeden — o braku wyceny
 * mówi osobno `bezWyceny`, a nie ma sensu zgadywać, że będzie duże.
 */
export function sprintsNeeded(hours: number | null): number {
  if (hours === null || hours <= SPRINT_HOURS_LIMIT) return 1;
  return Math.ceil(hours / SPRINT_HOURS_LIMIT);
}

/** Moment, w którym po radzie zaczyna się praca: dzień rady o `COUNCIL_END_HOUR`. */
export function councilStart(councilDay: Date): Date {
  return new Date(councilDay.getFullYear(), councilDay.getMonth(), councilDay.getDate(), COUNCIL_END_HOUR);
}

export interface DeadlineCandidate {
  deadline: string | null;
  storyPoints: number | null;
  tags: readonly string[];
}

export interface DeadlineVerdict {
  /** Dni kalendarzowe od dziś do terminu; ujemne = po terminie. */
  days: number;
  hard: boolean;
  /** Przy czekaniu do następnej rady zadania nie da się już zrobić w terminie. */
  mustEnter: boolean;
  /** Zadanie ma więcej niż 40 h, więc wchodzi na listę wcześniej. */
  longTask: boolean;
  bezWyceny: boolean;
  /** Ile godzin roboczych zostanie od startu po następnej radzie do końca dnia terminu. */
  hoursLeft: number;
}

/**
 * Czy zadanie z terminem musi wejść do planowanego sprintu, czyli nie może czekać do następnej rady.
 *
 * `nextCouncil` to poniedziałek następnej rady. Praca zaczyna się wtedy o 10:00, a termin
 * kończy się z końcem dnia roboczego w dniu terminu. Zadanie, którego wycena (godziny)
 * przekracza tak policzone godziny, musi wejść teraz. Termin przed następną radą wpada zawsze.
 * Zadanie ponad 40 h potrzebuje dodatkowych 40 h na każdy kolejny blok (rozbicie i złożenie).
 *
 * Bez wyceny nie wiemy, ile potrzeba: dajemy tydzień zapasu ponad następną radę, żeby
 * zadanie nie zniknęło z listy, zanim ktoś je wyceni.
 */
export function deadlineVerdict(
  task: DeadlineCandidate,
  nextCouncil: Date,
  now: Date = new Date(),
): DeadlineVerdict | null {
  if (!task.deadline) return null;
  const end = new Date(task.deadline);
  if (Number.isNaN(end.getTime())) return null;
  const days = calendarDays(now, end);
  const blocks = sprintsNeeded(task.storyPoints);

  const start = councilStart(nextCouncil);
  const finish = new Date(end.getFullYear(), end.getMonth(), end.getDate(), WORK_END_HOUR);
  const hoursLeft = workHoursBetween(start, finish);

  const bezWyceny = task.storyPoints === null;
  const mustEnter = bezWyceny
    ? finish.getTime() <= councilStart(nextCouncil).getTime() + 7 * DAY_MS
    : finish.getTime() <= start.getTime() || (task.storyPoints as number) + SPRINT_HOURS_LIMIT * (blocks - 1) > hoursLeft;

  return { days, hard: isHardDeadline(task.tags), mustEnter, longTask: blocks > 1, bezWyceny, hoursLeft };
}

/** Kolejność listy „Terminy": po terminie i najbliższe pierwsze, przy remisie twarde przed niepotwierdzonymi. */
export function compareDeadlines(a: DeadlineVerdict, b: DeadlineVerdict): number {
  if (a.days !== b.days) return a.days - b.days;
  return Number(b.hard) - Number(a.hard);
}
