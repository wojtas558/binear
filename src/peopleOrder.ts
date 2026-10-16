/**
 * Kolejnosc osob w listach wyboru: najpierw skroty (ja, „Nieprzypisane"), potem ZESPOL z podpisem „Zespół",
 * na koncu reszta pracownikow z podpisem „Pozostali". Wewnatrz grup zostaje kolejnosc z wejscia.
 * Podpisy dostaja tylko pierwsze pozycje grup i tylko wtedy, gdy sa obie grupy (zespol + reszta).
 */
export const TEAM_LABEL = 'Zespół';
export const OTHERS_LABEL = 'Pozostali';

export function teamFirst<T extends { id: number }>(
  list: readonly T[],
  teamIds: ReadonlySet<number>,
  pinned: ReadonlySet<number> = new Set(),
): { item: T; section?: string }[] {
  const pin = list.filter((p) => pinned.has(p.id));
  const team = list.filter((p) => !pinned.has(p.id) && teamIds.has(p.id));
  const rest = list.filter((p) => !pinned.has(p.id) && !teamIds.has(p.id));
  const labelled = team.length > 0 && rest.length > 0;
  return [
    ...pin.map((item) => ({ item })),
    ...team.map((item, i) => ({ item, section: labelled && i === 0 ? TEAM_LABEL : undefined })),
    ...rest.map((item, i) => ({ item, section: labelled && i === 0 ? OTHERS_LABEL : undefined })),
  ];
}
