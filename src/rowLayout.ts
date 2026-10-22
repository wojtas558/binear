/*
 * Uklad wiersza zadania na liscie — konfigurator karty.
 *
 * Wiersz to jedna albo kilka LINII, a kazda linia ma strefe lewa i prawa. Elementy ustawia sie
 * przeciaganiem w konfiguratorze (RowLayoutModal): co po lewej, co po prawej, w jakiej kolejnosci
 * i w ktorej linii. Element, ktorego nie ma w zadnej linii, jest ukryty.
 *
 * Stale zostaja: zaznaczenie (checkbox), znak waznosci, przycisk podzadan, etap/status i numer
 * zadania — stoja przed pierwsza linia w jednej kolumnie we wszystkich wierszach, a kolejne linie
 * zaczynaja sie dopiero za numerem, pod tytulem.
 *
 * Sama logika, bez Reacta — da sie ja sprawdzic testami (rowLayout.test.ts).
 */

export type RowElement =
  | 'parent'
  | 'title'
  | 'epic'
  | 'matrix'
  | 'tags'
  | 'subs'
  | 'related'
  | 'new'
  | 'comments'
  | 'points'
  | 'deadline'
  | 'more'
  | 'avatar';

export const ROW_ELEMENTS: { id: RowElement; label: string }[] = [
  { id: 'parent', label: 'Zadanie nadrzędne' },
  { id: 'title', label: 'Tytuł' },
  { id: 'epic', label: 'Epik' },
  { id: 'matrix', label: 'Priorytet A–D' },
  { id: 'tags', label: 'Tagi' },
  { id: 'subs', label: 'Podzadania poza grupą' },
  { id: 'related', label: 'Powiązane' },
  { id: 'new', label: 'Nowe' },
  { id: 'comments', label: 'Komentarze' },
  { id: 'points', label: 'Story points' },
  { id: 'deadline', label: 'Termin / data zmiany' },
  { id: 'more', label: 'Menu akcji' },
  { id: 'avatar', label: 'Osoba odpowiedzialna' },
];

const ZNANE = new Set<string>(ROW_ELEMENTS.map((e) => e.id));

export type RowZone = 'left' | 'right';

export interface RowLine {
  left: RowElement[];
  right: RowElement[];
}

export interface RowLayout {
  lines: RowLine[];
}

/** Najwiecej linii w wierszu — wiecej robi z listy sciane i nikt tego nie przeczyta. */
export const MAX_LINES = 4;

/** Uklad sprzed konfiguratora: wszystko w jednej linii, data, menu i osoba po prawej. */
export const DEFAULT_ROW_LAYOUT: RowLayout = {
  lines: [
    {
      left: ['parent', 'title', 'epic', 'matrix', 'tags', 'subs', 'related', 'new', 'comments'],
      right: ['points', 'deadline', 'more', 'avatar'],
    },
  ],
};

/** Elementy, ktorych nie da sie ukryc — wiersz bez tytulu nie mowi, czego dotyczy. */
export const REQUIRED: readonly RowElement[] = ['title'];

/**
 * Porzadkuje uklad z przegladarki: odrzuca nieznane i powtorzone elementy, przycina liczbe
 * linii, a tytul — jesli zniknal — dokleja na koniec lewej strony pierwszej linii.
 * Puste linie zostaja (uzytkownik moze je wlasnie wypelniac), ale co najmniej jedna musi byc.
 */
export function normalizeRowLayout(saved: unknown): RowLayout {
  const lines = (saved as RowLayout | undefined)?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return DEFAULT_ROW_LAYOUT;
  const seen = new Set<RowElement>();
  const clean = (xs: unknown): RowElement[] =>
    (Array.isArray(xs) ? xs : []).filter((x): x is RowElement => {
      if (typeof x !== 'string' || !ZNANE.has(x) || seen.has(x as RowElement)) return false;
      seen.add(x as RowElement);
      return true;
    });
  const out: RowLine[] = lines.slice(0, MAX_LINES).map((l) => ({ left: clean(l?.left), right: clean(l?.right) }));
  for (const req of REQUIRED) if (!seen.has(req)) out[0].left.push(req);
  return { lines: out };
}

/** Elementy, ktorych nie ma w zadnej linii — w konfiguratorze lezą w puli „Ukryte". */
export function hiddenElements(layout: RowLayout): RowElement[] {
  const placed = new Set(layout.lines.flatMap((l) => [...l.left, ...l.right]));
  return ROW_ELEMENTS.map((e) => e.id).filter((id) => !placed.has(id));
}

/** Gdzie ma trafic element: linia i strona, albo pula ukrytych (`line: null`). */
export interface RowTarget {
  line: number | null;
  zone: RowZone;
  /** Pozycja w strefie; brak = na koniec. */
  index?: number;
}

/**
 * Przenosi element. Wymaganego nie da sie wrzucic do ukrytych — wtedy uklad zostaje bez zmian.
 */
export function moveElement(layout: RowLayout, el: RowElement, to: RowTarget): RowLayout {
  if (to.line === null && REQUIRED.includes(el)) return layout;
  const lines = layout.lines.map((l) => ({
    left: l.left.filter((x) => x !== el),
    right: l.right.filter((x) => x !== el),
  }));
  if (to.line !== null) {
    const zone = lines[to.line]?.[to.zone];
    if (!zone) return layout;
    const at = to.index === undefined ? zone.length : Math.max(0, Math.min(to.index, zone.length));
    zone.splice(at, 0, el);
  }
  return { lines };
}

export function addLine(layout: RowLayout): RowLayout {
  if (layout.lines.length >= MAX_LINES) return layout;
  return { lines: [...layout.lines, { left: [], right: [] }] };
}

/** Usuwa linie; jej elementy ida do ukrytych, a wymagane — na koniec lewej strony pierwszej linii. */
export function removeLine(layout: RowLayout, index: number): RowLayout {
  if (layout.lines.length <= 1 || !layout.lines[index]) return layout;
  const removed = layout.lines[index];
  const lines = layout.lines.filter((_, i) => i !== index).map((l) => ({ left: [...l.left], right: [...l.right] }));
  for (const req of REQUIRED) if ([...removed.left, ...removed.right].includes(req)) lines[0].left.push(req);
  return { lines };
}
