/**
 * Kolejnosc „ostatnio dodane na gorze" w panelach sprintow widoku planowania.
 *
 * Bitrix nie przechowuje, KIEDY zadanie weszlo do sprintu, wiec pamietamy to sami: kazde
 * przeciagniecie z rejestru dostaje kolejny numer (`dodane`). Zadania bez numeru — te, ktore
 * byly w sprincie od poczatku — zostaja w dotychczasowej kolejnosci, pod dodanymi.
 */
export type Dodane = Record<number, number>;

/** Stabilny sort: najnowszy numer pierwszy, reszta w kolejnosci wejsciowej. */
export function ostatnioDodaneNaGorze<T extends { id: number }>(lista: T[], dodane: Dodane): T[] {
  if (lista.every((t) => dodane[t.id] === undefined)) return lista;
  return [...lista].sort((a, b) => (dodane[b.id] ?? 0) - (dodane[a.id] ?? 0));
}

/**
 * Zapis przeniesienia: do sprintu — kolejne numery, a przy paczce pierwszy z listy ma byc
 * na samej gorze; z powrotem do rejestru (cofniecie) — numer znika.
 */
export function zapiszPrzeniesienie(
  dodane: Dodane,
  ids: number[],
  doSprintu: boolean,
  start: number,
): { dodane: Dodane; nastepny: number } {
  const wynik = { ...dodane };
  if (!doSprintu) {
    for (const id of ids) delete wynik[id];
    return { dodane: wynik, nastepny: start };
  }
  let n = start;
  for (const id of [...ids].reverse()) wynik[id] = n++;
  return { dodane: wynik, nastepny: n };
}
