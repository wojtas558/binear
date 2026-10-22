import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Karta pod kursorem — wspolny odczyt dla drobnych plakietek w wierszach,
 * naglowkach i na kartach tablicy.
 *
 * Uklad i typografia sa wziete z odczytu na wykresie spalania przy kilku osobach:
 * na gorze przygaszony PODPIS („co to jest"), pod nim wyrazna WARTOSC i obok niej
 * przygaszony DOPISEK. Dzieki temu obie karty w aplikacji czytaja sie tak samo.
 *
 * Zamiast `title`, czyli podpowiedzi przegladarki, bo ta pojawia sie z sekundowym
 * opoznieniem i jest jednym ciagiem tekstu — nie da sie w niej odroznic opisu od
 * odpowiedzi.
 *
 * Renderowana przez PORTAL: listy i panele przewijaja sie w kontenerach z
 * `overflow`, wiec karta pozycjonowana w srodku wiersza bylaby przycieta przy
 * gornej krawedzi.
 *
 * DOMYSLNIE stoi nad elementem, dociskana do jego prawej krawedzi — ale mierzy
 * sie i UCIEKA, gdy by sie nie zmiescila: przy braku miejsca u gory przeskakuje
 * pod element, a w poziomie jest przytrzymywana przy krawedziach okna.
 *
 * Wczesniej pozycja byla stala („zawsze nad, zawsze do prawej") i karta potrafila
 * wyjsc poza ekran — najdotkliwiej w PASKU NARZEDZI, gdzie „nad elementem" znaczy
 * poza gorna krawedzia okna, oraz przy lewym brzegu, gdzie dlugi dopisek wychodzil
 * w lewo. W srodku listy bylo to mniej widoczne, ale dzialo sie tak samo.
 */
export function HoverNote({
  label,
  value,
  note,
  noteColor,
  className,
  style,
  przyKursorze,
  children,
}: {
  /**
   * Przygaszony podpis nad wartoscia — „Termin", „Story points", „Zadania".
   *
   * Pomijany przy PRZYCISKACH: tam karta nie odpowiada na pytanie „co to za
   * liczba", tylko nazywa czynnosc, a nad nazwa czynnosci nie ma czego pisac.
   * Zostaje sam wiersz z wartoscia — czyli zwykly dymek.
   */
  label?: string;
  /** To, po co sie tu zaglada. */
  value: ReactNode;
  /** Dopisek obok wartosci; to on zwykle niesie kolor. */
  note?: ReactNode;
  /** Kolor dopisku — dowolna wartosc CSS, zwykle wyliczona (patrz `dueFill`). */
  noteColor?: string;
  className?: string;
  /** Styl elementu pod kursorem — np. kolor daty terminu. */
  style?: CSSProperties;
  /**
   * Zaczep kartę o KURSOR, nie o element.
   *
   * Dla plakietki w wierszu prawa krawedz elementu jest dobrym punktem — element
   * jest maly i karta wypada tuz przy nim. Dla powierzchni szerokiej na caly
   * pasek to samo doklejenie wyrzuca karte na koniec wiersza, kilkaset pikseli
   * od miejsca, w ktore ktos patrzy.
   */
  przyKursorze?: boolean;
  children: ReactNode;
}) {
  /** Prostokat elementu, nad ktorym stoi kursor — punkt odniesienia dla karty. */
  const [kotwica, setKotwica] = useState<DOMRect | null>(null);
  const kartaRef = useRef<HTMLDivElement>(null);
  const [poz, setPoz] = useState<{ top: number; left: number } | null>(null);

  /*
   * Pozycje liczymy DOPIERO gdy karta jest w drzewie, bo bez jej wymiarow nie da
   * sie stwierdzic, czy sie miesci. `useLayoutEffect`, a nie `useEffect` — pomiar
   * i poprawka musza zajsc przed malowaniem, inaczej karta mignelaby w zlym
   * miejscu.
   */
  useLayoutEffect(() => {
    const karta = kartaRef.current;
    if (!kotwica || !karta) {
      setPoz(null);
      return;
    }
    const k = karta.getBoundingClientRect();
    const margines = 8;
    const odstep = 6;

    /* Nad elementem, a gdy tam nie ma miejsca (pasek narzedzi!) — pod nim. */
    const nad = kotwica.top - k.height - odstep;
    const top = nad >= margines ? nad : kotwica.bottom + odstep;

    /* Dociskamy do PRAWEJ krawedzi elementu, ale nie pozwalamy wyjsc z okna. */
    const maks = Math.max(margines, window.innerWidth - k.width - margines);
    const left = Math.min(Math.max(kotwica.right - k.width, margines), maks);

    setPoz({ top, left });
  }, [kotwica]);

  return (
    <span
      className={className}
      style={style}
      onMouseEnter={(e) =>
        setKotwica(
          przyKursorze
            ? new DOMRect(e.clientX, e.clientY, 0, 0)
            : e.currentTarget.getBoundingClientRect(),
        )
      }
      /* Przy zaczepieniu o kursor karta ma za nim isc — inaczej zostaje tam,
         gdzie mysz weszla na powierzchnie, czyli zwykle przy jej krawedzi. */
      onMouseMove={przyKursorze ? (e) => setKotwica(new DOMRect(e.clientX, e.clientY, 0, 0)) : undefined}
      onMouseLeave={() => setKotwica(null)}
    >
      {children}
      {kotwica &&
        createPortal(
          <div
            ref={kartaRef}
            className="due-card"
            /*
             * Do pierwszego pomiaru karta jest NIEWIDOCZNA, a nie odsunieta poza
             * ekran: `visibility` nie wyklucza jej z pomiarow, a przesuniecie
             * poza krawedz zmienialoby szerokosc przy zawijaniu.
             */
            style={
              poz
                ? { top: poz.top, left: poz.left }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
            role="tooltip"
          >
            {label !== undefined && label !== '' && <div className="due-card-label">{label}</div>}
            <div className="due-card-row">
              <span className="due-card-value">{value}</span>
              {note !== undefined && note !== '' && (
                <span className="due-card-note" style={noteColor ? { color: noteColor } : undefined}>
                  {note}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
