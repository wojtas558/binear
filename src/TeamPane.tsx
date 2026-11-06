import { useMemo, useState } from 'react';

import {
  addMember,
  countsCapacity,
  FTE_OPTIONS,
  fmtFte,
  isGuardian,
  isManager,
  isoDate,
  isPresent,
  mondayOf,
  removeMember,
  ROLE_SUGGESTIONS,
  setFte,
  setMember,
  takesBudget,
  teamWeekHours,
  togglePresence,
  weekDays,
  type TeamConfig,
} from './team';

const DNI = ['pn', 'wt', 'śr', 'cz', 'pt'];
const dm = (d: Date) => `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Zespol i grafik tygodniowy: kogo liczymy do mocy, na jaki etat i w ktore dni jest w pracy.
 * Domyslnie wszyscy sa w pracy w kazdy dzien roboczy — odznaczasz tylko wyjatki (urlop, L4).
 * Zapis idzie od razu (plik na serwerze, wspolny dla wszystkich), moce w widoku planowania i odliczanie sprintu licza sie z tego.
 * Zakladka okna „Ustawienia" (SettingsModal) — okno, naglowek i Esc sa tam.
 */
export function TeamPane({
  team,
  people,
  now,
  onChange,
}: {
  team: TeamConfig;
  /**
   * Osoby, z ktorych mozna wybrac czlonkow zespolu: aktywni pracownicy z calej firmy (nie tylko ci, ktorzy maja
   * teraz zadania), bez konta-zaslepki „Nieprzypisane". `it` = z dzialu IT — ida na gore listy.
   */
  people: { id: number; name: string; it?: boolean }[];
  now: Date;
  onChange: (next: TeamConfig) => void;
}) {
  const [monday, setMonday] = useState(() => mondayOf(now));
  const days = useMemo(() => weekDays(monday), [monday]);
  const shift = (weeks: number) => setMonday((m) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + weeks * 7));
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  /* Szukanie po nazwisku bez polskich znakow i wielkosci liter; IT na gorze, potem alfabetycznie. */
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
  const candidates = people
    .filter((p) => !team.members.some((m) => m.id === p.id))
    .filter((p) => !q.trim() || fold(p.name).includes(fold(q.trim())))
    .sort((a, b) => Number(Boolean(b.it)) - Number(Boolean(a.it)) || a.name.localeCompare(b.name, 'pl'));
  const shown = candidates.slice(0, 8);
  const add = (p: { id: number; name: string } | undefined) => {
    if (!p) return;
    onChange(addMember(team, p));
    setQ('');
    setCursor(0);
  };
  const hours = teamWeekHours(team, monday);
  const thisWeek = isoDate(monday) === isoDate(mondayOf(now));

  return (
    <>
      <div className="team-week">
        <button className="btn" onClick={() => shift(-1)} aria-label="Poprzedni tydzień">
          ‹
        </button>
        <span className="team-week-label">
          {dm(days[0])} – {dm(days[4])}
          {thisWeek && <span className="team-week-now"> · ten tydzień</span>}
        </span>
        <button className="btn" onClick={() => shift(1)} aria-label="Następny tydzień">
          ›
        </button>
        {!thisWeek && (
          <button className="btn" onClick={() => setMonday(mondayOf(now))}>
            Dziś
          </button>
        )}
      </div>

      {team.members.length === 0 ? (
        <p className="team-empty">
          Nikogo jeszcze nie ma. Dodaj osoby poniżej — dopóki zespół jest pusty, moce liczą się po staremu.
        </p>
      ) : (
        <table className="team-table">
          <thead>
            <tr>
              <th>Osoba</th>
              <th>Rola</th>
              <th>Etat</th>
              <th title="Kierownik: zadania poza budżetem SP, osobny pasek w planowaniu, przy wejściu do sprintu zadania zostają u niego">
                Kierownik
              </th>
              <th title="Godziny osoby wchodzą do mocy zespołu (potencjał sprintu)">Moc</th>
              <th title="Zadania osoby zjadają budżet SP w planowaniu">Budżet</th>
              <th title="Pula opiekunów: w backlogu precyzuje zadania do DO-STARTU. Zadanie w backlogu z kimś spoza puli jako odpowiedzialnym jest „bez opiekuna”">
                Opiekun
              </th>
              {days.map((d, i) => (
                <th key={i} className="team-day" title={isoDate(d)}>
                  {DNI[i]}
                  <small>{dm(d)}</small>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {team.members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>
                  <input
                    className="picker-input team-role"
                    list="team-roles"
                    value={m.role ?? ''}
                    maxLength={40}
                    placeholder="rola"
                    aria-label={`Rola: ${m.name}`}
                    onChange={(e) => onChange(setMember(team, m.id, { role: e.target.value }))}
                  />
                </td>
                <td>
                  <select
                    className="team-select"
                    value={m.fte}
                    onChange={(e) => onChange(setFte(team, m.id, Number(e.target.value)))}
                    aria-label={`Wymiar etatu: ${m.name}`}
                  >
                    {[...new Set<number>([...FTE_OPTIONS, m.fte])]
                      .sort((a, b) => b - a)
                      .map((f) => (
                        <option key={f} value={f}>
                          {fmtFte(f)}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="team-day">
                  <input
                    type="checkbox"
                    checked={isManager(m)}
                    onChange={(e) => onChange(setMember(team, m.id, { manager: e.target.checked }))}
                    aria-label={`${m.name}: kierownik`}
                  />
                </td>
                <td className="team-day">
                  <input
                    type="checkbox"
                    checked={countsCapacity(m)}
                    onChange={(e) => onChange(setMember(team, m.id, { capacity: e.target.checked }))}
                    aria-label={`${m.name}: godziny liczą się do mocy zespołu`}
                  />
                </td>
                <td className="team-day">
                  <input
                    type="checkbox"
                    checked={takesBudget(m)}
                    disabled={isManager(m)}
                    title={isManager(m) ? 'Zadania kierownika nie zjadają budżetu' : undefined}
                    onChange={(e) => onChange(setMember(team, m.id, { budget: e.target.checked }))}
                    aria-label={`${m.name}: zadania zjadają budżet SP`}
                  />
                </td>
                <td className="team-day">
                  <input
                    type="checkbox"
                    checked={isGuardian(m)}
                    onChange={(e) => onChange(setMember(team, m.id, { guardian: e.target.checked }))}
                    aria-label={`${m.name}: opiekun zadań w backlogu`}
                  />
                </td>
                {days.map((d, i) => (
                  <td key={i} className="team-day">
                    <input
                      type="checkbox"
                      checked={isPresent(team, m.id, d)}
                      onChange={() => onChange(togglePresence(team, m.id, d))}
                      aria-label={`${m.name}, ${DNI[i]} ${dm(d)}: w pracy`}
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="btn team-remove"
                    onClick={() => onChange(removeMember(team, m.id))}
                    title="Usuń z zespołu"
                    aria-label={`Usuń z zespołu: ${m.name}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Moce tygodnia</td>
              <td colSpan={8} className="team-total">
                <b>{Math.round(hours * 10) / 10}</b> h (= SP)
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      <datalist id="team-roles">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="team-add team-add-search">
        <span>Dodaj osobę</span>
        <div className="team-search">
          <input
            className="picker-input"
            placeholder="Szukaj w firmie…"
            // Fokus do okna po otwarciu — inaczej zostawal na przycisku w naglowku pod spodem.
            autoFocus
            value={q}
            aria-label="Szukaj osoby do zespołu"
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                add(shown[cursor]);
              } else if (e.key === 'Escape' && q) {
                // Pierwszy Esc zamyka same podpowiedzi; dopiero przy pustym polu Esc zamyka okno.
                e.preventDefault();
                setQ('');
              }
            }}
          />
          {q.trim() !== '' && (
            <div className="team-search-list" role="listbox">
              {shown.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className={`team-search-item${i === cursor ? ' team-search-item-on' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => add(p)}
                >
                  <span>{p.name}</span>
                  {p.it && <span className="team-search-it">IT</span>}
                </button>
              ))}
              {shown.length === 0 && <div className="team-search-empty">Nikogo takiego — albo już jest w zespole.</div>}
              {candidates.length > shown.length && (
                <div className="team-search-empty">…i {candidates.length - shown.length} więcej — wpisz dokładniej</div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="team-hint">
        <b>Kierownik</b> — jego zadania są poza budżetem SP, mają osobny pasek w planowaniu i przy wejściu do
        sprintu zostają u niego; dopóki nikt nie jest zaznaczony, kierownikiem jest ten z zakładki
        Środowisko („Poza limitem SP"). <b>Moc</b> — godziny osoby wchodzą do mocy zespołu. <b>Budżet</b> — jej zadania zjadają budżet SP w planowaniu.
        Statystyki (wykresy, podsumowanie) liczą zadania wszystkich, także tych bez mocy. Dni zaznaczone = w pracy;
        moc = etat × 8 h na dzień, jedna godzina to jeden punkt. Zespół zapisuje się na serwerze — wszyscy widzą ten sam, osobny dla każdego projektu.
      </p>
    </>
  );
}
