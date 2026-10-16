import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { addEpic, deleteEpic, editEpic as saveEpic, updateTags, type Epic, type Task } from './bitrix';
import { isHexColor } from './customTiles';

type Tab = 'tags' | 'epics';

/** Tag bez rozrozniania wielkosci liter — tak traktuje je Bitrix (BUG i bug to jeden tag). */
const same = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;

/** Nowy zestaw tagow zadania po zamianie `from` na `to` (`null` = usuniecie), bez dubli. */
export function replaceTag(tags: readonly string[], from: string, to: string | null): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const next = same(t, from) ? to : t;
    if (next && !out.some((x) => same(x, next))) out.push(next);
  }
  return out;
}

/**
 * Zarzadzanie tagami i epikami projektu w jednym miejscu. Tag w Bitriksie to tylko nazwa przy zadaniu
 * (nie ma slownika), wiec zmiana nazwy, scalenie i usuniecie to hurtowa zmiana zadan, ktore go maja.
 * Epik ma w Bitriksie osobne metody (dodaj / zmien / usun).
 */
export function ManageModal({
  tasks,
  epics,
  groupId,
  initialTab,
  onChanged,
  onClose,
}: {
  tasks: Task[];
  epics: Epic[];
  groupId: number | null;
  initialTab: Tab;
  /** Po zmianie trzeba przeladowac dane z Bitriksa. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (label: string, job: (progress: (done: number, total: number) => void) => Promise<void>) => {
    setMsg(null);
    setBusy(`${label}…`);
    try {
      await job((d, t) => setBusy(`${label}… ${d}/${t}`));
      onChanged();
    } catch (e) {
      setMsg(`Nie udało się: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <>
      <div className="picker-backdrop" onClick={busy ? undefined : onClose} />
      <div className="team-modal tiles-modal manage-modal" role="dialog" aria-label="Tagi i epiki">
        <header className="team-head">
          <h2>Tagi i epiki</h2>
          <button className="btn" onClick={onClose} disabled={Boolean(busy)}>
            Zamknij
          </button>
        </header>

        <div className="ds-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'tags'} className={`ds-tab${tab === 'tags' ? ' ds-tab-on' : ''}`} onClick={() => setTab('tags')}>
            Tagi
          </button>
          <button role="tab" aria-selected={tab === 'epics'} className={`ds-tab${tab === 'epics' ? ' ds-tab-on' : ''}`} onClick={() => setTab('epics')}>
            Epiki
          </button>
        </div>

        {busy && <p className="team-hint">{busy}</p>}
        {msg && <p className="team-hint manage-error">{msg}</p>}

        {tab === 'tags' ? (
          <TagsPane tasks={tasks} busy={Boolean(busy)} run={run} />
        ) : (
          <EpicsPane tasks={tasks} epics={epics} groupId={groupId} busy={Boolean(busy)} run={run} />
        )}
      </div>
    </>,
    document.body,
  );
}

type Run = (label: string, job: (progress: (done: number, total: number) => void) => Promise<void>) => Promise<void>;

function TagsPane({ tasks, busy, run }: { tasks: Task[]; busy: boolean; run: Run }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rows = useMemo(() => {
    const m = new Map<string, { name: string; all: number; open: number }>();
    for (const t of tasks) {
      for (const tag of t.tags) {
        const key = tag.toLowerCase();
        const r = m.get(key) ?? { name: tag, all: 0, open: 0 };
        r.all++;
        if (t.status !== '5' && t.status !== '7') r.open++;
        m.set(key, r);
      }
    }
    return [...m.values()].sort((a, b) => b.all - a.all || a.name.localeCompare(b.name, 'pl'));
  }, [tasks]);
  const shown = q.trim() ? rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())) : rows;

  const withTag = (tag: string) => tasks.filter((t) => t.tags.some((x) => same(x, tag)));

  const change = (tag: string, to: string | null) => {
    const list = withTag(tag);
    void run(to ? `Zmieniam „${tag}” → „${to}”` : `Usuwam „${tag}”`, async (progress) => {
      for (let i = 0; i < list.length; i++) {
        await updateTags(list[i].id, replaceTag(list[i].tags, tag, to));
        progress(i + 1, list.length);
      }
    });
  };

  return (
    <>
      <input className="tile-row-name" placeholder="Szukaj tagu…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="manage-list">
        {shown.map((r) => (
          <div key={r.name} className="manage-row">
            {editing === r.name ? (
              <>
                <input
                  className="tile-row-name"
                  value={draft}
                  autoFocus
                  maxLength={60}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null);
                    if (e.key === 'Enter' && draft.trim() && !same(draft.trim(), r.name)) {
                      setEditing(null);
                      change(r.name, draft.trim());
                    }
                  }}
                />
                <span className="team-hint">
                  Enter zapisze w {r.all} zadaniach{rows.some((x) => same(x.name, draft.trim()) && !same(x.name, r.name)) ? ' (scali z istniejącym tagiem)' : ''}
                </span>
                <button className="btn" onClick={() => setEditing(null)}>
                  Anuluj
                </button>
              </>
            ) : (
              <>
                <span className="manage-name">{r.name}</span>
                <span className="team-hint">
                  {r.all} zadań ({r.open} otwartych)
                </span>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditing(r.name);
                    setDraft(r.name);
                  }}
                  title="Zmień nazwę albo scal z innym tagiem (wpisz jego nazwę)"
                >
                  Zmień / scal
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Usunąć tag „${r.name}” z ${r.all} zadań?`)) change(r.name, null);
                  }}
                  title="Zdejmij tag ze wszystkich zadań"
                >
                  Usuń
                </button>
              </>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="team-empty">Brak tagów.</p>}
      </div>
      <p className="team-hint">
        Bitrix nie ma słownika tagów — tag to nazwa przy zadaniu, więc zmiana nazwy, scalenie i usunięcie aktualizują wszystkie zadania z
        tym tagiem (po jednym zapytaniu na zadanie).
      </p>
    </>
  );
}

function EpicsPane({
  tasks,
  epics,
  groupId,
  busy,
  run,
}: {
  tasks: Task[];
  epics: Epic[];
  groupId: number | null;
  busy: boolean;
  run: Run;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#58a6ff');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const count = (id: number) => tasks.filter((t) => t.epicId === id).length;

  return (
    <>
      <div className="manage-list">
        {epics.map((e) => (
          <div key={e.id} className="manage-row">
            <span className="manage-dot" style={{ background: e.color ? `#${e.color}` : 'var(--fg-dim)' }} />
            {editing === e.id ? (
              <>
                <input
                  className="tile-row-name"
                  value={draft}
                  autoFocus
                  maxLength={60}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Escape') setEditing(null);
                    if (ev.key === 'Enter' && draft.trim()) {
                      setEditing(null);
                      void run('Zapisuję epik', () => saveEpic(e.id, { name: draft.trim() }));
                    }
                  }}
                />
                <button className="btn" onClick={() => setEditing(null)}>
                  Anuluj
                </button>
              </>
            ) : (
              <>
                <span className="manage-name">{e.name}</span>
                <span className="team-hint">{count(e.id)} zadań</span>
                <label className="tile-swatch tile-swatch-custom" title="Zmień kolor">
                  <input
                    type="color"
                    value={e.color && isHexColor(`#${e.color}`) ? `#${e.color}` : '#58a6ff'}
                    disabled={busy}
                    onChange={(ev) => void run('Zapisuję kolor', () => saveEpic(e.id, { color: ev.target.value }))}
                    aria-label={`Kolor epiku ${e.name}`}
                  />
                </label>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditing(e.id);
                    setDraft(e.name);
                  }}
                >
                  Zmień nazwę
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Usunąć epik „${e.name}”? ${count(e.id)} zadań straci przypisanie do niego.`))
                      void run('Usuwam epik', () => deleteEpic(e.id));
                  }}
                >
                  Usuń
                </button>
              </>
            )}
          </div>
        ))}
        {epics.length === 0 && <p className="team-empty">Ten projekt nie ma epików.</p>}
      </div>

      <label className="team-add">
        <span>Nowy epik</span>
        <input placeholder="nazwa" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Kolor nowego epiku" />
        <button
          className="btn btn-primary"
          disabled={busy || !name.trim() || groupId === null}
          onClick={() => {
            const n = name.trim();
            setName('');
            if (groupId !== null) void run('Dodaję epik', () => addEpic(groupId, n, color));
          }}
        >
          Dodaj
        </button>
      </label>
    </>
  );
}
