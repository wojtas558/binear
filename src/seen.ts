/*
 * Ktore zadania widzialem juz wczesniej — do oznaczania nowych.
 *
 * Bitrix ma wlasne `viewedDate`, ale nie nadaje sie tutaj: liczy otwarcia zadania
 * w INTERFEJSIE Bitriksa, a tam nikt nie klika po kolei wszystkiego. W grupie IT
 * SCRUM 47 z 50 zadan na pierwszej stronie nie ma tej daty w ogole, wiec badge
 * wisialby praktycznie na kazdym wierszu i nic by nie znaczyl.
 *
 * Dlatego trzymamy wlasna liste. "Nowe" znaczy wiec: pojawilo sie od Twojego
 * poprzedniego uruchomienia Binear — a nie "nowe w Bitriksie".
 *
 * Per projekt, bo kazdy ma inny zbior zadan i przelaczenie sie miedzy nimi nie
 * moze wyzerowac zadnego z nich.
 */

export const SEEN_KEY = 'binear.seen.v1';

type Store = Record<string, number[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** `null` = tego projektu jeszcze nie ogladalismy, wiec NIC nie jest nowe. */
export function loadSeen(groupId: number): Set<number> | null {
  const list = read()[String(groupId)];
  return Array.isArray(list) ? new Set(list.filter((n) => typeof n === 'number')) : null;
}

export function saveSeen(groupId: number, ids: number[]): void {
  try {
    const store = read();
    store[String(groupId)] = ids;
    localStorage.setItem(SEEN_KEY, JSON.stringify(store));
  } catch {
    // brak miejsca / tryb prywatny — przy nastepnym starcie nic nie bedzie nowe
  }
}
