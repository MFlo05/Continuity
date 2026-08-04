import React from 'react';

interface Props {
  percent: number; // caller omits this component entirely when no grade is set
  size?: number;
}

// Gapped-ring gauge (see the UMS "Attendance" reference in the Education
// brief) — a plain SVG arc, not a canvas/library gauge, since this is just
// two concentric circles with a stroke-dasharray "gap". Math: a bare circle's
// dash pattern starts at 0° = 3 o'clock and grows clockwise. To center a
// GAP_DEG-wide gap at the bottom (90° in that same clockwise-from-3-o'clock
// frame), the whole pattern needs rotating by (90 + GAP_DEG/2) degrees —
// derived once here rather than re-eyeballed if GAP_DEG ever changes.
const GAP_DEG = 90;
const ROTATE_DEG = 90 + GAP_DEG / 2;

export function GradeGauge({ percent, size = 80 }: Props) {
  const strokeWidth = Math.round(size * 0.11);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * ((360 - GAP_DEG) / 360);
  const clamped = Math.max(0, Math.min(100, percent));
  const progressLength = arcLength * (clamped / 100);
  const cx = size / 2, cy = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="cc2-mc-gauge" role="img"
      aria-label={`Grade ${Math.round(percent)}%`}>
      <circle
        cx={cx} cy={cy} r={r}
        className="cc2-mc-gauge-track"
        strokeWidth={strokeWidth}
        strokeDasharray={`${arcLength} ${circumference}`}
        transform={`rotate(${ROTATE_DEG} ${cx} ${cy})`}
      />
      <circle
        cx={cx} cy={cy} r={r}
        className="cc2-mc-gauge-fill"
        strokeWidth={strokeWidth}
        strokeDasharray={`${progressLength} ${circumference}`}
        transform={`rotate(${ROTATE_DEG} ${cx} ${cy})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="central" className="cc2-mc-gauge-text">
        {Math.round(percent)}%
      </text>
    </svg>
  );
}
