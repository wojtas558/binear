/*
 * Wybrany projekt (grupa robocza Bitriksa).
 *
 * Osobny klucz, a nie pole w binear.view.v1, bo to nie jest ustawienie widoku:
 * zmiana projektu przeladowuje wszystkie dane, a nie przestawia to, co juz jest
 * na ekranie. Przy okazji stary zapis ustawien nie musi o niczym wiedziec.
 *
 * Brak zapisu znaczy "ten z .env" (BX_GROUP_ID). Dzieki temu pierwszy start
 * dziala bez zadnego wyboru, a konfiguracja serwera zostaje wartoscia domyslna,
 * a nie jednorazowa — zmiana BX_GROUP_ID nadal cos robi, dopoki nikt nie
 * przelaczyl projektu recznie.
 */

export const PROJECT_KEY = 'binear.project.v1';

export function loadProject(): number | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    // tryb prywatny — zostaje projekt z konfiguracji
    return null;
  }
}

export function saveProject(id: number): void {
  try {
    localStorage.setItem(PROJECT_KEY, String(id));
  } catch {
    // brak miejsca / tryb prywatny — wybor nie przezyje odswiezenia
  }
}
