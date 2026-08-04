import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  existingTabNames: string[];
  error?: string;
  onCancel:  () => void;
  onConfirm: (name: string, includeInTaskManager: boolean) => void;
}

// Forked from Kanban's AddBucketModal.tsx rather than sharing it with a
// copy-override prop — same underlying addBucket() call and validation, only
// the wording changes ("tab," not "bucket"), which doesn't generalize
// cleanly as a simple prop across two widgets with different vocabularies.
// Reuses WidgetSetupModal's exact shell classes (.cc2-modal-backdrop /
// .cc2-modal.cc2-setup-modal / header / footer) for visual consistency and
// to inherit its existing portal token-bridge for free.
export function AddTabModal({ existingTabNames, error, onCancel, onConfirm }: Props) {
  const [name, setName] = useState('');
  const [includeInTaskManager, setIncludeInTaskManager] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const trimmed      = name.trim();
  const duplicate    = existingTabNames.some(n => n.toLowerCase() === trimmed.toLowerCase());
  const invalidChars = /[#[\]\n]/.test(trimmed);
  const canConfirm   = trimmed.length > 0 && !duplicate && !invalidChars;

  const confirm = () => { if (canConfirm) onConfirm(trimmed, includeInTaskManager); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Enter' && canConfirm) confirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfirm, trimmed, includeInTaskManager]);

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">New Tab</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            Name a new tab. It's added as a <strong>## header</strong> in this list.
          </p>

          <input
            ref={nameRef}
            type="text"
            className="cc2-setup-input cc2-kb-bucket-name-input"
            placeholder="e.g. Personal, Groceries…"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          {duplicate && <div className="cc2-kb-bucket-error">A tab with that name already exists.</div>}
          {!duplicate && invalidChars && <div className="cc2-kb-bucket-error">Can't contain #, [, ], or a line break.</div>}
          {!duplicate && !invalidChars && error && <div className="cc2-kb-bucket-error">{error}</div>}

          <label className="cc2-kb-tm-toggle-row">
            <input
              type="checkbox"
              checked={includeInTaskManager}
              onChange={e => setIncludeInTaskManager(e.target.checked)}
            />
            <span>Include in Task Manager</span>
          </label>
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={confirm} disabled={!canConfirm}>
            Add Tab
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
