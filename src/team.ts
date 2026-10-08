/*
 * Zespol i grafik tygodniowy: kto jest w zespole, na jaki etat i w ktore dni jest w pracy.
 * Z tego liczymy moce — zamiast jednej liczby programistow w konfiguracji.
 *
 * Sama arytmetyka i zapis w przegladarce, bez Reacta (patrz team.test.ts).
 *
 * Model:
 *  - czlonek zespolu ma wymiar etatu (0.5, 1 ...), liczony do mocy, gdy jest obecny,
 *  - domyslnie jest obecny w kazdy dzien roboczy (pn–pt); zapisujemy tylko WYJATKI — dni, w ktore
 *    go nie ma (`off`), dzieki czemu urlop to jedno klikniecie, a nie wypelnianie calego tygodnia,
 *  - dzien roboczy to 8–16 (jak w odliczaniu do konca sprintu), 1 godzina = 1 punkt na etat.
 */
import { WORK_END_HOUR, WORK_START_HOUR } from './sprintClock';

export interface TeamMember {
  id: number;
  name: string;
  /** Wymiar etatu: 1 = pelny, 0.5 = pol etatu. */
  fte: number;
}

export interface TeamConfig {
  members: TeamMember[];
  /** Dni nieobecnosci per osoba: id → daty RRRR-MM-DD (lokalnie). */
  off: Record<string, string[]>;
}

export const EMPTY_TEAM: TeamConfig = { members: [], off: {} };

/** Dostepne wymiary etatu w selekcie. */
export const FTE_OPTIONS = [1, 0.75, 0.5, 0.25] as const;

const HOUR_MS = 3_600_000;
const DAY_HOURS = WORK_END_HOUR - WORK_START_HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** Data lokalna jako RRRR-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Poniedzialek tygodnia, w ktorym jest `d` (lokalnie, o polnocy). */
export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (m.getDay() + 6) % 7; // pn = 0
  m.setDate(m.getDate() - back);
  return m;
}

/** Pieciu dni roboczych (pn–pt) tygodnia zaczynajacego sie w `monday`. */
export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 5 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

export const isWorkDay = (d: Date): boolean => d.getDay() >= 1 && d.getDay() <= 5;

/** Czy osoba jest w pracy w ten dzien (poza weekendem i poza wpisanymi nieobecnosciami). */
export function isPresent(team: TeamConfig, memberId: number, d: Date): boolean {
  if (!isWorkDay(d)) return false;
  return !(team.off[String(memberId)] ?? []).includes(isoDate(d));
}

/** Przelacza obecnosc osoby w danym dniu; zwraca NOWA konfiguracje. */
export function togglePresence(team: TeamConfig, memberId: number, d: Date): TeamConfig {
  const key = String(memberId);
  const iso = isoDate(d);
  const cur = team.off[key] ?? [];
  const next = cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso].sort();
  const off = { ...team.off };
  if (next.length) off[key] = next;
  else delete off[key];
  return { ...team, off };
}

/** Etaty w pracy danego dnia: suma wymiarow obecnych osob. */
export function fteOnDay(team: TeamConfig, d: Date): number {
  return team.members.reduce((n, m) => n + (isPresent(team, m.id, d) ? m.fte : 0), 0);
}

/** Godziny jednego dnia roboczego (8–16) mieszczace sie w przedziale od–do. */
function dayHoursWithin(day: Date, from: Date, to: Date): number {
  const open = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_START_HOUR).getTime();
  const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_END_HOUR).getTime();
  const a = Math.max(open, from.getTime());
  const b = Math.min(close, to.getTime());
  return b > a ? (b - a) / HOUR_MS : 0;
}

/**
 * Moce zespolu w godzinach (= punktach) w przedziale od–do: dla kazdego dnia roboczego godziny dnia,
 * ktore mieszcza sie w przedziale, razy suma etatow obecnych tego dnia.
 */
export function teamHoursBetween(team: TeamConfig, from: Date, to: Date): number {
  if (team.members.length === 0 || to.getTime() <= from.getTime()) return 0;
  let total = 0;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (day.getTime() <= to.getTime()) {
    if (isWorkDay(day)) {
      const h = dayHoursWithin(day, from, to);
      if (h > 0) total += h * fteOnDay(team, day);
    }
    day.setDate(day.getDate() + 1);
  }
  return total;
}

/** Moce calego tygodnia (pn–pt, pelne dni) — do podsumowania w grafiku. */
export function teamWeekHours(team: TeamConfig, monday: Date): number {
  return weekDays(monday).reduce((n, d) => n + fteOnDay(team, d) * DAY_HOURS, 0);
}

/** Bez ulamkow w napisie: 3.5 → „3,5", 4 → „4". */
export const fmtFte = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

export function addMember(team: TeamConfig, m: { id: number; name: string }, fte = 1): TeamConfig {
  if (team.members.some((x) => x.id === m.id)) return team;
  return { ...team, members: [...team.members, { id: m.id, name: m.name, fte }] };
}

export function removeMember(team: TeamConfig, id: number): TeamConfig {
  const off = { ...team.off };
  delete off[String(id)];
  return { members: team.members.filter((m) => m.id !== id), off };
}

export function setFte(team: TeamConfig, id: number, fte: number): TeamConfig {
  return { ...team, members: team.members.map((m) => (m.id === id ? { ...m, fte } : m)) };
}

/* ---------- zapis w przegladarce ---------- */

const STORAGE_KEY = 'binear.team.v1';

/** Wczytuje konfiguracje; przy bledzie lub zepsutych danych pusty zespol (wtedy liczy stary sposob). */
export function loadTeam(): TeamConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_TEAM;
    const p = JSON.parse(raw) as Partial<TeamConfig>;
    const members = (Array.isArray(p.members) ? p.members : [])
      .filter((m) => m && Number.isFinite(m.id) && typeof m.name === 'string')
      .map((m) => ({ id: Number(m.id), name: m.name, fte: Number.isFinite(m.fte) && m.fte > 0 ? Math.min(1, m.fte) : 1 }));
    const off: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(p.off ?? {})) {
      if (Array.isArray(v)) off[k] = v.filter((x) => typeof x === 'string');
    }
    return { members, off };
  } catch {
    return EMPTY_TEAM;
  }
}

export function saveTeam(team: TeamConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
  } catch {
    /* Brak miejsca albo zablokowany zapis — konfiguracja zyje do konca sesji. */
  }
}
