/*
 * Przeciaganie zadan — wspolny slownik identyfikatorow dla listy i tablicy.
 *
 * dnd-kit trzyma jeden rejestr elementow przeciaganych i jeden celow, wiec kazdy
 * cel musi sie sam przedstawic: czym jest i na co ma przestawic zadanie. Stad
 * prefiksy. Wartosci sa kodowane (encodeURIComponent), bo klucz grupy to nazwa
 * etapu albo osoby i moze zawierac dowolne znaki, ze "/" wlacznie.
 */

import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

export const dragId = (taskId: number) => `task:${taskId}`;
export const groupDropId = (groupKey: string) => `group:${encodeURIComponent(groupKey)}`;
export const subDropId = (groupKey: string, subKey: string) =>
  `sub:${encodeURIComponent(groupKey)}/${encodeURIComponent(subKey)}`;
export const colDropId = (stageId: number) => `col:${stageId}`;

export type DropTarget =
  /** Sekcja listy — ustawia os glowna (grupowanie). */
  | { kind: 'group'; groupKey: string }
  /** Podsekcja listy — ustawia obie osi naraz. */
  | { kind: 'sub'; groupKey: string; subKey: string }
  /** Kolumna tablicy — etap sprintu. */
  | { kind: 'col'; stageId: number };

export function parseDrag(id: UniqueIdentifier): number | null {
  const raw = String(id);
  if (!raw.startsWith('task:')) return null;
  const n = Number(raw.slice(5));
  return Number.isFinite(n) ? n : null;
}

export function parseDrop(id: UniqueIdentifier): DropTarget | null {
  const raw = String(id);
  if (raw.startsWith('group:')) {
    return { kind: 'group', groupKey: decodeURIComponent(raw.slice(6)) };
  }
  if (raw.startsWith('sub:')) {
    const [g, s] = raw.slice(4).split('/');
    if (g === undefined || s === undefined) return null;
    return { kind: 'sub', groupKey: decodeURIComponent(g), subKey: decodeURIComponent(s) };
  }
  if (raw.startsWith('col:')) {
    const n = Number(raw.slice(4));
    return Number.isFinite(n) ? { kind: 'col', stageId: n } : null;
  }
  return null;
}

/** Im wyzej, tym bardziej szczegolowy cel. Podgrupa lezy WEWNATRZ grupy. */
const RANK: Record<string, number> = { sub: 3, col: 2, group: 1 };

const rank = (id: UniqueIdentifier) => RANK[String(id).split(':')[0] ?? ''] ?? 0;

/**
 * Sekcje listy sa zagniezdzone, wiec kursor stoi naraz nad podgrupa i nad grupa.
 * Domyslne wykrywanie zwrociloby ta o wiekszym polu, czyli zawsze zewnetrzna —
 * i upuszczenie na podgrupe ustawialoby tylko os glowna, a zadanie wracaloby do
 * swojej starej podgrupy. Wygrywa wiec cel bardziej szczegolowy.
 *
 * `pointerWithin` bierze pod uwage sam kursor; gdy wypadnie poza wszystko (np.
 * przy przeciaganiu klawiatura, gdzie kursora nie ma), schodzimy na przeciecie
 * prostokatow.
 */
/**
 * Podglad ma isc za kursorem, a nie stac tam, gdzie zaczynal sie wiersz.
 *
 * Domyslnie dnd-kit stawia go w miejscu elementu przeciaganego i przesuwa
 * o delte kursora. Wiersz listy jest szeroki na cala liste, a podglad ma 320 px,
 * wiec zlapanie wiersza przy prawej krawedzi zostawialo podglad kilkaset pikseli
 * od kursora. Kursor laduje wiec w SRODKU podgladu — niezaleznie od tego, w kore
 * miejsce wiersza sie kliknelo, chwyt jest zawsze taki sam.
 */
export const snapToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const pointer = getEventCoordinates(activatorEvent);
  if (!pointer) return transform;

  return {
    ...transform,
    x: transform.x + (pointer.x - draggingNodeRect.left) - draggingNodeRect.width / 2,
    y: transform.y + (pointer.y - draggingNodeRect.top) - draggingNodeRect.height / 2,
  };
};

export const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const list = hits.length > 0 ? hits : rectIntersection(args);
  return [...list].sort((a, b) => rank(b.id) - rank(a.id));
};
