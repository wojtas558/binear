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

/*
 * Suma story pointow — naglowek grupy, podgrupy i kolumny tablicy pokazuje ja
 * obok liczby zadan (patrz issue #2). `null` zamiast zera, gdy ZADNE zadanie w
 * kubelku nie ma oszacowania: "0 SP" klamie, bo sugeruje oszacowane na zero,
 * a nie nieoszacowane. Zadania bez pointow po prostu nie wchodza do sumy.
 */
export function sumPoints(tasks: { storyPoints: number | null }[]): number | null {
  let sum = 0;
  let any = false;
  for (const t of tasks) {
    if (t.storyPoints == null) continue;
    sum += t.storyPoints;
    any = true;
  }
  return any ? sum : null;
}

/**
 * „zadanie / zadania / zadan" — polska liczba mnoga. Wspolna, bo licznik zadan
 * stoi w kilku miejscach (naglowki grup, kolumny, wykresy), a odmiana recznie
 * w kazdym z nich rozjezdzala sie: „2 zadan" przy osobie na wykresie.
 */
export function tasksWord(n: number): string {
  if (n === 1) return 'zadanie';
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? 'zadania' : 'zadań';
}

/**
 * Etap zadania — ale TYLKO wtedy, gdy zadanie jest w sprincie.
 *
 * Wyjecie ze sprintu NIE czysci `STAGE_ID`. Sprawdzone na IT-890 (#116305):
 * `sprintId` jest `null`, a `stageId` dalej wskazuje 4711, czyli „Nowe /
 * Oczekujace" sprintu, do ktorego zadanie juz nie nalezy. Bez tego straznika
 * zadanie z rejestru pokazuje sie w kolumnie tamtego sprintu — w grupowaniu
 * listy, w sortowaniu po etapie, w kolorze wiersza i na tablicy.
 *
 * Czytamy to jako „etap nalezy do sprintu, nie do zadania": skoro sprintu nie
 * ma, to i etapu nie ma, niezaleznie od tego, co zostalo w polu.
 */
export function stageOf(t: { sprintId: number | null; stageId: number | null }): number | null {
  return t.sprintId ? t.stageId : null;
}

/** Kawalek tekstu z informacja, czy pasuje do szukanej frazy. */
export interface Kawalek {
  text: string;
  hit: boolean;
}

/**
 * Rozbija tekst na kawalki, zaznaczajac te pasujace do frazy — do podswietlenia
 * trafien w wynikach wyszukiwania.
 *
 * Czysta funkcja bez JSX, bo `<mark>` sklada juz kazdy widok u siebie: wiersz
 * listy i karta tablicy maja inna typografie, a wspolny ma byc PODZIAL, nie
 * znacznik. Dzieki temu daje sie tez wprost przetestowac.
 *
 * Szukamy przez `indexOf` na wersjach malymi literami, a nie wyrazeniem
 * regularnym: fraza pochodzi od uzytkownika i trafilaby tam jako kod (`.`, `(`,
 * `[` w tytule zadania to codziennosc).
 */
export function podzielNaTrafienia(text: string, fraza: string): Kawalek[] {
  const q = fraza.trim().toLowerCase();
  const calosc = [{ text, hit: false }];
  if (!q) return calosc;

  const hay = text.toLowerCase();
  /*
   * Zabezpieczenie: dla nielicznych znakow zmiana wielkosci zmienia DLUGOSC
   * (tureckie „İ" daje dwa znaki). Indeksy z `hay` rozjechalyby sie wtedy
   * wzgledem `text` i podswietlenie ucielo by tytul w losowym miejscu. Lepiej
   * nie podswietlic nic.
   */
  if (hay.length !== text.length) return calosc;

  const out: Kawalek[] = [];
  let i = 0;
  for (;;) {
    const at = hay.indexOf(q, i);
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  if (!out.length) return calosc;
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/**
 * Ile tagow pokazac, zanim reszta zwinie sie w „+N".
 *
 * Liczone z szerokosci POJEMNIKA, w ktorym stoi wiersz — nie z szerokosci okna.
 * Ta sama funkcja obsluguje liste (pelna szerokosc) i panele planowania, ktore
 * przy dwoch kolumnach maja polowe tego miejsca; bez tego panel dostawal limit
 * wyliczony dla listy i tagi nie miescily sie w wierszu.
 */
export function tagsForWidth(width: number): number {
  if (width >= 1500) return 6;
  if (width >= 1250) return 5;
  if (width >= 1000) return 4;
  if (width >= 820) return 3;
  if (width >= 640) return 2;
  if (width >= 480) return 1;
  /*
   * Ponizej 480 px NIE MA zadnego chipa — zostaje samo „+N". Dawniej dolna
   * granica wynosila 2 chipy i to one zjadaly caly wiersz: tytul, ktory ma
   * `flex-basis: 0`, dostawal wtedy zero miejsca i znikal calkowicie. Tytul
   * niesie tresc, tagi sa dopiskiem — przy ciasnocie ustepuja tagi.
   */
  return 0;
}

/*
 * BLAD na listach ma czerwone znaki przed tytulem, po jednym na zrodlo:
 *  - plomien — priorytet Bitriksa „wysoki" (`2`, ikona plomienia w Bitriksie),
 *  - robak — tag BUG.
 * Zadanie z obu na raz dostaje oba. Tag BUG nie jest wtedy pokazywany drugi raz jako etykieta (robak
 * go zastepuje). Kafelek „Bledy" liczy plomienie i tagi BUG razem, kazde zadanie raz (patrz `counters.ts`).
 */
export const isFlame = (t: { priority: string }): boolean => t.priority === '2';

export const hasBugTag = (t: { tags: string[] }): boolean => t.tags.some((g) => g.toUpperCase() === 'BUG');

/** Zadanie jest bledem: plomien Bitriksa albo tag BUG. */
export const isBug = (t: { priority: string; tags: string[] }): boolean => isFlame(t) || hasBugTag(t);

/** Tagi bez BUG — ten tag zastepuje robak przed tytulem, wiec drugi raz jako etykieta zbedny. */
export const withoutBugTag = (tags: string[]): string[] => tags.filter((g) => g.toUpperCase() !== 'BUG');
