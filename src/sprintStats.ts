/*
 * Liczby pod wykresami sprintu — spalanie i predkosc zespolu.
 *
 * Bitrix rysuje oba wykresy u siebie, ale NIE oddaje ich przez REST: sprawdzone
 * na zywo, `tasks.api.scrum.burndown.*` i `...velocity.*` nie istnieja (404), a
 * `sprint.burndown` / `sprint.statistics` odpowiadaja bledem 22002 "Could not
 * find description of burndown in Bitrix\Tasks\Rest\Controller" — czyli kontroler
 * jest, akcji nie ma. Serie trzeba wiec zlozyc samemu z tego, co REST daje.
 *
 * Tu siedzi sama arytmetyka, bez sieci: dzieki temu da sie ja sprawdzic na
 * wymyslonych danych, a pobieranie zostaje w bitrix.ts.
 */

import type { Sprint, SprintTask } from './bitrix';

/** Jeden punkt na osi wykresu spalania. */
export interface BurndownPoint {
  /** „Planowanie", potem „Dzień 1", „Dzień 2"... — tak samo jak u Bitriksa. */
  label: string;
  /** Koniec doby, ktora ten punkt podsumowuje (punkt „Planowanie" — start sprintu). */
  at: number;
  /** Linia idealna: rowny zjazd od zaplanowanych pointow do zera. */
  ideal: number;
  /** Ile POZOSTAJE naprawde. `null` = dzien jeszcze nie nadszedl, linia sie urywa. */
  actual: number | null;
}

export interface SprintSummary {
  sprint: Sprint;
  /** Suma story pointow zadan sprintu. */
  planned: number;
  /**
   * Story pointy zrobione — STAN NA DZIS, nie tempo. Liczy wszystko, co jest juz
   * gotowe, niezaleznie od tego, czy domkniete w tym sprincie czy wczesniej.
   *
   * Wczesniej bylo tu "domkniete W OKRESIE sprintu" i to mieszalo dwa pytania:
   * `planned - completed` wychodzilo wtedy 43 SP "do zrobienia" u osoby, ktorej
   * naprawde zostalo 6 — bo 37 SP zamknieto przed startem sprintu i wpadaly one
   * do planu, ale nie do wykonania. Suma `completed + remaining` ma sie zgadzac
   * z `planned` i teraz sie zgadza.
   */
  completed: number;
  /** Story pointy, ktore NIE sa gotowe. `completed + remaining === planned`. */
  remaining: number;
  taskCount: number;
  /** Ile zadan sprintu nie ma oszacowania — bez tego „0 SP" mysli sie z „brak danych". */
  unestimated: number;
  /** SP w kolumnie "Do zatwierdzenia / PR": zamkniete, ale jeszcze nie wdrozone. */
  inReview: number;
  burndown: BurndownPoint[];
}

const DAY = 86_400_000;

const sp = (t: SprintTask) => t.storyPoints ?? 0;

/**
 * Czy zadanie liczy sie jako zrobione.
 *
 * Wyciagniete z `summarize`, bo tej samej definicji potrzebuje takze lista osob
 * w selektorze — inaczej przelacznik "Wliczaj do zatwierdzenia" zmienialby wykres
 * i liczby nad nim, ale nie liczby przy nazwiskach tuz obok.
 */
export function taskDone(t: SprintTask, countReview: boolean): boolean {
  return countReview ? Boolean(t.closedAt) : t.done && Boolean(t.closedAt);
}

/**
 * Dni robocze sprintu. Bitrix liczy tak samo: sprint 31.08-07.09.2026 dostaje na
 * wykresie „Dzień 1".."Dzień 5", czyli poniedzialek-piatek — dzien konca nie
 * wchodzi, a weekend nie zajmuje miejsca na osi.
 */
export function workingDays(startIso: string, endIso: string): number[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const days: number[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // Bezpiecznik: sprint dluzszy niz kwartal to blad danych, nie plan.
  for (let i = 0; i < 92 && cur.getTime() < end.getTime(); i++) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      // Punkt podsumowuje CALA dobe, wiec siada na jej koncu.
      days.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59).getTime());
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * Spalanie jednego sprintu.
 *
 * Pointy zadania bierzemy takie, jakie sa DZIS, i stosujemy do calego sprintu —
 * bo zmiana story pointow nie trafia do dziennika zmian zadania (sprawdzone: pola
 * historii to STAGE, STATUS, TAGS, COMMENT, NEW, TITLE, DESCRIPTION,
 * MOVE_TO_SPRINT, RESPONSIBLE_ID, PARENT_ID — story pointow tam nie ma, bo leza
 * na scrumowym bycie zadania). Jesli ktos przeszacowal zadanie w trakcie sprintu,
 * wczesniejsze dni pokaza dzisiejsza wartosc. Nie da sie tego wykryc z danych,
 * wiec nie udajemy, ze umiemy — to znany limit, nie blad w liczeniu.
 */
export function buildBurndown(
  sprint: Sprint,
  tasks: SprintTask[],
  now = Date.now(),
  countReview = true,
): BurndownPoint[] {
  if (!sprint.dateStart) return [];

  const planned = tasks.reduce((a, t) => a + sp(t), 0);
  const days = workingDays(sprint.dateStart, sprint.dateEnd ?? sprint.dateStart);
  if (!days.length) return [];

  /*
   * Spalaja sie tylko zadania GOTOWE (kolumna FINISH) — patrz `done` w SprintTask.
   * `closedAt` zostaje, ale juz nie jako kryterium, tylko jako MOMENT: mowi, kiedy
   * to sie stalo, i dzieki temu punkt trafia we wlasciwy dzien.
   */
  /*
   * `countReview` rozstrzyga, co znaczy "zrobione":
   *   true  - kazde zadanie z data zamkniecia, czyli TAKZE "Do zatwierdzenia / PR"
   *           (Bitrix stempluje `closedDate` juz przy statusie 4). Tak patrzy na to
   *           osoba, ktora skonczyla pisac kod i czeka na czyjas akceptacje.
   *   false - tylko kolumna FINISH, czyli to, co realnie wdrozone. Tak liczy wykres
   *           samego Bitriksa (Sprint 65: spala 68 SP z "Wdrożone", a nie 168).
   * Roznica nie jest kosmetyczna - w tym sprincie to 100 SP z 254.
   */
  const closed = tasks
    .filter((t) => (countReview ? true : t.done) && t.closedAt)
    .map((t) => ({
      /*
       * Dzien spalenia zalezy od tego, CO uznajemy za zrobione. Liczac akceptacje
       * — moment oddania do niej (`reviewAt`), bo wtedy praca sie skonczyla.
       * Liczac tylko wdrozenia — `closedAt`, ktory po przejsciu do FINISH wskazuje
       * wlasnie wdrozenie. Bez tego rozroznienia zadanie oddane w sierpniu, a
       * wdrozone we wrzesniu, spadaloby z wykresu we wrzesniu w obu trybach.
       */
      at: new Date((countReview && t.reviewAt ? t.reviewAt : t.closedAt) as string).getTime(),
      points: sp(t),
    }))
    .filter((c) => Number.isFinite(c.at));

  const startAt = new Date(sprint.dateStart).getTime();

  /*
   * Punkt "Planowanie" to zakres MINUS to, co bylo gotowe juz przed startem.
   *
   * Bitrix zaczyna od pelnej sumy i nigdy nie spala zaszlosci — przez co jego
   * linia konczy sie wyzej niz faktyczna pozostalosc. U nas liczby nad wykresem
   * mowia "zostalo 86 SP", wiec linia MUSI dojsc do 86; inaczej wykres przeczy
   * podpisom tuz nad soba. Zaczynamy wiec od tego, co realnie bylo do zrobienia,
   * i spalamy wylacznie prace tego sprintu — bez sztucznego urwiska w Dniu 1,
   * ktore powstaloby, gdyby zaszlosci spalily sie naraz pierwszego dnia.
   */
  const burnedBefore = closed.reduce((a, c) => (c.at < startAt ? a + c.points : a), 0);
  const start = Math.max(0, planned - burnedBefore);

  const points: BurndownPoint[] = [
    { label: 'Planowanie', at: startAt, ideal: start, actual: start },
  ];

  days.forEach((at, i) => {
    // Tylko domkniecia Z OKRESU sprintu — zaszlosci sprzed startu nie spalaja sie
    // w Dniu 1, bo nie byly praca tego sprintu (patrz punkt "Planowanie" wyzej).
    const burned = closed.reduce((a, c) => (c.at >= startAt && c.at <= at ? a + c.points : a), 0);
    points.push({
      label: `Dzień ${i + 1}`,
      at,
      // Rowny zjazd do zera na ostatnim dniu sprintu.
      // Linia idealna schodzi z TEGO SAMEGO punktu co rzeczywista — dwie linie
      // startujace w roznych miejscach nie daja sie porownac wzrokiem.
      ideal: Math.max(0, start * (1 - (i + 1) / days.length)),
      // Dzien z przyszlosci nie ma stanu faktycznego — linia ma sie urwac na dzis,
      // a nie plasko biec po dzisiejszej wartosci az do konca sprintu.
      actual: at - DAY > now ? null : Math.max(0, start - burned),
    });
  });

  return points;
}

/** Zwiniecie sprintu do jednego slupka wykresu predkosci. */
export function summarize(
  sprint: Sprint,
  tasks: SprintTask[],
  now = Date.now(),
  countReview = true,
): SprintSummary {
  const planned = tasks.reduce((a, t) => a + sp(t), 0);
  /*
   * "Gotowe" zalezy od `countReview`: przy wlaczonym liczy sie kazde zadanie
   * z data zamkniecia (czyli takze "Do zatwierdzenia / PR"), przy wylaczonym
   * tylko kolumna FINISH. Data zamkniecia NIE jest tu filtrem czasowym — pytamy
   * "czy to jest zrobione", a nie "czy zrobiono to w tym tygodniu".
   */
  const isDone = (t: SprintTask) => taskDone(t, countReview);
  const completed = tasks.reduce((a, t) => (isDone(t) ? a + sp(t) : a), 0);
  const remaining = tasks.reduce((a, t) => (isDone(t) ? a : a + sp(t)), 0);

  return {
    sprint,
    planned,
    completed,
    remaining,
    taskCount: tasks.length,
    unestimated: tasks.filter((t) => t.storyPoints === null).length,
    inReview: tasks.reduce((a, t) => (t.closedAt && !t.done ? a + sp(t) : a), 0),
    burndown: buildBurndown(sprint, tasks, now, countReview),
  };
}
