/*
 * „Akcje" w czacie zadania — wpisy, ktore Bitrix pisze sam (author_id 0): „zmienil termin",
 * „jest teraz obserwatorem", „rozpoczal zadanie". Domyslnie ukryte, bo jest ich wielokrotnie
 * wiecej niz komentarzy; przelacznik nad watkiem je pokazuje. Wybor pamieta ta przegladarka.
 *
 * Gdy sa ukryte, nie licza sie tez do znaczka nieprzeczytanych przy zadaniu — licznik Bitriksa
 * (`newCommentsCount`) liczy je razem z komentarzami (patrz `unreadWithoutActions`).
 */

import { createContext, useContext, useSyncExternalStore } from 'react';

const KEY = 'binear.chatActions.v1';

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let current = read();

export function setShowActions(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // tryb prywatny — wybor zyje do zamkniecia karty
  }
  listeners.forEach((l) => l());
}

/** Czy akcje sa widoczne — wspolne dla watku i znaczkow na liscie i tablicy. */
export function useShowActions(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

const FULL_DATE = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });

/**
 * Tresc akcji bez BBCode: osoba z `[USER=id]` jako sama nazwa (pierwsza osobno — to wykonawca),
 * `[URL]` jako jego tekst, `[TIMESTAMP=… FORMAT=…]` jako data albo godzina.
 */
/*
 * Bitrix pisze czesc akcji w jezyku, ktory mial wykonawca w chwili akcji — u nas zdarzaja sie
 * angielskie wpisy („changed assignee to", „deactivated time tracking") miedzy polskimi. Tlumaczymy
 * je na brzmienie, jakiego Bitrix uzywa po polsku. Lista zebrana z czatow zadan portalu (pazdziernik
 * 2026); angielski wpis w binear znaczy, ze Bitrix dorzucil nowy zwrot i trzeba go tu dopisac.
 */
const PO_POLSKU: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\bchanged assignee to\b/gi, 'zmienił odpowiedzialnego na'],
  [/\badded observers:/gi, 'dodał obserwatorów'],
  [/\badded observer:/gi, 'dodał obserwatora:'],
  [/\badded participants:/gi, 'dodał uczestników'],
  [/\badded participant:/gi, 'dodał uczestnika:'],
  [/\bchanged stage to "([^"]*)"/gi, (_, etap: string) => `zmienił etap na „${etap}”`],
  [/\bcompleted the task and submitted it for review\b/gi, 'zakończył zadanie i przesłał je do sprawdzenia'],
  [/, the task is almost overdue\. Deadline:/gi, ', termin zadania wkrótce minie. Termin:'],
  [/, the task is overdue since\b/gi, ', termin zadania minął'],
  [/\bComplete the task ASAP, or change the deadline\./gi, 'Zakończ zadanie jak najszybciej lub zmień termin.'],
  [/\bdeactivated time tracking\b/gi, 'wyłączył śledzenie czasu'],
  [/\bactivated time tracking\b/gi, 'włączył śledzenie czasu'],
  [/\bTotal task duration:/gi, 'Łączny czas trwania zadania:'],
  /* Jednostki tylko po „Duration:" — nigdzie indziej „hour" nie powinno sie zmieniac. */
  [/\bDuration:([\s\S]*)$/, (_, reszta: string) => `Czas trwania:${jednostki(reszta)}`],
];

/* Odmiana po liczbie: 1 godzina, 2–4 godziny (bez 12–14), reszta godzin. */
const FORMY: Record<string, [string, string, string]> = {
  hour: ['godzina', 'godziny', 'godzin'],
  minute: ['minuta', 'minuty', 'minut'],
  second: ['sekunda', 'sekundy', 'sekund'],
};

const odmiana = (n: number, [jedna, kilka, wiele]: [string, string, string]) => {
  if (n === 1) return jedna;
  const r10 = n % 10;
  const r100 = n % 100;
  return r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? kilka : wiele;
};

const jednostki = (s: string) =>
  s.replace(/\b(\d+) (hour|minute|second)s?\b/gi, (_, n: string, j: string) => `${n} ${odmiana(Number(n), FORMY[j.toLowerCase()])}`);

function poPolsku(s: string): string {
  return PO_POLSKU.reduce((acc, [re, pl]) => acc.replace(re, pl as string), s);
}

/*
 * Wykonawca na poczatku wpisu. Czesc wpisow Bitrix zaczyna od „Użytkownik [USER=…]" (np. zmiana
 * odpowiedzialnego) — bez tego slowa w wzorcu taka linia nie miala awatara ani pogrubionej osoby.
 */
const WYKONAWCA = /^\s*(?:Użytkownik\s+)?\[USER=(\d+)\]([\s\S]*?)\[\/USER\]\s*/i;

/** Id osoby, ktora wykonala akcje — `null`, gdy wpis nie zaczyna sie od osoby. */
export function actorId(raw: string): number | null {
  return Number(WYKONAWCA.exec(raw)?.[1]) || null;
}

export function actionText(raw: string): { actor: string | null; text: string } {
  /* Tlumaczenie PO zdjeciu BBCode — `[URL]` potrafi rozciac zwrot („[URL=…]Complete the task[/URL] ASAP"). */
  const plain = (s: string) =>
    poPolsku(
        s
        .replace(/\[TIMESTAMP=(\d+)(?:\s+FORMAT=(\w+))?\]/gi, (_, ts: string, fmt?: string) => {
          const d = new Date(Number(ts) * 1000);
          if (Number.isNaN(d.getTime())) return '';
          return /TIME/i.test(fmt ?? '') ? TIME.format(d) : FULL_DATE.format(d);
        })
        .replace(/\[USER=\d+\]([\s\S]*?)\[\/USER\]/gi, '$1')
        .replace(/\[URL=[^\]]*\]([\s\S]*?)\[\/URL\]/gi, '$1')
        .replace(/\[\/?[A-Z]+(?:=[^\]]*)?\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  const m = WYKONAWCA.exec(raw);
  if (!m) return { actor: null, text: plain(raw) };
  return { actor: m[2].trim(), text: plain(raw.slice(m[0].length)) };
}

export interface ChatLine {
  id: number;
  authorId: number;
  text: string;
}

/**
 * Ile z `total` nieprzeczytanych (licznik Bitriksa) to komentarze, a nie akcje.
 *
 * Bitrix nie mowi, KTORE wiadomosci sa nieprzeczytane, tylko ile. Liczy wszystko od Twojego ostatniego
 * czytania poza tym, co zrobiles sam — Twoje komentarze i akcje opisujace Ciebie („[USER=me]… zmienil
 * etap"). Idziemy wiec od najnowszej wiadomosci wstecz, zbieramy `total` takich, ktore Bitrix liczy,
 * i z nich zostawiamy komentarze. `null`, gdy w pobranej koncowce nie uzbieralo sie `total` — wtedy
 * zostaje licznik Bitriksa.
 */
export function unreadWithoutActions(lines: readonly ChatLine[], total: number, me: number | null): number | null {
  if (total <= 0) return 0;
  let counted = 0;
  let comments = 0;
  for (const l of [...lines].sort((a, b) => b.id - a.id)) {
    if (me !== null && l.authorId === me) continue;
    if (l.authorId === 0 && me !== null && actorId(l.text) === me) continue;
    counted++;
    if (l.authorId !== 0) comments++;
    if (counted === total) return comments;
  }
  return null;
}

/** Ikona akcji: pierscien etapu (po nazwie kolumny) albo statusu Bitriksa. Inne akcje ikony nie maja. */
export type ActionIcon = { kind: 'stage'; name: string } | { kind: 'status'; status: string };

/*
 * Zwroty po polsku, juz bez BBCode (`actionText`). Koncowki „-ł/-ła" — Bitrix odmienia przez plec.
 * Numery statusow jak w STATUS_VISUAL (icons.tsx): 3 W toku, 4 Czeka na kontrole, 5 Zakonczone, 6 Odlozone.
 */
const STATUS_AKCJI: [RegExp, string][] = [
  [/^zakończył\w* zadanie i przesłał/i, '4'],
  [/^(rozpoczął|rozpoczęła|wznowił\w*) /i, '3'],
  [/^(ukończył\w*|zatwierdził\w* wynik)/i, '5'],
  [/^odłożył\w* /i, '6'],
];

export function actionIcon(text: string): ActionIcon | null {
  const etap = /^zmienił\w* etap na [„"]([^”"]+)[”"]/i.exec(text);
  if (etap) return { kind: 'stage', name: etap[1] };
  const status = STATUS_AKCJI.find(([re]) => re.test(text));
  return status ? { kind: 'status', status: status[1] } : null;
}

/** Nazwa etapu -> kolor i postep pierscienia — do ikon akcji „zmienil etap na …". */
export const ActionStagesCtx = createContext<ReadonlyMap<string, { color: string | null; progress: number | null }>>(
  new Map(),
);

/** Nieprzeczytane bez akcji, per zadanie — liczone w App po wczytaniu listy. */
export const UnreadWithoutActionsCtx = createContext<ReadonlyMap<number, number>>(new Map());

/**
 * Liczba na znaczku nieprzeczytanych: bez akcji, gdy sa ukryte i wiemy, ile ich bylo.
 *
 * Nigdy wiecej niz licznik Bitriksa: przeliczenie przychodzi chwile po zmianie licznika
 * i do tego czasu mapa trzyma liczbe z poprzedniego stanu.
 */
export function useUnread(task: { id: number; newComments: number }): number {
  const show = useShowActions();
  const adjusted = useContext(UnreadWithoutActionsCtx);
  if (show || task.newComments === 0) return task.newComments;
  return Math.min(adjusted.get(task.id) ?? task.newComments, task.newComments);
}
