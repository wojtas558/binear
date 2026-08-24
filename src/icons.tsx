import { useState } from 'react';

/** Ikony statusu: pierscien + wypelnienie proporcjonalne do postepu. */

const RING = { fill: 'none', strokeWidth: 1.6 } as const;

function StatusRing({ progress, color }: { progress: number; color: string }) {
  // 0 = pusty pierscien, 1 = pelne kolo; posrednie stany rysujemy wycinkiem.
  const r = 3.4;
  const circumference = 2 * Math.PI * r;

  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.6" stroke={color} {...RING} />
      {progress >= 1 ? (
        <circle cx="7" cy="7" r="5.6" fill={color} stroke="none" />
      ) : (
        progress > 0 && (
          <circle
            cx="7"
            cy="7"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={r * 2}
            strokeDasharray={`${circumference * progress} ${circumference}`}
            transform="rotate(-90 7 7)"
          />
        )
      )}
      {progress >= 1 && (
        <path
          d="M4.6 7.1 6.2 8.7 9.4 5.4"
          stroke="var(--bg-base)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
}

/** Klucze odpowiadaja enumowi STATUS z `tasks.task.getFields` tego portalu. */
const STATUS_VISUAL: Record<string, { progress: number; color: string }> = {
  '2': { progress: 0, color: 'var(--fg-dim)' }, // W oczekiwaniu
  '3': { progress: 0.5, color: 'var(--accent-amber)' }, // W toku
  '4': { progress: 0.75, color: 'var(--accent-green)' }, // Czeka na kontrolę
  '5': { progress: 1, color: 'var(--accent)' }, // Zakończone
  '6': { progress: 0.15, color: 'var(--fg-dim)' }, // Odłożone
};

export function StatusIcon({ status }: { status: string }) {
  const v = STATUS_VISUAL[status] ?? STATUS_VISUAL['2'];
  return <StatusRing progress={v.progress} color={v.color} />;
}

/**
 * Pierscien dla ETAPU sprintu. Ta ikona oznacza stan przeplywu pracy —
 * a tym w tej grupie jest etap kanbana, nie wbudowany status Bitriksa.
 * Kolor bierzemy z ustawien kolumny w Bitriksie, wypelnienie z jej pozycji.
 */
export function StageIcon({ progress, color }: { progress: number | null; color: string | null }) {
  const stroke = color ? `#${color}` : 'var(--fg-dim)';

  /*
   * `null` = etap poza przeplywem (wstrzymanie). Zamiast wypelnienia rysujemy
   * pauze: postoj NIE jest postepem, a kazde wypelnienie czytaloby sie wlasnie
   * tak — nawet minimalne sugerowaloby, ze zadanie gdzies dotarlo.
   */
  if (progress === null) {
    return (
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <circle cx="7" cy="7" r="5.6" stroke={stroke} {...RING} />
        <rect x="5.2" y="4.6" width="1.3" height="4.8" rx="0.5" fill={stroke} />
        <rect x="7.5" y="4.6" width="1.3" height="4.8" rx="0.5" fill={stroke} />
      </svg>
    );
  }

  return <StatusRing progress={progress} color={stroke} />;
}

/** Dymek przy liczniku nieprzeczytanych komentarzy. */
export function CommentIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <path
        d="M2 4.2a1.7 1.7 0 0 1 1.7-1.7h6.6A1.7 1.7 0 0 1 12 4.2v4a1.7 1.7 0 0 1-1.7 1.7H5.8L3.2 12V9.9A1.7 1.7 0 0 1 2 8.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Priorytet: slupki. Normalny nie rysuje sie wcale — brak sygnalu to tez sygnal. */
export function PriorityIcon({ priority }: { priority: string }) {
  if (priority === '1') return <span className="prio-spacer" aria-hidden />;

  const high = priority === '2';
  const color = high ? 'var(--accent-orange)' : 'var(--fg-dim)';
  const heights = high ? [4, 7, 10] : [4, 4, 4];
  const dim = high ? [1, 1, 1] : [1, 0.35, 0.35];

  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={1 + i * 4.4}
          y={12 - h}
          width="2.6"
          height={h}
          rx="0.8"
          fill={color}
          opacity={dim[i]}
        />
      ))}
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      className={open ? 'chev chev-open' : 'chev'}
      aria-hidden
    >
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ikona grupowania — trzy poziome bloki o roznej dlugosci. */
export function GroupIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <rect x="1.5" y="2.5" width="11" height="1.8" rx="0.9" fill="currentColor" />
      <rect x="1.5" y="6.1" width="7.5" height="1.8" rx="0.9" fill="currentColor" opacity="0.75" />
      <rect x="1.5" y="9.7" width="9.5" height="1.8" rx="0.9" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      {[2, 6, 10, 14].map((y) => (
        <rect key={y} x="1" y={y - 1} width="14" height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export function BoardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      {[1, 6, 11].map((y) =>
        [1, 9].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="6" height="4" rx="1.2" fill="currentColor" />
        )),
      )}
    </svg>
  );
}

/** Strzalka kierunku sortowania — w gore dla rosnaco, w dol dla malejaco. */
export function DirIcon({ dir }: { dir: 'asc' | 'desc' }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <g transform={dir === 'asc' ? undefined : 'rotate(180 8 8)'}>
        <path
          d="M4.5 6.5 8 3l3.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 3.4V13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/*
 * Ponizsze byly wczesniej znakami tekstowymi (⑂ ↻ ⋯ ↳). Inter ich nie zawiera,
 * wiec przegladarka podstawiala zastepczy font i renderowaly sie przypadkowo —
 * tak jak ⌘, ktore wygladalo jak blyskawica. Ikony musza byc rysowane, nie pisane.
 */

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M13.4 2.2v3.1h-3.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Rozgalezienie — oznacza podzadania. */
export function SubtaskIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M5 2.5v6a2 2 0 0 0 2 2h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="2.5" r="1.6" fill="currentColor" />
      <circle cx="11.5" cy="10.5" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Strzalka "w gore do rodzica" — przy podzadaniu bez rodzica w grupie. */
export function ParentIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden>
      <path
        d="M11.5 12.5h-4a3 3 0 0 1-3-3v-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2.6 5.4 4.5 3.2l1.9 2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Ogniwa lancucha — plakietka „ma powiazane zadania" (DEPENDS_ON). */
export function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M6.5 9.5 9.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8.7 5.3 10 4a2.4 2.4 0 0 1 3.4 3.4l-1.3 1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.3 10.7 6 12a2.4 2.4 0 0 1-3.4-3.4l1.3-1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      {[4, 8, 12].map((cx) => (
        <circle key={cx} cx={cx} cy="8" r="1.3" fill="currentColor" />
      ))}
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Wyjscie na zewnatrz — otwarcie zadania w Bitriksie. */
export function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <path
        d="M6.5 3.5H3.5v9h9v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.5h4v4M13 3l-5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "Stoi w innej grupie" — strzalka wychodzaca do slupka obok.
 * Celowo NIE ExternalIcon: tamta oznacza "otworz w Bitriksie" i mieszalyby sie znaczenia.
 */
export function ElsewhereIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M2 8h7m-2.4-2.6L9.2 8l-2.6 2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.8 3.4v9.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <rect x="5.5" y="2.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 13.5h-7a1 1 0 0 1-1-1v-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden>
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.2 9.2 12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Stabilny odcien z nazwy — ten sam tag ma zawsze ten sam kolor, w liscie i na tablicy. */
export function tagHue(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 55%)`;
}

export function Avatar({ name, photo }: { name: string | null; photo?: string | null }) {
  // Zapamietujemy KTORE zrodlo padlo, a nie samo "padlo" — inaczej po zmianie
  // osoby w wierszu kolejne zdjecie zostaloby uznane za zepsute.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!name) return <span className="avatar avatar-empty" title="Nieprzypisane" />;

  if (photo && photo !== failedSrc) {
    return (
      <img
        className="avatar"
        src={photo}
        alt=""
        title={name}
        loading="lazy"
        onError={() => setFailedSrc(photo)}
      />
    );
  }

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  // Stabilny odcien z nazwy — ten sam czlowiek zawsze ma ten sam kolor.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;

  return (
    <span
      className="avatar"
      title={name}
      style={{ background: `hsl(${hash} 42% 38%)`, color: `hsl(${hash} 70% 92%)` }}
    >
      {initials}
    </span>
  );
}
