import { BugIcon, FlameIcon } from './icons';
import { hasBugTag, isFlame } from './taskView';

/**
 * Czerwone znaki bledu przed tytulem zadania — na liscie, tablicy i w planowaniu. Po jednym na zrodlo:
 * plomien (wysoki priorytet Bitriksa) i robak (tag BUG); zadanie z obu dostaje oba. Wywolujacy
 * sprawdza `isBug`; tu tylko rysunek i podpowiedz.
 */
export function BugBadge({ task }: { task: { priority: string; tags: string[] } }) {
  return (
    <>
      {isFlame(task) && (
        <span className="bug-badge" title="Wysoki priorytet (płomień)" aria-label="Wysoki priorytet">
          <FlameIcon />
        </span>
      )}
      {hasBugTag(task) && (
        <span className="bug-badge" title="Błąd — tag BUG" aria-label="Błąd">
          <BugIcon />
        </span>
      )}
    </>
  );
}
