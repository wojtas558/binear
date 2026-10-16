import { useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import {
  addGroup,
  addTile,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  ensureLooseGroup,
  exportConfig,
  importConfig,
  isHexColor,
  moveGroup,
  moveTile,
  moveToGroup,
  newId,
  removeGroup,
  removeTile,
  renameGroup,
  setGroupCaption,
  TILE_COLORS,
  TILE_ICON_KEYS,
  updateTile,
  type CustomTile,
  type TileCondition,
  type TileGroup,
  type TileMeasure,
  type TileScope,
  type TilesConfig,
} from './customTiles';
import { PlusIcon } from './tileIcons';
import { TILE_ICON_NODES, tileColorCss } from './TilesBar';

/** Widok z listy (zakres, filtry, przelaczniki) — to, co zapisuje sie w kafelku. */
export interface TileView {
  scope: TileScope;
  filters: TileCondition[];
  onlyMine: boolean;
  showDone: boolean;
}

const SCOPE_LABEL: Record<TileScope, string> = { sprint: 'aktywny sprint', outside: 'poza sprintem', all: 'wszystkie' };

const describeView = (v: TileView): string => {
  const n = v.filters.filter((c) => c.values.length).length;
  return [
    `zakres: ${SCOPE_LABEL[v.scope]}`,
    `${n} ${n === 1 ? 'filtr' : 'filtrów'}`,
    v.onlyMine ? 'tylko moje' : null,
    v.showDone ? 'z zakończonymi' : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

function Swatches({ value, onPick }: { value: string; onPick: (k: string) => void }) {
  return (
    <span className="tile-swatches">
      {Object.entries(TILE_COLORS).map(([k, c]) => (
        <button
          key={k}
          type="button"
          className={`tile-swatch${value === k ? ' tile-swatch-on' : ''}`}
          style={{ background: c.css }}
          title={c.label}
          aria-label={c.label}
          aria-pressed={value === k}
          onClick={() => onPick(k)}
        />
      ))}
      {/* Dowolny kolor: pelny picker przegladarki; wybrany kolor zapisuje sie jako #rrggbb. */}
      <label className={`tile-swatch tile-swatch-custom${isHexColor(value) ? ' tile-swatch-on' : ''}`} title="Własny kolor">
        <input
          type="color"
          value={isHexColor(value) ? value : '#58a6ff'}
          aria-label="Własny kolor"
          onChange={(e) => onPick(e.target.value)}
        />
      </label>
    </span>
  );
}

function Icons({ value, onPick }: { value: string; onPick: (k: string) => void }) {
  return (
    <span className="tile-icons">
      {TILE_ICON_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`tile-icon-btn${value === k ? ' tile-icon-on' : ''}`}
          title={k}
          aria-label={`Ikona ${k}`}
          aria-pressed={value === k}
          onClick={() => onPick(k)}
        >
          {TILE_ICON_NODES[k]}
        </button>
      ))}
    </span>
  );
}

/**
 * Zarzadzanie wlasnymi kafelkami: nowy kafelek z biezacego widoku, nazwy, kolory, ikony, grupy,
 * kolejnosc, zestaw „proces IT", eksport i import pliku JSON (dzieki temu dzial moze wyslac swoj zestaw).
 */
const LOOSE = '__loose';

/** Co jest zaznaczone w pasku kafelkow: kafelek, grupa albo formularz nowego kafelka. */
type Sel = { k: 'tile'; id: string } | { k: 'group'; id: string } | { k: 'new' } | null;

export function TilesModal({
  cfg,
  current,
  startNew,
  onChange,
  onClose,
}: {
  cfg: TilesConfig;
  /** Widok na liscie w tej chwili — z niego powstaje nowy kafelek albo nim zastepujemy stary. */
  current: TileView;
  /** Otwarte przyciskiem „＋ Kafelek": od razu formularz nowego kafelka. */
  startNew: boolean;
  onChange: (next: TilesConfig) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Sel>(startNew ? { k: 'new' } : null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [measure, setMeasure] = useState<TileMeasure>('count');
  const [groupId, setGroupId] = useState(cfg.groups[0]?.id ?? '');
  const [newGroup, setNewGroup] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = () => {
    if (!name.trim()) return;
    let next = cfg;
    let g = groupId;
    if (groupId === LOOSE && !newGroup.trim()) {
      const loose = ensureLooseGroup(next);
      next = loose.cfg;
      g = loose.id;
    } else if (newGroup.trim() || !cfg.groups.length) {
      next = addGroup(next, newGroup.trim() || 'Moje kafelki');
      g = next.groups[next.groups.length - 1].id;
    }
    const id = newId('t');
    next = addTile(next, { id, name: name.trim().slice(0, 40), ...current, measure, color, icon, group: g });
    onChange(next);
    setName('');
    setNewGroup('');
    setSel({ k: 'tile', id });
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportConfig(cfg)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'binear-kafelki.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const merged = importConfig(await file.text(), cfg);
    if (!merged) return setImportMsg('To nie jest plik kafelków binear albo nie ma w nim kafelków.');
    onChange(merged);
    setImportMsg(`Zaimportowano ${merged.tiles.length - cfg.tiles.length} kafelków.`);
  };

  const selTile = sel?.k === 'tile' ? cfg.tiles.find((t) => t.id === sel.id) : undefined;
  const selGroup = sel?.k === 'group' ? cfg.groups.find((g) => g.id === sel.id) : undefined;

  const newForm = (
    <section className="tile-new">
            <h3>Nowy kafelek z bieżącego widoku</h3>
            <p className="team-hint">{describeView(current)}</p>
            <input
              className="tile-row-name"
              placeholder="Nazwa kafelka"
              value={name}
              maxLength={40}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <Swatches value={color} onPick={setColor} />
            <Icons value={icon} onPick={setIcon} />
            <label className="team-add">
              <span>Liczy</span>
              <select value={measure} onChange={(e) => setMeasure(e.target.value as TileMeasure)}>
                <option value="count">liczbę zadań</option>
                <option value="points">sumę SP</option>
              </select>
            </label>
            <label className="team-add">
              <span>Grupa</span>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {cfg.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                {!cfg.groups.length && <option value="">Moje kafelki (nowa grupa)</option>}
                <option value={LOOSE}>Bez grupy (bez podpisu i sumy)</option>
              </select>
              <input
                placeholder={cfg.groups.length ? 'albo nowa grupa' : 'nazwa grupy (opcjonalnie)'}
                value={newGroup}
                maxLength={40}
                onChange={(e) => setNewGroup(e.target.value)}
              />
            </label>
            <span className="tile-new-actions">
              <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>
                Dodaj kafelek
              </button>
              <button className="btn" onClick={() => setSel(null)}>
                Anuluj
              </button>
            </span>
          </section>
  );

  const tileEditor = (t: CustomTile) => (
    <section className="tile-new tile-edit">
      <header className="tile-edit-head">
        <h3>Kafelek</h3>
        <button className="btn" onClick={() => onChange(moveTile(cfg, t.id, -1))} title="Przesuń w lewo" aria-label="Przesuń w lewo">
          ←
        </button>
        <button className="btn" onClick={() => onChange(moveTile(cfg, t.id, 1))} title="Przesuń w prawo" aria-label="Przesuń w prawo">
          →
        </button>
        <button
          className="btn"
          onClick={() => {
            onChange(removeTile(cfg, t.id));
            setSel(null);
          }}
          title="Usuń kafelek"
        >
          Usuń
        </button>
      </header>
      <input
        className="tile-row-name"
        value={t.name}
        maxLength={40}
        aria-label="Nazwa kafelka"
        onChange={(e) => onChange(updateTile(cfg, t.id, { name: e.target.value }))}
        onBlur={(e) => !e.target.value.trim() && onChange(updateTile(cfg, t.id, { name: 'Kafelek' }))}
      />
      <Swatches value={t.color} onPick={(k) => onChange(updateTile(cfg, t.id, { color: k }))} />
      <Icons value={t.icon} onPick={(k) => onChange(updateTile(cfg, t.id, { icon: k }))} />
      <label className="team-add">
        <span>Liczy</span>
        <select
          value={t.measure}
          onChange={(e) => onChange(updateTile(cfg, t.id, { measure: e.target.value as TileMeasure }))}
        >
          <option value="count">liczbę zadań</option>
          <option value="points">sumę SP</option>
        </select>
      </label>
      <label className="team-add">
        <span>Grupa</span>
        <select value={t.group} onChange={(e) => onChange(moveToGroup(cfg, t.id, e.target.value))}>
          {cfg.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <p className="team-hint">Filtry kafelka: {describeView(t)}</p>
      <span className="tile-new-actions">
        <button
          className="btn"
          onClick={() => onChange(updateTile(cfg, t.id, { ...current }))}
          title={`Zastąp filtry kafelka bieżącym widokiem (${describeView(current)})`}
        >
          Użyj bieżącego widoku
        </button>
      </span>
    </section>
  );

  const groupEditor = (g: TileGroup) => (
    <section className="tile-new tile-edit">
      <header className="tile-edit-head">
        <h3>Grupa</h3>
        <button className="btn" onClick={() => onChange(moveGroup(cfg, g.id, -1))} title="Przesuń w lewo" aria-label="Przesuń w lewo">
          ←
        </button>
        <button className="btn" onClick={() => onChange(moveGroup(cfg, g.id, 1))} title="Przesuń w prawo" aria-label="Przesuń w prawo">
          →
        </button>
        <button
          className="btn"
          onClick={() => {
            onChange(removeGroup(cfg, g.id));
            setSel(null);
          }}
          title="Usuń grupę razem z kafelkami"
        >
          Usuń grupę
        </button>
      </header>
      <input
        className="tile-row-name"
        value={g.name}
        maxLength={40}
        aria-label="Nazwa grupy"
        onChange={(e) => onChange({ ...cfg, groups: cfg.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })}
        onBlur={(e) => onChange(renameGroup(cfg, g.id, e.target.value || 'Grupa'))}
      />
      <label className="team-hint tile-group-caption" title="Wyłącz, żeby nad kafelkami nie było nazwy grupy ani sumy">
        <input type="checkbox" checked={!g.hideCaption} onChange={(e) => onChange(setGroupCaption(cfg, g.id, e.target.checked))} />{' '}
        pokazuj podpis i sumę nad kafelkami
      </label>
    </section>
  );

  /** Pasek jak na liście: grupy z podpisem i kafelki; klik zaznacza element do edycji, plus dodaje nowy. */
  const strip = (
    <div className="counters tiles-strip" role="toolbar" aria-label="Kafelki do edycji">
      {cfg.groups.map((g) => (
        <div
          key={g.id}
          className="counters-group"
          style={{ ['--n' as string]: Math.max(1, cfg.tiles.filter((t) => t.group === g.id).length) } as CSSProperties}
        >
          <button
            className={`counters-cap counters-cap-total tiles-strip-cap${selGroup?.id === g.id ? ' tiles-strip-on' : ''}`}
            onClick={() => setSel({ k: 'group', id: g.id })}
            title="Edytuj grupę: nazwa, kolejność, podpis"
          >
            <span className="counters-cap-text">{g.name}</span>
            {g.hideCaption && <span className="counters-cap-sp">bez podpisu</span>}
          </button>
          <div className="counters-group-row">
            {cfg.tiles
              .filter((t) => t.group === g.id)
              .map((t) => (
                <button
                  key={t.id}
                  className={`counter${selTile?.id === t.id ? ' counter-on' : ''}`}
                  style={{ ['--c' as string]: tileColorCss(t.color) } as CSSProperties}
                  aria-pressed={selTile?.id === t.id}
                  onClick={() => setSel({ k: 'tile', id: t.id })}
                  title="Edytuj kafelek"
                >
                  <span className="counter-icon">{TILE_ICON_NODES[t.icon] ?? TILE_ICON_NODES.list}</span>
                  <span className="counter-body">
                    <span className="counter-label">{t.name}</span>
                    <span className="counter-points">{t.measure === 'points' ? 'suma SP' : 'zadania'}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="counters-group counters-tools">
        <span className="counters-cap counters-cap-total counters-cap-static counters-cap-ghost" aria-hidden>
          <span className="counters-cap-text">&nbsp;</span>
        </span>
        <div className="counters-group-row counters-tools-row">
          <button
            className={`counter counter-add counter-icon-only${sel?.k === 'new' ? ' counter-on' : ''}`}
            onClick={() => setSel({ k: 'new' })}
            title="Nowy kafelek z bieżącego widoku"
            aria-label="Nowy kafelek"
          >
            <PlusIcon />
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="team-modal tiles-modal" role="dialog" aria-label="Kafelki">
        <header className="team-head">
          <h2>Kafelki</h2>
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </header>

        {strip}

        {selTile && tileEditor(selTile)}
        {selGroup && groupEditor(selGroup)}
        {sel?.k === 'new' && newForm}
        {!sel && (
          <p className="team-empty">
            {cfg.tiles.length
              ? 'Kliknij kafelek albo nazwę grupy, żeby je edytować. Plus na końcu dodaje nowy kafelek z bieżącego widoku.'
              : 'Nie ma jeszcze własnych kafelków. Ustaw filtry na liście i dodaj kafelek przyciskiem plus.'}
          </p>
        )}

        <footer className="tile-io">
          <button className="btn" onClick={download} disabled={!cfg.tiles.length}>
            Eksportuj do pliku
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importuj z pliku
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {importMsg && <span className="team-hint">{importMsg}</span>}
        </footer>
        <p className="team-hint">Konfiguracja jest zapisana tylko w tej przeglądarce — plik pozwala przenieść ją do innych.</p>
      </div>
    </>,
    document.body,
  );
}
