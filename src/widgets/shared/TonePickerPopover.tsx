import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TonePicker } from './TonePicker';

// Small floating color picker, portaled to <body> since callers so far
// (Kanban's per-bucket swatch, Meal Planner's per-slot swatch) both live
// inside containers that clip with overflow:hidden — an anchored
// (non-portaled) popover would get cut off. Positioned from the trigger
// button's own bounding rect rather than CSS anchoring, closes on outside
// click/Escape. Extracted from Kanban's original private BucketColorPopover
// the moment Meal Planner's per-slot picker needed the identical shell.
export function TonePickerPopover({ anchorRef, tone, wash, onToneChange, onWashChange, onClose, showWash = true }: {
  anchorRef: React.RefObject<HTMLElement>;
  tone: string;
  wash: boolean;
  onToneChange: (tone: string) => void;
  onWashChange: (wash: boolean) => void;
  onClose: () => void;
  showWash?: boolean;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect  = el.getBoundingClientRect();
    const width = 240;
    setPos({
      top:  rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 12)),
    });
  }, [anchorRef]);

  // The panel's real height isn't known until it's actually mounted (it
  // varies with showWash), so the first pass above is only a provisional
  // "open below the anchor" guess — if that guess runs off the bottom of the
  // viewport (e.g. the anchor sits on the last widget on a page, with no room
  // to scroll further), flip to opening above the anchor instead, or clamp
  // into view if there's nowhere with enough room either way. Runs in a
  // layout effect (not a regular effect) so the correction lands before the
  // browser paints — no visible jump from the wrong position to the right one.
  useLayoutEffect(() => {
    if (!pos) return;
    const el = anchorRef.current;
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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div ref={popRef} className="cc2-tone-popover" style={{ top: pos.top, left: pos.left }}>
      <TonePicker tone={tone} wash={wash} onToneChange={onToneChange} onWashChange={onWashChange} showWash={showWash} />
    </div>,
    document.body,
  );
}
