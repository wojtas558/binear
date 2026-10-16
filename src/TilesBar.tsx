import type { CSSProperties } from 'react';

import { Delta } from './CounterHistory';
import type { DaySnapshot } from './counters';
import { colorCss, groupTotals, shownValue, type CustomTile, type TileGroup, type TileNumbers } from './customTiles';
import { PenIcon } from './icons';
import { PlusIcon, TILE_ICON_NODES } from './tileIcons';

export { TILE_ICON_NODES };
export const tileColorCss = colorCss;

/**
 * Wlasne kafelki uzytkownika: grupy z podpisami, w nich kafelki z liczba zadan albo suma SP. Klik
 * stosuje zapisany widok (zakres + filtry); ponowny klik czysci filtry. Podpis grupy pokazuje, jak w zestawie
 * IT, SUME kafelkow (zadania i SP) z roznica wzgledem poprzedniego dnia. Wyglad bierzemy z tych samych klas
 * co wbudowane liczniki, zeby oba rzedy wygladaly jak jedna rodzina.
 */
export function TilesBar({
  groups,
  values,
  prev,
  activeId,
  onPick,
  onAdd,
  onManage,
}: {
  groups: { group: TileGroup; tiles: CustomTile[] }[];
  values: ReadonlyMap<string, TileNumbers>;
  /** Ostatni zapisany dzien przed dzisiejszym (dla strzalek); `null`, gdy nie ma historii. */
  prev: { day: string; snap: DaySnapshot } | null;
  activeId: string | null;
  onPick: (tile: CustomTile) => void;
  onAdd: () => void;
  onManage: () => void;
}) {
  return (
    <div className="counters counters-custom" role="toolbar" aria-label="Moje kafelki">
      {groups.map(({ group, tiles }) => {
        const total = groupTotals(tiles, values);
        const prevCount = prev?.snap[`g:${group.id}`];
        const prevPoints = prev?.snap[`gs:${group.id}`];
        const caption = group.hideCaption ? null : (
            <span
              className="counters-cap counters-cap-total counters-cap-static"
              title={
                `Suma kafelków grupy: ${total.count} zadań, ${total.points} SP.` +
                (prevPoints !== undefined ? ` Dzień wcześniej: ${prevCount ?? '?'} zadań, ${prevPoints} SP.` : '') +
                ' Kafelki to osobne widoki i mogą się nakładać.'
              }
            >
              <span className="counters-cap-text">{group.name}</span>
              <span className="counters-cap-count">{total.count}</span>
              <span className="counters-cap-sp">{total.points} SP</span>
              {prev && <Delta now={total.count} before={prevCount} day={prev.day} riseIsBad />}
            </span>
          );
        return (
          <div key={group.id} className="counters-group" style={{ ['--n' as string]: tiles.length } as CSSProperties}>
            {caption ?? (
              /* Grupa bez podpisu: niewidoczny odpowiednik trzyma kafelki na wysokosci sasiednich grup. */
              <span className="counters-cap counters-cap-total counters-cap-static counters-cap-ghost" aria-hidden>
                <span className="counters-cap-text">&nbsp;</span>
                <span className="counters-cap-count">0</span>
                <span className="counters-cap-sp">0 SP</span>
              </span>
            )}
            <div className="counters-group-row">
              {tiles.map((t) => {
                const on = activeId === t.id;
                const v = values.get(t.id) ?? { count: 0, points: 0 };
                const shown = shownValue(t, v);
                return (
                  <button
                    key={t.id}
                    className={`counter${on ? ' counter-on' : ''}`}
                    style={{ ['--c' as string]: colorCss(t.color) } as CSSProperties}
                    aria-pressed={on}
                    title={on ? 'Kliknij ponownie, żeby wyczyścić filtry.' : `Pokaż: ${t.name}`}
                    onClick={() => onPick(t)}
                  >
                    <span className="counter-icon">{TILE_ICON_NODES[t.icon] ?? TILE_ICON_NODES.list}</span>
                    <span className="counter-body">
                      <span className="counter-top">
                        <span className="counter-value">{shown}</span>
                        {t.measure === 'points' && <span className="counter-points">SP</span>}
                        {/* Druga miara mniejszym tekstem: kafelek liczy zadania -> obok SP, i odwrotnie. */}
                        <span className="counter-points counter-second">
                          {t.measure === 'points' ? `${v.count} zad.` : `${v.points} SP`}
                        </span>
                      </span>
                      <span className="counter-label">{t.name}</span>
                      {prev && <Delta now={shown} before={prev.snap[`t:${t.id}`]} day={prev.day} riseIsBad />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="counters-group counters-tools">
        {/* Niewidoczny odpowiednik podpisu grupy (te same klasy i tresc) — dzieki temu rzad przyciskow zaczyna sie
            na tej samej wysokosci co kafelki, a nie kilka pikseli nizej. */}
        <span className="counters-cap counters-cap-total counters-cap-static counters-cap-ghost" aria-hidden>
          <span className="counters-cap-text">&nbsp;</span>
          <span className="counters-cap-count">0</span>
          <span className="counters-cap-sp">0 SP</span>
        </span>
        <div className="counters-group-row counters-tools-row">
          <button
            className="counter counter-add counter-icon-only"
            onClick={onAdd}
            title="Zapisz bieżący widok (zakres i filtry) jako kafelek"
            aria-label="Dodaj kafelek"
          >
            <PlusIcon />
          </button>
          <button
            className="counter counter-add counter-icon-only"
            onClick={onManage}
            title="Edytuj kafelki: kolejność, grupy, kolory, eksport i import"
            aria-label="Edytuj kafelki"
          >
            <PenIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
