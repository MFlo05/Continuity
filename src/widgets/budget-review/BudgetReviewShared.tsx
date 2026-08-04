import React, { useState } from 'react';
import type { MonthSummary } from '../../data-sources/budget';
import { categoryColor } from '../../data-sources/budget';

export function fmt$(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

export function StatCard({
  label, value, accent, sub,
}: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="glass cc2-brw-stat">
      <div className="cc2-brw-stat-row">
        <div className="cc2-brw-stat-bar" style={{ background: accent }} />
        <div className="cc2-brw-stat-body">
          <span className="label">{label}</span>
          <div className="cc2-brw-stat-value">{value}</div>
        </div>
      </div>
      {sub && <div className="cc2-brw-stat-sub">{sub}</div>}
    </div>
  );
}

// ─── Donut chart — spending by category ────────────────────────────────────
// Ported from V1 Command-Center's tab-budget.tsx DonutChart, with hardcoded
// rgba(255,255,255,…) text/stroke colors replaced by the --cc2-* theme
// tokens so it reads correctly in both light and dark mode (V1 only ever
// rendered in a single dark theme).

const CX = 90, CY = 90, R_OUT = 72, R_IN = 46, GAP_DEG = 1.4;

function toRad(deg: number) { return ((deg - 90) * Math.PI) / 180; }

function slicePath(startDeg: number, endDeg: number): string {
  const s = startDeg + GAP_DEG / 2;
  const e = endDeg   - GAP_DEG / 2;
  if (e <= s) return '';

  const ox1 = CX + R_OUT * Math.cos(toRad(s));
  const oy1 = CY + R_OUT * Math.sin(toRad(s));
  const ox2 = CX + R_OUT * Math.cos(toRad(e));
  const oy2 = CY + R_OUT * Math.sin(toRad(e));
  const ix1 = CX + R_IN  * Math.cos(toRad(e));
  const iy1 = CY + R_IN  * Math.sin(toRad(e));
  const ix2 = CX + R_IN  * Math.cos(toRad(s));
  const iy2 = CY + R_IN  * Math.sin(toRad(s));
  const la  = e - s > 180 ? 1 : 0;

  return [
    `M ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `A ${R_OUT} ${R_OUT} 0 ${la} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)}`,
    `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    `A ${R_IN}  ${R_IN}  0 ${la} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function DonutChart({ summary }: { summary: MonthSummary }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const categories = Object.entries(summary.byCategory)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const total = categories.reduce((s, [, v]) => s + v, 0);

  if (total === 0) {
    return <div className="cc2-brw-donut-empty">No expenses for this period</div>;
  }

  let cursor = 0;
  const slices = categories.map(([cat, amt]) => {
    const sweep = (amt / total) * 360;
    const start = cursor;
    cursor += sweep;
    return { cat, amt, start, end: cursor };
  });

  const hoveredAmt = hovered ? (summary.byCategory[hovered] ?? 0) : null;

  return (
    <div className="cc2-brw-donut">
      <div className="cc2-brw-donut-svg-wrap">
        <svg width={148} height={148} viewBox="0 0 180 180">
          {slices.map(({ cat, start, end }) => (
            <path
              key={cat}
              d={slicePath(start, end)}
              fill={categoryColor(cat)}
              opacity={hovered && hovered !== cat ? 0.28 : 1}
              style={{ cursor: 'pointer', transition: 'opacity 150ms ease' }}
              onMouseEnter={() => setHovered(cat)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
          <text x={CX} y={CY - 10} textAnchor="middle" style={{ fill: 'var(--cc2-faint)' }}
            fontSize={9} letterSpacing="0.08em">
            {hovered ? hovered.toUpperCase() : 'SPENDING'}
          </text>
          <text x={CX} y={CY + 8} textAnchor="middle" style={{ fill: 'var(--cc2-text)' }}
            fontSize={15} fontWeight={700} letterSpacing="-0.02em">
            {hovered && hoveredAmt ? fmt$(hoveredAmt) : fmt$(total)}
          </text>
          <text x={CX} y={CY + 22} textAnchor="middle" style={{ fill: 'var(--cc2-faint)' }} fontSize={9}>
            {hovered ? fmtPct(((hoveredAmt ?? 0) / total) * 100) : 'total'}
          </text>
        </svg>
      </div>

      <div className="cc2-brw-donut-legend">
        {slices.map(({ cat, amt }) => (
          <div
            key={cat}
            className="cc2-brw-donut-legend-row"
            onMouseEnter={() => setHovered(cat)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="cc2-brw-donut-dot" style={{ background: categoryColor(cat), opacity: hovered && hovered !== cat ? 0.25 : 1 }} />
            <span className="cc2-brw-donut-legend-name" style={{ color: hovered === cat ? 'var(--cc2-text)' : 'var(--cc2-muted)' }}>
              {cat}
            </span>
            <span className="cc2-brw-donut-legend-pct">{fmtPct((amt / total) * 100)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
