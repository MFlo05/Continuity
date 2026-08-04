import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { App } from 'obsidian';
import {
  useVaultData, checklistCodec, resolveWidgetSource, TODO_TEMPLATE, CodecError,
} from '../../core';
import type { BoundMutations, ChecklistBucket, ChecklistMeta, ChecklistRow, SourceRef } from '../../core';
import type { WidgetProps } from '../registry';
import { AddBucketModal } from './AddBucketModal';
import { TonePickerPopover } from '../shared/TonePickerPopover';

// Per-bucket color override, stored in config.bucketColors (keyed by bucket
// name) — independent of the widget-level tone/wash above, which only
// touches the TM badge/TODO counter. Not cascaded from the widget-level
// tone: an unset bucket is plain Paper regardless of the board's own color,
// same "default is invisible until touched" rule the rest of this feature
// follows, just scoped one level deeper.
interface BucketColor { tone?: string; wash?: boolean }

// Distinct from the existing 'cc2/task-text' MIME key used by Back Burner /
// Task Manager — that pattern only carries raw task text because it always
// has a single deterministic destination. Kanban's drop destination is
// determined by which column you drop on, so the payload also needs to know
// which row is moving. Carries the row's id plus its raw line: the id
// addresses the exact line (two identically-worded cards no longer collide)
// and the raw line is the codec's staleness check.
const DND_MIME = 'cc2/kanban-task';

interface DragPayload { id: string; raw?: string; sourceBucket: string; }

function KanbanCard({ row, mutate }: {
  row: ChecklistRow; mutate: BoundMutations<ChecklistRow>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(row.text);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) { editRef.current?.focus(); editRef.current?.select(); }
  }, [isEditing]);

  const handleToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await mutate.update(row.id, { done: !row.done, raw: row.raw });
  }, [mutate, row.id, row.done, row.raw]);

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await mutate.remove(row.id);
  }, [mutate, row.id]);

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
    <div
      className={'cc2-kb-card' + (row.done ? ' done' : '')}
      draggable={!isEditing}
      onDragStart={e => {
        const payload: DragPayload = { id: row.id, raw: row.raw, sourceBucket: row.bucket };
        e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
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
          onClick={e => e.stopPropagation()}
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

function KanbanColumn({ bucket, rows, app, source, mutate, onChanged, color, onColorChange }: {
  bucket: ChecklistBucket;
  rows: ChecklistRow[];
  app: App;
  source: SourceRef;
  mutate: BoundMutations<ChecklistRow>;
  onChanged: () => void;
  color?: BucketColor;
  onColorChange: (color: BucketColor) => void;
}) {
  const [dragOver,  setDragOver]  = useState(false);
  const [isAdding,  setIsAdding]  = useState(false);
  const [draft,     setDraft]     = useState('');
  const [addError,  setAddError]  = useState<string | undefined>();
  const [colorOpen, setColorOpen] = useState(false);
  const addInputRef  = useRef<HTMLInputElement>(null);
  const colorBtnRef  = useRef<HTMLButtonElement>(null);
  const bucketTone = color?.tone;
  const bucketWash = !!color?.wash;

  useEffect(() => {
    if (isAdding) addInputRef.current?.focus();
  }, [isAdding]);

  const commitAdd = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) { setIsAdding(false); setDraft(''); return; }
    try {
      await mutate.add({ text: trimmed, bucket: bucket.name });
    } catch (e) {
      setAddError(e instanceof CodecError ? e.message : String(e));
      return;
    }
    setAddError(undefined);
    setDraft('');
    setIsAdding(false);
  }, [mutate, bucket.name, draft]);

  const cancelAdd = useCallback(() => {
    setDraft('');
    setIsAdding(false);
    setAddError(undefined);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    const payload: DragPayload = JSON.parse(raw);
    if (payload.sourceBucket === bucket.name) return;
    await checklistCodec.moveRow(app, source, payload.id, bucket.name, payload.raw);
    onChanged();
  }, [app, source, bucket.name, onChanged]);

  const handleDeleteBucket = useCallback(async () => {
    const confirmed = window.confirm(
      bucket.count > 0
        ? `Delete "${bucket.name}"? This removes all ${bucket.count} task(s) in it.`
        : `Delete "${bucket.name}"?`,
    );
    if (!confirmed) return;
    await checklistCodec.deleteBucket(app, source, bucket.name);
    onChanged();
  }, [app, source, bucket.name, bucket.count, onChanged]);

  const done    = bucket.doneCount;
  const total   = bucket.count;
  const visible = rows.filter(r => !r.done);
  const active  = visible.length;

  // Historical completions shouldn't dilute the bar forever — once a bucket
  // has accumulated a lot of done tasks, a freshly added task would barely
  // move a lifetime done/total ratio. Cap how much "done" can count toward
  // the denominator so the bar stays responsive to current work; a fully
  // cleared bucket (active === 0) still reads 100% regardless of the cap.
  const CAPPED_DONE_MAX = 8;
  const cappedDone = Math.min(done, CAPPED_DONE_MAX);
  const pctDenom   = active + cappedDone;
  const pct        = pctDenom > 0 ? Math.round((cappedDone / pctDenom) * 100) : 0;

  return (
    <div
      className={'cc2-kb-column' + (dragOver ? ' cc2-kb-column--drag-over' : '')}
      data-tone={bucketTone} data-wash={bucketWash || undefined}
      onDragEnter={e => { if (e.dataTransfer.types.includes(DND_MIME)) setDragOver(true); }}
      onDragOver={e => { if (e.dataTransfer.types.includes(DND_MIME)) e.preventDefault(); }}
      onDragLeave={e => {
        const r = e.relatedTarget as Node | null;
        if (!r || !e.currentTarget.contains(r)) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="cc2-kb-column-hdr">
        <button
          type="button"
          ref={colorBtnRef}
          className="cc2-kb-column-color-btn"
          data-tone={bucketTone}
          title="Column color"
          onClick={() => setColorOpen(o => !o)}
        />
        <span className="cc2-kb-column-name">{bucket.name}</span>
        <button
          type="button"
          className="cc2-flush-btn cc2-kb-column-delete"
          aria-label={`Delete ${bucket.name} bucket`}
          onClick={handleDeleteBucket}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {active > 0 && <span className="cc2-kb-column-count">{active} TODO</span>}
        <button
          type="button"
          className="cc2-flush-btn cc2-kb-add-task"
          title="Add task"
          onClick={() => { if (!isAdding) setIsAdding(true); else addInputRef.current?.focus(); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {colorOpen && (
        <TonePickerPopover
          anchorRef={colorBtnRef}
          tone={bucketTone ?? 'paper'}
          wash={bucketWash}
          onToneChange={t => onColorChange({ tone: t === 'paper' ? undefined : t, wash: bucketWash })}
          onWashChange={w => onColorChange({ tone: bucketTone, wash: w })}
          onClose={() => setColorOpen(false)}
        />
      )}

      <div className="cc2-kb-column-body">
        {visible.length === 0 && !isAdding && <div className="cc2-kb-empty">No tasks</div>}
        {visible.map(row => (
          <KanbanCard key={row.id} row={row} mutate={mutate} />
        ))}

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
        {addError && <div className="cc2-kb-bucket-error">{addError}</div>}
      </div>

      {total > 0 && (
        <div className="cc2-kb-progress-track">
          <div
            className="cc2-kb-progress-fill"
            style={{ width: `${pct}%` }}
            data-complete={pct === 100 ? 'true' : undefined}
          />
        </div>
      )}
    </div>
  );
}

export function KanbanWidget({ config, app, onConfigChange }: WidgetProps) {
  const boardName = (config?.boardName as string | undefined) ?? '';

  const source = useMemo(() => resolveWidgetSource(app, 'kanban', config), [app, config]);
  const { rows, meta, mutate } = useVaultData<ChecklistRow, ChecklistMeta>(app, source, { template: TODO_TEMPLATE });

  const bucketColors = (config?.bucketColors as Record<string, BucketColor> | undefined) ?? {};
  const handleBucketColorChange = useCallback((bucketName: string, color: BucketColor) => {
    onConfigChange?.({ bucketColors: { ...bucketColors, [bucketName]: color } });
  }, [onConfigChange, bucketColors]);

  // Per-widget accent (right-click "Edit Widget Settings…"). Trim only —
  // like Task Manager, no wash background: the root pocket / column-chip
  // contrast (see DESIGN_SYSTEM.md's ".cc2-kb-column" note) is its own
  // deliberate depth treatment, not something a color wash should compete with.
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;
  const [showAddBucket,  setShowAddBucket]  = useState(false);
  const [addBucketError, setAddBucketError] = useState<string | undefined>();

  const buckets = meta?.buckets ?? [];

  const handleAddBucket = useCallback(async (name: string, includeInTaskManager: boolean) => {
    if (!source) return;
    try {
      await checklistCodec.addBucket(app, source, name, includeInTaskManager);
    } catch (e) {
      setAddBucketError(e instanceof CodecError ? e.message : String(e));
      return;
    }
    setAddBucketError(undefined);
    setShowAddBucket(false);
    await mutate.reload();
  }, [app, source, mutate]);

  if (!source) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--cc2-muted)', fontSize: 12 }}>
        No TODO list configured.
      </div>
    );
  }

  return (
    <div className="cc2-kb-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-kb-toolbar">
        <span className="cc2-kb-title">{boardName}</span>
        <button
          type="button"
          className="cc2-flush-btn cc2-kb-add-bucket"
          title="Add bucket"
          onClick={() => setShowAddBucket(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="cc2-kb-board">
        {buckets.map(bucket => (
          <KanbanColumn
            key={bucket.name}
            bucket={bucket}
            rows={rows.filter(r => r.bucket === bucket.name)}
            app={app}
            source={source}
            mutate={mutate}
            onChanged={() => { void mutate.reload(); }}
            color={bucketColors[bucket.name]}
            onColorChange={color => handleBucketColorChange(bucket.name, color)}
          />
        ))}
      </div>

      {showAddBucket && (
        <AddBucketModal
          existingBucketNames={buckets.map(b => b.name)}
          error={addBucketError}
          onCancel={() => { setShowAddBucket(false); setAddBucketError(undefined); }}
          onConfirm={handleAddBucket}
        />
      )}
    </div>
  );
}
