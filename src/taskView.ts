/*
 * Drobiazgi wspolne dla OBU widokow zadania — wiersza listy (App.tsx) i karty na
 * tablicy (Board.tsx). Lezą osobno, bo Board nie moze importowac z App (cykl), a
 * kazda kopia tych funkcji konczyla sie tym, ze jeden widok pokazywal cos inaczej
 * niz drugi. Zasada: co widac w wierszu, ma byc widoczne tez na karcie.
 */

export const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  // Rok DOPISUJEMY tylko, gdy to NIE biezacy rok. Bez tego „23 wrz" (2025) i „20 sie"
  // (2026) wygladaja jak ta sama skala, wiec poprawnie posortowana lista (po pelnym
  // znaczniku czasu) sprawia wrazenie przemieszanej na granicy lat. Biezacy rok
  // zostaje zwiezly.
  const y = d.getFullYear();
  return y === new Date().getFullYear() ? base : `${base} ${y}`;
}

/*
 * Konto-zaslepka "Nieprzypisane". Wartosc przychodzi z .env przez /api/config
 * (BX_UNASSIGNED_ID) i jest ustawiana raz, zanim wczytamy zadania — patrz
 * useBitrixData. Dlatego `let`, nie `const`: 251 to jedynie domyslka na start.
 * Import tego `let` widzi zmiane (zywe wiazanie ES), ale przypisac mozna tylko
 * przez `setUnassignedId`.
 */
export let UNASSIGNED_ID = 251;

export function setUnassignedId(id: number): void {
  if (Number.isFinite(id)) UNASSIGNED_ID = id;
}

export const UNASSIGNED_LABEL = 'Nieprzypisane';

export const isUnassigned = (responsibleId: number | null) =>
  responsibleId === null || responsibleId === UNASSIGNED_ID;
