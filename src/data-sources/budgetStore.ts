/**
 * budgetStore.ts — the Finance suite's three read hooks. Selectors only.
 *
 * This file used to BE the cache: a module-level, ref-counted
 * Map<(budgetName, year), parsed entries> with its own vault listener, built
 * because six Finance widgets pointed at one ledger otherwise meant six
 * listeners and six parses of the same file on every change.
 *
 * That mechanism now lives in core/source-cache.ts and serves every codec, so
 * all that's left here is three thin selectors over useVaultData. The
 * per-year granularity is preserved by the SOURCE shape rather than by a
 * hand-rolled cache key: `ledgerYearSource` points at one `<YYYY>-<name>.md`,
 * and the shared cache keys on that.
 *
 * Kept as a file (rather than folded into budget.ts) because these are React
 * hooks and budget.ts is deliberately hook-free — it's imported by the codec
 * layer and by plain functions.
 */

import { useMemo } from 'react';
import type { App } from 'obsidian';
import { useVaultData } from '../core';
import type { LedgerRow } from '../core';
import { ledgerYearSource, toRecentEntries, type BudgetEntry, type RecentEntry } from './budget';

const EMPTY: BudgetEntry[] = [];

/** One ledger year's entries, shared with every other widget on that year. */
export function useBudgetYearEntries(app: App, budgetName: string, year: number | null): BudgetEntry[] {
  const src = useMemo(
    () => (budgetName && year !== null ? ledgerYearSource(app, budgetName, year) : null),
    [app, budgetName, year],
  );
  const { rows } = useVaultData<LedgerRow>(app, src);
  return rows.length ? rows : EMPTY;
}

/**
 * Every entry needed to render the last 6 months, even when that window
 * crosses a calendar-year boundary (Feb 2027 needs both 2026 and 2027). Six
 * months back never spans more than the current year plus one prior, so only
 * those two are ever read.
 */
export function useBudgetRecentMonthsEntries(app: App, budgetName: string): BudgetEntry[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const priorYear   = now.getMonth() < 6 ? currentYear - 1 : null;

  const currentEntries = useBudgetYearEntries(app, budgetName, budgetName ? currentYear : null);
  const priorEntries   = useBudgetYearEntries(app, budgetName, budgetName ? priorYear : null);

  return useMemo(() => [...currentEntries, ...priorEntries], [currentEntries, priorEntries]);
}

/** Projection over the shared current-year snapshot — not a second read. */
export function useBudgetRecentEntries(app: App, budgetName: string, n = 30): RecentEntry[] {
  const currentYear = new Date().getFullYear();
  const entries = useBudgetYearEntries(app, budgetName, budgetName ? currentYear : null);
  return useMemo(() => toRecentEntries(entries, n), [entries, n]);
}
