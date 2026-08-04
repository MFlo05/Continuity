import React from 'react';
import type { WidgetProps } from './registry';
import { CATEGORY_COLORS } from './registry';

export function PlaceholderWidget({ config }: WidgetProps) {
  const label    = config?._label    as string | undefined;
  const category = config?._category as string | undefined;
  const color    = category ? CATEGORY_COLORS[category] : '#555';

  return (
    <div className="cc2-placeholder">
      <div className="cc2-placeholder-dot" style={{ background: color }} />
      {label && <span className="cc2-placeholder-label">{label}</span>}
      {category && <span className="cc2-placeholder-cat">{category}</span>}
    </div>
  );
}
