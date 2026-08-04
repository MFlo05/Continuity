import React, { useState, useEffect, useCallback, useRef } from 'react';
import { readPolicies, addPolicy, editPolicy, removePolicy } from '../../data-sources/class-policies';
import { watchClassesFolder } from '../../data-sources/class-info';
import type { WidgetProps } from '../registry';

// Double-click-to-edit, same convention as TodoRow — one row per policy,
// numbered by position (index+1) rather than any stored/persisted number,
// so deleting/reordering never needs renumbering logic.
function PolicyRow({ index, text, onEdit, onRemove }: {
  index: number; text: string; onEdit: (text: string) => void; onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);

  const commit = () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (!trimmed || trimmed === text) { setDraft(text); return; }
    onEdit(trimmed);
  };
  const cancel = () => { setDraft(text); setIsEditing(false); };

  return (
    <div className="cc2-cpw-row">
      <span className="cc2-cpw-num">{index + 1}</span>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="cc2-cpw-edit-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          onBlur={commit}
        />
      ) : (
        <span className="cc2-cpw-text" onDoubleClick={() => setIsEditing(true)}>{text}</span>
      )}
      {!isEditing && (
        <button type="button" className="cc2-flush-btn cc2-cpw-delete" title="Remove" onClick={onRemove}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// One of the class-page-only grid widgets — a flat, numbered list of
// teacher-specific rules/requests (attendance policy, late-work policy,
// participation expectations, etc.), stored in that class's own
// Policies.md (see class-policies.ts). Deliberately no date tracking (not
// asked for). No per-widget AI import button — syllabus extraction will be
// handled by one global "Import Syllabus" flow (see the class page's own
// topbar button) rather than a separate stub on every widget that could
// plausibly benefit from it; the file format is already shaped so that
// flow can append to it later without a rewrite.
export function ClassPoliciesWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [entries,  setEntries]  = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [draft,    setDraft]    = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setEntries(await readPolicies(app, slug));
  }, [app, slug]);

  useEffect(() => { if (!slug) return; load(); return watchClassesFolder(app, load); }, [slug, app, load]);
  useEffect(() => { if (isAdding) addInputRef.current?.focus(); }, [isAdding]);

  const commitAdd = useCallback(async () => {
    const trimmed = draft.trim();
    setIsAdding(false);
    setDraft('');
    if (!trimmed || !slug) return;
    await addPolicy(app, slug, trimmed);
    load();
  }, [app, slug, draft, load]);

  const cancelAdd = () => { setDraft(''); setIsAdding(false); };

  const handleEdit = useCallback((index: number, text: string) => {
    if (!slug) return;
    editPolicy(app, slug, index, text).then(load);
  }, [app, slug, load]);

  const handleRemove = useCallback((index: number) => {
    if (!slug) return;
    removePolicy(app, slug, index).then(load);
  }, [app, slug, load]);

  if (!slug) return null;

  return (
    <div className="cc2-cpw-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-cpw-header">
        <span className="cc2-cpw-title">Class Policies</span>
        <button type="button" className="cc2-flush-btn cc2-cfs-add-btn" title="Add policy" onClick={() => setIsAdding(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="cc2-cpw-list">
        {entries.length === 0 && !isAdding && (
          <div className="cc2-cpw-empty">No policies yet — hit + to note a teacher rule or request.</div>
        )}
        {entries.map((text, i) => (
          <PolicyRow key={i} index={i} text={text} onEdit={t => handleEdit(i, t)} onRemove={() => handleRemove(i)} />
        ))}
        {isAdding && (
          <div className="cc2-cpw-row cc2-cpw-row-adding">
            <span className="cc2-cpw-num">{entries.length + 1}</span>
            <input
              ref={addInputRef}
              type="text"
              className="cc2-cpw-edit-input"
              placeholder="e.g. No late work accepted without prior approval"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); commitAdd(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelAdd(); }
              }}
              onBlur={() => { if (draft.trim()) commitAdd(); else cancelAdd(); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
