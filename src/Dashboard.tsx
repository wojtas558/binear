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
import { fetchSprints, fetchSprintTasks, type Sprint, type SprintTask, type Stage } from './bitrix';
import { doneBeforeSprint, stageBreakdown, summarize, taskDone, type SprintSummary } from './sprintStats';
import { BurndownChart, Legend, ScopeBar, StageStrip, type Series } from './Charts';
import { Avatar, CheckIcon, ChevronIcon, personColor } from './icons';
import { Picker, type Anchor } from './Picker';
import { isUnassigned, tasksWord, UNASSIGNED_LABEL } from './taskView';
import { capacityState, weekWindow } from './capacityMarker';
import { teamFirst } from './peopleOrder';
import { countsCapacity, memberHoursBetween, type TeamConfig } from './team';

/*
 * Ile ostatnich sprintow pobieramy. Wykres jest JEDEN - spalanie biezacego
 * sprintu - wiec bierzemy tylko go. Kazdy dodatkowy sprint to osobne
 * `tasks.task.list` plus batch po story pointy, czyli realne zapytania do
 * portalu; pobieranie szesciu "na zapas" potrafilo dobic limit zapytan.
 */
const SPRINT_SPAN = 1;

/*
 * Ustawienia wykresu (JAK liczymy, nie co pokazujemy) trzymane osobno od ustawien
 * listy: to inny ekran i inny zestaw decyzji, a zapisane widoki nie maja po co ich
 * przenosic. Blad odczytu = wartosci domyslne; to tylko preferencja.
 */
const DASH_KEY = 'binear.dash.v1';

function readFlag(name: 'review' | 'added', fallback: boolean): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(DASH_KEY) || '{}')[name];
    return typeof v === 'boolean' ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeFlags(flags: Record<string, boolean>) {
  try {
    localStorage.setItem(DASH_KEY, JSON.stringify(flags));
  } catch {
    // tryb prywatny / brak miejsca — ustawienie po prostu nie przezyje odswiezenia
  }
}

export function Dashboard({
  groupId,
  people: roster,
  team,
  onOpenTeam,
}: {
  groupId: number | null;
  /** Ludzie projektu ze ZDJECIAMI — zadania sprintu niosa tylko id i imie. */
  people: { id: number; name: string; photo: string | null }[];
  /** Zespol i grafik: rola i moc osoby w sprincie (kreska na slupku). */
  team: TeamConfig;
  onOpenTeam: () => void;
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
  /* Kolumny tablicy per sprint — do podzialki zakresu na etapy. Ida z tego samego
     pobrania co zadania, wiec nie kosztuja osobnego wywolania. */
  const [stagesBySprint, setStagesBySprint] = useState<Record<number, Stage[]>>({});
  /** Zaznaczone osoby; PUSTA lista = caly zespol jedna linia. */
  const [persons, setPersons] = useState<number[]>([]);
  /*
   * Czy kolumna "Do zatwierdzenia / PR" liczy sie jako spalona. Domyslnie TAK —
   * z punktu widzenia osoby, ktora zadanie skonczyla, ono jest zrobione i czeka
   * juz tylko na cudza akceptacje. Bitrix liczy inaczej (tylko kolumna FINISH,
   * czyli "Wdrożone"), stad przelacznik. Nazewnictwo bierzemy WPROST z kolumny
   * na tablicy — zespol mowi o tym etapie jej nazwa, nie "recenzja".
   */
  const [countReview, setCountReview] = useState(() => readFlag('review', true));

  /*
   * Czy zadania DOSYPANE w trakcie sprintu wchodza na wykres dopiero w dniu, w ktorym
   * doszly. Domyslnie TAK: doliczone od pierwszego dnia zanizaja wsteczne dni, bo
   * mierza wczorajsza prace wobec zakresu, ktorego wczoraj jeszcze nie bylo.
   *
   * Rozpoznajemy je po `MOVE_TO_SPRINT` z dziennika — Bitrix nie zapisuje przy nim
   * numeru sprintu, wiec sprint bierze sie z tego, w czyje okno wpada znacznik czasu.
   * Przenoszenie ogona miedzy sprintami nie zostawia wpisu, wiec ogon liczy sie
   * od pierwszego dnia — i slusznie, bo faktycznie w tym sprincie od niego byl.
   */
  const [countAdded, setCountAdded] = useState(() => readFlag('added', true));

  /* Oba przelaczniki przezywaja przeladowanie — inaczej po kazdym wejsciu na wykres
     trzeba je ustawiac od nowa, a to sa ustawienia "jak liczymy", nie chwilowy filtr. */
  useEffect(() => {
    writeFlags({ review: countReview, added: countAdded });
  }, [countReview, countAdded]);

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

        /*
         * RÓWNOLEGLE. Wczesniej bylo sekwencyjnie, bo rownolegly wystrzal na szesc
         * sprintow wchodzil w limit zapytan portalu — ale tego pilnuje teraz
         * przepustnica w `bitrix.ts`, ktora i tak przepuszcza tylko tyle, ile
         * portal zniesie. Zostawala wiec sama wada: ~36 zapytan jedno po drugim,
         * czyli suma round-tripow zamiast ich maksimum, i kilkanascie sekund
         * pustego ekranu.
         */
        const out: (SprintSummary | undefined)[] = new Array(usable.length);
        await Promise.all(
          usable.map(async (s, i) => {
            const { tasks: rows, stages } = await fetchSprintTasks(s.id);
            if (cancelled) return;
            setTasksBySprint((m) => ({ ...m, [s.id]: rows }));
            setStagesBySprint((m) => ({ ...m, [s.id]: stages }));
            out[i] = summarize(s, rows);
            /* Oddajemy po kazdym sprincie, zeby wykres rosl w oczach. `filter`
               trzyma kolejnosc sprintow niezaleznie od kolejnosci odpowiedzi. */
            setSummaries(out.filter((x): x is SprintSummary => x !== undefined));
          }),
        );
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
  const stages = stagesBySprint[base.sprint.id] ?? [];

  /*
   * ZAKRES SPRINTU dla calego zespolu: zadania sprintu bez zaszlosci, czyli bez
   * pracy gotowej juz przed pierwszym dniem. Ta sama definicja, co w `summarize`
   * i w slupku — dzieki temu liczby przy nazwiskach sumuja sie do liczb nad
   * wykresem, zamiast byc o zaszlosci wieksze.
   */
  const sprintScope = tasks.filter((t) => !doneBeforeSprint(base.sprint, t, countReview));

  /*
   * Osoby wyliczamy Z ZADAN SPRINTU, nie z calego projektu: w selektorze i w
   * tabeli maja byc tylko ci, ktorzy naprawde cos w tym sprincie maja.
   * Kolejnosc wg wkladu (SP), zeby najbardziej obciazeni byli na gorze.
   */
  const byId = new Map(roster.map((p) => [p.id, p]));
  const byPerson = new Map<number, SprintTask[]>();
  for (const t of sprintScope) {
    if (!t.responsibleId) continue;
    const bucket = byPerson.get(t.responsibleId);
    if (bucket) bucket.push(t);
    else byPerson.set(t.responsibleId, [t]);
  }

  /*
   * POZOSTALA moc do konca tygodnia pracy: od teraz (a przed startem od poniedzialku 8:00) do piatku 16:00.
   * Na poczatku to pelna moc — pilnuje, zeby nikogo nie zawalic robota; z uplywem tygodnia kurczy sie
   * i pokazuje, czy osoba jeszcze zdazy z tym, co jej zostalo.
   */
  const sprintSpan = (() => {
    const start = base.sprint.dateStart ? new Date(base.sprint.dateStart) : null;
    if (!start || Number.isNaN(start.getTime())) return null;
    return weekWindow(start, new Date());
  })();

  const people = [...byPerson.entries()]
    .map(([id, own]) => {
      const known = byId.get(id);
      const sp = own.reduce((a, t) => a + (t.storyPoints ?? 0), 0);
      // "Zrobione" WEDLUG biezacego przelacznika — ta sama definicja, co wykres.
      const done = own.reduce((a, t) => (taskDone(t, countReview) ? a + (t.storyPoints ?? 0) : a), 0);
      return {
        id,
        /*
         * Tu grupujemy po OSOBIE ODPOWIEDZIALNEJ, wiec konto-zaslepka znaczy
         * „nikt tego nie prowadzi" i tak ma sie nazywac — inaczej niz przy autorze
         * czy uczestniku, gdzie jest zwyklym kontem i pokazujemy jego nazwisko.
         */
        unassigned: isUnassigned(id),
        // Imie i ZDJECIE bierzemy z listy projektu; zadanie sprintu zna tylko imie.
        name: isUnassigned(id) ? UNASSIGNED_LABEL : (known?.name ?? own[0].responsibleName ?? `#${id}`),
        photo: isUnassigned(id) ? null : (known?.photo ?? null),
        sp,
        done,
        left: sp - done,
        count: own.length,
        /* Wlasna podzialka na etapy — ten sam rachunek, co duzy slupek obok. */
        segments: stageBreakdown(own, stages),
      };
    })
    .concat(
      /* Osoby z zespolu bez zadan w tym sprincie: widac u nich wolna moc. */
      team.members
        .filter((m) => !byPerson.has(m.id))
        .map((m) => ({
          id: m.id,
          unassigned: false,
          name: m.name,
          photo: byId.get(m.id)?.photo ?? null,
          sp: 0,
          done: 0,
          left: 0,
          count: 0,
          segments: [] as ReturnType<typeof stageBreakdown>,
        })),
    )
    .map((p) => {
      const m = team.members.find((x) => x.id === p.id);
      const cap = m && sprintSpan ? memberHoursBetween(team, p.id, sprintSpan.from, sprintSpan.to) : 0;
      return {
        ...p,
        role: m?.role ?? '',
        cap: Math.round(cap * 10) / 10,
        /* Osoba z wylaczona moca (np. kierownik) nie ma kreski ani ostrzezen — nie ma czego porownywac. */
        hasCap: Boolean(m && countsCapacity(m)),
        capState: m && countsCapacity(m) && p.sp > 0 ? capacityState(p.segments, cap) : ('ok' as const),
      };
    })
    // Sortujemy po CALOSCI, nie po reszcie: inaczej lista przeskakiwalaby przy
    // kazdym przelaczeniu, a szuka sie w niej po nazwisku, nie po liczbie.
    .sort((a, b) => b.sp - a.sp || a.name.localeCompare(b.name, 'pl'));
  /* Wspolna skala slupkow: najdluzszy z (SP, moc) = 100%, zeby dlugosci dalo sie porownac miedzy osobami. */
  const barScale = Math.max(1, ...people.map((p) => Math.max(p.sp, p.cap)));

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
  const current = summarize(base.sprint, shown, Date.now(), countReview, countAdded);

  /*
   * Zakres slupka: zadania TEGO sprintu bez zaszlosci — bez pracy, ktora byla
   * gotowa juz przed pierwszym dniem. Wykres odejmuje ja od punktu „Planowanie",
   * wiec slupek musi odjac ja tak samo; inaczej stalby obok linii i pokazywal
   * wieksza calosc niz ta, ktora linia spala. Przelacznik „Wliczaj do
   * zatwierdzenia" zmienia, co znaczy „gotowe", wiec przesuwa i tu, i tam —
   * zadanie oddane do akceptacji przed sprintem po prostu znika ze slupka,
   * a jego calosc maleje.
   */
  const scope = shown.filter((t) => !doneBeforeSprint(base.sprint, t, countReview));

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
          countAdded,
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

          {/*
            Kontrolki po PRAWEJ — zawezaja widok, wiec nie mieszaja sie z nazwa
            sprintu po lewej.

            Wlasny przelacznik, nie <input type=checkbox>: natywny kwadracik
            rysuje system operacyjny i obok reszty wygladal jak wklejka. Ksztalt
            jest ten sam, co „Widok: Własny ›" w pasku zakresu i co kontrolki
            planowania — jeden jezyk kontrolek w calej aplikacji.
          */}
          <button
            className={`views-btn tog${countReview ? ' tog-on' : ''}`}
            onClick={() => setCountReview((v) => !v)}
            /*
             * Podpowiedz mowi, CO SIE STANIE, a nie jak sie nazywa ustawienie.
             * Bez tego pierwsze pytanie brzmi "czemu spadlo takze Zaplanowane?" —
             * i nie da sie na nie odpowiedziec z samej nazwy przelacznika.
             */
            title={
              countReview
                ? [
                    'Zadanie czekające na akceptację liczy się jako zrobione.',
                    '',
                    'Oddane do zatwierdzenia W TRAKCIE sprintu:',
                    '  linia spada tego dnia, „Zaplanowane” bez zmian.',
                    '',
                    'Oddane JESZCZE PRZED sprintem:',
                    '  nikt nie robił tego w tym sprincie, więc linia nie spada —',
                    '  zaczyna się niżej i „Zaplanowane” jest mniejsze.',
                    '',
                    'Zadanie zostaje w sprincie i na liście. Zmienia się tylko to,',
                    'czy liczy się jako praca jeszcze do zrobienia.',
                  ].join('\n')
                : [
                    'Liczy się tylko kolumna „Wdrożone” — tak jak w Bitriksie.',
                    '',
                    'Zadanie czekające na akceptację jest wciąż niezrobione:',
                    'zostaje w „Zostało” i trzyma linię wysoko, choć pracy przy nim',
                    'już nie ma.',
                  ].join('\n')
            }
          >
            {/* Kwadrat jest ZAWSZE widoczny — pusty obrys, gdy wylaczone. Dawniej
                ptaszek znikal, a pudelko zostawalo puste; szerokosc sie zgadzala,
                ale stan „wylaczony" nie mial wlasnego znaku. */}
            <span className="tog-box">
              <CheckIcon />
            </span>
            Wliczaj do zatwierdzenia
          </button>

          <button
            className={`views-btn tog${countAdded ? ' tog-on' : ''}`}
            onClick={() => setCountAdded((v) => !v)}
            title={
              countAdded
                ? [
                    'Zadanie dodane w trakcie sprintu wchodzi na wykres w dniu,',
                    'w którym doszło — linia idzie wtedy w GÓRĘ.',
                    '',
                    'Dzięki temu wcześniejsze dni są mierzone tym, co wtedy',
                    'faktycznie było do zrobienia.',
                    '',
                    'Ogon przenoszony z poprzedniego sprintu liczy się od dnia',
                    'pierwszego — bo rzeczywiście był w sprincie od startu.',
                  ].join('\n')
                : [
                    'Wszystko liczy się od pierwszego dnia, także zadania dodane',
                    'później.',
                    '',
                    'Wykres nie skacze w górę, ale wcześniejsze dni wyglądają',
                    'gorzej: mierzą wczorajszą pracę zakresem, którego wczoraj',
                    'jeszcze nie było.',
                  ].join('\n')
            }
          >
            <span className="tog-box">
              <CheckIcon />
            </span>
            Dosypane od dnia dodania
          </button>

          {people.length > 1 && (
            <PersonPicker people={people} value={persons} onPick={setPersons} teamIds={new Set(team.members.map((m) => m.id))} />
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
          <Stat
            label="Zadania"
            value={String(current.taskCount)}
            hint={
              'Zadania, z których składa się praca TEGO sprintu.\n\n' +
              'Nie liczy tych, które były gotowe już przed jego startem — na liście\n' +
              'sprintu nadal je widać, bo ta odpowiada na inne pytanie: co jest\n' +
              'w sprincie, a nie ile w nim było do zrobienia.'
            }
          />
          {current.unestimated > 0 && (
            <Stat
              label="Bez oszacowania"
              value={String(current.unestimated)}
              hint="Zadania bez story pointów nie wchodzą do sumy — wykres ich nie widzi."
            />
          )}
        </div>

        {/*
          Podzialka zakresu na etapy stoi PRZY LEWEJ KRAWEDZI wykresu, na jego
          pelna wysokosc: to zdjecie stanu NA TERAZ, wiec czyta sie je razem
          z linia — „tyle zostalo" i „tak to jest rozlozone" w jednym spojrzeniu.

          Slupek slucha filtru osoby (te same `shown`) i przelacznika „Wliczaj do
          zatwierdzenia": kolory pokazuja kolumny, a kreska — gdzie ten przelacznik
          stawia granice gotowosci. „Dosypane od dnia dodania" go nie dotyczy, bo
          mowi o CZASIE wejscia pracy, a slupek zadnego czasu nie pokazuje.
        */}
        <div className="dash-plot">
          <ScopeBar
            segments={stageBreakdown(scope, stages)}
            /* Granica gotowosci liczona z TEGO SAMEGO zbioru co slupek, czyli
               z pracy TEGO sprintu. Zaszlosci juz z niego wypadly, wiec kreska
               pokazuje, ile spalono od pierwszego dnia — tyle samo, ile zjechala
               linia obok. Reszta slupka rowna sie koncowi linii. */
            done={scope.reduce((a, t) => (taskDone(t, countReview) ? a + (t.storyPoints ?? 0) : a), 0)}
          />

          <div className="dash-plot-main">
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

            {/*
              Brakujaca linia planu wymaga jednego zdania, nie domyslania sie.
              Pokazujemy je RAZ, przy legendzie — a nie przy kazdym dniu w
              odczycie, gdzie powtarzalo sie jak komunikat bledu. Od razu mowi
              tez, czym to przelaczyc.
            */}
          </div>
        </div>
      </section>


      {/*
        Osoby (issue #1) — per-user staty jako WLASNA karta pod wykresem.
        Klikniecie wiersza robi dokladnie to, co selektor w naglowku, wiec
        tabela i wykres steruja soba nawzajem: patrzysz, kto ile ma, klikasz
        i od razu widzisz jego linie.

        Liczby licza sie z tego samego zakresu sprintu co wszystko inne, wiec
        kolumna „Zaplanowane" sumuje sie do liczby nad wykresem.
      */}
      {people.length > 0 && (
        <section className="dash-card">
          <header className="dash-head">
            <h2>Osoby</h2>
            <span className="dash-sub">
              {persons.length ? 'Klik zdejmuje zaznaczenie' : 'Klik filtruje wykres wyżej'}
            </span>
            <button className="btn dash-team-btn" onClick={onOpenTeam} title="Role, moc, budżet SP i urlopy">
              Zespół i grafik
            </button>
          </header>

          <div className="dash-people">
            {people.map((p) => (
              <button
                key={p.id}
                className={`person-row${persons.includes(p.id) ? ' person-row-on' : ''}`}
                /* Ctrl/Shift jak wszedzie indziej: doklada do porownania zamiast
                   podmieniac wybor. Ta sama umowa co w selektorze i na liscie. */
                onClick={(e) => {
                  const add = e.ctrlKey || e.metaKey || e.shiftKey;
                  setPersons((cur) => {
                    if (add) {
                      return cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id];
                    }
                    return cur.length === 1 && cur[0] === p.id ? [] : [p.id];
                  });
                }}
              >
                <Avatar name={p.unassigned ? null : p.name} photo={p.photo} />
                <span className="person-row-name">
                  {p.name}
                  {p.role && <small className="person-row-role">{p.role}</small>}
                </span>

                {/* „zrobione z calosci" — sama calosc nie reaguje na przelacznik,
                    a sama reszta gubi skale (6 SP u kogos, kto ma 76). */}
                <span className="person-row-sp">
                  <b>{p.done}</b> / {p.sp} SP
                </span>

                {/* Slupek w skali wspolnej dla wszystkich; kreska = moc osoby w tym sprincie. */}
                <span className="person-bar">
                  <span className="person-bar-fill" style={{ width: `${(p.sp / barScale) * 100}%` }}>
                    <StageStrip segments={p.segments} done={p.done} />
                  </span>
                  {p.hasCap && p.cap > 0 && (
                    <span
                      className={`person-bar-cap person-bar-cap-${p.capState}`}
                      style={{ left: `${(p.cap / barScale) * 100}%` }}
                      title={`Pozostała moc do końca tygodnia: ${p.cap} h`}
                    />
                  )}
                </span>

                <span
                  className={`person-row-cap person-row-cap-${p.capState}`}
                  title={
                    p.capState === 'late'
                      ? 'Nie zdąży: pozostała moc nie pokrywa nawet zadań, które jeszcze nie ruszyły'
                      : p.capState === 'warn'
                        ? 'Uwaga: pozostała moc nie pokrywa zadań w toku'
                        : 'Pozostała moc do końca tygodnia (godziny = SP)'
                  }
                >
                  {p.hasCap ? `moc ${p.cap}${p.capState === 'late' ? ' · nie zdąży' : ''}` : ''}
                </span>

                <span className="person-row-count">
                  {p.count} {tasksWord(p.count)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/*
        Dwa ograniczenia wpisane w EKRAN, a nie schowane w kodzie — ale JEDNYM
        ciagiem, nie dwoma akapitami. To drobny druk pod wykresem: rozbity na
        bloki zaczyna wygladac jak sekcja, ktora trzeba przeczytac, a ma byc
        przypisem, na ktory sie zerka.

        1. ZAKRES: karta liczy prace tego sprintu, wiec pomija zadania gotowe juz
           przed jego startem. Bez tego zdania liczby nie zgadzaja sie z lista
           sprintu i nie wiadomo dlaczego — a to pierwsze pytanie, jakie pada.
        2. STORY POINTY nie maja historii w Bitriksie, wiec kazdy dzien liczy sie
           DZISIEJSZYM oszacowaniem; przeszacowanie w trakcie sprintu zmienia tez
           przeszle punkty i nie da sie tego wykryc.
      */}
      <p className="dash-note">
        Liczby dotyczą pracy <b>tego</b> sprintu — zadania gotowe przed jego startem nie
        wchodzą do żadnej z nich, choć na liście sprintu nadal je widać. Spalanie liczone
        z dzisiejszych story pointów: Bitrix nie zapisuje ich historii, więc zmiana
        oszacowania przesuwa także wcześniejsze dni.
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
  teamIds,
}: {
  teamIds: ReadonlySet<number>;
  people: { id: number; name: string; photo: string | null; sp: number; left: number; unassigned: boolean }[];
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
                  <Avatar name={p.unassigned ? null : p.name} photo={p.photo} />
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
            ...teamFirst(people, teamIds).map(({ item: p, section }) => ({
              section,
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
