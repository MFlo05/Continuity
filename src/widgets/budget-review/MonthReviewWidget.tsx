import React from 'react';
import type { WidgetProps } from '../registry';
import { getMonthSummary } from '../../data-sources/budget';
import { useBudgetYearEntries } from '../../data-sources/budgetStore';
import { useBudgetMonth } from '../../context/BudgetMonthContext';
import { StatCard, fmt$, fmtPct } from './BudgetReviewShared';

// Stat-cards-only now — the bar chart moved to its own ExpenseVsIncomeWidget,
// and the month selection moved to the dedicated TimePeriodWidget (shared via
// BudgetMonthContext) — this widget has no selector UI of its own anymore.
export function MonthReviewWidget({ app, config }: WidgetProps) {
  const budgetName = (config?.budgetName as string | undefined) ?? '';
  const { selectedMonthKey } = useBudgetMonth();
  const year = parseInt(selectedMonthKey.slice(0, 4), 10);

  const entries = useBudgetYearEntries(app, budgetName, budgetName ? year : null);

  if (!budgetName) {
    return (
      <div className="cc2-brw-root">
        <div className="cc2-brw-empty">This Month Review has no ledger configured yet.</div>
      </div>
    );
  }

  const summary = getMonthSummary(entries, selectedMonthKey);
  const savingsColor = summary.savingsRate >= 20 ? 'var(--cc2-income)' : summary.savingsRate >= 10 ? 'var(--cc2-tone-terracotta)' : 'var(--cc2-expense)';

  return (
    <div className="cc2-brw-root">
      <div className="cc2-brw-toolbar cc2-brw-toolbar-compact">
        <span className="cc2-brw-title">Month Review</span>
      </div>
      <div className="cc2-brw-stats-row">
        <StatCard label="Income" value={fmt$(summary.income)} accent="var(--cc2-income)" sub={summary.label} />
        <StatCard label="Expenses" value={fmt$(summary.expenses)} accent="var(--cc2-expense)" sub={summary.label} />
        <StatCard
          label="Savings Rate"
          value={fmtPct(summary.savingsRate)}
          accent={savingsColor}
          sub={`${fmt$(summary.savings)} saved`}
        />
      </div>
    </div>
  );
}
