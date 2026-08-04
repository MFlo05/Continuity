import React, { useState } from 'react';
import type { WidgetProps } from '../registry';
import { getRecentMonths, getMonthSummary, type BudgetEntry } from '../../data-sources/budget';
import { useBudgetRecentMonthsEntries } from '../../data-sources/budgetStore';
import { fmt$ } from './BudgetReviewShared';

// Extracted from the original combined MonthReviewWidget. Deliberately NOT
// wired to BudgetMonthContext (the shared Time Period selector) — this is
// always the real last-6-months trend relative to today, a "recent history"
// view rather than a "browse an arbitrary period" one. Ported from V1
// Command-Center's tab-budget.tsx BarChart, with hardcoded rgba(255,255,255,…)
// colors replaced by --cc2-* theme tokens (income/expense bars reuse the same
// green/red as the Income & Expense Tracker widget), and 6 months instead of
// V1's 5.
const BAR_W = 20, BAR_GAP = 6, GROUP_GAP = 20;
const PAD_LEFT = 40, PAD_RIGHT = 8, PAD_TOP = 14, PAD_BOTTOM = 20, CHART_H = 170;

function BarChart({ entries }: { entries: BudgetEntry[] }) {
  const months    = getRecentMonths(6).reverse(); // oldest → newest, left to right
  const summaries = months.map(m => getMonthSummary(entries, m.key));

  const maxVal = Math.max(...summaries.flatMap(s => [s.income, s.expenses]), 1);
  const nice = (v: number) => {
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / e) * e;
  };
  const yMax = nice(maxVal * 1.15);

  const nGroups = months.length;
  const groupW  = BAR_W * 2 + BAR_GAP + GROUP_GAP;
  const innerW  = nGroups * groupW - GROUP_GAP;
  const svgW    = PAD_LEFT + innerW + PAD_RIGHT;
  const innerH  = CHART_H - PAD_TOP - PAD_BOTTOM;

  const yScale = (v: number) => PAD_TOP + innerH - (v / yMax) * innerH;

  const gridLines = [0, 0.5, 1].map(pct => ({
    y: yScale(pct * yMax),
    label: pct === 0 ? '$0' : `$${Math.round((pct * yMax) / 1000)}k`,
  }));

  const [hovered, setHovered] = useState<{ idx: number; kind: 'income' | 'expense' } | null>(null);

  return (
    <svg width="100%" viewBox={`0 0 ${svgW} ${CHART_H}`} style={{ overflow: 'visible', display: 'block' }}>
      {gridLines.map(({ y, label }) => (
        <g key={label}>
          <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + innerW} y2={y} style={{ stroke: 'var(--cc2-border)' }} strokeWidth={1} />
          <text x={PAD_LEFT - 6} y={y + 4} textAnchor="end" style={{ fill: 'var(--cc2-faint)' }} fontSize={8}>{label}</text>
        </g>
      ))}

      {summaries.map((s, i) => {
        const gx  = PAD_LEFT + i * groupW;
        const ih  = Math.max(2, (s.income   / yMax) * innerH);
        const eh  = Math.max(2, (s.expenses / yMax) * innerH);
        const iy  = yScale(s.income);
        const ey  = yScale(s.expenses);
        const hov = hovered?.idx === i;

        return (
          <g key={s.key}>
            <rect
              x={gx} y={iy} width={BAR_W} height={ih} rx={3} ry={3}
              style={{ fill: 'var(--cc2-income)', opacity: hov && hovered?.kind === 'income' ? 1 : 0.75, cursor: 'pointer', transition: 'opacity 140ms ease' }}
              onMouseEnter={() => setHovered({ idx: i, kind: 'income' })}
              onMouseLeave={() => setHovered(null)}
            />
            <rect
              x={gx + BAR_W + BAR_GAP} y={ey} width={BAR_W} height={eh} rx={3} ry={3}
              style={{ fill: 'var(--cc2-expense)', opacity: hov && hovered?.kind === 'expense' ? 1 : 0.72, cursor: 'pointer', transition: 'opacity 140ms ease' }}
              onMouseEnter={() => setHovered({ idx: i, kind: 'expense' })}
              onMouseLeave={() => setHovered(null)}
            />
            <text x={gx + BAR_W + BAR_GAP / 2} y={CHART_H - 6} textAnchor="middle" style={{ fill: 'var(--cc2-faint)' }} fontSize={8.5}>
              {s.label.split(' ')[0]}
            </text>
            {hov && hovered && (
              <text
                x={gx + BAR_W + BAR_GAP / 2}
                y={hovered.kind === 'income' ? iy - 5 : ey - 5}
                textAnchor="middle"
                style={{ fill: 'var(--cc2-text)' }}
                fontSize={8.5}
                fontWeight={600}
              >
                {fmt$(hovered.kind === 'income' ? s.income : s.expenses)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ExpenseVsIncomeWidget({ app, config }: WidgetProps) {
  const budgetName = (config?.budgetName as string | undefined) ?? '';
  const entries = useBudgetRecentMonthsEntries(app, budgetName);

  if (!budgetName) {
    return (
      <div className="cc2-brw-root">
        <div className="cc2-brw-empty">This Expense Vs Income chart has no ledger configured yet.</div>
      </div>
    );
  }

  return (
    <div className="cc2-brw-root">
      <div className="cc2-brw-toolbar">
        <span className="cc2-brw-title">Expense Vs Income</span>
      </div>
      <div className="cc2-brw-chart-col">
        <BarChart entries={entries} />
      </div>
    </div>
  );
}
