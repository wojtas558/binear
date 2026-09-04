/*
 * Popover wyboru - jedna lista pozycji z filtrem, ptaszkiem i obsluga klawiatury.
 *
 * Wyjety z App.tsx, bo potrzebuja go TAKZE ekrany, ktore App renderuje (dzis:
 * filtr osoby na wykresach). Import w druga strone zrobilby cykl - dokladnie ten
 * sam powod, dla ktorego wczesniej wyjechalo stad `taskView.ts` dla tablicy.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar, CheckIcon } from './icons';

/** Punkt zaczepienia popovera - wspolrzedne elementu, ktory go otworzyl. */
export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}


export interface Option {
  value: string;
  label: string;
  icon?: ReactNode;
  photo?: string | null;
  /** Dopisek po prawej — dzis typ projektu ("scrum", "archiwum"). */
  hint?: string;
  /** Kreska NAD ta pozycja — dzis oddziela zalogowanego uzytkownika od reszty osob. */
  divider?: boolean;
  /** Klucz zakladki (segments) w Pickerze — dzis "sprint" / "outside" dla rodzica. */
  group?: string;
}

export function Picker({
  title,
  options,
  anchor,
  emptyLabel,
  rawLabel,
  freeLabel,
  footer,
  externalQuery,
  above,
  placeholder = 'Filtruj…',
  segments,
  multi = false,
  selected,
  onToggle,
  onPick,
  onClose,
}: {
  title: string;
  options: Option[];
  anchor: Anchor;
  /** Co pokazac, gdy nie ma z czego wybierac. Domyslnie zwykle "Brak opcji". */
  emptyLabel?: string;
  /**
   * Pozwala oddac wartosc, ktorej nie ma na liscie, o ile wpisano sam numer.
   * Przy projektach to jedyne wyjscie, gdy webhook nie widzi grup roboczych —
   * identyfikator grupy stoi w adresie Bitriksa (`/workgroups/group/451/`).
   */
  rawLabel?: (n: number) => string;
  /**
   * Jak `rawLabel`, ale dla DOWOLNEGO tekstu — pozwala oddac wartosc, ktorej nie ma
   * na liscie (dzis: zalozenie nowego tagu wprost z pola szukania).
   */
  freeLabel?: (text: string) => string;
  /** Podpowiedz na dole listy — dzis: jak dolozyc kolejna osobe do porownania. */
  footer?: ReactNode;
  /**
   * Filtr STEROWANY Z ZEWNATRZ — dzis wzmianka `@` w komentarzu.
   *
   * Gdy jest podany, picker nie ma wlasnego pola i NIE ZABIERA focusu: tekst
   * pisze sie dalej tam, gdzie sie pisalo, a lista tylko za nim nadaza. Dzieki
   * temu znika cala szarpanina z oddawaniem kursora po zamknieciu.
   */
  externalQuery?: string;
  /**
   * Wymusza pozycje NAD kotwica.
   *
   * Domyslnie popover ląduje pod nia i skacze nad tylko wtedy, gdy sie nie miesci
   * — a przy liscie, ktora filtruje sie w trakcie pisania, ten warunek zmienia sie
   * z kazda litera: krotka lista "miesci sie" pod spodem i zaslania pole, dluzsza
   * przeskakuje nad nie. Wymuszenie gory daje STALA dolna krawedz (rosnie w gore)
   * i nie zakrywa tego, co uzytkownik pisze.
   */
  above?: boolean;
  /** Podpowiedz w polu; przy story pointach to nie "Filtruj", tylko "wpisz liczbę". */
  placeholder?: string;
  /** Zakladki filtrujace opcje po `Option.group`; pusty klucz = pokaz wszystkie. */
  segments?: { key: string; label: string }[];
  /**
   * Tryb wielokrotny (filtry): klik/Enter PRZELACZA pozycje i NIE zamyka popovera —
   * mozna zaznaczyc kilka wartosci naraz. Zamyka dopiero tlo albo Escape.
   * Zaznaczone dostaja ptaszek po prawej. Bez tego picker dziala po staremu:
   * jeden wybor i zamkniecie.
   */
  multi?: boolean;
  selected?: string[];
  onToggle?: (value: string) => void;
  /**
   * `add` mowi, ze klikniecie bylo z modyfikatorem (Ctrl/Cmd albo Shift) — czyli
   * "DOLOZ do wyboru", a nie "zastap wybor". Wywolania, ktorych to nie obchodzi,
   * po prostu ignoruja drugi argument.
   */
  onPick: (value: string, add?: boolean) => void;
  onClose: () => void;
}) {
  const [ownQuery, setOwnQuery] = useState('');
  const controlled = externalQuery !== undefined;
  const query = controlled ? externalQuery : ownQuery;
  const setQuery = setOwnQuery;
  const [cursor, setCursor] = useState(0);
  const [seg, setSeg] = useState(segments?.[0]?.key ?? '');
  const sel = useMemo(() => new Set(selected ?? []), [selected]);
  /*
   * Bezpiecznik otwarcia: menu wyskakuje TUZ pod klikanym przyciskiem, wiec szybki
   * „doklik" (ten sam ruch, ktory otworzyl menu) trafial w pierwsza pozycje, zanim
   * kursor w ogole ruszyl w strone celu — stad „klikam Tag, wychodzi Osoba". Przez
   * pierwsze ~140 ms po otwarciu ignorujemy klik w pozycje; swiadomy, wycelowany klik
   * i tak trwa dluzej, wiec go nie blokujemy. (Klawiatura/Enter dziala od razu.)
   */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 140);
    return () => clearTimeout(t);
  }, []);
  /** W trybie wielokrotnym wybor przelacza pozycje i zostawia popover otwarty. */
  const choose = (value: string, add = false) =>
    multi ? onToggle?.(value) : onPick(value, add);

  const shown = useMemo(() => {
    // Filtr zakladki: pusty klucz nie zawęża; opcje bez `group` (np. "—") widac zawsze.
    const bySeg = seg ? options.filter((o) => o.group == null || o.group === seg) : options;

    const q = query.trim().toLowerCase();
    const hits = q ? bySeg.filter((o) => o.label.toLowerCase().includes(q)) : bySeg;
    const typed = query.trim();
    const withRaw =
      rawLabel && /^\d+$/.test(q) && Number(q) > 0 && !hits.some((o) => o.value === q)
        ? [{ value: q, label: rawLabel(Number(q)) }, ...hits]
        : // Dowolny tekst spoza listy — np. zupelnie nowy tag zakladany w locie.
          freeLabel && typed && !bySeg.some((o) => o.label.toLowerCase() === q)
          ? [{ value: typed, label: freeLabel(typed) }, ...hits]
          : hits;

    // Nie renderujemy setek pozycji naraz — reszta jest osiagalna przez szukanie.
    return withRaw.slice(0, 200);
  }, [options, query, rawLabel, freeLabel, seg]);

  useEffect(() => setCursor(0), [query, seg]);

  /*
   * Sterowanie z klawiatury, gdy filtr przychodzi Z ZEWNATRZ.
   *
   * W trybie zwyklym strzalki i Enter wisza na wlasnym polu pickera — ale przy
   * wzmiance `@` tego pola nie ma i focus zostaje w polu komentarza, wiec nie ma
   * na czym ich powiesic. Sluchamy wiec na oknie, w fazie PRZECHWYTYWANIA: gdyby
   * zdarzenie doszlo najpierw do textarea, strzalka przesunelaby kursor w tekscie,
   * a Enter wstawil nowa linie.
   *
   * Ctrl/Cmd+Enter CELOWO puszczamy dalej — to skrot wysylki komentarza i ma
   * dzialac takze przy otwartej liscie.
   */
  useEffect(() => {
    if (!controlled) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, shown.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        const opt = shown[cursor];
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        choose(opt.value, e.shiftKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Popover nie moze wyjechac poza ekran przy wierszach na dole listy.
  const width = 260;
  const height = Math.min(340, 92 + shown.length * 30 + (segments ? 32 : 0));
  const left = Math.min(anchor.left + 32, window.innerWidth - width - 12);
  /*
   * Nad kotwica przypinamy DOLNA krawedz (`bottom`), nie gorna.
   *
   * `height` powyzej to tylko OSZACOWANIE (92 + wiersze x 30) i rozjezdza sie
   * z prawdziwa wysokoscia o kilkanascie pikseli — a przy liscie filtrowanej
   * w trakcie pisania kazda litera zmienia liczbe wierszy, wiec panel drgal
   * przy kazdym znaku. `bottom` zdejmuje zgadywanie z nas: panel rosnie w gore
   * od punktu, ktory sie nie rusza.
   */
  const forceUp = above || anchor.bottom + height > window.innerHeight;
  const place = forceUp
    ? { bottom: Math.max(12, window.innerHeight - anchor.top + 4) }
    : { top: anchor.bottom + 4 };

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div className="picker" style={{ left, width, ...place }}>
        <div className="picker-title">{title}</div>
        {segments && (
          <div className="picker-segments">
            {segments.map((s) => (
              <button
                key={s.key}
                className={`segment${seg === s.key ? ' segment-active' : ''}`}
                onClick={() => setSeg(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {/* Przy filtrze sterowanym z zewnatrz wlasnego pola NIE MA — byloby drugim
            miejscem do pisania tego samego i musialoby przejac focus. */}
        {!controlled && (
        <input
          className="picker-input"
          /* type=search — inaczej menedzery hasel biora to pole za login i wchodza z podpowiedzia. */
          type="search"
          autoFocus
          value={query}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const opt = shown[cursor];
              // Enter z Ctrl/Cmd/Shift dokłada do wyboru, tak samo jak klik.
              if (opt) choose(opt.value, e.ctrlKey || e.metaKey || e.shiftKey);
            }
          }}
        />
        )}
        <div className="picker-list">
          {shown.length === 0 && <div className="picker-empty">{emptyLabel ?? 'Brak opcji'}</div>}
          {shown.map((o, i) => (
            <Fragment key={o.value}>
              {/* Kreska tylko MIEDZY pozycjami — na samej gorze listy nie ma czego dzielic. */}
              {o.divider && i > 0 && <div className="picker-sep" />}
              <button
                className={`picker-item${i === cursor ? ' picker-item-active' : ''}${
                  sel.has(o.value) ? ' picker-item-on' : ''
                }`}
                onMouseEnter={() => setCursor(i)}
                onClick={(e) => armed && choose(o.value, e.ctrlKey || e.metaKey || e.shiftKey)}
              >
                {o.photo !== undefined ? <Avatar name={o.label} photo={o.photo} /> : o.icon}
                <span className="picker-label">{o.label}</span>
                {o.hint && <span className="palette-hint">{o.hint}</span>}
                {/* Ptaszek pokazujemy ZAWSZE, gdy wolajacy podal `selected` — takze
                    w trybie jednokrotnym. Inaczej lista, do ktorej mozna dolozyc
                    kolejna pozycje (Ctrl/Shift+klik), nie pokazuje, co juz wybrano. */}
                {selected && (
                  <span className="picker-check">{sel.has(o.value) && <CheckIcon />}</span>
                )}
              </button>
            </Fragment>
          ))}
        </div>

        {footer && <div className="picker-foot">{footer}</div>}
      </div>
    </>
  );
}
