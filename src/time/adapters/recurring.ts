import type { App } from 'obsidian';
import { localISO, parseLocalISO } from '../../core/dates';
import { indexFilePath } from '../../data-sources/budget';
import {
  formatAmount, occurrencesBetween, recurringSource, toRecurringRows,
} from '../../data-sources/recurring';
import { mdTableCodec } from '../../core';
import type { MdTableRow } from '../../core';
import type { TimelineAdapter, TimelineEvent } from '../types';

/**
 * Upcoming recurring bills and income.
 *
 * LEDGER ENTRIES ARE DELIBERATELY NOT HERE. A ledger row is money already
 * spent — history, not agenda. A recurring item is a forward-looking
 * commitment ("Mortgage, 1st of each month"), which is the only part of
 * Finance that belongs on a day view. Adding spent transactions would bury
 * today's actual obligations under a log.
 *
 * Uses `occurrencesBetween` rather than `nextOccurrence`: an agenda needs
 * every hit inside the window, not just the next one, so a fortnightly item
 * shows up twice in a month.
 *
 * Reads the ledger through the md-table codec directly rather than through
 * useVaultData — an adapter is a plain async function with no React, and the
 * codec's read() is exactly that.
 */

/** Which ledger to read. Configurable later; today the app's default. */
const DEFAULT_LEDGER = 'Home-Ledger';

export function makeRecurringAdapter(ledgerName = DEFAULT_LEDGER): TimelineAdapter {
  return {
    id:    'recurring',
    label: 'Bills',
    kinds: ['bill'],

    async read(app: App, from: string, to: string): Promise<TimelineEvent[]> {
      const start = parseLocalISO(from);
      const end   = parseLocalISO(to);
      if (!start || !end || end < start) return [];

      const src = recurringSource(app, ledgerName);
      // A vault with no ledger yet is normal, not an error.
      const rows = await mdTableCodec.read(app, src, []).catch(() => [] as MdTableRow[]);
      const items = toRecurringRows(rows);

      const out: TimelineEvent[] = [];
      for (const item of items) {
        for (const when of occurrencesBetween(item.schedule, start, end)) {
          const date = localISO(when);
          out.push({
            id:       `bill:${ledgerName}:${item.id}:${date}`,
            date,
            title:    item.description,
            detail:   `${formatAmount(item.amount)} · ${item.category}`,
            kind:     'bill',
            sourceId: 'recurring',
            // Income and expense read very differently on a day view; the
            // semantic pair is already defined app-wide.
            tone:     item.section === 'Income' ? 'var(--cc2-income)' : 'var(--cc2-expense)',
            open:     () => { void app.workspace.openLinkText(indexFilePath(app, ledgerName), ''); },
          });
        }
      }
      return out;
    },

    watch(app: App) {
      // Only the index file holds the recurring table; the year ledgers don't.
      return { paths: [indexFilePath(app, ledgerName)] };
    },
  };
}

export const recurringAdapter = makeRecurringAdapter();
