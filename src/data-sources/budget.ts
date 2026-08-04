/**
 * budget.ts — the Finance suite's PROJECTIONS, colours and paths.
 *
 * The ledger's on-disk format moved to the line-table codec
 * (core/codecs/line-table.ts) in Phase 3: parsing, serialising, the
 * month-section insertion logic, the file seeds and the watchers all live
 * there now. That format is V1-Command-Center-compatible and unchanged.
 *
 * What stays here is everything that is NOT a disk concern:
 *   - path helpers (a ledger is a folder; these resolve its pieces)
 *   - summaries: getMonthSummary / getYearSummary / getRecentMonths — pure
 *     projections over rows, shared by five widgets
 *   - categoryColor — presentation, and semantic to Finance (see
 *     DESIGN_SYSTEM.md's "Finance Suite Color System")
 *   - parseQuickAmount — parses USER INPUT, not a file
 *
 * Caching also stays out of the codec, in budgetStore.ts — see the codec's
 * header for why (it dedupes parses across six widgets; useVaultData doesn't).
 */

import { App, normalizePath } from 'obsidian';
import { resolveCommandCenterPath } from './vault-paths';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, EXPENSE_FALLBACK, INCOME_FALLBACK } from './budget-categories';
import type { LedgerRow, SourceRef } from '../core';

export function ledgersRoot(app: App): string {
  return resolveCommandCenterPath(app, 'Finance', 'Ledgers');
}

/**
 * A parsed ledger row. Now an alias for the codec's LedgerRow (which adds a
 * stable `id` and `year`) — every summary below reads only date/kind/amount/
 * category, so they work unchanged on the superset.
 */
export type BudgetEntry = LedgerRow;

export function budgetFolderPath(app: App, name: string): string {
  return `${ledgersRoot(app)}/${name}`;
}

export function indexFilePath(app: App, name: string): string {
  return `${budgetFolderPath(app, name)}/1-Index-${name}.md`;
}

export function yearFilePath(app: App, name: string, year: number): string {
  return `${budgetFolderPath(app, name)}/${year}-${name}.md`;
}

/**
 * Parse a quick-capture string into amount/description/kind.
 * A leading "-" (with or without "$" in between — "-20", "-$20", "$-20") means
 * expense; no leading "-" means income. Returns null if no number is found,
 * so the caller can show a validation hint instead of writing a bad entry
 * (V1 silently wrote $0 here — worth doing better).
 */
export function parseQuickAmount(raw: string): { amount: number; description: string; kind: 'income' | 'expense' } | null {
  const m = raw.match(/(-)?\$?(-)?(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const isNegative = !!m[1] || !!m[2];
  const amount = parseFloat(m[3]);
  const description = raw.replace(m[0], '').trim() || raw.trim();
  return { amount, description, kind: isNegative ? 'expense' : 'income' };
}

export type RecentEntry = {
  ts: string; date: string; text: string; category: string; kind: 'income' | 'expense';
};

/** Pure projection from parsed ledger entries to the N most recent, both kinds merged. */
export function toRecentEntries(entries: BudgetEntry[], n = 30): RecentEntry[] {
  return entries
    .slice()
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    .slice(0, n)
    .map(e => ({
      ts: e.time,
      date: e.date,
      text: `$${e.amount.toFixed(2)} ${e.description}`,
      category: e.category,
      kind: e.kind,
    }));
}

// ─── Review widgets (Month Review / Year Review) ───────────────────────────
//
// Note on year rollover: nothing here ever caches "the current year" — every
// read/write recomputes it from `new Date()` (or the entry's own date) at
// call time, so a brand-new "<name>-Ledger/2027-<name>-Ledger.md" gets
// created automatically the first time anything is read or written after
// Jan 1 — no migration step needed when a year turns over.

export type MonthSummary = {
  key:         string;   // "YYYY-MM" for a month, "YYYY" for a full year
  label:       string;   // "Jun '26" or "2026"
  income:      number;
  expenses:    number;
  savings:     number;
  savingsRate: number;   // pct of income saved
  byCategory:  Record<string, number>;
};

export function getRecentMonths(n = 6): Array<{ key: string; label: string }> {
  const result: Array<{ key: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2);
    result.push({ key, label });
  }
  return result;
}

export function getMonthSummary(entries: BudgetEntry[], monthKey: string): MonthSummary {
  const label   = getRecentMonths(72).find(m => m.key === monthKey)?.label ?? monthKey;
  const month   = entries.filter(e => e.date.startsWith(monthKey));
  const income  = month.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expenses = month.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const savings = income - expenses;

  const byCategory: Record<string, number> = {};
  for (const e of month.filter(e => e.kind === 'expense')) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
  }

  return {
    key: monthKey, label, income, expenses, savings,
    savingsRate: income > 0 ? (savings / income) * 100 : 0,
    byCategory,
  };
}

/** Same shape as MonthSummary, but totals the whole calendar year. */
export function getYearSummary(entries: BudgetEntry[], year: number): MonthSummary {
  const key         = String(year);
  const yearEntries = entries.filter(e => e.date.startsWith(key));
  const income      = yearEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expenses    = yearEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const savings     = income - expenses;

  const byCategory: Record<string, number> = {};
  for (const e of yearEntries.filter(e => e.kind === 'expense')) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
  }

  return {
    key, label: key, income, expenses, savings,
    savingsRate: income > 0 ? (savings / income) * 100 : 0,
    byCategory,
  };
}

// Interleaved so neighboring categories (by declaration order in
// budget-categories.ts) never land on adjacent hue families — same order
// the widget-tone palette itself uses for chart series (see
// command-center-widget-palette.html / DESIGN_SYSTEM.md). Deliberately a
// separate list from TonePicker.tsx's WIDGET_TONES (that one is swatch-UI
// display order; this one is chart/category-assignment order).
const CATEGORY_TONE_ORDER = [
  'sage', 'rust', 'indigo', 'ochre', 'plum',
  'spruce', 'terracotta', 'slate', 'moss', 'rose',
] as const;

// Positional map: the Nth category (in declaration order) gets the Nth tone,
// solid. Past the 10-tone cap, wrap around and soften 55% toward the card
// surface via color-mix rather than introducing new hues — a 16-category
// legend is a data problem, not a palette problem. The fallback bucket
// ("Other"/"Other Income") stays neutral, never assigned a tone.
function buildCategoryColors(names: string[], fallback: string): Record<string, string> {
  const map: Record<string, string> = { [fallback]: 'var(--cc2-faint)' };
  names.forEach((name, i) => {
    const tone = CATEGORY_TONE_ORDER[i % CATEGORY_TONE_ORDER.length];
    map[name] = i < CATEGORY_TONE_ORDER.length
      ? `var(--cc2-tone-${tone})`
      : `color-mix(in srgb, var(--cc2-tone-${tone}) 55%, var(--cc2-bg-raised))`;
  });
  return map;
}

const EXPENSE_CATEGORY_COLORS = buildCategoryColors(Object.keys(EXPENSE_CATEGORIES), EXPENSE_FALLBACK);
const INCOME_CATEGORY_COLORS  = buildCategoryColors(Object.keys(INCOME_CATEGORIES), INCOME_FALLBACK);

export function categoryColor(cat: string, kind: 'income' | 'expense' = 'expense'): string {
  const table    = kind === 'income' ? INCOME_CATEGORY_COLORS : EXPENSE_CATEGORY_COLORS;
  const fallback = kind === 'income' ? INCOME_FALLBACK : EXPENSE_FALLBACK;
  return table[cat] ?? table[fallback];
}

/** The whole ledger (every year) as a typed source — used for writes/scaffolding. */
export function ledgerSource(app: App, budgetName: string): SourceRef {
  return { codec: 'line-table', folder: normalizePath(budgetFolderPath(app, budgetName)) };
}

/**
 * ONE year of a ledger as a typed source. This is what the Finance widgets
 * read through: the shared source cache keys per source, so a year-scoped
 * source means a widget showing 2026 never forces a re-parse of every year on
 * disk — the granularity budgetStore's bespoke (budgetName, year) cache used
 * to provide by hand.
 */
export function ledgerYearSource(app: App, budgetName: string, year: number): SourceRef {
  return { codec: 'line-table', path: normalizePath(yearFilePath(app, budgetName, year)) };
}

// Reading, writing and watching all moved to the line-table codec
// (core/codecs/line-table.ts). budgetStore.ts calls it through
// lineTableCodec.readYear + subscribeVault; nothing here loads files any more.
//
// Also deleted in Phase 3 as dead code (zero references anywhere):
// listBudgetNames, loadRecentEntries, watchBudgetFolder, loadRecentMonthsEntries.
