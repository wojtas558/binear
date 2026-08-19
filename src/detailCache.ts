/*
 * Cache szczegolow zadania (opis, checklista, wspolwykonawcy…). Szczegoly ciagniemy
 * dopiero przy otwarciu zadania (`fetchTaskDetail`), wiec przy KAZDYM otwarciu byl
 * moment pustki. Trzymamy ostatnio ogladane w localStorage i przy ponownym otwarciu
 * pokazujemy je OD RAZU, a swieze dane dociagamy w tle i podmieniamy (stale-while-
 * revalidate). Id zadan sa globalne, wiec nie trzeba kluczowac po projekcie.
 */
import type { Comment, TaskDetail } from './bitrix';

/** Ile ostatnio otwartych zadan trzymamy — reszta wypada (LRU po czasie zapisu). */
const CAP = 80;

/*
 * Jeden lekki cache LRU per rodzaj danych (szczegoly, komentarze). Klucz = id zadania,
 * wartosc = dane + znacznik czasu ostatniego zapisu (do wyrzucania najstarszych).
 */
function makeCache<T>(storageKey: string) {
  type Entry = { value: T; ts: number };
  let store: Record<string, Entry> | null = null;

  const load = (): Record<string, Entry> => {
    if (store) return store;
    try {
      store = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, Entry>;
    } catch {
      store = {};
    }
    return store;
  };

  return {
    get(id: number): T | null {
      return load()[id]?.value ?? null;
    },
    set(id: number, value: T): void {
      const s = load();
      s[id] = { value, ts: Date.now() };

      const ids = Object.keys(s);
      if (ids.length > CAP) {
        ids
          .sort((a, b) => s[a].ts - s[b].ts)
          .slice(0, ids.length - CAP)
          .forEach((k) => delete s[k]);
      }

      try {
        localStorage.setItem(storageKey, JSON.stringify(s));
      } catch {
        // brak miejsca / tryb prywatny — cache po prostu nie przezyje odswiezenia
      }
    },
  };
}

const details = makeCache<TaskDetail>('binear.details.v1');
const comments = makeCache<Comment[]>('binear.comments.v1');

export const getCachedDetail = (id: number) => details.get(id);
export const setCachedDetail = (id: number, detail: TaskDetail) => details.set(id, detail);

/* Komentarze: istniejace sie NIE zmieniaja, dochodza tylko nowe — wiec cache jest
   bezpieczny; pokazujemy stare od razu, a swieze pobranie dokłada ewentualne nowe. */
export const getCachedComments = (id: number) => comments.get(id);
export const setCachedComments = (id: number, list: Comment[]) => comments.set(id, list);
