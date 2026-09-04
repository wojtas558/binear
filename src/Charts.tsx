/*
 * Wykres spalania sprintu.
 *
 * Rysowany recznie w SVG, bez biblioteki. Powod jest prosty: to wykres o znanym
 * ksztalcie, a kazda biblioteka przynosi wlasna typografie, wlasne kolory
 * i wlasne tooltipy — czyli dokladnie te trzy rzeczy, ktore w tej aplikacji sa
 * ustawione tokenami i maja wygladac tak samo wszedzie.
 *
 * Kolory: JEDNA seria (caly zespol albo jedna osoba) dostaje --accent, zgodnie
 * z zasada arkusza „jeden akcent". Przy porownywaniu KILKU osob naraz kolor
 * przestaje byc ozdoba i staje sie jedynym sposobem odroznienia linii — wtedy
 * kazda osoba dostaje wlasna barwe z `tagHue`, tak samo jak tagi i epiki.
 */

import { useCallback, useRef, useState } from 'react';
import type { BurndownPoint } from './sprintStats';

/**
 * Gorna krawedz osi Y — najblizszy okragly stopien POWYZEJ najwyzszej wartosci.
 *
 * Drabinka musi byc gesta: przy samych 1/2/5 wykres na 225 SP dostaje os do 500
 * i polowa pola zostaje pusta. Kroki co pol rzedu trzymaja slupki wysokie, a
 * podzialka nadal wypada na liczbach, ktore da sie przeczytac.
 */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => n <= c) ?? 10;
  return step * pow;
}

/**
 * Podzialka: 4 rowne kroki od zera do gory osi, BEZ powtorzen.
 *
 * Przy malej gornej krawedzi zaokraglenie sklejalo stopnie — `ticks(1)` dawalo
 * [0,0,1,1,1], czyli pokrywajace sie linie i powtorzone klucze Reacta. Zdarza sie
 * naprawde: wystarczy wybrac osobe, ktorej zadania nie maja oszacowan.
 */
function ticks(max: number): number[] {
  return [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f)))];
}

/*
 * Wysokosc jest STALA, szerokosc bierze sie z pomiaru kontenera.
 *
 * Wykres w SVG o sztywnym `viewBox` skaluje sie w CALOSCI: rozciagniety na
 * szeroki ekran rosnie tez w pionie, a razem z nim podpisy osi — 11px robi sie
 * naglowkiem. Ratowanie tego `max-width` dzialalo, ale zostawialo pol wiersza
 * pustego. Zamiast tego dopasowujemy uklad wspolrzednych do PIKSELI: viewBox ma
 * dokladnie tyle jednostek, ile kontener ma pikseli, wiec nic sie nie skaluje —
 * wykres jest szeroki, a typografia zostaje taka, jak w reszcie aplikacji.
 */
const H = 280;
const PAD = { top: 16, right: 16, bottom: 42, left: 44 };
const MIN_W = 320;

/**
 * Szerokosc kontenera. ResizeObserver, bo panel boczny i zwijanie grup zmieniaja
 * ja bez zdarzenia `resize` okna.
 *
 * Ref jest FUNKCYJNY, nie `useRef` + `useEffect`. Komponent ma wczesny `return`
 * dla sprintu bez dni roboczych — a wtedy element z refem w ogole sie nie renderuje.
 * Efekt z pusta lista zaleznosci odpalilby sie raz, na pustym refie, i nigdy juz
 * nie podpial obserwatora, kiedy wykres faktycznie sie pojawil. Callback ref
 * podpina sie dokladnie wtedy, gdy wezel wchodzi do drzewa.
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(760);
  const ro = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(Math.max(MIN_W, el.getBoundingClientRect().width));
    ro.current = new ResizeObserver(([e]) => setW(Math.max(MIN_W, e.contentRect.width)));
    ro.current.observe(el);
  }, []);

  return [ref, w];
}

/** Tlo wykresu: linie podzialki i podpisy osi Y. */
function Grid({ max, w }: { max: number; w: number }) {
  const plotH = H - PAD.top - PAD.bottom;
  return (
    <g className="chart-grid">
      {ticks(max).map((t) => {
        const y = PAD.top + plotH - (t / max) * plotH;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} />
            <text x={PAD.left - 10} y={y + 4} textAnchor="end">
              {t}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Jedna linia wykresu: caly zespol albo jedna osoba. */
export interface Series {
  key: string;
  label: string;
  color: string;
  points: BurndownPoint[];
}

export function BurndownChart({ series }: { series: Series[] }) {
  // Hooki musza stac PRZED jakimkolwiek `return` — inaczej przy sprincie bez dni
  // roboczych React dostaje inna liczbe hookow niz przy pelnym i wywala liste.
  const [ref, W] = useWidth();
  /*
   * Pozycja kursora na osi X jako UŁAMKOWY indeks dnia (2.4 = 40% drogi z dnia 2
   * do dnia 3), nie zaokraglony do najblizszego punktu. Prowadnica chodzi wtedy
   * plynnie, a nie skokami co kolumne.
   */
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Wszystkie serie dziela te sama os X (ten sam sprint), wiec dni bierzemy z pierwszej.
  const days = series[0]?.points ?? [];

  /*
   * Linia idealna ma sens tylko przy JEDNEJ serii. Przy kilku osobach kazda ma
   * wlasny zakres, wiec albo trzeba by rysowac kilka linii odniesienia (wykres
   * robi sie krata), albo jedna wspolna, ktora dla nikogo nie jest prawdziwa.
   * Porownujac ludzi patrzy sie na KSZTALT linii, nie na dystans do planu.
   */
  const solo = series.length === 1;

  // Linie odniesienia licza sie do sufitu osi tak samo jak dane — inaczej przy
  // kimś, kto jest mocno przed planem, projekcja wychodzilaby poza kadr.
  const top = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => Math.max(p.ideal, p.actual ?? 0))),
  );
  const max = niceMax(top);
  const x = (i: number) => PAD.left + (i / Math.max(1, days.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  if (days.length < 2)
    return <div className="chart-empty">Sprint nie ma jeszcze dni roboczych.</div>;

  /*
   * Linia rzeczywista urywa sie na dzis — dni z przyszlosci nie maja stanu. Indeks
   * niesiemy razem z punktem, bo pozycja na osi X liczy sie z PELNEJ listy dni:
   * po odfiltrowaniu przyszlosci linia rozjechalaby sie wzgledem idealnej.
   */
  const drawn = series.map((s) => {
    const real = s.points.map((p, i) => ({ p, i })).filter(({ p }) => p.actual !== null);
    return { s, real, last: real[real.length - 1] };
  });

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  /** Data pod podpisem dnia — dzien i miesiac wystarcza, rok bierze sie z kontekstu. */
  const dayDate = (at: number) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime())
      ? ''
      : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  /*
   * Odczyt pod kursorem liczymy RAZ i uzywamy w dwoch miejscach: kropki rysuje
   * SVG, a liste wartosci — zwykly div nad wykresem. Tekst w SVG nie ma tla ani
   * ukladu, wiec przy kilku osobach nachodzil na siatke i na same linie; w HTML
   * dostaje karte, odstepy i sortowanie za darmo.
   */
  const tip = (() => {
    if (hover === null || days.length < 2) return null;
    const lo = Math.floor(hover);
    const hi = Math.min(days.length - 1, lo + 1);
    const f = hover - lo;
    const rows = series
      .map((s) => {
        const a = s.points[lo];
        const b = s.points[hi];
        const v =
          a.actual === null ? null : b.actual === null ? a.actual : lerp(a.actual, b.actual, f);
        // Projekcja KAZDEJ osoby z osobna — wspolny plan nie istnieje, bo kazda
        // ma inny zakres. Bez tego przy porownaniu widac "ile zostalo", ale nie
        // wiadomo, czy to duzo, czy malo jak na jej wlasny plan.
        return { s, v, plan: lerp(a.ideal, b.ideal, f) };
      })
      .filter((r): r is { s: Series; v: number; plan: number } => r.v !== null)
      // Kolejnosc jak na wykresie: najwyzsza linia u gory listy. Bez tego przy
      // kilku osobach trzeba wodzic wzrokiem miedzy kolorami, zeby je sparowac.
      .sort((a, b) => b.v - a.v);
    return {
      x: x(hover),
      label: f < 0.5 ? days[lo].label : days[hi].label,
      plan: Math.round(lerp(days[lo].ideal, days[hi].ideal, f)),
      rows,
    };
  })();

  return (
    <div className="chart-box" ref={ref}>
      <svg
        className="chart"
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Wykres spalania sprintu"
        onMouseMove={(e) => {
          /*
           * Odczyt chodzi za kursorem po CALEJ szerokosci, nie po samych kropkach:
           * trafianie w punkt o promieniu 3px jest bez sensu, a natywny <title>
           * pojawia sie z sekundowym opoznieniem. Uklad wspolrzednych jest 1:1
           * z pikselami, wiec to zwykle odejmowanie.
           */
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = ((px - PAD.left) / plotW) * (days.length - 1);
          setHover(Math.min(days.length - 1, Math.max(0, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="burn-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <Grid max={max} w={W} />

        {/* Pole pod linia i linia idealna TYLKO przy jednej serii: kilka
            nachodzacych wypelnien zlewa sie w papke i nie da sie ich odczytac. */}
        {solo && drawn[0].last && (
          <polygon
            className="area-real"
            fill="url(#burn-fill)"
            points={
              `${drawn[0].real.map(({ p, i }) => `${x(i)},${y(p.actual as number)}`).join(' ')} ` +
              `${x(drawn[0].last.i)},${y(0)} ${x(0)},${y(0)}`
            }
          />
        )}

        {/*
          Projekcja — rowny zjazd od zakresu do zera. Przy jednej serii to znajoma
          szara kreska. Przy kilku osobach kazda dostaje WLASNA, w swoim kolorze
          i mocno przygaszona: inaczej nie wiadomo, czyja jest, a w pelnej sile
          szesc linii odniesienia zamienia wykres w krate.
        */}
        {solo ? (
          <polyline
            className="line-ideal"
            points={series[0].points.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')}
          />
        ) : (
          series.map((s) => (
            <polyline
              key={`plan-${s.key}`}
              className="line-plan"
              style={{ stroke: s.color }}
              points={s.points.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')}
            />
          ))
        )}

        {drawn.map(({ s, real, last }) => (
          <g key={s.key}>
            <polyline
              className="line-real"
              style={{ stroke: s.color }}
              points={real.map(({ p, i }) => `${x(i)},${y(p.actual as number)}`).join(' ')}
            />

            {/* Punkty posrednie sa drobne i wypelnione tlem karty, zeby linia ich
                nie przecinala; DZIS dostaje pelna kropke. */}
            {real.map(({ p, i }) => {
              const isNow = last && i === last.i;
              return (
                <circle
                  key={`${s.key}-${p.label}`}
                  className={isNow ? 'dot-now' : 'dot-real'}
                  style={isNow ? { fill: s.color } : { stroke: s.color }}
                  cx={x(i)}
                  cy={y(p.actual as number)}
                  r={isNow ? 4.5 : 3}
                >
                  <title>{`${s.label} · ${p.label}: ${p.actual} SP pozostało`}</title>
                </circle>
              );
            })}

            {/* Wartosc przy koncu linii tylko przy jednej serii — przy kilku
                podpisy nachodzilyby na siebie, tam liczby daje odczyt hover. */}
            {solo && last && hover === null && (
              <text
                className="dot-label"
                x={x(last.i) - 10}
                y={y(last.p.actual as number) - 10}
                textAnchor="end"
              >
                {last.p.actual} SP
              </text>
            )}
          </g>
        ))}

        {tip &&
          (() => {
            // Podpis ucieka na lewo przy prawej krawedzi, zeby nie wyszedl poza kadr.
            const flip = tip.x > W - 240;
            const tx = flip ? tip.x - 10 : tip.x + 10;
            const anchor = flip ? 'end' : 'start';
            return (
              <g className="chart-hover" pointerEvents="none">
                <line
                  className="hover-guide"
                  x1={tip.x}
                  x2={tip.x}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                />
                {solo && <circle className="dot-ideal" cx={tip.x} cy={y(tip.plan)} r={3} />}
                {tip.rows.map(({ s, v }) => (
                  <circle
                    key={s.key}
                    className="dot-now"
                    style={{ fill: s.color }}
                    cx={tip.x}
                    cy={y(v)}
                    r={4.5}
                  />
                ))}

                {solo ? (
                  <text className="hover-label" x={tx} y={PAD.top + 16} textAnchor={anchor}>
                    {tip.label}
                    <tspan className="hover-value" dx="6">
                      {Math.round(tip.rows[0]?.v ?? 0)} SP
                    </tspan>
                    <tspan className="hover-plan" dx="6">
                      plan {tip.plan}
                    </tspan>
                  </text>
                ) : (
                  <>
                    <text className="hover-label" x={tx} y={PAD.top + 16} textAnchor={anchor}>
                      {tip.label}
                    </text>
                    {/* Wiersz na osobe, posortowane malejaco — kolejnosc podpisow
                        odpowiada wtedy kolejnosci linii na wykresie. */}
                    {tip.rows.map(({ s, v, plan }, k) => (
                      <text
                        key={s.key}
                        className="hover-value"
                        style={{ fill: s.color }}
                        x={tx}
                        y={PAD.top + 36 + k * 18}
                        textAnchor={anchor}
                      >
                        {s.label} · {Math.round(v)} SP
                        <tspan className="hover-plan" dx="6">
                          plan {Math.round(plan)}
                        </tspan>
                      </text>
                    ))}
                  </>
                )}
              </g>
            );
          })()}

        {/* Podpis dnia i data POD nim — jedna dluga etykieta ("Dzień 1 · 31.08")
            zaczyna sie zlewac z sasiadami przy waskim wykresie, a dwie linijki
            trzymaja te sama szerokosc kolumny co sam numer dnia. */}
        {days.map((p, i) => (
          <g key={p.label}>
            <text className="chart-x" x={x(i)} y={H - 20} textAnchor="middle">
              {p.label}
            </text>
            <text className="chart-date" x={x(i)} y={H - 7} textAnchor="middle">
              {dayDate(p.at)}
            </text>
          </g>
        ))}
      </svg>

    </div>
  );
}

/** Legenda wykresu — znak plus podpis, ten sam zapis dla kazdej serii. */
export function Legend({ items }: { items: { cls?: string; color?: string; label: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className="legend-item">
          <span
            className={`legend-mark ${it.cls ?? ''}`}
            style={it.color ? { background: it.color } : undefined}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
