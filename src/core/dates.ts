/**
 * core/dates.ts — the one date module.
 *
 * Before this file, the same helpers were hand-rolled per consumer: the local
 * ISO formatter appeared BYTE-IDENTICALLY in ten files, `isSameDay` in five
 * (one of them using a different algorithm), the 12-hour formatter in three,
 * and the month/weekday name tables in eight. That was consistent with the
 * house style for PARSERS — each data source owns a narrow one scoped to what
 * it writes — but date maths isn't a parser. There is exactly one correct
 * answer to "what is today, locally", and having ten copies of it meant two of
 * them were quietly wrong (see below).
 *
 * ── THE UTC TRAP, which this module exists to end ──────────────────────────
 *
 * `new Date().toISOString().slice(0, 10)` is the obvious way to get YYYY-MM-DD
 * and it is wrong for a local calendar. `toISOString()` converts to UTC first,
 * so at 18:00 on the 3rd in UTC-7 it yields the 4th — an event filed a day
 * late, or a "today" that doesn't match the user's clock. `meetings.ts` had
 * documented this since it was written; `class-info.ts` and `class-notes.ts`
 * did it anyway. `localISO` reads the local components directly and cannot
 * drift.
 *
 * ── WEEKDAY INDEXING ──────────────────────────────────────────────────────
 *
 * Two conventions are in play and both are load-bearing. JavaScript's
 * `Date.getDay()` is Sunday=0. This app's data — class schedules, meal plans —
 * is Monday=0, because a week that starts on Monday is what a timetable means.
 * The conversion `(getDay() + 6) % 7` was written out at four call sites;
 * `toMondayIndex` is that expression, named. Never mix the two: a raw
 * `getDay()` used against `WEEKDAYS` is off by one for six days out of seven.
 */

// ── ISO dates (local, never UTC) ──────────────────────────────────────────

/**
 * A Date as local `YYYY-MM-DD`. The single source of truth for every date
 * string this app writes to disk or compares against.
 */
export function localISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as local `YYYY-MM-DD`. */
export function todayISO(): string {
  return localISO(new Date());
}

/**
 * `YYYY-MM-DD` back to a Date at LOCAL midnight.
 *
 * Deliberately not `new Date(iso)`: the spec parses a bare date string as UTC,
 * so that returns the previous day's evening in any negative-offset timezone.
 * Building from components sidesteps it entirely.
 */
export function parseLocalISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** True when a string is a well-formed leading `YYYY-MM-DD`. */
export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}

// ── Day arithmetic ────────────────────────────────────────────────────────

export function startOfDay(d: Date = new Date()): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date = new Date()): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Monday-anchored start of the week containing `d`, at local midnight. */
export function startOfWeek(d: Date = new Date()): Date {
  const r = new Date(d);
  const day = r.getDay();                    // 0 = Sunday
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  r.setHours(0, 0, 0, 0);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

/** Days in a given month. `month` is 0-based, matching Date. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// ── Weekday indexing ──────────────────────────────────────────────────────

/**
 * JS `getDay()` (Sunday=0) → this app's index (Monday=0).
 * See the header note; mixing the two is an off-by-one six days a week.
 */
export function toMondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/** A Date's weekday on the Monday=0 scale. */
export function mondayIndexOf(d: Date): number {
  return toMondayIndex(d.getDay());
}

// ── Clock times (minutes from local midnight) ─────────────────────────────
//
// The class schedule stores times as minutes-from-midnight rather than as
// Dates, because a weekly template has no date to attach a Date to. These
// convert at the edges.

/** `"09:30"` → 570. Returns 0 for anything unparseable. */
export function timeToMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** 570 → `"09:30"`. */
export function minToTime(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 570 → `"9:30 AM"`. */
export function fmtTime12h(min: number): string {
  const h24 = Math.floor(min / 60), m = min % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ── Name tables ───────────────────────────────────────────────────────────
//
// Monday-first, matching toMondayIndex. Eight separate copies of these existed,
// in three different cases and two different week orders.

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** `"June 2026"` — the ledger's `## <Month Year>` heading format. */
export function monthYearLabel(iso: string): string {
  const d = parseLocalISO(iso);
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : iso;
}
