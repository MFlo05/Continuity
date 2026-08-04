/**
 * BudgetMonthContext.tsx — the single shared "which month am I looking at"
 * cursor for the whole budget-review widget family (Month Review, Year
 * Review, Categorized Pie Chart). The Time Period widget is the only writer
 * (its month/year steppers); everything else just reads `selectedMonthKey`.
 *
 * Deliberately NOT shared by the Expense vs Income widget — that one always
 * shows the real last-6-months trend relative to today, independent of
 * whatever period the user is browsing elsewhere.
 *
 * Ephemeral (not persisted to data.json) — resets to the current month on
 * reload, same as other transient view state in this codebase (e.g.
 * CalendarStripWidget's selDate).
 */

import * as React from 'react';
import { getRecentMonths } from '../data-sources/budget';

interface BudgetMonthCtx {
  selectedMonthKey: string; // "YYYY-MM"
  setSelectedMonthKey: (key: string) => void;
}

const Ctx = React.createContext<BudgetMonthCtx | null>(null);

export function useBudgetMonth(): BudgetMonthCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useBudgetMonth must be used inside <BudgetMonthProvider>');
  return ctx;
}

export function BudgetMonthProvider({ children }: { children: React.ReactNode }) {
  const [selectedMonthKey, setSelectedMonthKey] = React.useState<string>(() => getRecentMonths(1)[0].key);
  const value = React.useMemo(() => ({ selectedMonthKey, setSelectedMonthKey }), [selectedMonthKey]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
