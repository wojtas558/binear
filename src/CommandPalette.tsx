import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface Command {
  id: string;
  section: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

/** Paleta poleceń (Cmd/Ctrl+K) — jedno wejscie do nawigacji i akcji. */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 60);
    // Wszystkie slowa zapytania musza wystapic — pozwala pisac "sta zak" na "Status: Zakonczone".
    const words = q.split(/\s+/);
    return commands
      .filter((c) => {
        const hay = `${c.section} ${c.label} ${c.hint ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 60);
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, shown]);

  // Naglowki sekcji rysujemy tylko przy zmianie sekcji — lista zostaje plaska do nawigacji.
  let lastSection = '';

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="Paleta poleceń">
        <input
          className="palette-input"
          type="search"
          autoFocus
          value={query}
          placeholder="Szukaj zadania lub polecenia…"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => (shown.length ? (c + 1) % shown.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => (shown.length ? (c - 1 + shown.length) % shown.length : 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const cmd = shown[cursor];
              if (cmd) {
                onClose();
                cmd.run();
              }
            }
          }}
        />

        <div className="palette-list" ref={listRef}>
          {shown.length === 0 && <div className="picker-empty">Nic nie pasuje</div>}

          {shown.map((c, i) => {
            const header = c.section !== lastSection ? c.section : null;
            lastSection = c.section;
            return (
              <div key={c.id}>
                {header && <div className="palette-section">{header}</div>}
                <button
                  className={`palette-item${i === cursor ? ' palette-item-active' : ''}`}
                  data-active={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    onClose();
                    c.run();
                  }}
                >
                  {c.icon}
                  <span className="palette-label">{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="palette-foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> wybór · <kbd>Enter</kbd> wykonaj · <kbd>Esc</kbd> zamknij
        </div>
      </div>
    </>
  );
}
