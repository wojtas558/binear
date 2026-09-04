/*
 * Dashboard sprintow (issue #1): spalanie biezacego sprintu + predkosc zespolu
 * na kilku ostatnich, z paroma liczbami nad wykresami.
 *
 * Dane sa DROGIE w porownaniu z lista: kazdy sprint to jedno `tasks.task.list`
 * plus batch po story pointy. Dlatego dashboard pobiera je dopiero, gdy ktos go
 * otworzy, i trzyma wynik w stanie — przelaczenie na liste i z powrotem nie
 * odpala tego jeszcze raz.
 */

import { useEffect, useState } from 'react';
import { fetchSprints, fetchSprintTasks, type Sprint, type SprintTask } from './bitrix';
import { summarize, taskDone, type SprintSummary } from './sprintStats';
import { BurndownChart, Legend, type Series } from './Charts';
import { Avatar, CheckIcon, ChevronIcon, personColor } from './icons';
import { Picker, type Anchor } from './Picker';

/*
 * Ile ostatnich sprintow pobieramy. Wykres jest JEDEN - spalanie biezacego
 * sprintu - wiec bierzemy tylko go. Kazdy dodatkowy sprint to osobne
 * `tasks.task.list` plus batch po story pointy, czyli realne zapytania do
 * portalu; pobieranie szesciu "na zapas" potrafilo dobic limit zapytan.
 */
const SPRINT_SPAN = 1;

export function Dashboard({
  groupId,
  people: roster,
}: {
  groupId: number | null;
  /** Ludzie projektu ze ZDJECIAMI — zadania sprintu niosa tylko id i imie. */
  people: { id: number; name: string; photo: string | null }[];
}) {
  const [summaries, setSummaries] = useState<SprintSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Surowe zadania sprintu — trzymamy je, zeby filtr osoby przeliczal wykres
   *  lokalnie, bez ponownego odpytywania portalu (to kilkanascie zapytan). */
  /*
   * Zadania trzymane PER SPRINT, nie jedna lista. Wczesniej petla nadpisywala je
   * przy kazdym obrocie i zostawaly zadania OSTATNIEGO sprintu — zgadzalo sie
   * tylko dlatego, ze pobieramy jeden. Podniesienie `SPRINT_SPAN` po cichu
   * pokazywaloby liczby jednego sprintu pod naglowkiem innego.
   */
  const [tasksBySprint, setTasksBySprint] = useState<Record<number, SprintTask[]>>({});
  /** Zaznaczone osoby; PUSTA lista = caly zespol jedna linia. */
  const [persons, setPersons] = useState<number[]>([]);
  /*
   * Czy kolumna "Do zatwierdzenia / PR" liczy sie jako spalona. Domyslnie TAK —
   * z punktu widzenia osoby, ktora zadanie skonczyla, ono jest zrobione i czeka
   * juz tylko na cudza akceptacje. Bitrix liczy inaczej (tylko kolumna FINISH,
   * czyli "Wdrożone"), stad przelacznik. Nazewnictwo bierzemy WPROST z kolumny
   * na tablicy — zespol mowi o tym etapie jej nazwa, nie "recenzja".
   */
  const [countReview, setCountReview] = useState(true);

  useEffect(() => {
    if (groupId === null) return;
    let cancelled = false;

    (async () => {
      setError(null);
      setSummaries(null);
      try {
        const sprints = await fetchSprints(groupId);
        // Planowane sprinty nie maja czego pokazac — jeszcze sie nie zaczely.
        const usable = sprints.filter((s) => s.status !== 'planned').slice(-SPRINT_SPAN);
        if (!usable.length) {
          if (!cancelled) setSummaries([]);
          return;
        }

        // Sekwencyjnie, nie rownolegle: kazdy sprint to i tak kilka batchy, a
        // rownolegly wystrzal na 6 sprintow potrafi wejsc w limit zapytan portalu.
        const out: SprintSummary[] = [];
        for (const s of usable) {
          const rows = await fetchSprintTasks(s.id);
          if (cancelled) return;
          setTasksBySprint((m) => ({ ...m, [s.id]: rows }));
          out.push(summarize(s, rows));
          // Oddajemy po kazdym sprincie, zeby wykres rosl w oczach zamiast
          // trzymac pusty ekran przez kilkanascie sekund.
          setSummaries([...out]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (groupId === null) return <div className="dash-empty">Wybierz projekt.</div>;
  if (error) return <div className="dash-empty">Nie udało się pobrać danych: {error}</div>;
  if (!summaries) return <div className="dash-empty">Liczę sprinty…</div>;
  if (!summaries.length) return <div className="dash-empty">Ten projekt nie ma jeszcze sprintów.</div>;

  // Spalanie pokazujemy dla sprintu trwajacego; gdy zadnego nie ma — dla ostatniego.
  const base = summaries.find((s) => s.sprint.status === 'active') ?? summaries[summaries.length - 1];

  // Zadania TEGO sprintu, ktory pokazuje naglowek — nie ostatniego pobranego.
  const tasks = tasksBySprint[base.sprint.id] ?? [];

  /*
   * Osoby wyliczamy Z ZADAN SPRINTU, nie z calego projektu: w selektorze maja byc
   * tylko ci, ktorzy naprawde cos w tym sprincie maja. Kolejnosc wg wkladu (SP),
   * zeby najbardziej obciazeni byli na gorze.
   */
  const byId = new Map(roster.map((p) => [p.id, p]));
  const people = [...
    tasks.reduce((m, t) => {
      if (!t.responsibleId) return m;
      const known = byId.get(t.responsibleId);
      const cur =
        m.get(t.responsibleId) ??
        {
          id: t.responsibleId,
          // Imie i ZDJECIE bierzemy z listy projektu; zadanie sprintu zna tylko imie.
          name: known?.name ?? t.responsibleName ?? `#${t.responsibleId}`,
          photo: known?.photo ?? null,
          sp: 0,
          left: 0,
        };
      cur.sp += t.storyPoints ?? 0;
      // Do zrobienia WEDLUG biezacego przelacznika — ta sama definicja, co wykres.
      if (!taskDone(t, countReview)) cur.left += t.storyPoints ?? 0;
      return m.set(t.responsibleId, cur);
    }, new Map<number, { id: number; name: string; photo: string | null; sp: number; left: number }>()).values(),
    // Sortujemy po CALOSCI, nie po reszcie: inaczej lista przeskakiwalaby przy
    // kazdym przelaczeniu, a szuka sie w niej po nazwisku, nie po liczbie.
  ].sort((a, b) => b.sp - a.sp || a.name.localeCompare(b.name, 'pl'));

  // Wybor osoby przelicza sprint LOKALNIE — te same zadania, wezsze wejscie.
  /*
   * Bez zaznaczenia: jedna linia dla calego zespolu. Z zaznaczeniem: po jednej
   * linii na osobe, zeby dalo sie porownac tempo. Liczby nad wykresem opisuja
   * wtedy SUME zaznaczonych — inaczej nie wiadomo by bylo, czyje sa.
   */
  const chosen = persons.length ? people.filter((p) => persons.includes(p.id)) : [];
  const shown = chosen.length
    ? tasks.filter((t) => t.responsibleId !== null && persons.includes(t.responsibleId))
    : tasks;
  const current = summarize(base.sprint, shown, Date.now(), countReview);

  const series: Series[] = chosen.length
    ? chosen.map((p) => ({
        key: String(p.id),
        label: p.name,
        // Ten sam odcien co awatar tej osoby — legenda pokazuje twarz obok linii,
        // wiec para musi sie zgadzac bez tlumaczenia.
        color: personColor(p.name),
        points: summarize(
          base.sprint,
          tasks.filter((t) => t.responsibleId === p.id),
          Date.now(),
          countReview,
        ).burndown,
      }))
    : [{ key: 'all', label: 'Cały zespół', color: 'var(--accent)', points: current.burndown }];

  return (
    <div className="dash">
      <section className="dash-card">
        <header className="dash-head">
          <h2>Spalanie sprintu</h2>
          <span className="dash-sub">
            {current.sprint.name}
            {current.sprint.dateStart && current.sprint.dateEnd && (
              <> · {range(current.sprint)}</>
            )}
          </span>

          {/* Filtr osoby po PRAWEJ — zawezenie widoku, nie tytul, wiec nie miesza
              sie z nazwa sprintu po lewej. */}
          {/* Pigulka, nie <input type=checkbox>: natywny kwadracik rysuje system
              operacyjny, wiec obok wlasnych kontrolek tej karty wygladal jak
              wklejka. Ta ma ten sam ksztalt i wysokosc co filtr osoby obok. */}
          <button
            className={`chip-toggle${countReview ? ' chip-toggle-on' : ''}`}
            onClick={() => setCountReview((v) => !v)}
            title={
              countReview
                ? 'Zadania z „Do zatwierdzenia / PR” liczą się jako zrobione'
                : 'Liczy się tylko kolumna „Wdrożone” (jak w Bitriksie)'
            }
          >
            {/* Ptaszek jest ZAWSZE w drzewie, tylko niewidoczny w stanie wylaczonym —
                warunkowe renderowanie zmienialo szerokosc przycisku, wiec przy
                kliknieciu skakal on sam i przesuwal filtr osoby obok. */}
            <span className={`chip-toggle-mark${countReview ? '' : ' chip-toggle-mark-off'}`}>
              <CheckIcon />
            </span>
            Wliczaj do zatwierdzenia
          </button>

          {people.length > 1 && (
            <PersonPicker people={people} value={persons} onPick={setPersons} />
          )}
        </header>

        <div className="dash-stats">
          <Stat label="Zaplanowane" value={`${current.planned} SP`} />
          <Stat label="Zakończone" value={`${current.completed} SP`} />
          <Stat label="Pozostało" value={`${current.remaining} SP`} />
          {current.inReview > 0 && (
            <Stat
              label="Do zatwierdzenia"
              value={`${current.inReview} SP`}
              hint="Zamknięte, ale wciąż w kolumnie „Do zatwierdzenia / PR”."
            />
          )}
          {/* Kreska dzieli dwie JEDNOSTKI: po lewej story pointy, po prawej sztuki
              zadan. Bez niej "94 SP" i "60" czytaja sie jak jeden ciag liczb. */}
          <span className="dash-sep" aria-hidden />
          <Stat label="Zadania" value={String(current.taskCount)} />
          {current.unestimated > 0 && (
            <Stat
              label="Bez oszacowania"
              value={String(current.unestimated)}
              hint="Zadania bez story pointów nie wchodzą do sumy — wykres ich nie widzi."
            />
          )}
        </div>

        <BurndownChart series={series} />
        <Legend
          items={
            chosen.length
              ? chosen.map((p) => ({ color: personColor(p.name), label: p.name }))
              : [
                  { cls: 'legend-ideal', label: 'Linia idealna' },
                  { cls: 'legend-real', label: 'Rzeczywista' },
                ]
          }
        />
      </section>


      {/*
        Ograniczenie jest wpisane w ekran, a nie schowane w kodzie: story pointy
        nie maja historii w Bitriksie (dziennik zmian zadania ich nie zapisuje),
        wiec kazdy dzien liczy sie DZISIEJSZYM oszacowaniem. Przeszacowanie w
        trakcie sprintu zmienia tez przeszle punkty i nie da sie tego wykryc.
      */}
      <p className="dash-note">
        Spalanie liczone z dzisiejszych story pointów — Bitrix nie zapisuje ich historii,
        więc zmiana oszacowania w trakcie sprintu przesuwa także wcześniejsze dni.
      </p>
    </div>
  );
}

/**
 * Wybor osob w naglowku wykresu.
 *
 * Zachowuje sie jak zwykla lista rozwijana: klik WYBIERA jedna osobe i zamyka
 * liste. Zeby POROWNAC kilka osob na jednym wykresie, klika sie z modyfikatorem
 * (Ctrl/Cmd albo Shift) — dokladnie ta sama konwencja co zaznaczanie zadan na
 * liscie ("Ctrl+klik = dodaj/usuń z zaznaczenia" ze sciagawki). Pusty wybor
 * znaczy "caly zespol jedna linia".
 *
 * Uzywa WSPOLNEGO `Picker` — nie wlasnej listy ani `<select>`, ktory rysuje
 * system operacyjny i ktory obok reszty kontrolek wyglada jak wklejka.
 */
function PersonPicker({
  people,
  value,
  onPick,
}: {
  people: { id: number; name: string; photo: string | null; sp: number; left: number }[];
  value: number[];
  onPick: (ids: number[]) => void;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const chosen = people.filter((p) => value.includes(p.id));

  /*
   * Kilka osob = facepile jak na chipach filtrow: nachodzace awatary i "+N".
   * Trzy twarze, nie piec jak w pasku filtrow — przycisk stoi w naglowku karty
   * obok przelacznika i nie ma tam miejsca na dluzszy ogon.
   */
  const FACES = 3;
  const shownFaces = chosen.slice(0, FACES);
  const extra = chosen.length - shownFaces.length;

  return (
    <>
      <button
        className="person-btn"
        title="Klik wybiera osobę; Ctrl/Shift+klik dokłada kolejną do porównania"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          /*
           * Picker kotwiczy sie LEWA krawedzia i sam dodaje jeszcze 32 px
           * (`anchor.left + 32`), a ten przycisk stoi przy prawej krawedzi karty.
           * Odejmujemy wiec szerokosc listy ORAZ te 32 px — inaczej popover
           * wystawal poza przycisk dokladnie o tyle.
           */
          setAnchor(
            anchor ? null : { left: r.right - 260 - 32, top: r.bottom + 4, bottom: r.bottom + 4 },
          );
        }}
      >
        {chosen.length === 0 ? (
          <>
            <span className="person-all" aria-hidden />
            <span className="person-name">Cały zespół</span>
          </>
        ) : (
          <>
            {/* Lewy awatar na wierzchu — z-index z JSX, jak w pasku filtrow. */}
            <span className="filter-chip-stack">
              {shownFaces.map((p, i) => (
                <span className="filter-chip-vicon" key={p.id} style={{ zIndex: FACES - i }}>
                  <Avatar name={p.name} photo={p.photo} />
                </span>
              ))}
            </span>
            {/* Przy jednej osobie jej imie; przy kilku sama liczba — nazwiska
                i tak sa pod spodem w legendzie wykresu. */}
            <span className="person-name">
              {chosen.length === 1 ? chosen[0].name : `${chosen.length} osób`}
            </span>
            {extra > 0 && <span className="filter-chip-more">+{extra}</span>}
          </>
        )}
        <ChevronIcon open={anchor !== null} />
      </button>

      {anchor && (
        <Picker
          title="Osoba"
          anchor={anchor}
          /* Pusty wybor to nie "nic nie zaznaczono", tylko stan "caly zespol" —
             wiec ptaszek ma stac przy tej pozycji, a nie znikac z calej listy. */
          selected={value.length ? value.map(String) : ['']}
          options={[
            { value: '', label: 'Cały zespół', icon: <span className="person-all" aria-hidden /> },
            ...people.map((p) => ({
              value: String(p.id),
              label: p.name,
              photo: p.photo,
              // "zostalo / calosc" — sama calosc nie reagowala na przelacznik,
              // a sama reszta gubila skale (6 SP u kogos, kto ma w sprincie 76).
              hint: `${p.left} / ${p.sp} SP`,
            })),
          ]}
          onPick={(v, add) => {
            if (v === '') {
              onPick([]);
              setAnchor(null);
              return;
            }
            const id = Number(v);
            if (add) {
              // Dokladanie NIE zamyka listy — zwykle chce sie zaznaczyc kilka naraz.
              onPick(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
              return;
            }
            onPick([id]);
            setAnchor(null);
          }}
          footer={
            <>
              <kbd>Ctrl</kbd> lub <kbd>Shift</kbd> + klik — dołóż osobę do porównania
            </>
          }
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="dash-stat" title={hint}>
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
    </div>
  );
}

function range(s: Sprint): string {
  const fmt = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return `${fmt(s.dateStart)} – ${fmt(s.dateEnd)}`;
}
