/*
 * Widok planowania: rejestr po lewej, sprinty po prawej.
 *
 * Po co osobny widok, skoro lista i tablica juz sa: przy planowaniu patrzy sie
 * na DWA zbiory naraz i przekłada miedzy nimi. Lista pokazuje jeden zakres,
 * tablica jeden sprint — zadne z nich nie odpowiada na pytanie "co jeszcze
 * wziac i czy to sie zmiesci".
 *
 * Trzy rzeczy, ktorych brakowalo w planowaniu Bitriksa i ktore sa tu wprost:
 *
 *  1. LICZBY IDA ZA FILTREM. Zawezenie listy przelicza sumy. U Bitriksa sumy
 *     zostawaly dla calosci, wiec po odfiltrowaniu nie mowily juz o tym, co
 *     widac.
 *  2. OBCIAZENIE OSOB. Sam licznik SP mowi, ze sprint jest pelny; nie mowi,
 *     czyj jest. Pasek osob pokazuje rozklad i zmienia sie przy kazdym
 *     dorzuceniu.
 *  3. GESTY WIERSZE. Wiecej informacji w jednej linii zamiast wielkich kart:
 *     w rejestrze jest ich 175 i przewijanie po dziesiec na ekran to zaden
 *     przeglad.
 *
 * Samego przenoszenia ten plik NIE obsluguje — cele upuszczania rejestruje, ale
 * decyzje podejmuje `onDragEnd` w App.tsx, w jednym wspolnym `DndContext`.
 */

import { ostatnioDodaneNaGorze, type Dodane } from './planRecent';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';

import { CLOSED_STATUSES, REVIEW_STATUSES, type Sprint, type Task } from './bitrix';
import { planDropId } from './dnd';
import { podzielNaZespolIKierownika, pozaLimitem, sumaDoLimitu, sumaKierownika } from './planCapacity';
import { PLAN_SORT_DOMYSLNY } from './planSort';
import { BarsIcon, CheckIcon, ChevronIcon, GripIcon, personColor } from './icons';
import { Picker, type Anchor } from './Picker';
import { tagsForWidth } from './taskView';

/*
 * Ile wysokosci prawej kolumny bierze sprint AKTYWNY. Reszta idzie do kolejnego.
 *
 * Nie po polowie: planuje sie GLOWNIE w sprincie aktywnym — to w nim sie czyta,
 * przestawia i skresla — a kolejny jest na razie miejscem odkladczym, czesto
 * pustym. Rowny podzial oddawal polowe ekranu liscie na kilka pozycji i kazal
 * przewijac te, w ktorej naprawde sie pracuje. Suwak i chevron dzialaja dalej,
 * a dwuklik w uchwyt wraca tutaj.
 */
const SPLIT_DEFAULT = 0.8;

/** „zadanie / zadania / zadan" — zeby liczba w naglowku czytala sie po polsku. */
function plural(n: number): string {
  if (n === 1) return 'zadanie';
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? 'zadania' : 'zadań';
}

/** Zwiniete sumy jednego panelu. Liczone ZAWSZE z tego, co panel pokazuje. */
interface PaneStats {
  points: number;
  count: number;
  /** Ile zadan nie ma oszacowania — o tyle `points` jest zanizone. */
  unestimated: number;
  /**
   * Rozklad SP po osobach, malejaco. Nieprzypisane zostaja jako `id: null`.
   *
   * `carry` to ta czesc punktow osoby, ktora przyjdzie z trwajacego sprintu —
   * pasek rysuje ja kreskowaniem, zeby bylo widac, ile z czyjegos obciazenia to
   * praca wybrana teraz, a ile zaleglosc.
   */
  load: { id: number | null; name: string; photo: string | null; points: number; carry: number }[];
}

type Udzial = { id: number | null; name: string; photo: string | null; points: number; carry: number };

function statsOf(
  tasks: Task[],
  people: { id: number; name: string; photo: string | null }[],
  /** Identyfikatory zadan PRZENIESIONYCH — patrz `load[].carry`. */
  przeniesione?: Set<number>,
): PaneStats {
  const byId = new Map(people.map((p) => [p.id, p]));
  const load = new Map<number | null, Udzial>();

  let points = 0;
  let unestimated = 0;
  for (const t of tasks) {
    const sp = t.storyPoints ?? 0;
    points += sp;
    if (t.storyPoints === null) unestimated += 1;

    /*
     * Nieprzypisane trzymamy jako osobna pozycje, a nie pomijamy: to wlasnie ta
     * czesc sprintu, ktorej nikt nie wzial, i przy planowaniu jest wazniejsza
     * od reszty.
     */
    const id = t.responsibleId;
    const known = id !== null ? byId.get(id) : undefined;
    const key = id ?? null;
    const cur = load.get(key) ?? {
      id: key,
      name: known?.name ?? t.responsibleName ?? (key === null ? 'Nieprzypisane' : `#${key}`),
      photo: known?.photo ?? null,
      points: 0,
      carry: 0,
    };
    cur.points += sp;
    if (przeniesione?.has(t.id)) cur.carry += sp;
    load.set(key, cur);
  }

  return {
    points,
    count: tasks.length,
    unestimated,
    load: [...load.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'pl')),
  };
}

/**
 * Zdanie pod paskiem: ile zostalo, ile ponad, albo ze wypelnione co do punktu.
 *
 * Etykieta w NAWIASIE, a nie wpleciona w zdanie: „ostatnio dowiezione
 * (Sprint 67)" nie odmienia sie po polsku razem z reszta, wiec kazde wplecenie
 * wychodzilo koslawo („do ostatnio dowiezione").
 */
function opisMocy(points: number, compare: { label: string; points: number }): string {
  if (points > compare.points)
    return `+${points - compare.points} SP ponad ${compare.points} SP — ${compare.label}`;
  if (points === compare.points)
    return `Wypełnione co do punktu: ${compare.points} SP — ${compare.label}`;
  return `Zostało ${compare.points - points} SP z ${compare.points} SP — ${compare.label}`;
}

/**
 * JEDEN pasek na panel: rozklad SP po osobach, w skali mocy zespolu.
 *
 * Wczesniej byly dwa, jeden pod drugim — pasek mocy („ile z limitu") i pasek osob
 * („czyje to"). Kazdy odpowiadal na pol pytania i zaden nie odpowiadal na cale:
 * po pasku mocy nie bylo widac, kto jest obciazony, a po pasku osob nie bylo
 * widac, ile jeszcze wolno wziac. Zlozone razem: kolor to osoba, dlugosc to
 * punkty, a caly tor to moce zespolu.
 *
 * Skala: tor ma dlugosc `max(limit, suma)`. Dopoki sprint sie miesci, kreska
 * stoi na prawej krawedzi (100% mocy) i pusty ogon jest miejscem, ktore zostalo.
 * Po przekroczeniu tor rozciaga sie do sumy, a kreska wjezdza w glab paska — to,
 * co za nia, jest nadmiarem, i wtedy kreska robi sie czerwona.
 *
 * `limit` rowny zeru znaczy „brak odniesienia" (rejestr, sprint aktywny) — tor
 * jest wtedy sama suma, czyli pasek zachowuje sie jak zwykly rozklad po osobach.
 *
 * Podpis pod kursorem, a nie natywny `title`: ten pokazuje sie z sekundowym
 * opoznieniem i rysuje go system, wiec przy pasku, po ktorym wodzi sie mysza,
 * jest bezuzyteczny. Ten sam wybor i ten sam wyglad co odczyt na wykresie
 * spalania.
 */
function Pasek({
  stats,
  limit = 0,
  zawsze,
  note,
  dopisek,
}: {
  stats: PaneStats;
  /** Moce zespolu w SP; 0 = bez odniesienia. */
  limit?: number;
  /** Rysuj sam tor, gdy nie ma czego rozkladac (zeby warianty sie zgadzaly). */
  zawsze?: boolean;
  /** Zdanie pod paskiem: ile zostalo albo ile ponad. */
  note?: string;
  /** Druga linijka — skad wziely sie punkty przeniesione. */
  dopisek?: string;
}) {
  const [hover, setHover] = useState<{ name: string; points: number; carry: number; at: number } | null>(
    null,
  );
  const barRef = useRef<HTMLDivElement>(null);

  if (stats.points <= 0 && !zawsze) return null;

  /* Tor: moce zespolu, a gdy sprint je przekracza — cala suma, zeby nadmiar mial
     gdzie sie zmiescic. Bez odniesienia tor jest sama suma. */
  const tor = Math.max(limit, stats.points) || 1;
  const pct = (v: number) => (v / tor) * 100;
  const ponad = limit > 0 && stats.points > limit;
  /*
   * Przy przekroczeniu kawalki osob SCISKAMY do pola przed kreska mocy — kolor
   * konczy sie na kresce, a tor za nia zostaje pusty i pokazuje sam nadmiar.
   * Proporcje miedzy osobami zostaja, zmienia sie tylko skala kawalkow.
   */
  const skala = ponad ? limit / stats.points : 1;
  const szer = (v: number) => pct(v * skala);

  /*
   * Zaokraglenie PRAWEGO konca dostaje ostatni kawalek, i tylko gdy wypelnienie
   * naprawde dochodzi do konca toru. Nie da sie tego zrobic przez `:last-child`:
   * po kawalkach w pasku stoja jeszcze kreska i podpis, tez jako `span`. A gdy
   * sprint nie wypelnia mocy, koniec wypelnienia ma byc PROSTY — jak w kazdym
   * pasku postepu, ktory sie jeszcze nie skonczyl.
   */
  const pelny = limit === 0 || stats.points === limit;
  const ostatni = [...stats.load].reverse().find((p) => p.points > 0);
  const koniec = (p: (typeof stats.load)[number], czyCarry: boolean) =>
    pelny && p === ostatni && (p.carry > 0 ? czyCarry : !czyCarry);

  return (
    <div className="plan-load">
      <div className="plan-load-bar" ref={barRef} onMouseLeave={() => setHover(null)}>
        {stats.load.map((p) => {
          const kolor = p.id === null ? 'var(--fg-dim)' : personColor(p.name);
          const pokaz = (e: React.MouseEvent) => {
            const box = barRef.current?.getBoundingClientRect();
            if (!box) return;
            /* Pozycja WZGLEDEM paska — podpis ma isc za kursorem, nie stac na
               srodku kawalka, ktory bywa szerszy niz pol panelu. */
            setHover({ name: p.name, points: p.points, carry: p.carry, at: e.clientX - box.left });
          };

          /*
           * Osoba moze miec DWA kawalki: wybrane teraz i przeniesione. Oba w jej
           * kolorze, drugi kreskowany — inaczej nie da sie odczytac, czy ktos jest
           * obciazony wyborem, czy zaleglocia, a to zmienia decyzje przy dokladaniu.
           */
          const wybrane = Math.max(0, p.points - p.carry);
          return (
            <Fragment key={String(p.id)}>
              {wybrane > 0 && (
                <span
                  className={`plan-load-seg${koniec(p, false) ? ' plan-load-seg-koniec' : ''}`}
                  style={{ width: `${szer(wybrane)}%`, background: kolor }}
                  onMouseMove={pokaz}
                />
              )}
              {p.carry > 0 && (
                <span
                  className={`plan-load-seg plan-load-carry${koniec(p, true) ? ' plan-load-seg-koniec' : ''}`}
                  style={{ width: `${szer(p.carry)}%`, background: kolor }}
                  onMouseMove={pokaz}
                />
              )}
            </Fragment>
          );
        })}

        {/*
          Gdzie KONCZY sie wypelnienie — czerwona kreska, jak na pasku postepu.
          Tylko ponizej mocy: przy przekroczeniu wypelnienie siega konca toru,
          a granice pokazuje kreska mocy (tez czerwona).
        */}
        {limit > 0 && !ponad && stats.points > 0 && stats.points < limit && (
          <span className="plan-load-mark plan-load-mark-ponad" style={{ left: `${pct(stats.points)}%` }} />
        )}

        {/* Kreska mocy zespolu. Na prawej krawedzi, dopoki sprint sie miesci. */}
        {limit > 0 && (
          <span
            className={`plan-load-mark${ponad ? ' plan-load-mark-ponad' : ''}`}
            style={{ left: `${pct(limit)}%` }}
          />
        )}

        {hover && (
          /*
           * Przy prawej krawedzi podpis ucieka w lewo, zeby nie wyszedl poza
           * panel — dokladnie jak odczyt na wykresie.
           */
          <span
            className="plan-load-tip"
            style={
              hover.at > (barRef.current?.clientWidth ?? 0) - 120
                ? { right: (barRef.current?.clientWidth ?? 0) - hover.at }
                : { left: hover.at }
            }
          >
            {hover.name}
            <b>{hover.points} SP</b>
            {hover.carry > 0 && <span className="plan-load-tip-carry">z tego {hover.carry} z przeniesienia</span>}
          </span>
        )}
      </div>

      {note && (
        <span className="plan-compare-note">
          {note}
          {dopisek && <span className="plan-compare-skad">{dopisek}</span>}
        </span>
      )}
    </div>
  );
}

/** Kolejnosc waznosci: STRATEGIA, priorytet Bitriksa, tag „Wysoki", okres zwrotu, story pointy malejaco. */
/** Kursor blizej gory kolumny niz tyle = na naglowku sprintu aktywnego, czyli zwin go. */
const FOLD_PX = 56;
/** Tyle trzeba przesunac mysz, zeby wcisniecie uchwytu stalo sie przeciaganiem. */
const DRAG_PX = 4;

export const SORT_DOMYSLNY: { by: string; dir: 'asc' | 'desc' }[] = PLAN_SORT_DOMYSLNY;

const jestDomyslne = (sort: { by: string; dir: string }[]) =>
  sort.length === SORT_DOMYSLNY.length &&
  sort.every((l, i) => l.by === SORT_DOMYSLNY[i].by && l.dir === SORT_DOMYSLNY[i].dir);

/** Stala, nie nowa tablica przy kazdym renderze — inaczej memo zalezne od niej liczyloby sie od nowa. */
const BEZ_KIEROWNIKOW: readonly number[] = [];

/** Panel: naglowek z liczbami, pasek osob i lista wierszy. Jest celem upuszczania. */
function Pane({
  title,
  subtitle,
  sprintId,
  tasks,
  people,
  renderRow,
  ponad,
  nowe,
  collapsible = false,
  compare,
  carry,
  wMoce,
  kierownicy = BEZ_KIEROWNIKOW,
  grow,
  zwiniety = false,
  onZwin,
}: {
  title: string;
  subtitle?: string;
  /** `null` = rejestr (backlog). */
  sprintId: number | null;
  tasks: Task[];
  people: { id: number; name: string; photo: string | null }[];
  /** Wiersz rysuje App — TYM SAMYM komponentem co lista, zeby widoki nie rozjechaly sie wygladem. */
  /**
   * Wiersz rysuje App (ten sam komponent co lista). Drugi argument to limit
   * tagow policzony z szerokosci TEGO panelu: panel zna swoja szerokosc, a App
   * wie, jak narysowac wiersz. Bez tego panel dostawal limit wyliczony dla
   * calej listy i tagi nie miescily sie w o polowe wezszym wierszu.
   */
  renderRow: (t: Task, limitTagow?: number) => React.ReactNode;
  /**
   * Czy zadanie NIE MIESCI sie w pozostalych punktach. Podaje to tylko rejestr —
   * w sprintach pytanie nie ma sensu, bo one sa juz policzone.
   */
  ponad?: (t: Task) => boolean;
  /**
   * Czy zadanie zostalo przeciagniete do tego sprintu w tej sesji. Takie leza na gorze panelu
   * (`ostatnioDodaneNaGorze`), wiec pod nimi stoi kreska — nizej dziala juz wybrane sortowanie.
   */
  nowe?: (t: Task) => boolean;
  collapsible?: boolean;
  /** Odniesienie: ile SP zespol NAPRAWDE dowiozl ostatnio. */
  compare?: { label: string; points: number; wlasne?: boolean };
  /**
   * PRZENIESIENIE — niedomknieta praca z trwajacego sprintu, ktora wejdzie do
   * tego panelu sama, bez niczyjej decyzji.
   *
   * Licznik mocy liczony z samych zadan JUZ przypisanych do planowanego sprintu
   * klamal na korzysc: pokazywal wolne moce, ktore w rzeczywistosci sa zajete
   * przez to, czego nie skonczono. Panel dostaje wiec oba warianty — wybrane
   * recznie i to samo z doliczonym przeniesieniem — bo pierwszy odpowiada na
   * „ile wzielismy", a drugi na „ile zespol naprawde uniesie".
   *
   * Zadania, nie liczby: ten sam zestaw karmi licznik mocy i rozklad po osobach.
   */
  carry?: { tasks: Task[]; label: string };
  /**
   * Ktore zadania panelu ZAJMUJA MOCE zespolu. Brak = wszystkie.
   *
   * Liczby w naglowku opisuja to, co panel POKAZUJE (wraz z odsiewem
   * przelacznikow), a licznik mocy odpowiada na inne pytanie: ile pracy ten
   * sprint jeszcze zabierze. Praca zakonczona i oddana do akceptacji nie zabiera
   * juz nic, wiec do mocy nie wchodzi — inaczej wlaczenie „pokaz zakonczone"
   * podnosilo obciazenie sprintu, choc nic sie w nim nie zmienilo.
   */
  wMoce?: (t: Task) => boolean;
  /**
   * Osoby spoza limitu zespolu (kierownik) — ich zadania NIE zajmuja mocy: nie wchodza do
   * pasków „zaplanowane" i „z przeniesieniem" ani do licznika „ponad moce". Pokazujemy je osobno,
   * pod paskami zespolu, i w naglowku jako „SP kierownika".
   */
  kierownicy?: readonly number[];
  /** Udzial w wysokosci kolumny (0-1). Brak = panel dzieli sie po rowno. */
  /** Ulamek miejsca. Tekst (`var(--plan-cols)`) pozwala ciagnac uchwyt bez renderu. */
  grow?: number | string;
  /** Zwiniecie trzyma App — lokalny stan ginal przy kazdym przelaczeniu widoku. */
  zwiniety?: boolean;
  onZwin?: () => void;
}) {
  const open = !zwiniety;
  const stats = useMemo(() => statsOf(tasks, people), [tasks, people]);
  /*
   * Wariant „z przeniesieniem" liczymy z SUMY obu zestawow, a nie z samego
   * przeniesienia: pytanie brzmi „ile bedzie w tym sprincie", wiec zadania
   * wybrane recznie musza sie w nim znalezc. `null`, gdy nie ma czego przenosic —
   * wtedy oba warianty bylyby tym samym paskiem dwa razy.
   */
  /* Zadania liczone do mocy — to z nich ida oba paski, a nie z tego, co widac. */
  const doMocy = useMemo(() => (wMoce ? tasks.filter(wMoce) : tasks), [tasks, wMoce]);
  /*
   * ZESPOL I KIEROWNIK osobno. Do mocy zespolu (paski, „ponad moce") liczy sie tylko zespol —
   * zadania kierownika nie zjadaja limitu, wiec nie mozna ich wrzucac do tych samych sum. Kierownik
   * ma wlasny pasek bez odniesienia i wlasna liczbe w naglowku.
   */
  const maKierownika = kierownicy.length > 0;
  const { zespol: doMocyZespolu, kierownik: doMocyKierownika } = useMemo(
    () => podzielNaZespolIKierownika(doMocy, kierownicy),
    [doMocy, kierownicy],
  );
  const { zespol: przeniesioneZespolu, kierownik: przeniesioneKierownika } = useMemo(
    () => podzielNaZespolIKierownika(carry?.tasks ?? [], kierownicy),
    [carry, kierownicy],
  );
  const statsMoc = useMemo(
    () => (wMoce || maKierownika ? statsOf(doMocyZespolu, people) : stats),
    [wMoce, maKierownika, doMocyZespolu, people, stats],
  );
  const carryStats = useMemo(
    () =>
      przeniesioneZespolu.length > 0
        ? statsOf(
            [...doMocyZespolu, ...przeniesioneZespolu],
            people,
            new Set(przeniesioneZespolu.map((t) => t.id)),
          )
        : null,
    [przeniesioneZespolu, doMocyZespolu, people],
  );
  /* Kierownik: wybrane teraz + jego przeniesienie (kreskowane) — bez odniesienia do limitu. */
  const kierownikStats = useMemo(
    () =>
      doMocyKierownika.length + przeniesioneKierownika.length > 0
        ? statsOf(
            [...doMocyKierownika, ...przeniesioneKierownika],
            people,
            new Set(przeniesioneKierownika.map((t) => t.id)),
          )
        : null,
    [doMocyKierownika, przeniesioneKierownika, people],
  );
  /* Naglowek opisuje to, co panel POKAZUJE, wiec dzieli wszystkie wyswietlane zadania. */
  const spZespolu = sumaDoLimitu(tasks, kierownicy);
  const spKierownika = sumaKierownika(tasks, kierownicy);
  const { setNodeRef, isOver, active } = useDroppable({ id: planDropId(sprintId) });

  /* Szerokosc TEGO panelu — zmienia sie przy ciagnieciu uchwytu i przy otwarciu
     panelu szczegolow, wiec mierzymy na zywo, a nie raz przy montowaniu. */
  const [szerokosc, setSzerokosc] = useState(0);
  const paneRef = useRef<HTMLElement | null>(null);
  /*
   * `useLayoutEffect`, nie `useEffect`, i odczyt OD RAZU — nie tylko przez
   * obserwatora. Sam `ResizeObserver` zostawal z zerem: lapal panel, zanim
   * uklad flex policzyl mu szerokosc, a pozniejsze ulozenie nie zawsze wywoluje
   * kolejne zgloszenie. Zero znaczylo „najwezszy mozliwy wiersz", wiec tagi
   * zwijaly sie do „+N" nawet na szerokim ekranie.
   */
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    setSzerokosc(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([w]) => setSzerokosc(w.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Podswietlamy dopiero, gdy cos naprawde jest w reku — samo `isOver` lapie
     kazdy ruch myszy nad panelem. */
  const armed = Boolean(active);

  return (
    <section
      ref={(el) => {
        paneRef.current = el;
        setNodeRef(el);
      }}
      /*
       * `plan-pane-ciasny` wlacza sie ponizej 480 px — tam, gdzie limit tagow
       * spada juz do zera, a wiersz nadal sie nie miesci. Kolejnosc ustepowania:
       * najpierw tagi (dopisek), potem data zmiany (da sie ja odczytac z panelu
       * szczegolow), a awatar i tytul zostaja do konca, bo odpowiadaja na
       * „czyje to" i „co to".
       */
      className={`plan-pane${open ? '' : ' plan-pane-shut'}${armed ? ' plan-pane-armed' : ''}${isOver && armed ? ' plan-pane-over' : ''}${szerokosc > 0 && szerokosc < 480 ? ' plan-pane-ciasny' : ''}`}
      /*
       * Udzial w wysokosci idzie ZMIENNA, nie wprost przez `flex-grow`.
       *
       * Styl w atrybucie bije kazda regule arkusza, wiec przy wprost wpisanym
       * `flex-grow` nie dalo sie go nadpisac — a trzeba, gdy sasiad jest zwiniety
       * (patrz regula `:has` przy `.plan-right`). Zmienna arkusz odczytuje i moze
       * zignorowac.
       *
       * Zwiniety panel nie dostaje zadnego udzialu — ma byc samym naglowkiem.
       */
      style={
        grow !== undefined && open ? ({ ['--plan-grow']: grow } as React.CSSProperties) : undefined
      }
    >
      <header className="plan-head">
        {collapsible && (
          <button className="plan-fold" onClick={onZwin} title="Zwiń / rozwiń">
            <ChevronIcon open={open} />
          </button>
        )}
        <h2>{title}</h2>
        {subtitle && <span className="plan-sub">{subtitle}</span>}

        {/*
          Kazda liczba ze SWOJA jednostka, jako osobny kawalek.
          Wczesniej bylo "69 SP · 21 zad." w jednym ciagu, z przygaszona
          jednostka — i czytalo sie jako "69 zadan". Zmiana kolejnosci tego nie
          naprawiala: winna byla jednostka doklejona ciszej niz liczba, przez co
          znikala. Teraz jednostka ma ten sam glos co liczba i nie da sie jej
          przeoczyc, a pary sa rozsuniete zamiast rozdzielone kropka.
        */}
        <span className="plan-nums">
          {/*
            „Bez SP" to ZASTRZEZENIE DO LICZBY ZADAN, a nie trzecia rownorzedna
            liczba: mowi, ilu z tych 59 nie policzono do sumy punktow. Stojac
            osobno, na koncu, czytalo sie jak kolejna miara panelu — i ciag
            „59 zadań 297 SP 6 bez SP" rozpadal sie na trzy niepowiazane liczby.
            W nawiasie, tuz przy swojej liczbie, wiadomo czego dotyczy.
          */}
          <span className="plan-num">
            <b>{stats.count}</b> {plural(stats.count)}
            {stats.unestimated > 0 && (
              <span className="plan-miss" title="Zadania bez oszacowania — nie wchodzą do sumy SP">
                {' '}
                ({stats.unestimated} bez SP)
              </span>
            )}
          </span>
          {maKierownika && spKierownika > 0 ? (
            <>
              <span className="plan-num" title="Zadania zespołu — to one zajmują moce">
                <b>{spZespolu}</b> SP zespołu
              </span>
              <span className="plan-num plan-num-kierownik" title="Zadania kierownika — poza limitem zespołu">
                <b>{spKierownika}</b> SP kierownika
              </span>
            </>
          ) : (
            <span className="plan-num">
              <b>{stats.points}</b> SP
            </span>
          )}
          {compare && compare.points > 0 && statsMoc.points > compare.points && (
            <span className="plan-num plan-over" title={`${compare.label}: ${compare.points} SP`}>
              +{statsMoc.points - compare.points} SP ponad {compare.wlasne ? 'moce' : 'ostatni sprint'}
            </span>
          )}
        </span>
      </header>

      {/*
        LICZNIK panelu — jeden pasek na wariant. Gdy jest przeniesienie, wariantow
        jest dwa: „zaplanowane" i to samo z doliczona zaleglocia. Kazdy ma swoj
        podpis, bo bez niego dwa takie same paski sa nieodroznialne.
      */}
      {open && (
        <div className="plan-liczniki">
          <div className="plan-wariant">
            {(carryStats || maKierownika) && (
              <span className="plan-wariant-podpis">
                {maKierownika ? (carryStats ? 'Zespół · zaplanowane' : 'Zespół') : 'Zaplanowane'}
              </span>
            )}
            <Pasek
              stats={statsMoc}
              limit={compare?.points ?? 0}
              zawsze={Boolean(carryStats) || maKierownika || (compare?.points ?? 0) > 0}
              note={compare && compare.points > 0 ? opisMocy(statsMoc.points, compare) : undefined}
            />
          </div>

          {carryStats && (
            <div className="plan-wariant">
              <span className="plan-wariant-podpis">
                {maKierownika ? 'Zespół · z przeniesieniem' : 'Z przeniesieniem'}
              </span>
              <Pasek
                stats={carryStats}
                limit={compare?.points ?? 0}
                note={compare && compare.points > 0 ? opisMocy(carryStats.points, compare) : undefined}
                dopisek={`${przeniesioneZespolu.length} ${plural(przeniesioneZespolu.length)} bez zakończenia w ${carry!.label} — ${carryStats.points - statsMoc.points} SP`}
              />
            </div>
          )}

          {/* Kierownik: osobny pasek, BEZ limitu — jego zadania nie zajmuja mocy zespolu. */}
          {kierownikStats && (
            <div className="plan-wariant">
              <span className="plan-wariant-podpis">Kierownik · poza limitem</span>
              <Pasek
                stats={kierownikStats}
                zawsze
                note={`${kierownikStats.points} SP — nie wlicza się do limitu zespołu`}
                dopisek={
                  przeniesioneKierownika.length > 0
                    ? `w tym ${przeniesioneKierownika.reduce((n, t) => n + (t.storyPoints ?? 0), 0)} SP z przeniesienia`
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="plan-list">
          {tasks.length === 0 ? (
            <div className="plan-empty">
              {sprintId === null ? 'Rejestr jest pusty.' : 'Przeciągnij tutaj zadania z rejestru.'}
            </div>
          ) : (
            tasks.map((t, i) => {
              const za = ponad?.(t) ?? false;
              /* Kreska stoi RAZ, przy pierwszym zadaniu ponad limit — to granica
                 miedzy „da sie wziac" a „juz sie nie zmiesci", a nie ozdoba
                 kazdego wiersza. Lista jest posortowana tak, ze przekraczajace
                 leza na koncu, wiec granica jest dokladnie jedna. */
              const granica = za && !(i > 0 && (ponad?.(tasks[i - 1]) ?? false));
              /* Koniec bloku „dodane w tej sesji": pierwsze zadanie spoza niego, gdy blok cos ma. */
              const poNowych = i > 0 && nowe !== undefined && nowe(tasks[i - 1]) && !nowe(t);
              return (
                <Fragment key={t.id}>
                  {poNowych && (
                    <div className="plan-nowe" role="separator">
                      <span>↑ dodane w tej sesji</span>
                    </div>
                  )}
                  {granica && (
                    <div className="plan-granica" role="separator">
                      <span>nie mieści się w pozostałych punktach</span>
                    </div>
                  )}
                  <div className={za ? 'plan-row-ponad' : undefined}>
                    {renderRow(t, tagsForWidth(szerokosc))}
                  </div>
                </Fragment>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function Planning({
  tasks,
  activeSprint,
  nextSprint,
  onCreateSprint,
  lastDone,
  people,
  renderRow,
  rejestrTasks,
  showReview,
  onToggleReview,
  showDone,
  onToggleDone,
  moce,
  onMoce,
  dzialy,
  teraz,
  kolejkaWl,
  onKolejkaWl,
  podzial,
  onPodzial,
  zwiniete,
  onZwin,
  onLosuj,
  onPomin,
  onPrzestaw,
  onObecny,
  tylkoDoStartu,
  onTylkoDoStartu,
  przeniesienie,
  onPrzeniesienie,
  sort,
  sortFields,
  dodane,
  onSort,
  kierownicy = BEZ_KIEROWNIKOW,
}: {
  /**
   * Osoby spoza limitu zespolu (BX_CAPACITY_EXCLUDE_IDS) — ich zadania nie zajmuja mocy sprintu:
   * ani przy pasku „z przeniesieniem", ani przy liczeniu, ile punktow rejestr moze jeszcze wziac.
   */
  kierownicy?: readonly number[];
  /**
   * Zadania do SPRINTOW — wszystkie, bez filtrow i bez szukania.
   *
   * Filtr zaweza wylacznie rejestr (`rejestrTasks`). Gdyby dotykal takze paneli
   * sprintu, kazdy filtr zmienialby sumy SP i licznik mocy, choc w sprincie nic
   * sie nie zmienilo — a to wlasnie liczby sprintu maja tu byc prawda. Rejestr
   * przeciwnie: tam sie SZUKA, wiec zawezanie jest cala jego robota.
   */
  tasks: Task[];
  /** Zadania do REJESTRU — po filtrach i po szukaniu. */
  rejestrTasks: Task[];
  activeSprint: Sprint | null;
  nextSprint: Sprint | null;
  /**
   * Zalozenie kolejnego sprintu. `undefined`, gdy nie ma z czego go zaproponowac
   * (brak aktywnego sprintu albo jego nazwa nie konczy sie numerem) — wtedy
   * przycisku nie ma, zamiast pokazywac taki, ktory nie wie, co zalozyc.
   */
  onCreateSprint?: () => void;
  /** Ostatni domkniety sprint i to, co w nim zostalo — czyli co dowieziono. */
  lastDone: { name: string; points: number } | null;
  /**
   * Moce zespolu na sprint w SP, wpisane recznie. `null` = nie ustawiono i za
   * odniesienie sluzy `lastDone`, czyli ile zespol naprawde dowiozl ostatnio.
   */
  moce: number | null;
  onMoce: (v: number | null) => void;
  /**
   * KOLEJKA DZIALOW — kto po kim wybiera zadanie do kolejnego sprintu. Dzialy to
   * epiki grupy, wiec nie ma tu drugiego slownika do utrzymywania.
   */
  dzialy: { id: number; nazwa: string; color: string | null; obecny: boolean }[];
  /** Dzial, ktorego jest tura. `null`, gdy nikt nie jest obecny albo kolejka jest wylaczona. */
  teraz: { id: number; nazwa: string } | null;
  /**
   * Czy KOLEJKA jest w uzyciu.
   *
   * Wylaczona: rejestr przestaje sie zawezac do epiku i do `DO-STARTU`, a same
   * kontrolki kolejki gasna. Planuje sie tak poza spotkaniem — gdy nikt nie
   * wybiera po kolei, a chodzi o przejrzenie calego rejestru.
   */
  kolejkaWl: boolean;
  onKolejkaWl: () => void;
  /**
   * PODZIAL WIDOKU, zapamietany miedzy wejsciami: `cols` to rejestr kontra
   * kolumna sprintow, `split` to sprint aktywny kontra planowany.
   *
   * Trzymane poza tym komponentem, bo przelaczenie widoku go ODMONTOWUJE — a
   * wtedy stan wewnetrzny przepada i przy kazdym powrocie panele wracaly do
   * proporcji domyslnych. Wygladalo to, jakby uklad sam sie przestawial.
   *
   * Ulamki, nie piksele: okno bywa zmieniane, a proporcja przezywa to bez
   * przeliczania.
   */
  podzial: { cols: number; split: number };
  onPodzial: (v: { cols: number; split: number }) => void;
  /** Zwiniete panele sprintow (ID). Z gory z tego samego powodu co `podzial`. */
  zwiniete: number[];
  onZwin: (sprintId: number) => void;
  onLosuj: () => void;
  onPomin: () => void;
  onPrzestaw: (z: number, na: number) => void;
  onObecny: (id: number) => void;
  /** Czy rejestr w trakcie tury pokazuje tylko zadania z tagiem `DO-STARTU`. */
  tylkoDoStartu: boolean;
  onTylkoDoStartu: () => void;
  /** Wlicz do mocy kolejnego sprintu to, czego nie domknieto w trwajacym. */
  przeniesienie: boolean;
  onPrzeniesienie: () => void;
  people: { id: number; name: string; photo: string | null }[];
  /** Wiersz rysuje App — tym samym komponentem co lista. */
  /** Jak wyzej w `Pane`: drugi argument to limit tagow policzony przez panel. */
  renderRow: (t: Task, limitTagow?: number) => React.ReactNode;
  /*
   * Filtry TEGO widoku — wlasne, nie te z panelu. Planowanie pyta "co bierzemy
   * dalej", wiec domyslnie bez zakonczonych, za to z oddanymi do akceptacji.
   */
  showReview: boolean;
  onToggleReview: () => void;
  showDone: boolean;
  onToggleDone: () => void;
  /*
   * STOS kluczy sortowania: pierwszy rozstrzyga, kolejny wchodzi przy remisie.
   * Klik zastepuje caly stos, Ctrl/Shift+klik dokłada poziom — ta sama umowa,
   * co przy zaznaczaniu zadan i przy wyborze osob na wykresie.
   */
  sort: { by: string; dir: 'asc' | 'desc' }[];
  sortFields: { key: string; label: string }[];
  /**
   * Kolejnosc wejscia do sprintu w tej sesji — ostatnio przeciagniete ma byc na gorze, ale tylko w
   * KOLEJNYM sprincie: to jego sie teraz wypelnia. Trwajacy sprint zostaje w wybranym sortowaniu.
   */
  dodane: Dodane;
  onSort: (next: { by: string; dir: 'asc' | 'desc' }[]) => void;
}) {
  /*
   * REJESTR zawsze bez pracy domknietej i bez oddanej do akceptacji — jednego
   * ani drugiego nie da sie zaplanowac, wiec w rejestrze sa czystym szumem
   * (samych domknietych jest tam 144 na 336).
   *
   * Przelaczniki nad panelami dotycza WYLACZNIE sprintow: tam te zadania nadal
   * cos znacza — pokazuja, ile ze sprintu jest juz zrobione albo czeka na czyjas
   * akceptacje.
   */
  const plannable = useCallback(
    (t: Task) => !CLOSED_STATUSES.has(t.status) && !REVIEW_STATUSES.has(t.status),
    [],
  );
  const inSprintView = useCallback(
    (t: Task) =>
      (showDone || !CLOSED_STATUSES.has(t.status)) &&
      (showReview || !REVIEW_STATUSES.has(t.status)),
    [showDone, showReview],
  );

  /*
   * REJESTR w trakcie tury: tylko to, z czego dzial moze WZIASC zadanie —
   * jego epik i tag `DO-STARTU`. Bez tagu w rejestrze leza rzeczy jeszcze
   * niedomyslane (DO-WYWIADU, OCZEKUJE-NA-ODPOWIEDZ), ktorych nie ma sensu
   * wrzucac do sprintu.
   *
   * Gdy nikt nie ma tury (wszystkie dzialy pominiete), nie zawezamy niczego —
   * pusty rejestr wygladalby na awarie, a nie na stan kolejki.
   */
  const backlog = useMemo(() => {
    const wszystkie = rejestrTasks.filter((t) => t.sprintId === null && plannable(t));
    if (!teraz) return wszystkie;
    return wszystkie.filter(
      (t) =>
        t.epicId === teraz.id &&
        (!tylkoDoStartu || t.tags.some((g) => g.toUpperCase() === 'DO-STARTU')),
    );
  }, [rejestrTasks, plannable, teraz, tylkoDoStartu]);

  const jestNowe = useCallback((t: Task) => dodane[t.id] !== undefined, [dodane]);

  const inActive = useMemo(
    () =>
      activeSprint ? tasks.filter((t) => t.sprintId === activeSprint.id && inSprintView(t)) : [],
    [tasks, activeSprint, inSprintView],
  );
  const inNext = useMemo(
    () =>
      nextSprint
        ? ostatnioDodaneNaGorze(
            tasks.filter((t) => t.sprintId === nextSprint.id && inSprintView(t)),
            dodane,
          )
        : [],
    [tasks, nextSprint, inSprintView, dodane],
  );

  /*
   * PRZENIESIENIE: co z trwajacego sprintu NIE jest zakonczone.
   *
   * Przy zamknieciu sprintu zostaje w nim tylko praca domknieta — reszta idzie do
   * kolejnego (patrz `sprint-lifecycle`). Te punkty zajma wiec moce planowanego
   * sprintu, choc nikt ich do niego nie wybieral.
   *
   * Liczymy z `tasks`, a NIE z `inActive`: `inActive` przechodzi przez
   * przelaczniki widoku, a przeniesienie jest faktem o sprincie, nie o tym, co
   * ktos sobie wlasnie odsiał.
   *
   * „Czeka na kontrolę" liczy sie jak ZROBIONE (decyzja Wojciecha 2026-09-28):
   * praca jest oddana, zostala cudza akceptacja, wiec nie zajmie mocy zespolu w
   * nastepnym sprincie — nawet jesli formalnie przywedruje razem z zadaniem.
   * Doliczanie jej zawyzalo przeniesienie i kazalo planowac ponizej mozliwosci.
   */
  const carry = useMemo(() => {
    if (!activeSprint || !przeniesienie) return undefined;
    const zostajace = tasks.filter(
      (t) =>
        t.sprintId === activeSprint.id &&
        !CLOSED_STATUSES.has(t.status) &&
        !REVIEW_STATUSES.has(t.status),
    );
    return zostajace.length > 0 ? { tasks: zostajace, label: activeSprint.name } : undefined;
  }, [tasks, activeSprint, przeniesienie]);

  /*
   * Odniesienie dla sum SP. Recznie wpisane moce maja pierwszenstwo nad tym, co
   * zespol dowiozl ostatnio — bo urlopy, swieta i zmiana skladu zmieniaja
   * pojemnosc tygodnia, a historia sama tego nie wie.
   */
  const limit = moce ?? lastDone?.points ?? 0;

  /*
   * KOLEJNOSC WAZNOSCI w rejestrze — to po niej dzial czyta, co brac najpierw:
   *   1. zadania, ktore NIE MIESZCZA sie w pozostalych punktach, ida na DOL
   *      (osobno, na czerwono — nie da sie ich wziac bez przekroczenia mocy),
   *   2. priorytet wysoki z Bitriksa (plomien),
   *   3. tag „Wysoki",
   *   4. story pointy malejaco.
   *
   * Zostalo liczymy wzgledem KOLEJNEGO sprintu, bo to do niego sie wybiera.
   */
  /*
   * Liczymy z `tasks`, nie z `inNext`: `inNext` jest odsiane przelacznikami
   * widoku, a moce sprintu nie zaleza od tego, co ktos wlasnie ma na ekranie.
   * Zakonczone i oddane do akceptacji nie zajmuja juz mocy (`plannable`).
   */
  /* Tylko zespol: zadania kierownika nie zajmuja mocy, wiec nie odejmuja sie od tego, co zostalo. */
  const sumaNext = nextSprint
    ? sumaDoLimitu(
        tasks.filter((t) => t.sprintId === nextSprint.id && plannable(t)),
        kierownicy,
      )
    : 0;
  /* Wlaczone przeniesienie zajmuje moce tak samo jak wybrane recznie — inaczej
     rejestr obiecywalby punkty, ktore i tak zjedza zaleglosci. */
  const sumaCarry = carry ? sumaDoLimitu(carry.tasks, kierownicy) : 0;
  const zostalo = Math.max(0, limit - sumaNext - sumaCarry);

  const backlogUlozony = useMemo(() => {
    /*
     * Kolejnosc ustawia PRZELACZNIK sortowania (zadania przychodza juz ulozone).
     * Tutaj zostaje jedna rzecz, ktora nie jest sortowaniem, tylko granica: co
     * nie miesci sie w pozostalych punktach, spada na sam dol. `sort` w JS jest
     * stabilny, wiec w obu czesciach wybrana kolejnosc zostaje nietknieta.
     */
    if (zostalo <= 0) return backlog;
    /* Zadanie kierownika nie zajmie mocy, wiec nigdy „nie miesci sie w pozostalych punktach". */
    const ponad = (t: Task) => (!pozaLimitem(t, kierownicy) && (t.storyPoints ?? 0) > zostalo ? 1 : 0);
    return [...backlog].sort((a, b) => ponad(a) - ponad(b));
  }, [backlog, zostalo, kierownicy]);

  const compare =
    limit > 0
      ? {
          label: moce !== null ? 'Moce zespołu' : `Ostatnio dowiezione (${lastDone?.name ?? ''})`,
          points: limit,
          wlasne: moce !== null,
        }
      : undefined;

  /*
   * Podzial wysokosci prawej kolumny miedzy sprint aktywny a kolejny.
   * Trzymamy UŁAMEK, nie piksele: okno bywa zmieniane, a proporcja przezywa to
   * bez przeliczen. Suwak tylko przesuwa granice — zwijanie chevronem dziala
   * dalej i ma pierwszenstwo.
   */
  const [sortAt, setSortAt] = useState<Anchor | null>(null);
  /* Kolejka dzialow schowana pod przyciskiem: jej UKLADANIE to czynnosc
     jednorazowa (raz na spotkanie), a stale zajmowala caly rzad. W pasku zostaje
     to, co zmienia sie w trakcie — czyja jest tura. */
  const [kolejkaAt, setKolejkaAt] = useState<{ left: number; top: number } | null>(null);
  /* Wylaczenie kolejki zamyka jej liste — inaczej zostawalaby otwarta nad
     przygaszonym przyciskiem, ktory juz jej nie otworzy ani nie zamknie. */
  useEffect(() => {
    if (!kolejkaWl) setKolejkaAt(null);
  }, [kolejkaWl]);
  const [pokazAt, setPokazAt] = useState<{ left: number; top: number } | null>(null);
  /*
   * Podzial przychodzi Z GORY i tam wraca — patrz `podzial`. Lokalnego stanu tu
   * nie ma: byl, ale ginal przy kazdym przelaczeniu widoku.
   */
  const { cols, split } = podzial;
  const setSplit = useCallback((v: number) => onPodzial({ cols, split: v }), [onPodzial, cols]);
  const setCols = useCallback((v: number) => onPodzial({ cols: v, split }), [onPodzial, split]);
  const rightRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  /* Korzen widoku — tu siedza OBIE zmienne podzialu, zeby odziedziczyl je takze
     pasek nad kolumnami, ktory jest rodzenstwem `.plan-cols`, a nie dzieckiem. */
  const planRef = useRef<HTMLDivElement>(null);

  /**
   * Wspolna obsluga obu uchwytow — pionowego i poziomego.
   *
   * Rozni je tylko os, wiec dwie kopie tej samej petli zdarzen roznilyby sie
   * jednym slowem i rozjechaly przy pierwszej poprawce.
   *
   * Nasluch wisi na OKNIE, nie na uchwycie: kursor przy szybkim ruchu wyprzedza
   * 4-pikselowy pasek i zdarzenia przestalyby dochodzic w polowie przeciagania.
   */
  const drag = useCallback(
    (
      axis: 'x' | 'y',
      box: React.RefObject<HTMLDivElement | null>,
      set: (f: number) => void,
      /**
       * Zwijanie panelu nad uchwytem PRZECIAGNIECIEM: dociagniecie pod jego
       * naglowek zwija go, odciagniecie w dol rozwija. Bez tego uchwyt przy
       * zwinietym panelu dawal sie ciagnac, ale nic nie robil.
       */
      fold?: {
        top?: { folded: boolean; toggle: () => void };
        bottom?: { folded: boolean; toggle: () => void };
      },
    ) =>
      (e: React.PointerEvent) => {
        e.preventDefault();
        const el = box.current;
        if (!el) return;

        /*
         * W TRAKCIE ciagniecia NIE ruszamy stanu Reacta — tylko zmienna CSS na
         * kontenerze, z ktorej panele biora `flex-grow`.
         *
         * Wczesniej kazdy `pointermove` wolal `set()`, czyli przerysowywal caly
         * widok planowania: oba panele sprintow, rejestr i kazdy wiersz w nich.
         * Przy kilkuset zadaniach uchwyt szarpal, bo na jedno drgniecie myszy
         * przypadal pelny render. Teraz rusza sie jedna wlasciwosc na jednym
         * elemencie, a stan dostaje wartosc RAZ, przy puszczeniu — zeby podzial
         * przezyl odswiezenie.
         */
        const zmienna = axis === 'y' ? '--plan-split' : '--plan-cols';
        /* MIERZYMY pudelko kolumn, ale PISZEMY na korzeniu — zmienna musi dojsc
           takze do paska, ktory lezy poza tym pudelkiem. */
        const cel = planRef.current ?? el;
        let ostatni: number | null = null;
        /* Wartosc sprzed ciagniecia — wraca na miejsce, gdy nic nie zapisujemy. */
        const przed = cel.style.getPropertyValue(zmienna);
        let gora = fold?.top?.folded ?? false;
        let dol = fold?.bottom?.folded ?? false;
        /*
         * Przeciaganie rusza dopiero po kilku pikselach. Wczesniej KAZDE
         * wcisniecie bylo przeciaganiem: drgniecie reki przy podwojnym kliknieciu
         * przestawialo podzial tam, gdzie akurat stal kursor, i dwuklik dawal
         * raz jeden, raz drugi wynik.
         */
        const start = axis === 'y' ? e.clientY : e.clientX;
        let ruszyl = false;

        const move = (ev: PointerEvent) => {
          const r = el.getBoundingClientRect();
          /*
           * Granica w PIKSELACH, nie w ulamku: chodzi o to, czy kursor wszedl na
           * naglowek panelu, a naglowek ma stala wysokosc niezaleznie od okna.
           * Stan Reacta ruszamy tylko na przejsciu przez granice — raz, a nie przy
           * kazdym drgnieciu.
           */
          const teraz = axis === 'y' ? ev.clientY : ev.clientX;
          if (!ruszyl) {
            if (!Number.isFinite(teraz) || Math.abs(teraz - start) < DRAG_PX) return;
            ruszyl = true;
          }
          if (fold && axis === 'y' && Number.isFinite(ev.clientY)) {
            /* Pod naglowkiem gornego — zwin gorny; przy dolnej krawedzi — dolny. */
            const naGore = Boolean(fold.top) && ev.clientY - r.top < FOLD_PX;
            const naDol = Boolean(fold.bottom) && r.bottom - ev.clientY < FOLD_PX;
            if (naGore !== gora) {
              gora = naGore;
              fold.top!.toggle();
            }
            if (naDol !== dol) {
              dol = naDol;
              fold.bottom!.toggle();
            }
            if (gora || dol) return;
          }
          const f =
            axis === 'y' ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
          /*
           * Nie-liczba KONCZY na tym kroku. Pudelko o zerowej wysokosci albo
           * zdarzenie bez wspolrzednych daja `NaN`, a `Math.min/max` przepuszcza
           * go dalej bez slowa. Trafial wtedy do zapisanych ustawien, gdzie `JSON`
           * zamienia go na `null` — i po odswiezeniu panele dostawaly
           * `flex-grow: NaN`, czyli uklad rozjechany NA STALE, bez sposobu na
           * cofniecie inaczej niz czyszczeniem pamieci przegladarki.
           */
          if (!Number.isFinite(f)) return;
          /*
           * Po 12% z kazdej strony zostaje nietykalne: panel scisniety do zera
           * nie ma juz za co zostac zlapany z powrotem. W poziomie dochodzi
           * minimum w PIKSELACH z arkusza (`--plan-min-*`) — ulamek na szerokim
           * ekranie zostawial sprintom ~220 px i panel sie zapadal.
           */
          let lo = 0.12;
          let hi = 0.88;
          if (axis === 'x' && r.width > 0) {
            const css = getComputedStyle(cel);
            const px = (v: string) => parseFloat(css.getPropertyValue(v)) || 0;
            lo = Math.max(lo, px('--plan-min-left') / r.width);
            hi = Math.min(hi, 1 - px('--plan-min-right') / r.width);
          }
          ostatni = Math.min(Math.max(lo, hi), Math.max(lo, f));
          cel.style.setProperty(zmienna, String(ostatni));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          /* Dopiero teraz jeden render — i zdjecie nadpisania, zeby dalej rzadzil stan. */
          /*
           * Zmienna WPISUJEMY, nie usuwamy. Ten sam atrybut `style` ustawia React
           * i odtwarza go tylko przy ZMIANIE wartosci — puszczenie uchwytu na tej
           * samej liczbie (drgniecie przy dwukliku) zostawialo zmienna usunieta,
           * a panele bez niej dzielily sie pol na pol.
           *
           * Zwiniety zostawia zapisany podzial w spokoju — rozwiniecie ma wrocic
           * do proporcji sprzed zwiniecia, a nie do 12%.
           */
          if (ostatni !== null && !gora && !dol) {
            cel.style.setProperty(zmienna, String(ostatni));
            set(ostatni);
          } else if (przed) {
            cel.style.setProperty(zmienna, przed);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      },
    [],
  );

  return (
    <div
      className="plan"
      ref={planRef}
      style={
        {
          ['--plan-cols' as string]: String(cols),
          ['--plan-split' as string]: String(split),
        } as React.CSSProperties
      }
    >
      {/*
        Pasek nalezy WYLACZNIE do planowania — oba przelaczniki rusza tylko
        panele sprintow, a nie liste i tablice. Odsiew „do zatwierdzenia" znikl
        z panelu widoku: praca oddana do akceptacji jest tam normalna trescia,
        a przeszkadza dopiero przy planowaniu, gdzie nie da sie jej juz ani
        przypisac, ani przelozyc, a zawyza sumy SP.

        Podzial paska jest DOKLADNIE taki, jak kolumn pod nim: sortowanie nad
        rejestrem, filtry nad sprintami — bo tylko ich dotycza.
      */}
      <div className="plan-bar">
        <div className="plan-bar-side" style={{ flexGrow: 'var(--plan-cols)', flexBasis: 0 }}>
          {/* Sortowanie tuz przy widoku, zamiast w panelu — przy planowaniu
              zmienia sie je czesto: raz po priorytecie, raz po terminie. */}
          <button
            className="views-btn plan-sort"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSortAt(sortAt ? null : { left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
            title="Kolejność zadań w panelach — klik zastępuje, Ctrl/Shift+klik dokłada poziom"
          >
            <BarsIcon />
            <span className="display-label">Sortuj:</span>
            {/*
              Domyslna kolejnosc to trzy poziomy — wypisane zajmowaly pol paska.
              Nazywamy ja wprost, a dowolny inny stos skracamy po DRUGIM poziomie:
              pierwsze dwa rozstrzygaja prawie wszystko, reszta jest w liscie.
            */}
            <span className="plan-sort-val">
              {jestDomyslne(sort) ? (
                <span className="plan-sort-lvl">Domyślna</span>
              ) : (
                <>
                  {sort.slice(0, 2).map((lvl, i) => (
                    <span key={lvl.by} className="plan-sort-lvl">
                      {i > 0 && <span className="plan-sort-then">, potem</span>}
                      {sortFields.find((f) => f.key === lvl.by)?.label ?? lvl.by}
                      <span className="plan-sort-dir">{lvl.dir === 'asc' ? '↑' : '↓'}</span>
                    </span>
                  ))}
                  {sort.length > 2 && <span className="plan-sort-then"> +{sort.length - 2}</span>}
                </>
              )}
            </span>
            <ChevronIcon open={Boolean(sortAt)} />
          </button>

          {sortAt && (
            <Picker
              title="Sortuj"
              anchor={sortAt}
              selected={sort.map((l) => l.by)}
              options={sortFields.map((f) => {
                const at = sort.findIndex((l) => l.by === f.key);
                return {
                  value: f.key,
                  label: f.label,
                  /* Numer poziomu przy nazwie — bez niego nie widac, ktory klucz
                     rozstrzyga pierwszy, a to cala tresc tego stosu. */
                  hint: at >= 0 ? `${at + 1}. ${sort[at].dir === 'asc' ? '↑' : '↓'}` : undefined,
                };
              })}
              onPick={(v, add) => {
                const at = sort.findIndex((l) => l.by === v);
                const flip = (d: 'asc' | 'desc') => (d === 'asc' ? 'desc' : 'asc');

                /*
                 * Lista NIE zamyka sie po wyborze — ani przy zwyklym kliknieciu,
                 * ani przy Ctrl. Kolejnosc ustawia sie porownawczo: klika sie klucz,
                 * patrzy na panele, poprawia kierunek, dokłada drugi poziom. Zamykanie
                 * po kazdym kliknieciu kazaloby otwierac ja od nowa przy kazdej z tych
                 * prob. Zamyka ja Esc, klik obok albo ponowny klik w chip.
                 */
                if (!add) {
                  /* Ten sam klucz drugi raz odwraca kierunek — jak naglowek tabeli. */
                  onSort([{ by: v, dir: at === 0 ? flip(sort[0].dir) : 'desc' }]);
                  return;
                }

                /*
                 * Klucz JUZ w stosie — modyfikator odwraca jego kierunek. Kazdy
                 * poziom tak samo.
                 *
                 * Wczesniej OSTATNI poziom byl wyjatkiem: to samo klikniecie go
                 * usuwalo. Wygladalo to na zniknięcie bez powodu, bo nic nie
                 * mowilo, ze ostatni zachowuje sie inaczej niz pozostale — a
                 * odwrocenie kierunku jest tym, po co sie w niego klika.
                 * Zwijanie stosu robi zwykly klik (zostawia jeden klucz) albo
                 * przycisk domyslnej kolejnosci.
                 */
                if (at >= 0) {
                  onSort(sort.map((l) => (l.by === v ? { ...l, dir: flip(l.dir) } : l)));
                  return;
                }
                onSort([...sort, { by: v, dir: 'desc' }]);
              }}
              footer={
                <>
                  <button
                    className="btn plan-sort-reset"
                    /* Trzy poziomy, nie jeden — dokladnie te, ktore skladaja sie
                       na kolejnosc waznosci, zeby bylo je widac i dalo poprawic. */
                    onClick={() => onSort(SORT_DOMYSLNY)}
                    title="Priorytet Bitriksa, potem tag „Wysoki”, potem story pointy malejąco"
                  >
                    Domyślna kolejność ważności
                  </button>
                  <span className="plan-sort-hint">
                    <kbd>Ctrl</kbd> lub <kbd>Shift</kbd> + klik — dołóż poziom albo odwróć
                    jego kierunek. Zwykły klik zostawia jeden klucz.
                  </span>
                </>
              }
              onClose={() => setSortAt(null)}
            />
          )}
        </div>

        <div
          className="plan-bar-side plan-bar-right"
          style={{ flexGrow: 'calc(1 - var(--plan-cols))', flexBasis: 0 }}
        >
          {/*
            Moce zespolu na sprint. Puste pole NIE znaczy zero — znaczy „nie
            wiem", i wtedy za odniesienie sluzy to, co zespol dowiozl ostatnio.
            Dlatego podpowiedz w polu pokazuje te liczbe: widac, co sie stanie po
            wyczyszczeniu, bez zgadywania.
          */}
          {/*
            WLACZNIK KOLEJKI. Kolejka ma sens na spotkaniu, gdy dzialy wybieraja po
            kolei; poza nim zaweza rejestr do jednego epiku bez powodu. Przelacznik
            stoi PRZED nia, bo rzadzi wszystkim, co po nim — a to, co wylaczone,
            zostaje na miejscu przygaszone, zeby pasek nie zmienial szerokosci przy
            przelaczaniu.
          */}
          <button
            className={`views-btn plan-kolejka-wl tog${kolejkaWl ? ' tog-on' : ''}`}
            onClick={onKolejkaWl}
            title={
              kolejkaWl
                ? 'Kolejka działów włączona — rejestr pokazuje tylko zadania działu, którego jest tura'
                : 'Kolejka działów wyłączona — rejestr pokazuje wszystko'
            }
          >
            <span className="tog-box">
              <CheckIcon />
            </span>
            Kolejka działów
          </button>

          {/* Czyja tura + wejscie do kolejki. Nazwa dzialu stoi RAZ — wczesniej
              byla i tekstem, i podswietlona pastylka w tym samym rzedzie. */}
          <span className={`display-label plan-show${kolejkaWl ? '' : ' plan-wyl'}`}>Teraz:</span>
          <span className={`plan-teraz${kolejkaWl ? '' : ' plan-wyl'}`}>
            {kolejkaWl ? (teraz ? teraz.nazwa : 'nikt') : '—'}
          </span>
          <button
            className="views-btn plan-kolejka-btn"
            disabled={!kolejkaWl}
            onClick={(e) => {
              if (kolejkaAt) {
                setKolejkaAt(null);
                return;
              }
              /* Mierzymy PRZYCISK, nie pasek — panel ma wisiec pod nim, dosuniety
                 prawa krawedzia, i nie wyjsc poza okno na waskim ekranie. */
              const r = e.currentTarget.getBoundingClientRect();
              const szer = 240;
              setKolejkaAt({
                left: Math.max(8, Math.min(r.right - szer, window.innerWidth - szer - 8)),
                top: r.bottom + 4,
              });
            }}
            title="Kolejność działów, obecność, losowanie"
          >
            Kolejka
            <ChevronIcon open={Boolean(kolejkaAt)} />
          </button>
          <button
            className="views-btn"
            disabled={!kolejkaWl}
            onClick={onPomin}
            title="Ten dział nie wybiera — następny"
          >
            Pomiń
          </button>

          {kolejkaAt &&
            createPortal(
              <>
                <div className="picker-backdrop" onClick={() => setKolejkaAt(null)} />
                <div className="menu plan-kolejka" style={{ left: kolejkaAt.left, top: kolejkaAt.top }}>
                <div className="ds-colhead">Kolejka działów</div>
                <div className="ds-colhint">
                  Przeciągnij, żeby zmienić kolejność. Odznaczony dział nie dostaje tury.
                </div>
                <ol className="plan-kolejka-list">
                  {dzialy.map((d, i) => (
                    <li
                      key={d.id}
                      className={`plan-kolejka-item${d.id === teraz?.id ? ' is-now' : ''}${d.obecny ? '' : ' is-off'}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        /* Firefox nie zaczyna przeciagania bez ustawionych danych. */
                        e.dataTransfer.setData('text/plain', String(i));
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const z = Number(e.dataTransfer.getData('text/plain'));
                        if (Number.isFinite(z)) onPrzestaw(z, i);
                      }}
                    >
                      <button
                        type="button"
                        className="plan-kolejka-chk"
                        title={d.obecny ? 'Pomiń ten dział' : 'Włącz z powrotem'}
                        onClick={() => onObecny(d.id)}
                      >
                        {d.obecny ? <CheckIcon /> : null}
                      </button>
                      <span className="plan-kolejka-nr">{i + 1}</span>
                      <span className="plan-kolejka-nazwa">{d.nazwa}</span>
                    </li>
                  ))}
                </ol>
                  <button className="btn plan-kolejka-losuj" onClick={onLosuj}>
                    Losuj kolejność
                  </button>
                </div>
              </>,
              document.body,
            )}

          <span className="plan-bar-div" aria-hidden />

          {/*
            Moce i trzy przelaczniki schowane pod jednym przyciskiem — tak samo
            jak kolejka. Rozlozone w pasku nie miescily sie przy otwartym panelu
            szczegolow: pasek konczy sie tam, gdzie zaczyna panel, wiec nadmiar
            wychodzil POD niego i ostatnie przelaczniki bylo widac tylko w polowie.
          */}
          <button
            className="views-btn"
            onClick={(e) => {
              if (pokazAt) {
                setPokazAt(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              const szer = 250;
              setPokazAt({
                left: Math.max(8, Math.min(r.right - szer, window.innerWidth - szer - 8)),
                top: r.bottom + 4,
              });
            }}
            title="Moce zespołu i co ma być widoczne"
          >
            {/* „Opcje", nie „Pokaż" — pod spodem sa dwie rozne rzeczy: moce
                zespolu (liczba) i widocznosc (przelaczniki). „Pokaż" nazywalo
                tylko te druga polowe. */}
            Opcje
            <ChevronIcon open={Boolean(pokazAt)} />
          </button>

          {pokazAt &&
            createPortal(
              <>
                <div className="picker-backdrop" onClick={() => setPokazAt(null)} />
                <div className="menu plan-pokaz" style={{ left: pokazAt.left, top: pokazAt.top }}>
                  <div className="ds-colhead">Moce zespołu</div>
                  <label className="plan-pokaz-moce">
                    <input
                      className="plan-moce"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={moce ?? ''}
                      placeholder={lastDone ? String(lastDone.points) : '—'}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        onMoce(v === '' ? null : Math.max(0, Number(v) || 0));
                      }}
                    />
                    <span className="plan-moce-unit">SP na sprint</span>
                  </label>
                  <div className="ds-colhint">
                    {moce === null && lastDone
                      ? `Puste — liczymy do ostatnio dowiezionego (${lastDone.name}: ${lastDone.points} SP).`
                      : 'Ile SP zespół jest w stanie wziąć na sprint.'}
                  </div>

                  <button
                    className={`menu-item tog${przeniesienie ? ' tog-on' : ''}`}
                    onClick={onPrzeniesienie}
                    title="Niedomknięte zadania z trwającego sprintu przejdą do kolejnego i zajmą jego moce"
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    licz przeniesione z {activeSprint?.name ?? 'trwającego sprintu'}
                  </button>

                  <div className="ds-colhead">Pokaż w rejestrze i sprintach</div>
                  <button
                    className={`menu-item tog${tylkoDoStartu ? ' tog-on' : ''}`}
                    onClick={onTylkoDoStartu}
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    tylko DO-STARTU
                  </button>
                  <button
                    className={`menu-item tog${showReview ? ' tog-on' : ''}`}
                    onClick={onToggleReview}
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    do zatwierdzenia
                  </button>
                  <button
                    className={`menu-item tog${showDone ? ' tog-on' : ''}`}
                    onClick={onToggleDone}
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    zakończone
                  </button>
                </div>
              </>,
              document.body,
            )}
        </div>
      </div>

      <div className="plan-cols" ref={colsRef}>
      <Pane
        title="Rejestr"
        sprintId={null}
        tasks={backlogUlozony}
        ponad={(t) => zostalo > 0 && !pozaLimitem(t, kierownicy) && (t.storyPoints ?? 0) > zostalo}
        people={people}
        renderRow={renderRow}
        grow="var(--plan-cols)"
      />

      {/* Uchwyt pionowy: ile miejsca dostaje rejestr, a ile sprinty. */}
      <div
        className="plan-grip plan-grip-v"
        role="separator"
        aria-orientation="vertical"
        title="Przeciągnij, żeby zmienić szerokość kolumn"
        onPointerDown={drag('x', colsRef, setCols)}
        onDoubleClick={() => setCols(0.5)}
      >
        <span className="plan-grip-dots">
          <GripIcon />
        </span>
      </div>

      <div
        className="plan-right"
        ref={rightRef}
        style={{ flexGrow: 'calc(1 - var(--plan-cols))', flexBasis: 0 }}
      >
        {activeSprint && (
          <Pane
            title={activeSprint.name}
            subtitle="aktywny"
            grow="var(--plan-split)"
            sprintId={activeSprint.id}
            tasks={inActive}
            people={people}
            renderRow={renderRow}
            collapsible
            zwiniety={zwiniete.includes(activeSprint.id)}
            onZwin={() => onZwin(activeSprint.id)}
            kierownicy={kierownicy}
            /* Bez licznika mocy: w trwajacym sprincie nie ma juz czego planowac. */
          />
        )}

        {activeSprint && nextSprint && (
          /* Uchwyt miedzy sprintami — chwyt myszy zmienia podzial wysokosci. */
          <div
            className="plan-grip"
            role="separator"
            aria-orientation="horizontal"
            title="Przeciągnij, żeby zmienić podział wysokości — do samej góry albo dołu zwija sprint. Dwuklik: 80/20."
            onPointerDown={drag('y', rightRef, setSplit, {
              top: { folded: zwiniete.includes(activeSprint.id), toggle: () => onZwin(activeSprint.id) },
              bottom: { folded: zwiniete.includes(nextSprint.id), toggle: () => onZwin(nextSprint.id) },
            })}
            /* Dwuklik ZAWSZE daje to samo: oba rozwiniete, 80/20. */
            onDoubleClick={() => {
              if (zwiniete.includes(activeSprint.id)) onZwin(activeSprint.id);
              if (zwiniete.includes(nextSprint.id)) onZwin(nextSprint.id);
              setSplit(SPLIT_DEFAULT);
            }}
          >
            {/* Kropki na srodku — bez nich pasek czyta sie jak zwykla kreska
                rozdzielajaca i nikt nie zgaduje, ze da sie go chwycic. */}
            <span className="plan-grip-dots">
              <GripIcon />
            </span>
          </div>
        )}

        {nextSprint ? (
          <Pane
            title={nextSprint.name}
            subtitle="planowany"
            grow="calc(1 - var(--plan-split))"
            sprintId={nextSprint.id}
            tasks={inNext}
            nowe={jestNowe}
            people={people}
            renderRow={renderRow}
            collapsible
            zwiniety={zwiniete.includes(nextSprint.id)}
            onZwin={() => onZwin(nextSprint.id)}
            compare={compare}
            carry={carry}
            wMoce={plannable}
            kierownicy={kierownicy}
          />
        ) : (
          /* Bez kolejnego sprintu planowac nie ma dokad — mowimy to wprost,
             zamiast pokazywac pusty panel bez wyjasnienia. */
          <section className="plan-pane plan-pane-none">
            <div className="plan-empty">
              Nie ma zaplanowanego kolejnego sprintu.
              {onCreateSprint ? (
                <>
                  {' '}
                  Bez niego nie ma dokąd planować.
                  <button className="btn btn-primary plan-new-sprint" onClick={onCreateSprint}>
                    Załóż kolejny sprint
                  </button>
                </>
              ) : (
                ' Załóż go w Bitriksie, a pojawi się tutaj.'
              )}
            </div>
          </section>
        )}
      </div>
      </div>
    </div>
  );
}
