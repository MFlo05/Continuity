import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title:    string;
  startMin: number;
  endMin:   number;
  onCancel:  () => void;
  onConfirm: (startMin: number, endMin: number) => void;
}

function toTimeStr(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Precise time entry, for adjustments finer than the grid's 15-min
// drag-snap — native <input type="time"> for a real picker on iOS/iPadOS.
// For a series/series-modified block, confirming this still routes back
// through the same instance-vs-series prompt as a drag-resize would (see
// ClassSchedulerWidget's onEditTime) — this modal only replaces HOW the new
// time is entered, not what happens once it's confirmed.
export function EditTimeModal({ title, startMin, endMin, onCancel, onConfirm }: Props) {
  const [start, setStart] = useState(toTimeStr(startMin));
  const [end,   setEnd]   = useState(toTimeStr(endMin));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canConfirm = toMin(end) > toMin(start);

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-cs-prompt" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Edit Time — {title}</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <label className="cc2-mc-settings-label cc2-mc-settings-label-first">Start time</label>
          <input type="time" className="cc2-setup-input" value={start} onChange={e => setStart(e.target.value)} />
          <label className="cc2-mc-settings-label">End time</label>
          <input type="time" className="cc2-setup-input" value={end} onChange={e => setEnd(e.target.value)} />
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="cc2-setup-confirm"
            onClick={() => { if (canConfirm) onConfirm(toMin(start), toMin(end)); }}
            disabled={!canConfirm}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
