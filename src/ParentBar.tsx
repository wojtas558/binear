import type { ParentProgress } from './parentProgress';

const NAZWY = { done: 'zrobione', doing: 'w toku', waiting: 'czeka' } as const;

/** Podpowiedz paska: ile SP w kazdym stanie, co jest zrobione i ile podzadan nie ma wyceny. */
export function parentBarTitle(p: ParentProgress): string {
  const czesci = (['done', 'doing', 'waiting'] as const)
    .filter((s) => p[s] > 0)
    .map((s) => `${NAZWY[s]} ${p[s]} SP`);
  const brak = p.unestimated > 0 ? ` · ${p.unestimated} bez SP (nie wchodzą do paska)` : '';
  return `Podzadania: ${p.points} SP — ${czesci.join(' · ') || 'bez wycen'}${brak}`;
}

/**
 * Pasek postepu rodzica: kazde podzadanie to kawalek o szerokosci proporcjonalnej do jego SP,
 * w kolorze stanu (zrobione / w toku / czeka). Pusty, gdy zadne podzadanie nie ma SP.
 */
export function ParentBar({ progress, className = '' }: { progress: ParentProgress; className?: string }) {
  if (progress.slices.length === 0) return null;
  return (
    <span className={`parent-bar ${className}`.trim()} title={parentBarTitle(progress)} aria-label={parentBarTitle(progress)}>
      {progress.slices.map((s) => (
        <span key={s.id} className={`parent-bar-seg is-${s.state}`} style={{ flexGrow: s.sp }} />
      ))}
    </span>
  );
}
