/**
 * Logika laczenia warunkow filtra. Warunki sa domyslnie rozdzielone ORAZ; warunki z tym samym `or`
 * tworza grupe LUB (nawias), np. (priorytet = wysoki LUB tag = BUG) ORAZ etap = W toku.
 */
export interface Groupable {
  or?: string;
}

/** Czy zadanie przechodzi: kazdy warunek spoza grup i kazda grupa (wystarczy jeden jej warunek). */
export function matchGrouped<T extends Groupable>(conds: readonly T[], test: (c: T) => boolean): boolean {
  const groups = new Map<string, boolean>();
  for (const c of conds) {
    if (!c.or) {
      if (!test(c)) return false;
    } else groups.set(c.or, (groups.get(c.or) ?? false) || test(c));
  }
  for (const ok of groups.values()) if (!ok) return false;
  return true;
}

/** Grupy z jednym warunkiem to zwykly warunek — zdejmujemy `or`, zeby nie wisial pusty nawias. */
export function normalizeGroups<T extends Groupable>(conds: readonly T[]): T[] {
  const size = new Map<string, number>();
  for (const c of conds) if (c.or) size.set(c.or, (size.get(c.or) ?? 0) + 1);
  return conds.map((c) => {
    if (!c.or || (size.get(c.or) ?? 0) > 1) return c;
    const { or: _or, ...rest } = c;
    return rest as T;
  });
}

/** Laczy warunek z sasiadem LUB rozlacza go (ORAZ). `a` i `b` to sasiednie warunki, `a` przed `b`. */
export function toggleJoin<T extends Groupable & { id: string }>(
  conds: readonly T[],
  bId: string,
  newGroup: () => string,
): T[] {
  const i = conds.findIndex((c) => c.id === bId);
  if (i < 1) return [...conds];
  const a = conds[i - 1];
  const b = conds[i];
  let next: T[];
  if (a.or && a.or === b.or) {
    // Rozlaczenie: b i wszystko po nim w tej grupie zostaja osobna grupa/warunkiem.
    const rest = new Set(conds.slice(i).filter((c) => c.or === a.or).map((c) => c.id));
    const g = newGroup();
    next = conds.map((c) => (rest.has(c.id) ? { ...c, or: g } : c));
  } else {
    const g = a.or ?? b.or ?? newGroup();
    const merged = new Set([a.or, b.or].filter(Boolean));
    next = conds.map((c) => (c.id === a.id || c.id === b.id || (c.or && merged.has(c.or)) ? { ...c, or: g } : c));
  }
  return normalizeGroups(next);
}

/** Odcisk niezalezny od id grup: do porownywania widokow i kafelkow. */
export function groupedKeys<T extends Groupable>(conds: readonly T[], key: (c: T) => string): string[] {
  const groups = new Map<string, string[]>();
  const out: string[] = [];
  for (const c of conds) {
    if (c.or) groups.set(c.or, [...(groups.get(c.or) ?? []), key(c)]);
    else out.push(key(c));
  }
  for (const g of groups.values()) out.push(`(${g.sort().join(' | ')})`);
  return out.sort();
}

/** Nowe id grup przy wczytaniu zapisanego zestawu, zeby nie kolidowaly z grupami biezacej sesji. */
export function refreshGroups<T extends Groupable>(conds: readonly T[], newGroup: () => string): T[] {
  const map = new Map<string, string>();
  return conds.map((c) => {
    if (!c.or) return c;
    if (!map.has(c.or)) map.set(c.or, newGroup());
    return { ...c, or: map.get(c.or) };
  });
}

/**
 * Przenosi warunek `fromId` na miejsce warunku `toId` (przeciaganie chipow). Przenoszony chip wychodzi
 * ze swojej grupy LUB — o tym, kto z kim sasiaduje, decyduje potem lacznik, a nie pozostalosc po starym miejscu.
 */
export function moveCondition<T extends Groupable & { id: string }>(
  conds: readonly T[],
  fromId: string,
  toId: string,
): T[] {
  const from = conds.findIndex((c) => c.id === fromId);
  const to = conds.findIndex((c) => c.id === toId);
  if (from < 0 || to < 0 || from === to) return [...conds];
  const rest = conds.filter((c) => c.id !== fromId);
  const { or: _or, ...moved } = conds[from];
  rest.splice(to, 0, moved as unknown as T);
  return normalizeGroups(rest);
}
