/*
 * Kto zostaje odpowiedzialnym, gdy zadanie wchodzi z rejestru do sprintu.
 *
 * Zasada: zadanie spoza IT, ktore ktos bierze do sprintu, przechodzi na konto-zaslepke IT
 * (BX_UNASSIGNED_ID, u nas „Klaudiusz") — dzial zglaszajacy nie jest tym, kto je zrobi. Jesli
 * odpowiedzialny jest z IT, zostaje. Dotyczy WYLACZNIE wejscia z rejestru do sprintu; przekladanie
 * miedzy sprintami niczego nie zmienia.
 *
 * Czyj jest IT: konto, z ktorego dziala binear (`me`), konta z BX_IT_USERS, osoby z dzialow
 * BX_IT_DEPARTMENTS oraz osoby spoza limitu zespolu (kierownik) i sama zaslepka. Gdy o kims nic
 * nie wiemy (nie ma go w spisie pracownikow), NIE ruszamy zadania — pomylka w druga strone
 * zabralaby je komus z IT.
 *
 * Sama logika, bez Reacta i sieci — da sie ja sprawdzic na wymyslonych danych.
 */

export interface ItContext {
  /** Konto, z ktorego dziala binear — zawsze IT. */
  me: number | null;
  itUsers: readonly number[];
  itDepartments: readonly number[];
  /** Osoby spoza limitu zespolu (kierownik IT) — tez IT. */
  kierownicy: readonly number[];
  /** Konto-zaslepka IT, na ktore przechodza zadania spoza IT. */
  unassignedId: number;
  /** Dzialy osob ze spisu pracownikow; brak wpisu = nie wiemy. */
  departmentsOf: ReadonlyMap<number, readonly number[]>;
}

/** `true` IT, `false` spoza IT, `null` — nie wiemy (nie ma go w spisie). */
export function isIt(personId: number, ctx: ItContext): boolean | null {
  if (personId === ctx.me || personId === ctx.unassignedId) return true;
  if (ctx.itUsers.includes(personId) || ctx.kierownicy.includes(personId)) return true;
  const deps = ctx.departmentsOf.get(personId);
  if (!deps) return null;
  return deps.some((d) => ctx.itDepartments.includes(d));
}

/**
 * Nowy odpowiedzialny dla zadania wchodzacego do sprintu albo `null`, gdy zostaje bez zmian.
 *
 * `fromSprintId` — sprint, z ktorego zadanie wychodzi (`null` = rejestr); `toSprintId` — dokad idzie.
 */
export function ownerOnEnteringSprint(
  task: { responsibleId: number | null },
  fromSprintId: number | null,
  toSprintId: number | null,
  ctx: ItContext,
): number | null {
  // Tylko rejestr → sprint.
  if (fromSprintId !== null || toSprintId === null) return null;
  if (task.responsibleId === null || task.responsibleId === ctx.unassignedId) return null;
  return isIt(task.responsibleId, ctx) === false ? ctx.unassignedId : null;
}
