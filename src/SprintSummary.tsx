import { useMemo } from 'react';

import type { Sprint, Task } from './bitrix';
import { sprintDeadline, workHoursBetween } from './sprintClock';
import {
  SUMMARY_STATES,
  efficiency,
  STATE_LABELS,
  summarizeSprint,
  type Dept,
  type SummaryState,
  type Totals,
} from './sprintTotals';

const dm = (iso: string | null) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? `${t.getDate()}.${String(t.getMonth() + 1).padStart(2, '0')}` : '—';
};

const plZad = (n: number) =>
  `${n} ${n === 1 ? 'zadanie' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'zadania' : 'zadań'}`;

/** Pasek: kawalek na stan, szerokosc proporcjonalna do jego SP. */
function StateBar({ totals, thick = false }: { totals: Totals; thick?: boolean }) {
  if (totals.points <= 0) return <span className={`sum-bar${thick ? ' sum-bar-thick' : ''} sum-bar-empty`} />;
  return (
    <span
      className={`sum-bar${thick ? ' sum-bar-thick' : ''}`}
      title={SUMMARY_STATES.filter((s) => totals.by[s] > 0)
        .map((s) => `${STATE_LABELS[s].toLowerCase()} ${totals.by[s]} SP`)
        .join(' · ')}
    >
      {SUMMARY_STATES.map((s) =>
        totals.by[s] > 0 ? <span key={s} className={`sum-seg is-${s}`} style={{ flexGrow: totals.by[s] }} /> : null,
      )}
    </span>
  );
}

const Num = ({ v }: { v: number }) => <span className="sum-num">{v > 0 ? v : '—'}</span>;

function DeptBlock({ dept, onOpen }: { dept: Dept; onOpen: (id: number) => void }) {
  const t = dept.totals;
  return (
    <details className="sum-dept">
      <summary className="sum-dept-head">
        <span className="sum-dept-name">{dept.name}</span>
        <StateBar totals={t} />
        <span className="sum-num sum-total">{t.points}</span>
        {SUMMARY_STATES.map((s) => (
          <Num key={s} v={t.by[s]} />
        ))}
      </summary>
      <div className="sum-topics">
        {dept.topics.map((p) => (
          <button key={p.rootId} className="sum-topic" onClick={() => onOpen(p.rootId)} title="Otwórz zadanie">
            <span className="sum-topic-title">{p.title}</span>
            <StateBar totals={p.totals} />
            <span className="sum-num sum-total">{p.totals.points}</span>
            <span className="sum-topic-count">{plZad(p.totals.count)}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

/**
 * Podsumowanie BIEZACEGO sprintu — te same liczby, ktore idzie omawiac na Radzie Priorytetow, ale z
 * zywych danych, wiec widac je przed zamknieciem sprintu (po zamknieciu Bitrix przenosi niedowiezione
 * zadania do nastepnego i obraz znika).
 */
export function SprintSummary({
  sprint,
  tasks,
  workStageIds,
  epicName,
  now,
  teamCapacity,
  capacityTotal,
  capacitySource,
  onOpen,
}: {
  sprint: Sprint | null;
  tasks: Task[];
  /** Etapy typu WORK („W toku") sprintu. */
  workStageIds: ReadonlySet<number>;
  epicName: (epicId: number | null) => string;
  now: Date;
  /** Moce z grafiku zespolu do konca sprintu; `null`, gdy zespol nie jest wpisany. */
  teamCapacity: number | null;
  /** Moce zespolu na CALY sprint (h = SP); `null`, gdy nie da sie ich policzyc. */
  capacityTotal: number | null;
  /** Skad moce: grafik zespolu albo liczba programistow z konfiguracji. */
  capacitySource: 'grafik' | 'konfiguracja' | null;
  onOpen: (id: number) => void;
}) {
  const data = useMemo(
    () => (sprint ? summarizeSprint(tasks, sprint.id, workStageIds, epicName) : null),
    [tasks, sprint, workStageIds, epicName],
  );

  if (!sprint || !data) {
    return <div className="sum-empty">Nie ma aktywnego sprintu do podsumowania.</div>;
  }

  const t = data.totals;
  const end = sprintDeadline(sprint.dateEnd);
  const hoursLeft = end ? workHoursBetween(now, end) : 0;
  const open = t.points - t.by.wdrozone;
  const maxDept = Math.max(1, ...data.depts.map((d) => d.totals.points));
  const delivered = t.by.wdrozone + t.by.pr;
  const effDeployed = efficiency(t.by.wdrozone, capacityTotal);
  const effFinished = efficiency(delivered, capacityTotal);

  return (
    <div className="sum">
      <header className="sum-head">
        <h2>{sprint.name}</h2>
        <span className="sum-dates">
          {dm(sprint.dateStart)} – {dm(sprint.dateEnd)}
          {end && hoursLeft > 0 && <> · zostało {Math.round(hoursLeft)} h roboczych</>}
        </span>
      </header>

      {/*
        Procent liczymy od MOCY, nie od zaplanowanych SP: plan bywa kilkadziesiat procent ponad moce, wtedy
        „39% planu" wyglada na porazke, a zespol dowiozl tyle, na ile pozwalaly godziny. Plan pokazujemy obok.
      */}
      <p className="sum-headline">
        Zakończone w sprincie: <b>{delivered}</b> SP
        {effFinished && capacityTotal !== null ? (
          <span className="sum-headline-pct">
            {' '}
            · {Math.round(effFinished.pct)}% mocy zespołu ({Math.round(capacityTotal)} h)
          </span>
        ) : (
          t.points > 0 && <span className="sum-headline-pct"> · {Math.round((delivered / t.points) * 100)}% planu</span>
        )}
      </p>
      {capacityTotal !== null && capacityTotal > 0 && (
        <p className="sum-plan">
          Zaplanowane było <b>{t.points}</b> SP = {Math.round((t.points / capacityTotal) * 100)}% mocy
          {t.points > capacityTotal && <> — o {Math.round(t.points - capacityTotal)} SP ponad moce</>}.
        </p>
      )}

      {effDeployed && effFinished && capacityTotal !== null && (
        <p className="sum-eff" title={`Moce: ${capacitySource === 'grafik' ? 'z grafiku zespołu' : 'liczba programistów z konfiguracji × godziny sprintu'}. Jedna godzina mocy to jeden punkt.`}>
          Wydajność: wdrożone <b>{t.by.wdrozone}</b> SP na <b>{Math.round(capacityTotal)}</b> h mocy ={' '}
          <b>{Math.round(effDeployed.pct)}%</b>
          {effDeployed.hPerSp !== null && <> (odwrotnie: {effDeployed.hPerSp.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} h mocy na 1 SP)</>}
          . Razem z czekającymi na wdrożenie ({delivered} SP): <b>{Math.round(effFinished.pct)}%</b>.
        </p>
      )}

      <div className="sum-tiles">
        {SUMMARY_STATES.map((s: SummaryState) => (
          <div key={s} className={`sum-tile is-${s}`}>
            <span className="sum-tile-n">{t.by[s]}</span>
            <span className="sum-tile-l">
              SP · {STATE_LABELS[s].toLowerCase()}
              <small>{plZad(t.counts[s])}</small>
            </span>
          </div>
        ))}
      </div>

      <StateBar totals={t} thick />
      <p className="sum-note">
        Skończone (wdrożone albo czekające na wdrożenie): <b>{delivered}</b> z <b>{t.points}</b> SP planu
        {t.points > 0 && <> ({Math.round((delivered / t.points) * 100)}%)</>}; do zrobienia lub dokończenia{' '}
        <b>{open}</b> SP.
        {t.unestimated > 0 && <> {plZad(t.unestimated)} bez SP nie wchodzi do sum.</>}
        {teamCapacity !== null && (
          <>
            {' '}
            Moce zespołu do końca sprintu (grafik): <b>{Math.round(teamCapacity)}</b> h.
          </>
        )}
      </p>

      {data.depts.length > 0 && (
        <section className="sum-chart" aria-label="SP według działu i statusu">
          <h3>Działy — SP według statusu</h3>
          <div className="sum-legend">
            {SUMMARY_STATES.map((s) => (
              <span key={s} className="sum-legend-item">
                <i className={`sum-dot is-${s}`} />
                {STATE_LABELS[s]}
              </span>
            ))}
          </div>
          {data.depts.map((d) => {
            const done = d.totals.by.wdrozone + d.totals.by.pr;
            return (
              <div key={d.epicId ?? 0} className="sum-chart-row">
                <span className="sum-chart-name" title={d.name}>
                  {d.name}
                </span>
                <span className="sum-chart-track">
                  <span className="sum-chart-bar" style={{ width: `${(d.totals.points / maxDept) * 100}%` }}>
                    {SUMMARY_STATES.map((s) =>
                      d.totals.by[s] > 0 ? (
                        <span
                          key={s}
                          className={`sum-seg is-${s}`}
                          style={{ flexGrow: d.totals.by[s] }}
                          title={`${STATE_LABELS[s]}: ${d.totals.by[s]} SP`}
                        >
                          {d.totals.by[s]}
                        </span>
                      ) : null,
                    )}
                  </span>
                </span>
                <span className="sum-chart-done">
                  {done}/{d.totals.points} SP
                  {d.totals.points > 0 && <small> · {Math.round((done / d.totals.points) * 100)}%</small>}
                </span>
              </div>
            );
          })}
        </section>
      )}

      <div className="sum-table-head">
        <span>Dział</span>
        <span />
        <span className="sum-num">Razem</span>
        {SUMMARY_STATES.map((s) => (
          <span key={s} className="sum-num" title={STATE_LABELS[s]}>
            {STATE_LABELS[s]}
          </span>
        ))}
      </div>
      {data.depts.map((d) => (
        <DeptBlock key={d.epicId ?? 0} dept={d} onOpen={onOpen} />
      ))}
      {data.depts.length === 0 && <div className="sum-empty">Sprint nie ma jeszcze zadań.</div>}
      <p className="sum-foot">Rozwiń dział, żeby zobaczyć tematy. SP rodzica liczymy z jego podzadań.</p>
    </div>
  );
}
