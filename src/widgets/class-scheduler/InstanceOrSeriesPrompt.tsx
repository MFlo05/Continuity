import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title:         string;   // e.g. "Delete this class?" / "Apply this time change to…"
  subtitle:      string;   // e.g. "CHEM 101 · Monday · 9:00–10:15 AM"
  instanceLabel: string;   // e.g. "Just this one — Mon, Mar 9"
  seriesLabel:   string;   // e.g. "Every Monday at 9:00 AM"
  onInstance: () => void;
  onSeries:   () => void;
  onCancel:   () => void;
}

// Shared by every structural edit (resize, same-day move, delete) on a
// recurring block — always asked, never guessed at, per the explicit
// decision to keep this binary rather than Google Calendar's three-way
// "this / this and following / all" (which would need a validFrom/validUntil
// range on SeriesBlock — not built, since it wasn't asked for).
//
// Touch-first by construction: two full-width, generously tall buttons
// triggered by a plain onClick — never onContextMenu, never a hover
// tooltip, so it works identically on a trackpad or a fingertip.
export function InstanceOrSeriesPrompt({ title, subtitle, instanceLabel, seriesLabel, onInstance, onSeries, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-cs-prompt" onMouseDown={e => e.stopPropagation()}>
        <div className="cc2-modal-header">
          <span className="cc2-modal-title">{title}</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-cs-prompt-body">
          <div className="cc2-cs-prompt-subtitle">{subtitle}</div>
          <button type="button" className="cc2-cs-prompt-btn" onClick={onInstance}>{instanceLabel}</button>
          <button type="button" className="cc2-cs-prompt-btn" onClick={onSeries}>{seriesLabel}</button>
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
