/**
 * Kolejnosc „ostatnio dodane na gorze" w panelu KOLEJNEGO sprintu widoku planowania.
 *
 * Bitrix nie przechowuje, KIEDY zadanie weszlo do sprintu, wiec pamietamy to sami (do przeladowania
 * strony): kazde przeciagniecie z rejestru dostaje kolejny numer (`dodane`). Na gorze stoi tylko
 * `NA_GORZE` najnowszych; reszta — starsze przeciagniete i te, ktore byly w sprincie od poczatku —
 * zostaje w wybranym sortowaniu, pod kreska „dodane w tej sesji".
 */
export type Dodane = Record<number, number>;

/**
 * Ile ostatnio przeciagnietych zadan trzymamy na gorze. Starsze wracaja do zwyklego sortowania —
 * przy dlugim planowaniu blok „dodane w tej sesji" nie rosnie bez konca.
 */
export const NA_GORZE = 5;

/** Tylko `NA_GORZE` najnowszych znacznikow; ten sam obiekt, gdy nie ma czego obcinac. */
export function tylkoOstatnie(dodane: Dodane, ile = NA_GORZE): Dodane {
  const ids = Object.keys(dodane).map(Number);
  if (ids.length <= ile) return dodane;
  const zostaja = ids.sort((a, b) => dodane[b] - dodane[a]).slice(0, ile);
  return Object.fromEntries(zostaja.map((id) => [id, dodane[id]]));
}

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
