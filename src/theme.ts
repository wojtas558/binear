/*
 * Motyw. Trzy stany: 'system' (idzie za ustawieniem OS), 'light', 'dark'.
 *
 * Klucz jest OSOBNY od SETTINGS_KEY i trzyma goly string, bo czyta go rowniez
 * maly skrypt w <head> (index.html), jeszcze przed startem Reacta — inaczej przy
 * jasnym motywie mignelaby na moment ciemna strona. Goly string oszczedza tam
 * parsowania JSON-a i uniezaleznia od wersji ustawien widoku.
 *
 * Do CSS trafia zawsze ROZSTRZYGNIETA wartosc ('dark' albo 'light') w atrybucie
 * data-theme na <html>. Dzieki temu arkusz ma jeden zestaw tokenow domyslnych
 * i jedna nadpiske, zamiast tych samych kolorow w dwoch miejscach (raz pod
 * media query, raz pod atrybutem).
 */

/**
 * Konkretna paleta. Identyfikator = selektor `[data-theme='...']` w styles.css,
 * wiec dolozenie motywu to blok w arkuszu + pozycja na tej liscie.
 * 'dark' i 'light' to palety domyslne — 'dark' siedzi w samym :root.
 */
export type Palette =
  | 'dark'
  | 'light'
  | 'tokyo-night'
  | 'argonaut'
  | 'solarized-dark'
  | 'everforest'
  | 'nord'
  | 'gruvbox'
  | 'bitrix'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'solarized-light';

export type Theme = 'system' | Palette;

export const THEME_KEY = 'binear.theme.v1';

/**
 * Kolejnosc jak w menu. `section` rozdziela ciemne od jasnych — bez tego lista
 * jest jednym ciagiem nazw, po ktorym nie widac, w co sie wlasnie klika.
 */
export const THEMES: { value: Theme; label: string; section?: string }[] = [
  { value: 'system', label: 'Systemowy' },

  // Kolejnosc od najciemniejszego tla do najjasniejszego — sasiedzi na liscie
  // maja byc realnie rozne, a nie kolejnym odcieniem tego samego granatu.
  { value: 'dark', label: 'Ciemny', section: 'Ciemne' },
  { value: 'tokyo-night', label: 'Tokyo Night', section: 'Ciemne' },
  { value: 'gruvbox', label: 'Gruvbox', section: 'Ciemne' },
  { value: 'solarized-dark', label: 'Solarized Dark', section: 'Ciemne' },
  { value: 'argonaut', label: 'Argonaut', section: 'Ciemne' },
  { value: 'everforest', label: 'Everforest', section: 'Ciemne' },
  { value: 'nord', label: 'Nord', section: 'Ciemne' },

  { value: 'light', label: 'Jasny', section: 'Jasne' },
  // Kolory wprost z portalu — do pracy z Bitriksem otwartym w sasiedniej karcie.
  { value: 'bitrix', label: 'Bitrix24', section: 'Jasne' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', section: 'Jasne' },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn', section: 'Jasne' },
  { value: 'solarized-light', label: 'Solarized Light', section: 'Jasne' },
];

const IDS = new Set<string>(THEMES.map((t) => t.value));

const lightQuery = () => window.matchMedia('(prefers-color-scheme: light)');

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    // Nieznana nazwa (np. po usunieciu motywu) ma wrocic do 'system', nie wywalic apki.
    if (raw !== null && IDS.has(raw)) return raw as Theme;
  } catch {
    // tryb prywatny — zostaje domyslny
  }
  return 'system';
}

/** Ustawia data-theme na wartosc rozstrzygnieta, ale zapamietuje sam WYBOR. */
export function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? (lightQuery().matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // brak miejsca / tryb prywatny — motyw nie przezyje odswiezenia
  }
}

/**
 * Przy 'system' motyw musi reagowac na zmiane ustawienia OS w trakcie dzialania
 * — Windows potrafi przelaczyc sie sam o zachodzie slonca. Zwraca funkcje
 * odpinajaca nasluch; przy wyborze recznym nie ma czego sluchac.
 */
export function watchSystemTheme(theme: Theme, onChange: () => void): () => void {
  if (theme !== 'system') return () => {};
  const mq = lightQuery();
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
