import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ClassInfoFields } from '../../data-sources/class-info';

interface Props {
  classes: ClassInfoFields[];
  onClose:   () => void;
  onConfirm: (title: string, classId: string | undefined) => void;
}

// Mirrors BlankMealModal exactly (type a name, then click-to-place on the
// grid) — the one addition is an optional class picker so a one-off can
// still pick up that class's color, since unlike Meal Planner's blank
// meals, a one-off here often genuinely belongs to a class (a lab, a
// makeup session) even though it isn't part of that class's weekly series.
export function AddOneOffModal({ classes, onClose, onConfirm }: Props) {
  const [title,   setTitle]   = useState('');
  const [classId, setClassId] = useState('');
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
    onConfirm(trimmed, classId || undefined);
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-rv-import-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Add a One-Off Block</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            For a single occurrence outside the normal weekly schedule — a lab, a study session, a one-time reschedule.
          </p>
          <input
            ref={inputRef}
            type="text"
            className="cc2-setup-input"
            placeholder="e.g. Chem Lab Makeup"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
          <select className="cc2-setup-select" value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">No class (neutral color)</option>
            {classes.map(c => <option key={c.slug} value={c.slug}>{c.code}</option>)}
          </select>
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={submit} disabled={!title.trim()}>
            Place on schedule →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
