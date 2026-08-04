/**
 * recurring.ts — the `## Recurring Items` table inside each ledger's
 * `1-Index-<Name>-Ledger.md` (see budget.ts's indexFilePath).
 *
 * This file used to own a hand-rolled markdown-table parser, serializer,
 * file I/O and its own vault watcher. All four are gone: that format is now
 * core/codecs/md-table.ts, and this ledger table was the second consumer that
 * justified writing it (WIDGET-INVENTORY.md had already filed Recurring Items
 * as "a markdown table… needs its own handling"). What's left here is the part
 * that was never about disk:
 *
 *   - the RecurringItem shape and its mapping to/from generic table cells
 *   - schedule parsing and next-occurrence date math
 *
 * The table shape on disk is unchanged, and must stay so — `budget-capture.md`
 * reads this exact table every time it runs:
 *   | Amount | Description | Category | Section | Schedule |
 *   | --- | --- | --- | --- | --- |
 *   | $1,870.93 | Mortgage | Housing | Expenses | 1st of each month |
 *
 * NOTE ON LAYERING: the codec is generic and deals in strings. The `$` and
 * thousands separators are a Finance convention, not a table one, so amount
 * formatting/parsing lives here — the codec must not learn about currency.
 */

import type { App } from 'obsidian';
import type { MdTableRow, SourceRef } from '../core';
import { addDays, daysInMonth, parseLocalISO, startOfDay } from '../core/dates';
import { indexFilePath } from './budget';

export type RecurringItem = {
  amount:      number;
  description: string;
  category:    string;
  section:     'Income' | 'Expenses';
  schedule:    string; // raw text, e.g. "1st of each month" or "Every 28 days from 2026-06-03"
};

/** A RecurringItem plus the codec row identity a mutation addresses it by. */
export type RecurringRow = RecurringItem & { id: string; raw?: string };

/** The heading that scopes this table inside the ledger's index file. */
export const RECURRING_HEADING = 'Recurring Items';

/** Column headers, verbatim — these are the codec's row keys. */
const COL = {
  amount:      'Amount',
  description: 'Description',
  category:    'Category',
  section:     'Section',
  schedule:    'Schedule',
} as const;

export function recurringSource(app: App, budgetName: string): SourceRef {
  return { codec: 'md-table', path: indexFilePath(app, budgetName), heading: RECURRING_HEADING };
}

function parseAmount(raw: string): number {
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function formatAmount(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const cell = (row: MdTableRow, key: string): string =>
  typeof row[key] === 'string' ? (row[key] as string).trim() : '';

/** Generic table rows → typed recurring items. */
export function toRecurringRows(rows: MdTableRow[]): RecurringRow[] {
  return rows.map(r => ({
    id:          r.id,
    raw:         r.raw,
    amount:      parseAmount(cell(r, COL.amount)),
    description: cell(r, COL.description),
    category:    cell(r, COL.category),
    // Anything that isn't literally "Income" is an expense — same permissive
    // rule the old parser used, so a hand-edited file can't produce a third kind.
    section:     /^income$/i.test(cell(r, COL.section)) ? 'Income' : 'Expenses',
    schedule:    cell(r, COL.schedule),
  }));
}

/** A typed item → the cells the codec writes. */
export function recurringCells(item: RecurringItem): Record<string, string> {
  return {
    [COL.amount]:      formatAmount(item.amount),
    [COL.description]: item.description,
    [COL.category]:    item.category,
    [COL.section]:     item.section,
    [COL.schedule]:    item.schedule,
  };
}

// ─── Schedule parsing ───────────────────────────────────────────────────────
// Shared between RecurringItemModal (reverse-parsing an existing schedule
// string back into the structured Monthly/Every-N-days/Custom picker) and
// RecurringItemsGallery (computing a next-occurrence date to sort/display by).

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const MONTHLY_RE = /^(\d{1,2})(?:st|nd|rd|th)\s+of each month$/i;
const EVERY_N_RE = /^every\s+(\d+)\s+days\s+from\s+(\d{4}-\d{2}-\d{2})$/i;

export type ParsedSchedule =
  | { mode: 'monthly'; day: number }
  | { mode: 'everyN'; interval: number; startDate: string }
  | { mode: 'custom'; raw: string };

/** Reverse-parse a raw schedule string into a structured shape — falls back to
 * 'custom' for anything that doesn't match either canonical pattern, so
 * hand-written schedule text never gets mangled or misinterpreted. */
export function parseSchedule(raw: string): ParsedSchedule {
  const monthly = MONTHLY_RE.exec(raw.trim());
  if (monthly) return { mode: 'monthly', day: parseInt(monthly[1], 10) };

  const everyN = EVERY_N_RE.exec(raw.trim());
  if (everyN) return { mode: 'everyN', interval: parseInt(everyN[1], 10), startDate: everyN[2] };

  return { mode: 'custom', raw };
}

/**
 * Compute the next occurrence on/after `from` (defaults to today, local time,
 * time-of-day stripped). Returns null for 'custom' schedules that don't match
 * either canonical pattern — there's no way to compute a date from free text.
 */
export function nextOccurrence(schedule: string, from: Date = new Date()): Date | null {
  const parsed = parseSchedule(schedule);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  if (parsed.mode === 'monthly') {
    const clamp = (y: number, m: number) => Math.min(parsed.day, daysInMonth(y, m));
    let candidate = new Date(today.getFullYear(), today.getMonth(), clamp(today.getFullYear(), today.getMonth()));
    if (candidate < today) {
      const y = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
      const m = (today.getMonth() + 1) % 12;
      candidate = new Date(y, m, clamp(y, m));
    }
    return candidate;
  }

  if (parsed.mode === 'everyN') {
    const start = parseLocalISO(parsed.startDate);
    if (!start) return null;
    if (start > today) return start;
    const n = Math.max(1, parsed.interval);
    const diffDays = Math.round((today.getTime() - start.getTime()) / 86400000);
    const cyclesPassed = Math.floor(diffDays / n);
    let candidate = new Date(start.getTime() + cyclesPassed * n * 86400000);
    if (candidate < today) candidate = new Date(candidate.getTime() + n * 86400000);
    return candidate;
  }

  return null;
}

/** Hard ceiling on expansion, so a malformed schedule can't spin forever. */
const MAX_OCCURRENCES = 400;

/**
 * EVERY occurrence in [from, to], inclusive — the windowed sibling of
 * nextOccurrence.
 *
 * nextOccurrence answers "when is this due next", which is all the Recurring
 * Items gallery ever needed. An agenda asks a different question: a bill due
 * on the 1st should appear on the 1st of every month the user pages through,
 * and a fortnightly item should appear twice in a month-long window.
 *
 * Both dates are treated as local midnight, and both ends are inclusive.
 * `'custom'` schedules yield nothing — free text like "when the invoice
 * arrives" has no computable date, and guessing would be worse than omitting.
 */
export function occurrencesBetween(schedule: string, from: Date, to: Date): Date[] {
  const parsed = parseSchedule(schedule);
  const start = startOfDay(from);
  const end   = startOfDay(to);
  if (end < start) return [];

  const out: Date[] = [];

  if (parsed.mode === 'monthly') {
    // Walk months rather than days: the day-of-month is fixed, and clamping
    // per month is what makes "the 31st" land on the 28th in February instead
    // of silently rolling into March.
    let y = start.getFullYear();
    let m = start.getMonth();
    while (out.length < MAX_OCCURRENCES) {
      const d = new Date(y, m, Math.min(parsed.day, daysInMonth(y, m)));
      if (d > end) break;
      if (d >= start) out.push(d);
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
    return out;
  }

  if (parsed.mode === 'everyN') {
    const anchor = parseLocalISO(parsed.startDate);
    if (!anchor) return [];
    const n = Math.max(1, parsed.interval);

    // addDays (setDate) rather than adding n * 86_400_000 milliseconds.
    // Stepping by fixed ms is only correct while every day is 24 hours: cross
    // a DST boundary and the cursor lands at 23:00 the previous day or 01:00
    // the next, and from there every subsequent date is off by one. A window
    // measured in months WILL cross one. nextOccurrence gets away with the ms
    // form because it only ever computes a single hop.
    //
    // The initial jump is a day-count so an anchor years in the past doesn't
    // cost thousands of iterations before the window even starts. Rounding is
    // safe here because both operands are local midnights — a DST-affected
    // difference is 23h or 25h, which rounds to the right whole day.
    let cursor = anchor;
    if (anchor < start) {
      const dayDiff = Math.round((start.getTime() - anchor.getTime()) / 86400000);
      cursor = addDays(anchor, Math.ceil(dayDiff / n) * n);
    }
    while (cursor <= end && out.length < MAX_OCCURRENCES) {
      if (cursor >= start) out.push(cursor);
      cursor = addDays(cursor, n);
    }
    return out;
  }

  return [];
}
