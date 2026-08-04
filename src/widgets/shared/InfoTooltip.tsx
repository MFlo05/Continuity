import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

// Hover-triggered "i" icon + tooltip — originally local to AIPanel.tsx (its
// model-picker rows), moved to shared/ so other settings-heavy surfaces
// (e.g. the Grade Breakdown widget's per-assignment vs per-category mode
// picker) can reuse it. Portaled to <body> and positioned from the trigger
// button's own getBoundingClientRect() — same technique as
// TonePickerPopover.tsx — rather than CSS position:absolute anchored inside
// the wrap: every caller so far (WidgetSettingsModal's .cc2-modal in
// particular) lives inside an overflow:hidden ancestor, which silently
// clipped whichever side of the CSS-anchored version spilled past its edge.
export function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!show) { setPos(null); return; }
    const el = btnRef.current;
    if (!el) return;
    const rect  = el.getBoundingClientRect();
    const width = 230;
    setPos({
      top:  rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 12)),
    });
  }, [show]);

  // First pass above is a "drop below, right-aligned" guess made before the
  // tooltip's real height is known — flip above the button if that guess
  // would run off the bottom of the viewport. Layout effect so the
  // correction lands before paint, same as TonePickerPopover's own.
  useLayoutEffect(() => {
    if (!pos) return;
    const el  = btnRef.current;
    const pop = popRef.current;
    if (!el || !pop) return;
    const rect   = el.getBoundingClientRect();
    const height = pop.getBoundingClientRect().height;
    if (pos.top + height > window.innerHeight - 8) {
      const above = rect.top - height - 6;
      const next  = above >= 8 ? above : Math.max(8, window.innerHeight - height - 8);
      if (Math.abs(next - pos.top) > 0.5) setPos(p => (p ? { ...p, top: next } : p));
    }
  }, [pos]);

  return (
    <div className="cc2-ai-info-wrap">
      <button
        ref={btnRef}
        className="cc2-ai-info-btn"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        aria-label="More info"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {show && pos && createPortal(
        <div ref={popRef} className="cc2-ai-info-tooltip" style={{ top: pos.top, left: pos.left }}>
          {text}
        </div>,
        document.body,
      )}
    </div>
  );
}
