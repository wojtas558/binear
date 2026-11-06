/*
 * Hooki i drobne widoki pod kafelkami: odpowiedzi zgloszajacych (filtr „do analizy odpowiedzi"),
 * dzienna historia (strzalki „od wczoraj") i sama strzalka roznicy. Logika w `counters.ts`.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchChatTail, fetchTaskHistory, type ChatTail, type Sprint, type Task } from './bitrix';
import { carryOverCount } from './carryOver';
import {
  answerState,
  dayKey,
  DEFERRED_STATUS,
  hasReconMarker,
  hasTag,
  latestValue,
  loadHistory,
  previousDay,
  recordDay,
  saveHistory,
  TAG_CZEKA,
  TAG_DO_STARTU,
  TAG_PRZENIESIONE,
  type ChatFacts,
  type DaySnapshot,
  type TaskValue,
} from './counters';

/** Czaty dociagamy ponownie co tyle, nawet gdy lista sie nie zmienila. */
const ANSWERS_REFRESH_MS = 5 * 60_000;

/**
 * Fakty z czatow (patrz `readiness` i `latestValue` w counters.ts): dopisek rozpoznania w wiadomosci WYCENA
 * i najnowsza wiadomosc WARTOŚĆ — z niej komplet do startu, kwota oszczednosci (sortowanie, wiersz) i wyliczenie.
 *
 * Czytamy otwarte, nieodlozone zadania DO-STARTU i zadania trwajacego sprintu (`sprintId`), i tylko gdy cos
 * z tych faktow korzysta (`enabled`). `null`, dopoki pierwszy przebieg sie nie skonczy.
 *
 * Nieudany odczyt to „nie wiem", a nie „pusty czat": zadanie czytane juz wczesniej zachowuje stary wynik,
 * a nigdy nieprzeczytane zostaje nieznane (`complete: false`) — kafelki czekaja wtedy na „…", a zla liczba nie trafia do historii.
 */
export function useChatFacts(
  tasks: Task[],
  opts: { closed: ReadonlySet<string>; groupId: number | null; sprintId: number | null; enabled: boolean },
): { facts: ChatFacts | null; complete: boolean } {
  const { closed, groupId, sprintId, enabled } = opts;
  const [state, setState] = useState<{ group: number | null; facts: ChatFacts; read: ReadonlySet<number> } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ANSWERS_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const candidates = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !closed.has(t.status) &&
          t.status !== DEFERRED_STATUS &&
          (hasTag(t, TAG_DO_STARTU) || (sprintId !== null && t.sprintId === sprintId)),
      ),
    [tasks, closed, sprintId],
  );
  // Zadanie bez czatu nie ma czego przeczytac — to pusty czat (znany wynik), a nie „nie wiem".
  const toRead = useMemo(() => candidates.filter((t) => t.chatId !== null), [candidates]);
  const noChat = useMemo(() => candidates.filter((t) => t.chatId === null).map((t) => t.id), [candidates]);

  const key = useMemo(
    () =>
      `${groupId}#${tick}#` + candidates.map((t) => `${t.id}:${t.chatId}:${t.changedDate}:${t.newComments}`).join('|'),
    [candidates, groupId, tick],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const got = await Promise.allSettled(toRead.map((t) => fetchChatTail(t.chatId as number)));
      if (cancelled) return;
      setState((prev) => {
        const known = prev && prev.group === groupId ? prev : null;
        const recon = new Set<number>();
        const value = new Map<number, TaskValue>();
        const read = new Set<number>(noChat);
        for (const [i, r] of got.entries()) {
          const t = toRead[i];
          if (r.status === 'fulfilled') {
            read.add(t.id);
            if (hasReconMarker(r.value.messages)) recon.add(t.id);
            const v = latestValue(r.value.messages);
            if (v) value.set(t.id, v);
            continue;
          }
          // Nieudany odczyt: ostatni znany wynik tego zadania, a bez niego zadanie zostaje nieznane („…") —
          // jeden nieczytelny czat nie moze wstrzymac wyniku dla wszystkich.
          if (!known?.read.has(t.id)) continue;
          read.add(t.id);
          if (known.facts.recon.has(t.id)) recon.add(t.id);
          const v = known.facts.value.get(t.id);
          if (v) value.set(t.id, v);
        }
        return { group: groupId, facts: { recon, value, read }, read };
      });
    })().catch(() => {
      /* Czat nieczytelny — zostajemy przy ostatnim wyniku. */
    });
    return () => {
      cancelled = true;
    };
    // `candidates` i reszta sa w kluczu — efekt rusza tylko, gdy klucz sie zmieni.
  }, [key, enabled]);

  const facts = state && state.group === groupId ? state.facts : null;
  /*
   * `complete` = kazde zadanie, ktorego gotowosc rozstrzyga czat, ma juz znany wynik. Bez tego kafelek liczylby
   * zadanie z nieprzeczytanym czatem jako „nie pasuje" i zapisal zanizona liczbe do historii — wtedy pokazuje „…".
   */
  const complete = facts !== null && candidates.every((t) => facts.read.has(t.id));
  return { facts, complete };
}

/**
 * Zadania OCZEKUJE-NA-ODPOWIEDZ, w ktorych po naszych pytaniach odezwal sie ktos spoza IT.
 *
 * Ta sama regula co w przegladzie gotowosci z audytu: kotwica to ostatni komentarz
 * z pytaniami („[B]1.") napisany przez IT, odpowiedz to pozniejsza wiadomosc osoby
 * spoza IT. IT = konto webhooka, konta z BX_IT_USERS (np. automat wywiadow, ktory
 * siedzi w dziale spoza IT) i ludzie z dzialow BX_IT_DEPARTMENTS. Podzadanie bez
 * wlasnych pytan czyta czat rodzica — tag siedzi na podzadaniach, a pytania czesto
 * padly w zadaniu nadrzednym.
 *
 * `answered` jest `null`, dopoki pierwszy przebieg dla tego projektu sie nie skonczy. Kolejne
 * przebiegi zostawiaja poprzedni wynik na ekranie, zeby karta nie migala.
 *
 * Nieudany odczyt czatu to „nie wiem", a nie „bez odpowiedzi": zadanie znane z wczesniejszego przebiegu
 * zachowuje stary wynik, a nigdy nieprzeczytane zostaje nieznane — `complete: false`, kafelki pokazuja „…"
 * i nie zapisuja liczby do historii. Wczesniej taki czat liczyl sie po cichu jako „czeka na odpowiedz".
 */
export function useAnsweredTasks(
  tasks: Task[],
  opts: {
    closed: ReadonlySet<string>;
    itDepartments: number[];
    itUsers: number[];
    me: number | null;
    groupId: number | null;
    enabled: boolean;
  },
): { answered: ReadonlySet<number> | null; complete: boolean } {
  const { closed, itDepartments, itUsers, me, groupId, enabled } = opts;
  const [state, setState] = useState<{ group: number | null; answered: Set<number>; known: Set<number> } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ANSWERS_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const candidates = useMemo(
    // Odlozonych karta i tak nie liczy — nie czytamy ich czatow na darmo.
    () =>
      tasks.filter(
        (t) => !closed.has(t.status) && t.status !== DEFERRED_STATUS && hasTag(t, TAG_CZEKA),
      ),
    [tasks, closed],
  );

  /*
   * Klucz przebiegu: nowa wiadomosc w czacie podbija licznik nieprzeczytanych albo
   * date zmiany, wiec przeliczamy, gdy ktores z nich drgnie — a poza tym co 5 minut.
   */
  const key = useMemo(
    () =>
      `${groupId}#${tick}#${itDepartments.join(',')}#${itUsers.join(',')}#` +
      candidates.map((t) => `${t.id}:${t.chatId}:${t.changedDate}:${t.newComments}`).join('|'),
    [candidates, groupId, tick, itDepartments, itUsers],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const itDeps = new Set(itDepartments);
    const itIds = new Set(itUsers);

    (async () => {
      const tails = new Map<number, ChatTail>();
      const departments = new Map<number, number[]>();
      const load = async (chatIds: number[]) => {
        const fresh = [...new Set(chatIds)].filter((id) => !tails.has(id));
        const got = await Promise.allSettled(fresh.map((id) => fetchChatTail(id)));
        got.forEach((r, i) => {
          if (r.status !== 'fulfilled') return;
          tails.set(fresh[i], r.value);
          // Dzialy wszystkich autorow znane, zanim cokolwiek ocenimy.
          r.value.departments.forEach((v, k) => departments.set(k, v));
        });
      };
      const isIt = (id: number) =>
        id === me || itIds.has(id) || (departments.get(id) ?? []).some((d) => itDeps.has(d));
      // `null` = czat jest, ale nie dal sie przeczytac (nie wiadomo); brak czatu to po prostu brak pytan.
      const stateOf = (chatId: number | null) => {
        if (!chatId) return 'no-question' as const;
        const tail = tails.get(chatId);
        return tail ? answerState(tail.messages, isIt) : null;
      };

      await load(candidates.map((t) => t.chatId).filter((c): c is number => c !== null));

      const answered = new Set<number>();
      const unknown = new Set<number>();
      const viaParent: Task[] = [];
      for (const t of candidates) {
        const s = stateOf(t.chatId);
        if (s === null) unknown.add(t.id);
        else if (s === 'answered') answered.add(t.id);
        else if (s === 'no-question' && t.parentId) viaParent.push(t);
      }

      const parentChat = (t: Task) => byId.get(t.parentId as number)?.chatId ?? null;
      await load(viaParent.map(parentChat).filter((c): c is number => c !== null));
      for (const t of viaParent) {
        const s = stateOf(parentChat(t));
        if (s === null) unknown.add(t.id);
        else if (s === 'answered') answered.add(t.id);
      }

      if (cancelled) return;
      setState((prev) => {
        const before = prev && prev.group === groupId ? prev : null;
        const known = new Set<number>();
        for (const t of candidates) {
          if (!unknown.has(t.id)) {
            known.add(t.id);
            continue;
          }
          // Nieczytelny teraz, ale znany z poprzedniego przebiegu: zostaje stary wynik.
          if (!before?.known.has(t.id)) continue;
          known.add(t.id);
          if (before.answered.has(t.id)) answered.add(t.id);
        }
        return { group: groupId, answered, known };
      });
    })().catch(() => {
      /* Czat nieczytelny (brak zakresu `im`) — karta zostaje przy ostatnim wyniku. */
    });

    return () => {
      cancelled = true;
    };
    // `tasks` i reszta sa w kluczu — efekt ma ruszac tylko, gdy klucz sie zmieni.
  }, [key, enabled]);

  const current = state && state.group === groupId ? state : null;
  // Kandydat dopisany po ostatnim przebiegu tez jest jeszcze nieznany — do nastepnego przebiegu „…".
  const complete = current !== null && candidates.every((t) => current.known.has(t.id));
  return { answered: current ? current.answered : null, complete };
}

/**
 * Dzienna historia licznikow w przegladarce (binear.counters.v1, osobno per projekt)
 * i punkt odniesienia dla strzalek — ostatni zapisany dzien przed dzisiejszym.
 *
 * `snap` zawiera tylko wartosci PEWNE: karta, ktora jeszcze liczy (story pointy
 * w drodze, czaty w drodze), nie trafia do zapisu, zeby „zero w trakcie ladowania"
 * nie udawalo spadku.
 */
export function useCounterHistory(groupId: number | null, snap: DaySnapshot) {
  const today = dayKey(new Date());
  const [history, setHistory] = useState(() => (groupId ? loadHistory(groupId) : {}));
  const sig = JSON.stringify(snap);

  useEffect(() => {
    setHistory(groupId ? loadHistory(groupId) : {});
  }, [groupId]);

  useEffect(() => {
    if (!groupId || sig === '{}') return;
    setHistory((h) => {
      const next = recordDay(h, today, snap);
      saveHistory(groupId, next);
      return next;
    });
    // `snap` porownujemy po `sig` — nowy obiekt przy kazdym renderze nie jest zmiana.
  }, [groupId, sig, today]);

  return useMemo(() => previousDay(history, today), [history, today]);
}

function dayLabel(day: string, today: Date): string {
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (day === dayKey(y)) return 'wczoraj';
  const [, m, d] = day.split('-');
  return `${d}.${m}`;
}

/** Wzrost wiekszy niz to jest „goracy" (czerwony); do tej wartosci wlacznie — bursztynowy. */
const HOT_RISE = 10;

export function Delta({
  now,
  before,
  day,
  riseIsBad,
}: {
  now: number;
  before: number | undefined;
  day: string;
  riseIsBad: boolean;
}) {
  if (before === undefined) return <span className="counter-delta">—</span>;
  const diff = now - before;
  const when = dayLabel(day, new Date());
  /* Spadek zawsze zielony; wzrost bursztynowy do 10 wlacznie, powyzej czerwony. */
  const tone =
    diff === 0 || !riseIsBad
      ? ''
      : diff < 0
        ? ' counter-delta-down'
        : diff > HOT_RISE
          ? ' counter-delta-hot'
          : ' counter-delta-up';
  return (
    <span className={`counter-delta${tone}`} title={`${when}: ${before}`}>
      {diff === 0 ? '=' : diff > 0 ? `▲ ${diff}` : `▼ ${-diff}`}{' '}
      <span className="counter-delta-when">{when}</span>
    </span>
  );
}

/**
 * Ile razy zadania z tagiem PRZENIESIONE przeszly z poprzedniego sprintu (`carryOverCount`). Dziennik zmian
 * to jedno zapytanie na zadanie, wiec czytamy go tylko dla otwartych zadan z tym tagiem, a wynik trzymamy,
 * dopoki nie zamknie sie kolejny sprint. Brak wpisu = jeszcze nie wiadomo (pigulka bez „N×").
 */
export function useCarryOver(
  tasks: Task[],
  sprints: readonly Sprint[],
  closed: ReadonlySet<string>,
): ReadonlyMap<number, number> {
  const [counts, setCounts] = useState<{ key: string; map: Map<number, number> }>({ key: '', map: new Map() });
  const candidates = useMemo(
    () => tasks.filter((t) => !closed.has(t.status) && hasTag(t, TAG_PRZENIESIONE)).map((t) => t.id),
    [tasks, closed],
  );
  const closedSprints = sprints.filter((s) => s.status === 'completed').length;
  const sprintKey = `${closedSprints}`;

  useEffect(() => {
    const known = counts.key === sprintKey ? counts.map : new Map<number, number>();
    const missing = candidates.filter((id) => !known.has(id));
    if (!missing.length) return;
    let cancelled = false;
    void Promise.allSettled(missing.map((id) => fetchTaskHistory(id))).then((got) => {
      if (cancelled) return;
      setCounts((prev) => {
        const map = new Map(prev.key === sprintKey ? prev.map : []);
        got.forEach((r, i) => {
          if (r.status === 'fulfilled') map.set(missing[i], carryOverCount(r.value, sprints));
        });
        return { key: sprintKey, map };
      });
    });
    return () => {
      cancelled = true;
    };
    // `sprints` zmienia sie razem z `sprintKey` (liczba zamknietych) — to on wyznacza ponowne liczenie.
  }, [candidates, sprintKey]);

  return counts.key === sprintKey ? counts.map : new Map();
}
