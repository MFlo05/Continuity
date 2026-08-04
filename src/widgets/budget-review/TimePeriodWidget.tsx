import React from 'react';
import { MONTHS } from '../../core/dates';
import { useBudgetMonth } from '../../context/BudgetMonthContext';

const MONTH_NAMES = MONTHS;

/** Add `delta` months to a "YYYY-MM" key, rolling over year boundaries naturally. */
function stepMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The one dedicated period-selector widget for the whole budget-review
// family (Month Review, Year Review, Categorized Pie Chart all just read
// useBudgetMonth() with no selector of their own — this is the only writer).
// Visually mirrors CalendarStripWidget's date-block (small line + big bold
// line + accent dot) — see .cc2-tp-* in styles.css, values copied from
// .cc2-cal-wgt-date-line/.cc2-cal-wgt-day-name/.cc2-cal-wgt-accent.
export function TimePeriodWidget() {
  const { selectedMonthKey, setSelectedMonthKey } = useBudgetMonth();

  const year  = selectedMonthKey.slice(0, 4);
  const month = MONTH_NAMES[parseInt(selectedMonthKey.slice(5, 7), 10) - 1];

  const stepYear  = (delta: number) => setSelectedMonthKey(stepMonthKey(selectedMonthKey, delta * 12));
  const stepMonth = (delta: number) => setSelectedMonthKey(stepMonthKey(selectedMonthKey, delta));

  return (
    <div className="cc2-tp-root">
      <div className="label cc2-tp-title">Time Period</div>
      <div className="cc2-tp-year-row">
        <button type="button" className="cc2-flush-btn cc2-tp-nav-btn" onClick={() => stepYear(-1)} title="Previous year">‹</button>
        <span className="cc2-tp-year-label">{year}</span>
        <button type="button" className="cc2-flush-btn cc2-tp-nav-btn" onClick={() => stepYear(1)} title="Next year">›</button>
      </div>
      <div className="cc2-tp-month-row">
        <button type="button" className="cc2-flush-btn cc2-tp-nav-btn" onClick={() => stepMonth(-1)} title="Previous month">‹</button>
        <span className="cc2-tp-month-label">
          {month.toUpperCase()}<span className="cc2-tp-accent">.</span>
        </span>
        <button type="button" className="cc2-flush-btn cc2-tp-nav-btn" onClick={() => stepMonth(1)} title="Next month">›</button>
      </div>
    </div>
  );
}
