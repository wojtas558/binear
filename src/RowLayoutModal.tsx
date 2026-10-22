import { useState } from 'react';
import { createPortal } from 'react-dom';

import {
  addLine,
  DEFAULT_ROW_LAYOUT,
  hiddenElements,
  MAX_LINES,
  moveElement,
  removeLine,
  REQUIRED,
  ROW_ELEMENTS,
  type RowElement,
  type RowLayout,
  type RowTarget,
  type RowZone,
} from './rowLayout';

const LABEL = new Map(ROW_ELEMENTS.map((e) => [e.id, e.label]));

/**
 * Konfigurator karty zadania na liscie: elementy przeciaga sie miedzy lewa i prawa strona
 * kazdej linii albo do „Ukrytych". Zmiana dziala od razu — lista pod spodem pokazuje efekt na zywo.
 */
export function RowLayoutModal({
  layout,
  onChange,
  onClose,
}: {
  layout: RowLayout;
  onChange: (next: RowLayout) => void;
  onClose: () => void;
}) {
  /* Strefa, nad ktora wisi przeciagany element — tylko do podswietlenia. */
  const [over, setOver] = useState<string | null>(null);

  const drop = (e: React.DragEvent, to: RowTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain') as RowElement;
    if (!LABEL.has(id)) return;
    onChange(moveElement(layout, id, to));
  };

  const chip = (id: RowElement, to: RowTarget) => (
    <span
      key={id}
      className={`rl-chip${REQUIRED.includes(id) ? ' rl-chip-req' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }}
      /* Upuszczenie NA elemencie wstawia przed nim — tak ustawia sie kolejnosc. */
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => drop(e, to)}
      title={REQUIRED.includes(id) ? 'Tytułu nie da się ukryć' : 'Przeciągnij'}
    >
      {LABEL.get(id)}
    </span>
  );

  const zone = (line: number, side: RowZone) => {
    const key = `${line}-${side}`;
    const items = layout.lines[line][side];
    return (
      <div
        className={`rl-zone rl-zone-${side}${over === key ? ' rl-zone-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(key);
        }}
        onDragLeave={() => setOver((o) => (o === key ? null : o))}
        onDrop={(e) => drop(e, { line, zone: side })}
      >
        {items.length === 0 && <span className="rl-empty">{side === 'left' ? 'lewa strona' : 'prawa strona'}</span>}
        {items.map((id, i) => chip(id, { line, zone: side, index: i }))}
      </div>
    );
  };

  const ukryte = hiddenElements(layout);

  return createPortal(
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="team-modal team-modal-wide rl-modal" role="dialog" aria-label="Karta zadania">
        <header className="team-head">
          <h2>Karta zadania na liście</h2>
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </header>
        <p className="rl-hint">
          Przeciągnij elementy między lewą i prawą stroną linii albo do ukrytych. Upuszczony na innym elemencie staje
          przed nim. Zmiany widać od razu na liście.
        </p>

        {layout.lines.map((_, line) => (
          <div key={line} className="rl-line">
            <span className="rl-line-nr">{line + 1}</span>
            {zone(line, 'left')}
            {zone(line, 'right')}
            <button
              className="btn rl-line-del"
              disabled={layout.lines.length <= 1}
              onClick={() => onChange(removeLine(layout, line))}
              title="Usuń linię — jej elementy trafią do ukrytych"
            >
              Usuń
            </button>
          </div>
        ))}

        <div className="rl-actions">
          <button className="btn" disabled={layout.lines.length >= MAX_LINES} onClick={() => onChange(addLine(layout))}>
            Dodaj linię
          </button>
          <button className="btn" onClick={() => onChange(DEFAULT_ROW_LAYOUT)}>
            Przywróć domyślny
          </button>
        </div>

        <div className="rl-pool-head">Ukryte</div>
        <div
          className={`rl-zone rl-pool${over === 'pool' ? ' rl-zone-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver('pool');
          }}
          onDragLeave={() => setOver((o) => (o === 'pool' ? null : o))}
          onDrop={(e) => drop(e, { line: null, zone: 'left' })}
        >
          {ukryte.length === 0 && <span className="rl-empty">przeciągnij tu, żeby ukryć</span>}
          {ukryte.map((id) => chip(id, { line: null, zone: 'left' }))}
        </div>
      </div>
    </>,
    document.body,
  );
}
