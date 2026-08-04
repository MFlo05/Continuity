import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { App } from 'obsidian';
import {
  useVaultData, useVaultDataMulti, checklistCodec, resolveWidgetSource,
  TODO_TEMPLATE, CodecError,
} from '../../core';
import type { BoundMutations, ChecklistMeta, ChecklistRow, SourceRef } from '../../core';
import { listClasses, watchClassesFolder, classTasksPath } from '../../data-sources/class-info';
import type { ClassInfoFields } from '../../data-sources/class-info';
import type { WidgetProps } from '../registry';
import { AddTabModal } from './AddTabModal';

// The single bucket every class-linked class's own Tasks.md is read/written
// through — class-linked mode's "tabs" are classes, not buckets, so each
// class's file only ever needs one flat list, not a multi-bucket board.
// Reuses the 'Active' convention (the checklist codec's default template
// seed, also Task Manager's default active-bucket name) rather than
// inventing a new one.
const CLASS_BUCKET = 'Active';

/** The checklist file a class's tasks live in, as a source descriptor. */
export function classChecklistSource(app: App, slug: string): SourceRef {
  return { codec: 'checklist', path: classTasksPath(app, slug) };
}

// General-purpose tabbed TODO list — same underlying file/setup as Kanban
// (requiresFileSetup: TODO_LIST_SETUP in registry.ts, an exact sibling of
// KANBAN_SETUP) and the same checklist source, just presented one bucket at
// a time as tabs instead of side-by-side columns, with a tap "Move to ▸"
// menu instead of Kanban's HTML5 drag (which doesn't work on iOS). Started
// life as the Education suite's Class Tasks widget; genericized per request
// so it reads/writes any TODO file, not just a fixed Class-Tasks.md, and
// buckets are fully user-managed (add/delete) rather than a fixed three —
// plus an optional "class-linked" mode (config.classLinked) that switches
// tabs to be derived 1:1 from the user's active classes instead.
//
// Exported for ClassTodoWidget's reuse (a simpler, tab-free, single-bucket
// sibling of this widget) — same checkbox/edit/delete/move-menu row, no need
// to duplicate it. Takes bound mutations rather than a file path: every
// write goes through the codec, never straight at the vault (handoff §5).
export function TodoRow({ row, otherBuckets, mutate, onMove }: {
  row: ChecklistRow;
  otherBuckets: string[];
  mutate: BoundMutations<ChecklistRow>;
  onMove: (dest: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(row.text);
  const [moveOpen,  setMoveOpen]  = useState(false);
  const moveWrapRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) { editRef.current?.focus(); editRef.current?.select(); }
  }, [isEditing]);

  useEffect(() => {
    if (!moveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moveWrapRef.current?.contains(e.target as Node)) setMoveOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moveOpen]);

  // `raw` rides along on every patch as the row's identity check — the codec
  // no-ops rather than writing if the line moved underneath us.
  const handleToggle = useCallback(async () => {
    await mutate.update(row.id, { done: !row.done, raw: row.raw });
  }, [mutate, row.id, row.done, row.raw]);

  const handleDelete = useCallback(async () => {
    await mutate.remove(row.id);
  }, [mutate, row.id]);

  const handleMove = useCallback((dest: string) => {
    setMoveOpen(false);
    onMove(dest);
  }, [onMove]);

  const commitEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    setIsEditing(false);
    if (!trimmed || trimmed === row.text) return;
    await mutate.update(row.id, { text: trimmed, raw: row.raw });
  }, [mutate, row.id, row.text, row.raw, editValue]);

  const cancelEdit = useCallback(() => {
    setEditValue(row.text);
    setIsEditing(false);
  }, [row.text]);

  return (
    <div className={'cc2-kb-card cc2-tl-row' + (row.done ? ' done' : '')}>
      <button
        type="button"
        className="cc2-kb-check"
        onClick={handleToggle}
        aria-label={row.done ? 'Mark not done' : 'Mark done'}
      >
        {row.done && (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 4.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {isEditing ? (
        <input
          ref={editRef}
          type="text"
          className="cc2-kb-card-edit-input"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          onBlur={commitEdit}
        />
      ) : (
        <span className="cc2-kb-card-text" onDoubleClick={() => setIsEditing(true)}>{row.displayText}</span>
      )}

      {!isEditing && row.project && <span className="cc2-kb-card-project">#{row.project}</span>}

      {!isEditing && otherBuckets.length > 0 && (
        <div className="cc2-tl-move-wrap" ref={moveWrapRef}>
          <button
            type="button"
            className="cc2-flush-btn cc2-tl-move-btn"
            title="Move to another tab"
            aria-label="Move to another tab"
            onClick={() => setMoveOpen(o => !o)}
          >
            Move
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {moveOpen && (
            <div className="cc2-tl-move-menu">
              {otherBuckets.map(name => (
                <button key={name} type="button" className="cc2-mc-menu-item" onClick={() => handleMove(name)}>
                  Move to {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!isEditing && (
        <button
          type="button"
          className="cc2-kb-card-delete"
          onClick={handleDelete}
          title="Delete task"
          aria-label="Delete task"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// The tab itself is ONE real .cc2-tab button (the same class the app's real
// Page-select tabs use, reused verbatim rather than a hand-copied duplicate
// of its active-state values) — .cc2-tl-tab-btn only layers on the
// layout-only differences this stretched-pill context needs (flex:1,
// centered content) that the topbar's shrink-to-content tabs don't. Delete
// is a small absolute-positioned corner overlay OUTSIDE that button's own
// flex flow, so it can never push the centered label off-center the way the
// old two-separate-buttons layout did. Takes plain label/count/tone rather
// than a raw bucket so it renders identically for a free-form bucket tab or
// a class-linked-mode class tab (which has no bucket object of its own).
function TodoTab({ label, count, tone, active, showDelete, onSelect, onDelete }: {
  label: string; count: number; tone?: string; active: boolean; showDelete: boolean;
  onSelect: () => void; onDelete: () => void;
}) {
  return (
    <div className="cc2-tl-tab-wrap">
      <button
        type="button"
        className={'cc2-tab cc2-tl-tab-btn' + (active ? ' active' : '')}
        onClick={onSelect}
      >
        {tone && <span className="cc2-tl-tab-dot" data-tone={tone} />}
        {label}
        {count > 0 && <span className="cc2-tl-tab-count">{count}</span>}
      </button>
      {showDelete && (
        <button
          type="button"
          className="cc2-flush-btn cc2-tl-tab-delete"
          title={`Delete "${label}"`}
          aria-label={`Delete ${label} tab`}
          onClick={onDelete}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function TodoListWidget({ config, app }: WidgetProps) {
  const classLinked = !!config?.classLinked;
  const listName = (config?.listName as string | undefined) ?? '';

  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  // ── Class-linked mode: tabs are the user's active classes, each with its
  // own Tasks.md. The class list itself is metadata, not checklist data, so
  // it keeps its own small loader until the record-folder codec lands. ──
  const [classes, setClasses] = useState<ClassInfoFields[]>([]);
  useEffect(() => {
    if (!classLinked) return;
    const load = () => { void listClasses(app).then(setClasses); };
    load();
    return watchClassesFolder(app, load);
  }, [classLinked, app]);

  // Exactly one of these two is ever live: the unused one gets a null/empty
  // source and does nothing. Both hooks still have to be *called* every
  // render (rules of hooks), which is why the mode branch is in the argument
  // rather than around the call.
  const freeSource = useMemo(
    () => (classLinked ? null : resolveWidgetSource(app, 'todo-list', config)),
    [classLinked, app, config],
  );
  const classSources = useMemo(
    () => (classLinked ? classes.map(c => classChecklistSource(app, c.slug)) : []),
    [classLinked, classes, app],
  );

  const free  = useVaultData<ChecklistRow, ChecklistMeta>(app, freeSource, { template: TODO_TEMPLATE });
  const multi = useVaultDataMulti<ChecklistRow, ChecklistMeta>(app, classSources, { template: TODO_TEMPLATE });

  const [activeTab, setActiveTab] = useState<string>('');
  const [isAdding,  setIsAdding]  = useState(false);
  const [draft,     setDraft]     = useState('');
  const [addTaskError, setAddTaskError] = useState<string | undefined>();
  const [showAddTab, setShowAddTab] = useState(false);
  const [addTabError, setAddTabError] = useState<string | undefined>();
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isAdding) addInputRef.current?.focus(); }, [isAdding]);

  const buckets = free.meta?.buckets ?? [];

  interface TabInfo { key: string; label: string; count: number; tone?: string; }
  const tabs: TabInfo[] = useMemo(() => {
    if (classLinked) {
      return classes.map(c => ({
        key: c.slug, label: c.code, tone: c.color,
        count: multi.rowsFor(classChecklistSource(app, c.slug))
          .filter(r => r.bucket === CLASS_BUCKET && !r.done).length,
      }));
    }
    return buckets.map(b => ({ key: b.name, label: b.name, count: b.count - b.doneCount }));
  }, [classLinked, classes, multi, app, buckets]);

  // Keep the selected tab valid as buckets/classes come and go, without
  // resetting the user's choice on every reload.
  const tabsKey = tabs.map(t => t.key).join('|');
  useEffect(() => {
    setActiveTab(prev => (prev && tabs.some(t => t.key === prev)) ? prev : (tabs[0]?.key ?? ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey]);

  // What's actually being read/written for the active tab, resolved once here
  // so the rest of the render doesn't branch on mode itself.
  const activeSource = classLinked
    ? (activeTab ? classChecklistSource(app, activeTab) : null)
    : freeSource;
  const activeBucketName = classLinked ? CLASS_BUCKET : activeTab;
  const activeMutate = classLinked ? multi.mutateFor(activeSource) : free.mutate;
  const activeRows = (classLinked ? multi.rowsFor(activeSource) : free.rows)
    .filter(r => r.bucket === activeBucketName);

  // Class-linked mode has nothing to move a task TO (each class is its own
  // flat single-bucket list, and tabs = classes, not buckets) — an empty
  // array hides TodoRow's "Move" control via its own existing guard.
  const otherBuckets = classLinked ? [] : buckets.map(b => b.name).filter(n => n !== activeTab);

  const reload = classLinked ? multi.reload : free.mutate.reload;

  const handleMove = useCallback(async (row: ChecklistRow, dest: string) => {
    if (!activeSource) return;
    await checklistCodec.moveRow(app, activeSource, row.id, dest, row.raw);
    await reload();
  }, [app, activeSource, reload]);

  const commitAdd = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || !activeSource || !activeBucketName) { setIsAdding(false); setDraft(''); return; }
    try {
      await activeMutate.add({ text: trimmed, bucket: activeBucketName });
    } catch (e) {
      setAddTaskError(e instanceof CodecError ? e.message : String(e));
      return;
    }
    setAddTaskError(undefined);
    setDraft('');
    setIsAdding(false);
  }, [activeMutate, activeSource, activeBucketName, draft]);

  const cancelAdd = useCallback(() => {
    setDraft(''); setIsAdding(false); setAddTaskError(undefined);
  }, []);

  const handleAddTab = useCallback(async (name: string, includeInTaskManager: boolean) => {
    if (!freeSource) return;
    try {
      await checklistCodec.addBucket(app, freeSource, name, includeInTaskManager);
    } catch (e) {
      setAddTabError(e instanceof CodecError ? e.message : String(e));
      return;
    }
    setAddTabError(undefined);
    setShowAddTab(false);
    await free.mutate.reload();
  }, [app, freeSource, free.mutate]);

  const handleDeleteTab = useCallback(async (name: string, count: number) => {
    if (!freeSource) return;
    const confirmed = window.confirm(
      count > 0 ? `Delete "${name}"? This removes all ${count} task(s) in it.` : `Delete "${name}"?`,
    );
    if (!confirmed) return;
    await checklistCodec.deleteBucket(app, freeSource, name);
    await free.mutate.reload();
  }, [app, freeSource, free.mutate]);

  if (!classLinked && !freeSource) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--cc2-muted)', fontSize: 12 }}>
        No TODO list configured.
      </div>
    );
  }

  const hasActiveTab = tabs.some(t => t.key === activeTab);

  return (
    <div className="cc2-tl-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-tl-toolbar">
        <span className="cc2-tl-title">{listName || (classLinked ? 'Class Tasks' : 'TODO List')}</span>
        {!classLinked && (
          <button
            type="button"
            className="cc2-flush-btn cc2-tl-add-tab"
            title="Add tab"
            onClick={() => setShowAddTab(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      <div className="cc2-tl-tabs">
        {tabs.map(t => (
          <TodoTab
            key={t.key}
            label={t.label}
            count={t.count}
            tone={t.tone}
            active={t.key === activeTab}
            showDelete={!classLinked}
            onSelect={() => setActiveTab(t.key)}
            onDelete={() => {
              const bucket = buckets.find(b => b.name === t.key);
              if (bucket) handleDeleteTab(bucket.name, bucket.count);
            }}
          />
        ))}
      </div>

      <div className="cc2-tl-list">
        {hasActiveTab && activeRows.length === 0 && !isAdding && (
          <div className="cc2-tl-empty">No tasks here.</div>
        )}
        {activeRows.map(row => (
          <TodoRow
            key={row.id}
            row={row}
            otherBuckets={otherBuckets}
            mutate={activeMutate}
            onMove={dest => handleMove(row, dest)}
          />
        ))}

        {!hasActiveTab && tabs.length === 0 && (
          <div className="cc2-tl-empty">
            {classLinked ? 'No active classes yet — add one from My Classes.' : 'No tabs yet — hit + to add one.'}
          </div>
        )}

        {hasActiveTab && !isAdding && (
          <button
            type="button"
            className="cc2-flush-btn cc2-tl-add-task-btn"
            onClick={() => setIsAdding(true)}
          >
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

      {showAddTab && (
        <AddTabModal
          existingTabNames={buckets.map(b => b.name)}
          error={addTabError}
          onCancel={() => { setShowAddTab(false); setAddTabError(undefined); }}
          onConfirm={handleAddTab}
        />
      )}
    </div>
  );
}
