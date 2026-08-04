import React, { useState } from 'react';
import type { WidgetProps } from '../registry';
import { getMonthSummary, getYearSummary } from '../../data-sources/budget';
import { useBudgetYearEntries } from '../../data-sources/budgetStore';
import { useBudgetMonth } from '../../context/BudgetMonthContext';
import { DonutChart } from './BudgetReviewShared';

type Scope = 'month' | 'year';

// Reads the shared Time Period selection (BudgetMonthContext) for *which*
// month/year, same as Month Review and Year Review — but unlike those two,
// this widget keeps its own small local Month/Year toggle so one instance
// can show either granularity's category breakdown off the same shared
// selection, rather than being locked to just one.
export function CategorizedPieChartWidget({ app, config }: WidgetProps) {
  const budgetName = (config?.budgetName as string | undefined) ?? '';
  const { selectedMonthKey } = useBudgetMonth();
  const year = parseInt(selectedMonthKey.slice(0, 4), 10);

  const [scope, setScope] = useState<Scope>('month');
  const entries = useBudgetYearEntries(app, budgetName, budgetName ? year : null);

  if (!budgetName) {
    return (
      <div className="cc2-brw-root">
        <div className="cc2-brw-empty">This Categorized Pie Chart has no ledger configured yet.</div>
      </div>
    );
  }

  const summary = scope === 'month' ? getMonthSummary(entries, selectedMonthKey) : getYearSummary(entries, year);

  return (
    <div className="cc2-brw-root">
      <div className="cc2-brw-toolbar cc2-brw-toolbar-divided">
        <span className="cc2-brw-title">Categorized Pie Chart</span>
        <div className="cc2-brw-scope-toggle">
          <button
            type="button"
            className={`cc2-flush-btn cc2-brw-scope-btn${scope === 'month' ? ' active' : ''}`}
            onClick={() => setScope('month')}
          >
            Month
          </button>
          <button
            type="button"
            className={`cc2-flush-btn cc2-brw-scope-btn${scope === 'year' ? ' active' : ''}`}
            onClick={() => setScope('year')}
          >
            Year
          </button>
        </div>
      </div>
      <div className="cc2-brw-donut-col">
        <DonutChart summary={summary} />
      </div>
    </div>
  );
}
