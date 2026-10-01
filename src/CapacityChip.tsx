import { useEffect, useState } from 'react';
import { HoverNote } from './HoverNote';
import { OVER_RATIO, type CapacityLevel, type SprintCapacity } from './sprintClock';

/**
 * „Teraz" odświeżane co minutę — odliczanie ma się przesuwać samo, bez klikania.
 * Minuta wystarcza: liczymy w godzinach, a chip pokazuje je w pełnych liczbach.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* Pełne liczby: godziny i punkty pokazujemy bez ułamka — kolor liczy się z dokładnych wartości. */
const num = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 0 });

/** Kolor dopisku w dymku — te same trzy barwy co sam chip. */
const LEVEL_COLOR: Record<CapacityLevel, string> = {
  ok: 'var(--accent-green)',
  warn: 'var(--accent-orange)',
  over: 'var(--danger)',
};

const LEVEL_NOTE: Record<CapacityLevel, string> = {
  ok: 'mieścimy się',
  warn: 'trochę za dużo',
  over: `nie wyrobimy (od ${OVER_RATIO}× pojemności)`,
};

/**
 * Chip przy etapie „Nowe / Oczekujące": ile punktów zespół jeszcze zrobi do końca
 * sprintu (godziny robocze × programiści), w kolorze mówiącym, czy zadania czekające
 * na start się w tym mieszczą.
 *
 * Na chipie stoją DWIE liczby i kolor: „mamy" (pojemność) i „czeka" (punkty czekających
 * zadań PO odjęciu tych, które nie wchodzą do limitu). Skąd się biorą, mówi dopiero dymek.
 */
export function CapacityChip({ cap }: { cap: SprintCapacity }) {
  return (
    <HoverNote
      label="Do końca sprintu"
      value={
        <>
          {num(cap.hoursLeft)} h roboczych × {cap.devs} os. = {num(cap.capacity)} SP do zrobienia
          <br />
          Czeka na start: {num(cap.demand)} SP
          {cap.excluded > 0 && (
            <>
              <br />
              Nie wliczamy {num(cap.excluded)} SP kierownika — jego zadania nie wchodzą do limitu zespołu
            </>
          )}
        </>
      }
      note={LEVEL_NOTE[cap.level]}
      noteColor={LEVEL_COLOR[cap.level]}
      className={`head-cap head-cap-${cap.level}`}
    >
      mamy {num(cap.capacity)} · czeka {num(cap.demand)} SP
    </HoverNote>
  );
}
