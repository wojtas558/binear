/*
 * Krój pisma. Ta sama konstrukcja co motyw (theme.ts): wybor ladzie jako
 * `data-font` na <html>, a arkusz podmienia pod tym token `--font-ui`.
 *
 * Inter i kroje "do testow" sa hostowane lokalnie (@fontsource, patrz main.tsx) —
 * jako ZMIENNE, wiec pogrubienie dziala zawsze. Cascadia i Monocraft bierzemy
 * z systemu; brak konczy stos na zwyklym monospace i aplikacja dalej dziala.
 */

export type Font = 'sora' | 'inter' | 'fira-code' | 'monocraft';

export const FONT_KEY = 'binear.font.v1';

export const FONTS: { value: Font; label: string; hint?: string }[] = [
  { value: 'sora', label: 'Sora', hint: 'domyślny' },
  { value: 'inter', label: 'Inter' },
  { value: 'fira-code', label: 'Fira Code', hint: 'mono' },
  { value: 'monocraft', label: 'Monocraft', hint: 'pikselowy' },
];

const IDS = new Set<string>(FONTS.map((f) => f.value));

export function loadFont(): Font {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (raw !== null && IDS.has(raw)) return raw as Font;
  } catch {
    // tryb prywatny — zostaje domyslny
  }
  return 'sora';
}

export function applyFont(font: Font): void {
  document.documentElement.dataset.font = font;
  try {
    localStorage.setItem(FONT_KEY, font);
  } catch {
    // brak miejsca / tryb prywatny — wybor nie przezyje odswiezenia
  }
}
