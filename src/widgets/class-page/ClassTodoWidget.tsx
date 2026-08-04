import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVaultData, TODO_TEMPLATE, CodecError } from '../../core';
import type { ChecklistRow } from '../../core';
import type { WidgetProps } from '../registry';
import { TodoRow, classChecklistSource } from '../todo-list/TodoListWidget';

// The single bucket this class's own Tasks.md is read/written through — same
// convention TodoListWidget's own class-linked mode already uses for every
// class's file, so the two stay interchangeable/compatible on disk.
const CLASS_BUCKET = 'Active';

// One of the class-page-only grid widgets (registry.ts's classPageOnly
// flag) — a deliberately stripped-down sibling of TodoListWidget: no setup
// page (always reads/writes THIS class's own Tasks.md via config.classSlug,
// same file TodoListWidget's class-linked mode points at), no tabs (one
// flat list, not a multi-bucket board — CLASS_BUCKET is the only bucket
// ever read/written here). Reuses TodoRow (checkbox/edit/delete) and every
// .cc2-tl-*/.cc2-kb-* class verbatim rather than re-deriving them.
//
// Its source is derived from the injected classSlug rather than stored
// config — the class page injects that at render time and never persists it
// (see ClassPageContent), which is exactly why the migration shim skips
// class-page widgets.
export function ClassTodoWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const source = useMemo(
    () => (slug ? classChecklistSource(app, slug) : null),
    [app, slug],
  );

  const { rows, mutate } = useVaultData<ChecklistRow>(app, source, { template: TODO_TEMPLATE });

  const [isAdding, setIsAdding] = useState(false);
  const [draft,    setDraft]    = useState('');
  const [addTaskError, setAddTaskError] = useState<string | undefined>();
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isAdding) addInputRef.current?.focus(); }, [isAdding]);

  const items = rows.filter(r => r.bucket === CLASS_BUCKET);

  const commitAdd = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || !source) { setIsAdding(false); setDraft(''); return; }
    try {
      await mutate.add({ text: trimmed, bucket: CLASS_BUCKET });
    } catch (e) {
      setAddTaskError(e instanceof CodecError ? e.message : String(e));
      return;
    }
    setAddTaskError(undefined);
    setDraft('');
    setIsAdding(false);
  }, [mutate, source, draft]);

  const cancelAdd = useCallback(() => {
    setDraft(''); setIsAdding(false); setAddTaskError(undefined);
  }, []);

  if (!slug) return null;

  return (
    <div className="cc2-tl-root" data-tone={tone} data-wash={wash || undefined}>
      {/* Own header class, not .cc2-tl-toolbar verbatim — that class has no
          border-bottom and different padding than every other class-page
          widget's header (.cc2-cnw-header etc.), which read as an
          inconsistent missing divider next to them. .cc2-tl-toolbar itself
          stays untouched since the general TODO List widget keeps its own
          look. */}
      <div className="cc2-ctw-header">
        <span className="cc2-ctw-title">Class Tasks</span>
      </div>

      <div className="cc2-tl-list">
        {items.length === 0 && !isAdding && <div className="cc2-tl-empty">No tasks yet.</div>}

        {items.map(row => (
          <TodoRow
            key={row.id}
            row={row}
            otherBuckets={[]}
            mutate={mutate}
            onMove={() => { /* single-bucket list — no move target */ }}
          />
        ))}

        {!isAdding && (
          <button type="button" className="cc2-flush-btn cc2-tl-add-task-btn" onClick={() => setIsAdding(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add task
          </button>
        )}

        {isAdding && (
          <div className="cc2-kb-add-row">
            <div className="cc2-kb-add-placeholder" />
            <input
              ref={addInputRef}
              type="text"
              className="cc2-kb-add-input"
              placeholder="Task name… add #tag at the end"
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
        {addTaskError && <div className="cc2-kb-bucket-error">{addTaskError}</div>}
      </div>
    </div>
  );
}
