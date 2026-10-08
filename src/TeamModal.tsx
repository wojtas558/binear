import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  addMember,
  FTE_OPTIONS,
  fmtFte,
  isoDate,
  isPresent,
  mondayOf,
  removeMember,
  setFte,
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
 * Zapis idzie od razu (przegladarka), moce w widoku planowania i odliczanie sprintu licza sie z tego.
 */
export function TeamModal({
  team,
  people,
  now,
  onChange,
  onClose,
}: {
  team: TeamConfig;
  /** Osoby z Bitriksa, z ktorych mozna wybrac czlonkow zespolu. */
  people: { id: number; name: string }[];
  now: Date;
  onChange: (next: TeamConfig) => void;
  onClose: () => void;
}) {
  const [monday, setMonday] = useState(() => mondayOf(now));
  const days = useMemo(() => weekDays(monday), [monday]);
  const shift = (weeks: number) => setMonday((m) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + weeks * 7));
  const candidates = people.filter((p) => !team.members.some((m) => m.id === p.id));
  const hours = teamWeekHours(team, monday);
  const thisWeek = isoDate(monday) === isoDate(mondayOf(now));

  return createPortal(
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="team-modal" role="dialog" aria-label="Zespół i grafik">
        <header className="team-head">
          <h2>Zespół i grafik</h2>
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </header>

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
                <th>Etat</th>
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
                    <select
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
                <td colSpan={2}>Moce tygodnia</td>
                <td colSpan={6} className="team-total">
                  <b>{Math.round(hours * 10) / 10}</b> h (= SP)
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <label className="team-add">
          <span>Dodaj osobę</span>
          <select
            value=""
            onChange={(e) => {
              const p = people.find((x) => x.id === Number(e.target.value));
              if (p) onChange(addMember(team, p));
            }}
          >
            <option value="">— wybierz —</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className="team-hint">
          Zaznaczone = w pracy. Moce = etat × 8 h na każdy zaznaczony dzień roboczy; jedna godzina to jeden punkt.
          Konfiguracja jest zapisana tylko w tej przeglądarce.
        </p>
      </div>
    </>,
    document.body,
  );
}
