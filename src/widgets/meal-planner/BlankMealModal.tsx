import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  onClose:  () => void;
  onConfirm: (title: string) => void;
}

// Portaled, reusing .cc2-modal-backdrop/.cc2-modal/.cc2-setup-* verbatim
// (same shell as RecipeImportModal). Type-first, not drag-first-then-rename
// — placed meal blocks have no rename interaction today, so capturing the
// name here means MealPlannerWidget can hand the typed title straight into
// the existing click-to-place flow (startPlacing) with zero new placement
// or editing code. A title with no matching recipe file already renders
// correctly via the existing "missing recipe" (dashed, faint) styling —
// exactly right for an ad-hoc item like "Granola Bar".
export function BlankMealModal({ onClose, onConfirm }: Props) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-rv-import-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Add a Blank Meal</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            Not tied to a recipe note — just a name to drop onto the plan (e.g. "Granola bars", "Leftovers").
          </p>
          <input
            ref={inputRef}
            type="text"
            className="cc2-setup-input"
            placeholder="Meal name…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={submit} disabled={!title.trim()}>
            Place on plan →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
