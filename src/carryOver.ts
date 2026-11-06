/*
 * Ile razy zadanie przeszlo NIEDOKONCZONE z zamknietego sprintu do nastepnego (tag PRZENIESIONE).
 *
 * Ta sama regula co w kolejce audytu: Bitrix zapisuje przeniesienie jako zmiane etapu z kolumny do kolumny
 * o TEJ SAMEJ nazwie, w ciagu kilkunastu minut od zamkniecia sprintu (`dateEnd`). Sama zmiana etapu nie
 * wystarcza — wejscie z backlogu do sprintu tuz po zamknieciu poprzedniego wyglada tak samo — dlatego
 * odsiewamy ja wpisem MOVE_TO_SPRINT z (prawie) tej samej chwili.
 *
 * Czysta funkcja, bez Reacta i bez zapytan (carryOver.test.ts).
 */
import type { HistoryEntry, Sprint } from './bitrix';

/** Okno po zamknieciu sprintu, w ktorym zmiana etapu jest przeniesieniem. */
export const CARRY_WINDOW_MS = 30 * 60 * 1000;
/** Wpis MOVE_TO_SPRINT tak blisko zmiany etapu oznacza wejscie z backlogu, a nie przeniesienie. */
export const ENTRY_WINDOW_MS = 5 * 1000;

const STAGE_FIELDS = new Set(['STAGE', 'STAGE_ID']);

export function carryOverCount(
  history: readonly Pick<HistoryEntry, 'createdDate' | 'field' | 'from' | 'to'>[],
  sprints: readonly Pick<Sprint, 'status' | 'dateEnd'>[],
): number {
  const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const closings = sprints.filter((s) => s.status === 'completed').map((s) => at(s.dateEnd)).filter(Number.isFinite);
  const entries = history.filter((h) => h.field === 'MOVE_TO_SPRINT').map((h) => at(h.createdDate)).filter(Number.isFinite);
  const moves = history
    .filter((h) => STAGE_FIELDS.has(h.field) && h.from !== '' && h.from === h.to)
    .map((h) => at(h.createdDate))
    .filter(Number.isFinite);
  return closings.filter((end) =>
    moves.some(
      (when) => when >= end && when - end <= CARRY_WINDOW_MS && !entries.some((e) => Math.abs(e - when) <= ENTRY_WINDOW_MS),
    ),
  ).length;
}
