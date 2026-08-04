import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoundMutations, ChecklistMeta, ChecklistRow, RendererProps } from '../core';
import { parseIngredientLine, formatQty } from '../data-sources/ingredient-line';

/**
 * renderers/SimpleList.tsx — the flat checkbox-list renderer.
 *
 * Second generic renderer in the app, extracted from GroceryListWidget once it
 * became clear that widget was a *layout* rather than a feature. Two presets
 * draw through it today (Checklist, Grocery List) differing only in the
 * `rowDisplay` option, which is the whole argument for the split: the qty/unit
 * parsing was never list behaviour, it was one preset's row formatting.
 *
 * ENTRY PATTERN — the add-row never closes. Committing an item clears the
 * input and immediately refocuses it rather than collapsing. That's deliberate
 * and documented (DESIGN_SYSTEM.md): grocery/checklist entry is rapid and
 * one-after-another, and Kanban's click-to-reopen step breaks that flow. Do
 * not "fix" this into a toggled affordance.
 *
 * Speaks the `checklist` codec only. Flat by default; `bucket` scopes it to one
 * `## Header` for sources that have them.
 */

export type RowDisplay = 'plain' | 'ingredient';

export interface SimpleListOptions {
  /** Header micro-label. */
  title: string;
  /** Placeholder for the always-open add input. */
  addPlaceholder?: string;
  /**
   * 'plain'      — the line verbatim (a checklist item)
   * 'ingredient' — split into qty/unit/name for display (a grocery item).
   * Purely presentational: storage is a plain `- [ ] <raw text>` line either
   * way, and the split is derived on read, never written back.
   */
  rowDisplay?: RowDisplay;
  /**
   * Restrict to one `## Bucket`.
   *
   * OMITTED MEANS ALL BUCKETS, not the root one. Defaulting to root looked
   * right (a flat grocery file has only root items) but silently rendered
   * nothing for any bucketed file — point Checklist at a `## Active`-style
   * TODO note and every item would vanish. A "checklist note" means the
   * checkboxes in it, wherever they sit.
   */
  bucket?: string;
  /** "Clear checked (N)" footer. */
  showClearDone?: boolean;
  /** "N left" count in the header. */
  showCount?: boolean;
  emptyText?: string;
}

interface SimpleListProps extends Omit<RendererProps<ChecklistRow>, 'options'> {
  options: SimpleListOptions;
  /** The checklist codec's file-level state — needed to pick an add target. */
  meta?: ChecklistMeta | null;
  /** Supplied by PresetHost; the codec-level clear-done for this source. */
  onClearDone?: () => void;
}

function ListRow({ row, display, showBucket, mutate }: {
  row: ChecklistRow; display: RowDisplay; showBucket: boolean;
  mutate: BoundMutations<ChecklistRow>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(row.text);
  const editRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(
    () => (display === 'ingredient' ? parseIngredientLine(row.text) : null),
    [display, row.text],
  );

  useEffect(() => {
    if (isEditing) { editRef.current?.focus(); editRef.current?.select(); }
  }, [isEditing]);

  // `raw` rides along as the row's identity check — the codec no-ops rather
  // than writing if the line moved underneath us.
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
    <div className={'cc2-lst-row' + (row.done ? ' done' : '')}>
      <button
        type="button"
        className="cc2-lst-check"
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
          className="cc2-lst-edit-input"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          onBlur={commitEdit}
        />
      ) : (
        <span className="cc2-lst-row-text" onDoubleClick={() => setIsEditing(true)}>
          {parsed && (parsed.qty !== null || parsed.unit) && (
            <span className="cc2-lst-row-qty">
              {[parsed.qty !== null ? formatQty(parsed.qty) : null, parsed.unit].filter(Boolean).join(' ')}
            </span>
          )}
          <span className="cc2-lst-row-name">{parsed ? parsed.name : row.displayText || row.text}</span>
          {/* Read-only: which `## Header` this item sits under. Deliberately no
              add/rename/delete for buckets — that's what TODO List and Kanban
              are for, and adding it here would make this the same widget. */}
          {showBucket && row.bucket && <span className="cc2-lst-row-bucket">{row.bucket}</span>}
        </span>
      )}

      {!isEditing && (
        <button
          type="button"
          className="cc2-lst-row-delete"
          onClick={handleDelete}
          aria-label="Delete item"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function SimpleList({ rows, meta, mutate, options, tone, wash, onClearDone }: SimpleListProps) {
  const {
    title, addPlaceholder, rowDisplay = 'plain', bucket,
    showClearDone = true, showCount = true, emptyText,
  } = options;

  const [draft, setDraft] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () => (bucket === undefined ? rows : rows.filter(r => r.bucket === bucket)),
    [rows, bucket],
  );

  // Where a new item lands. A flat file has no buckets, so '' (root, appended
  // at the end) is right; a bucketed file gets the first bucket, since dropping
  // items above the first `## header` would be technically valid and visually
  // baffling.
  const addBucket = bucket ?? meta?.buckets[0]?.name ?? '';

  const commitAdd = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setDraft('');
    await mutate.add({ text: trimmed, bucket: addBucket });
    // Frictionless rapid entry is the point — stay focused for the next line.
    addInputRef.current?.focus();
  }, [mutate, draft, addBucket]);

  const checkedCount = items.filter(r => r.done).length;

  return (
    <div className="cc2-lst-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-lst-toolbar">
        <span className="cc2-lst-title">{title}</span>
        {showCount && items.length > 0 && (
          <span className="cc2-lst-count">{items.length - checkedCount} left</span>
        )}
      </div>

      <div className="cc2-lst-add-row">
        <div className="cc2-lst-add-placeholder" />
        <input
          ref={addInputRef}
          type="text"
          className="cc2-lst-add-input"
          placeholder={addPlaceholder ?? 'Add an item…'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(); } }}
          autoFocus
        />
      </div>

      <div className="cc2-lst-list">
        {items.length === 0 && (
          <div className="cc2-lst-empty">{emptyText ?? 'Nothing here yet — add something above.'}</div>
        )}
        {items.map(row => (
          <ListRow
            key={row.id}
            row={row}
            display={rowDisplay}
            // Only worth showing when rows can differ: a bucket-scoped list has
            // one value on every row, and a flat file has none at all.
            showBucket={bucket === undefined}
            mutate={mutate}
          />
        ))}
      </div>

      {showClearDone && checkedCount > 0 && onClearDone && (
        <div className="cc2-lst-footer">
          <button type="button" className="cc2-flush-btn cc2-lst-clear-btn" onClick={onClearDone}>
            Clear checked ({checkedCount})
          </button>
        </div>
      )}
    </div>
  );
}
