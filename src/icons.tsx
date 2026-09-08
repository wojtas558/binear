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

/** Sam kolor statusu (bez rysunku) — do jednolitych „monet" w facepile filtra. */
export function statusColor(status: string): string {
  return (STATUS_VISUAL[status] ?? STATUS_VISUAL['2']).color;
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
  // Slupki rosnaco: liczba pelnych slupkow = poziom. Niski 1, Normalny 2, Wysoki 3.
  // Kazdy poziom ma teraz widoczna ikone (dawniej Normalny byl pusty).
  const active = priority === '2' ? 3 : priority === '1' ? 2 : priority === '0' ? 1 : 0;
  if (active === 0) return <span className="prio-spacer" aria-hidden />;

  // Kazdy poziom ma WLASNY kolor, nie tylko inna liczbe slupkow. Pilny (2) =
  // pomaranczowy, standardowy (1) = szary, latwy (0) = zielony rozjasniony do
  // jasnosci pomaranczu (odpowiednik „orange", nie ciemny bazowy accent-green).
  const color =
    priority === '2'
      ? 'var(--accent-orange)'
      : priority === '1'
        ? 'var(--fg-muted)'
        : 'color-mix(in srgb, var(--accent-green) 55%, white)';
  const heights = [4, 7, 10];

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
          style={{ fill: color }}
          opacity={i < active ? 1 : 0.28}
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

/** Wykresy sprintu — slupki rosnace, czytelne w 16px bez zadnych detali. */
export function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <rect x="1.5" y="9" width="3.5" height="5.5" rx="1.2" fill="currentColor" />
      <rect x="6.25" y="5.5" width="3.5" height="9" rx="1.2" fill="currentColor" />
      <rect x="11" y="1.5" width="3.5" height="13" rx="1.2" fill="currentColor" />
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

/**
 * Pinezka — „trzymaj te kolumne na widoku, nawet gdy pusta".
 * Wypelniona = przypieta, sam kontur = nieprzypieta.
 */
export function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** Kosz — nieodwracalne usuniecie zadania. */
export function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
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

/*
 * Ikony WYMIAROW filtra ("+ Filtr"). Wszystkie neutralne i jednym konturem, bo
 * oznaczaja KATEGORIE, a nie wartosci.
 *
 * Dlatego NIE uzywamy tu `PriorityIcon` ani `StatusIcon`, mimo ze istnieja: one
 * rysuja konkretna wartosc razem z jej kolorem (pomaranczowy = pilny), wiec w
 * liscie wymiarow czytaloby sie to jako "priorytet: wysoki", a nie "priorytet".
 *
 * Wspolny szkielet: viewBox 16, kontur `currentColor` o grubosci 1.4 — arkusz
 * skaluje je do 16px i barwi na `--fg-dim` razem z reszta wiersza.
 */
const GLYPH = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Osoba odpowiedzialna. */
export function PersonIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <circle cx="8" cy="5.6" r="2.6" />
      <path d="M3 13.2c0-2.4 2.2-3.8 5-3.8s5 1.4 5 3.8" />
    </svg>
  );
}

/** Autor — pioro, czyli "kto to napisal", a nie "kto to robi". */
export function PenIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <path d="M10.8 2.6 13.4 5.2 6.1 12.5 2.8 13.2l0.7-3.3z" />
      <path d="M9.4 4 12 6.6" />
    </svg>
  );
}

/** Termin — kalendarz. */
export function CalendarIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.6" />
      <path d="M2.4 6.6h11.2M5.6 2v2.6M10.4 2v2.6" />
    </svg>
  );
}

/** Tag — etykieta z dziurka. */
export function TagIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <path d="M8.2 2.4H13.6V7.8L7.9 13.5 2.5 8.1z" />
      <circle cx="10.8" cy="5.2" r="1" />
    </svg>
  );
}

/** Epik — warstwy, czyli zadania zebrane pod jednym tematem. */
export function LayersIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <path d="M8 2.2 14 5.4 8 8.6 2 5.4z" />
      <path d="M2 8.6 8 11.8 14 8.6" />
      <path d="M2 11.6 8 14.8 14 11.6" />
    </svg>
  );
}

/** Story pointy — krata, bo to wymiar LICZBOWY. */
export function HashIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <path d="M6.2 2.6 4.8 13.4M11.2 2.6 9.8 13.4M2.6 6h11M2.2 10h11" />
    </svg>
  );
}

/**
 * Etap — kolumny kanbana, ale KONTUREM, nie wypelnieniem.
 *
 * `BoardIcon` (te same kolumny, na pelno) jest tu za ciezki: w kolumnie samych
 * konturow cztery pelne kwadraty wybijaly sie z rzedu jak pogrubienie i wzrok
 * lapal je pierwsze, chociaz "Etap" nie jest wazniejszy od reszty wymiarow.
 */
export function ColumnsIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <rect x="2.3" y="3" width="4.6" height="10" rx="1.3" />
      <rect x="9.1" y="3" width="4.6" height="6.6" rx="1.3" />
    </svg>
  );
}

/** Obserwator — oko. Patrzy na zadanie, nie pracuje przy nim. */
export function EyeIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <path d="M1.6 8s2.6-4.2 6.4-4.2S14.4 8 14.4 8s-2.6 4.2-6.4 4.2S1.6 8 1.6 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

/** Status — sam pierscien, bez wypelnienia i bez koloru wartosci. */
export function RingIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <circle cx="8" cy="8" r="5.4" />
    </svg>
  );
}

/** Priorytet — te same slupki co przy zadaniu, ale bez poziomu i bez koloru. */
export function BarsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      {[4, 7.5, 11].map((h, i) => (
        <rect key={i} x={2.4 + i * 4} y={13 - h} width="2.6" height={h} rx="0.9" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
/** Spinacz — zalacznik komentarza, ktory nie jest obrazkiem. */
export function ClipIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M10.8 5.2 6.1 9.9a1.7 1.7 0 0 0 2.4 2.4l4.7-4.7a3.2 3.2 0 0 0-4.5-4.5L3.9 8.0a4.7 4.7 0 0 0 6.6 6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

/**
 * Stabilny odcien (0-359) z nazwy. Jedna implementacja na cala aplikacje —
 * wczesniej ten sam kod stal w dwoch miejscach: raz w `tagHue`, raz wprost
 * w `Avatar`, przez co zmiana w jednym nie ruszala drugiego.
 */
function nameHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

/** Stabilny odcien z nazwy — ten sam tag ma zawsze ten sam kolor, w liscie i na tablicy. */
export function tagHue(name: string): string {
  return `hsl(${nameHash(name)} 52% 55%)`;
}

/*
 * Odcien OSOBY. Osobno od tagow, bo ludzie i etykiety to dwa niezalezne zbiory —
 * przesuniecie jednego nie ma prawa przemalowac drugiego.
 *
 * Obrot o 143 stopnie jest DOBRANY, nie przypadkowy: surowy hash sadzal czesc
 * zespolu w okolicach zolci i oliwki (Wojciech Szyper wypadal na 57 stopniach),
 * a te barwy na ciemnym tle czytaja sie jak ostrzezenie, nie jak czyjs kolor.
 * Po obrocie ta sama osoba ladauje na 200 stopniach, czyli w blekicie, a reszta
 * zespolu rozklada sie po zieleniach, fioletach i rozach.
 */
const PERSON_SHIFT = 143;

export function personHue(name: string): number {
  return (nameHash(name) + PERSON_SHIFT) % 360;
}

/**
 * Kolor LINII osoby na wykresie. Ten sam odcien co jej awatar, ale jasniejszy
 * i bardziej nasycony: awatar to ciemny krazek pod jasnymi inicjalami (42%/38%),
 * a kreska o tych parametrach ginie na ciemnym tle wykresu.
 */
export function personColor(name: string): string {
  return `hsl(${personHue(name)} 52% 55%)`;
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

  // Ten sam odcien, ktory dostaje linia tej osoby na wykresie — dzieki temu
  // twarz w legendzie i jej kreska to jeden kolor, bez sprawdzania w tabelce.
  const hash = personHue(name);

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

/** Zakladka — ikona zapisanych widokow w pasku. */
export function ViewsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path
        d="M4 2.5h8a1 1 0 0 1 1 1V13l-5-3-5 3V3.5a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
