/*
 * Moce zespolu w planowaniu sprintu: kto zajmuje limit, a kto nie.
 *
 * Kierownik nie wchodzi do pojemnosci zespolu (BX_CAPACITY_EXCLUDE_IDS), wiec jego zadania nie
 * mogą zjadac limitu — ani przy sprawdzaniu, czy sprint sie miesci, ani przy liczeniu, ile
 * punktow rejestr moze jeszcze wziac. Wciaz jednak sa pracą w sprincie, wiec pokazujemy je OSOBNO
 * (statystyka „kierownik"), a nie chowamy.
 *
 * Sama arytmetyka, bez Reacta — da sie ja sprawdzic na wymyslonych danych.
 */
import type { Task } from './bitrix';

type Odpowiedzialny = Pick<Task, 'responsibleId'>;
type ZPunktami = Odpowiedzialny & Pick<Task, 'storyPoints'>;

/** Czy zadanie nalezy do osoby spoza limitu zespolu (kierownika). */
export const pozaLimitem = (t: Odpowiedzialny, kierownicy: readonly number[]): boolean =>
  t.responsibleId !== null && kierownicy.includes(t.responsibleId);

/** Dzieli zadania na zespol (zajmuje limit) i kierownika (poza limitem). */
export function podzielNaZespolIKierownika<T extends Odpowiedzialny>(
  tasks: readonly T[],
  kierownicy: readonly number[],
): { zespol: T[]; kierownik: T[] } {
  if (kierownicy.length === 0) return { zespol: [...tasks], kierownik: [] };
  const zespol: T[] = [];
  const kierownik: T[] = [];
  for (const t of tasks) (pozaLimitem(t, kierownicy) ? kierownik : zespol).push(t);
  return { zespol, kierownik };
}

/** Suma story pointow zadan, ktore zajmuja limit zespolu (bez zadan kierownika). */
export function sumaDoLimitu(tasks: readonly ZPunktami[], kierownicy: readonly number[]): number {
  let suma = 0;
  for (const t of tasks) if (!pozaLimitem(t, kierownicy)) suma += t.storyPoints ?? 0;
  return suma;
}

/** Suma story pointow zadan kierownika — poza limitem. */
export function sumaKierownika(tasks: readonly ZPunktami[], kierownicy: readonly number[]): number {
  let suma = 0;
  for (const t of tasks) if (pozaLimitem(t, kierownicy)) suma += t.storyPoints ?? 0;
  return suma;
}
