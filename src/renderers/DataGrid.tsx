import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'obsidian';
import type { CodecRow, RendererProps } from '../core';
import type { MdTableColumn, MdTableMeta } from '../core';

/**
 * renderers/DataGrid.tsx — the editable table renderer.
 *
 * The third generic renderer, and the first one that WRITES cells. Speaks the
 * `md-table` codec, whose schema comes from the file rather than a preset: the
 * table's header row is its column list, so this renderer reads its columns
 * from `meta`, never from options. Point it at any markdown table and it works.
 *
 * WHY THIS ISN'T RecordTable WITH AN `editable` FLAG. RecordTable is a browser,
 * not an editor — it never destructures `mutate`, and its row click opens the
 * NOTE a row came from. A markdown-table row isn't a note, so there is nothing
 * to open, and every interaction here (edit a cell, add a row, rename a column)
 * has no counterpart there. Both renderers ARE registered for `md-table`
 * though, which is what makes "View as…" meaningful: the same table, editable
 * here or read-only there, with no data migration between them.
 *
 * ── LAYOUT: ONE SCROLL BOX OWNS BOTH AXES ──────────────────────────────────
 *
 *   .cc2-grd-root      flex column, overflow hidden
 *     .cc2-grd-header  title + actions
 *     .cc2-grd-scroll  overflow: auto          ← the ONLY scroller
 *       .cc2-grd-head-row   position: sticky; top: 0
 *       .cc2-grd-row × N
 *
 * The header living INSIDE the scroller is load-bearing, not tidiness. It used
 * to be a sibling of the body, which meant the body lost ~11px to its vertical
 * scrollbar that the header didn't — and with every column `flex: 1 1 0`, that
 * error was divided by N and then re-accumulated at each boundary, so headers
 * drifted further off their columns the further right you looked, and only once
 * there were enough rows to scroll. Sharing one scroll box makes that
 * structurally impossible rather than merely corrected.
 *
 * Columns are `flex: 0 0 <width>` — no grow, no shrink — following Kanban's
 * board (`.cc2-kb-board`/`.cc2-kb-column`). Without `flex-shrink: 0` the
 * children compress to fit and there is nothing to scroll horizontally.
 *
 * DESIGN CONTRACT — same as RecordTable's, and for the same reason: pointing a
 * widget at an arbitrary table must still look like this app, not a
 * spreadsheet. No gridlines, no zebra striping. The only chrome is the header
 * divider, because this renderer's header carries real actions.
 */

/** Fallback column width when neither the preset nor the user has set one. */
const DEFAULT_COL_W = 140;
/** Floor for a drag-resize, so a column can never be dragged out of existence. */
const MIN_COL_W = 72;

export interface DataGridOptions {
  /** Header micro-label. */
  title:      string;
  emptyText?: string;
  /** Tooltip for the add-row button. */
  addLabel?:  string;
  /**
   * Column add/rename/delete/reorder affordances.
   *
   * Defaults ON, which is the one deliberate departure from "new options
   * default to off" — that rule protects existing presets from a shared
   * renderer changing under them, and this renderer ships with a single
   * preset whose entire purpose is editing. A curated preset over a
   * fixed-shape table (where a renamed column would break whatever reads it)
   * opts out.
   */
  editableColumns?: boolean;
  /** Preset-level default width for every column. */
  columnWidth?: number;
  /** Per-column user overrides, persisted in the widget's own config. */
  columnWidths?: Record<string, number>;
}

/** Codec-level column mutations, bound to this source by PresetHost. */
export interface ColumnOps {
  addColumn(label: string, atIndex?: number): Promise<void>;
  renameColumn(key: string, nextLabel: string): Promise<void>;
  removeColumn(key: string): Promise<void>;
  moveColumn(key: string, toIndex: number): Promise<void>;
}

interface DataGridProps<Row extends CodecRow> extends Omit<RendererProps<Row>, 'options'> {
  options: DataGridOptions;
  meta?:   MdTableMeta | null;
  columnOps?: ColumnOps;
}

const ICON = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const,
};

/** Which way a keyboard commit moves the cursor. */
type Nav = 'up' | 'down' | 'left' | 'right';

/**
 * True on touch devices (iPhone/iPad), where there is no hover at all.
 *
 * This renderer's controls are hover-revealed, which on a touch device means
 * "permanently invisible" — so the affordances have to change, not just grow:
 * they stay visible, the targets get bigger, and the whole header cell becomes
 * the menu trigger rather than a 16px button a fingertip can't reliably hit.
 *
 * A media query rather than a container query, and NOT a violation of the
 * container-queries-never-media-queries rule: that rule is about widget
 * LAYOUT, whose width comes from the grid span rather than the viewport.
 * Pointer type is a device capability — container queries cannot express it.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    if (!mq) return;
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return !!coarse;
}

// ── Inline editor ─────────────────────────────────────────────────────────

/**
 * One text field shared by cells and column headers: commit on Enter or blur,
 * abandon on Escape — the same contract SimpleList's row editor uses, so
 * editing feels identical across renderers.
 *
 * `onNav` is what makes the grid keyboard-navigable. Left/Right are
 * CARET-AWARE: they move the text caret normally and only jump to the adjacent
 * cell once the caret is already at the very start or end of the value.
 * Hijacking them unconditionally would make it impossible to fix a typo
 * mid-word without the mouse.
 */
function InlineEdit({ value, onCommit, onCancel, className, onNav }: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
  className: string;
  onNav?: (dir: Nav, wrap: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  /** Guards against writing the same edit twice — see `commit`. */
  const written = useRef(false);
  /** Set once this editor has handed off to another cell — see `onBlur`. */
  const handedOff = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    // Keyboard travel would otherwise walk straight off the edge of the
    // scroller with nothing following it.
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  /**
   * Idempotent: a keyboard move commits, and then the input unmounts, which
   * can fire `blur` and try to commit the identical value a second time.
   */
  const commit = () => {
    if (written.current) return false;
    const next = draft.trim();
    if (next === value.trim()) return false;
    written.current = true;
    onCommit(next);
    return true;
  };

  /**
   * Commit whatever is typed, then move — the cursor change remounts us at the
   * new cell, and that remount is what moves focus.
   *
   * Deliberately does NOT call onCancel on an unchanged value. onCancel sets
   * the cursor to null, and because `navigate` is a functional state update it
   * would then read that null and refuse to move — so arrowing off a cell you
   * hadn't edited would close the editor instead of stepping to the next cell.
   */
  const commitAndNav = (dir: Nav, wrap = false) => {
    handedOff.current = true;
    commit();
    onNav?.(dir, wrap);
  };

  const atStart = () => {
    const el = ref.current;
    return !!el && el.selectionStart === 0 && el.selectionEnd === 0;
  };
  const atEnd = () => {
    const el = ref.current;
    return !!el && el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
  };

  return (
    <input
      ref={ref}
      type="text"
      className={className}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        switch (e.key) {
          case 'Enter':
            e.preventDefault();
            if (onNav) commitAndNav(e.shiftKey ? 'up' : 'down');
            else if (!commit()) onCancel();
            return;
          case 'Escape':
            e.preventDefault(); onCancel(); return;
          case 'Tab':
            if (!onNav) return;
            e.preventDefault(); commitAndNav(e.shiftKey ? 'left' : 'right', true); return;
          case 'ArrowUp':
            if (!onNav) return;
            e.preventDefault(); commitAndNav('up'); return;
          case 'ArrowDown':
            if (!onNav) return;
            e.preventDefault(); commitAndNav('down'); return;
          case 'ArrowLeft':
            if (!onNav || !atStart()) return;   // let the caret move instead
            e.preventDefault(); commitAndNav('left'); return;
          case 'ArrowRight':
            if (!onNav || !atEnd()) return;
            e.preventDefault(); commitAndNav('right'); return;
          default:
        }
      }}
      // Skipped after a keyboard hand-off: the unmount that follows a cursor
      // move fires blur, and onCancel would null the cursor that move just set.
      onBlur={() => { if (handedOff.current) return; if (!commit()) onCancel(); }}
    />
  );
}

// ── Column resize handle ──────────────────────────────────────────────────

/**
 * Drag the divider on a column's right edge to resize it.
 *
 * POINTER EVENTS, not HTML5 drag — mouse, touch and pen are then one code
 * path, which is what makes this work on iOS. Copied in shape from
 * ClassSchedulerWidget's `handleStretchDown`: pointerdown attaches its OWN
 * move/up pair to `window` and removes that exact pair on release, so each
 * gesture's closures capture that gesture's starting values fresh and there is
 * no stale-closure risk.
 *
 * The width is live-previewed in local state and written to config ONCE on
 * release — persisting on every pointermove would write per pixel of travel.
 *
 * `pointercancel` matters on touch: iOS fires it instead of `pointerup` when
 * the system takes over the gesture, and without it the listeners would leak.
 */
function ResizeHandle({ width, onPreview, onCommit, onReset }: {
  width: number;
  onPreview: (w: number) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
}) {
  const start = (e: React.PointerEvent) => {
    // Both are required: preventDefault stops iOS's text-selection callout,
    // stopPropagation stops the header's own click/context handlers firing.
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    let last = width;

    const onMove = (ev: PointerEvent) => {
      last = Math.max(MIN_COL_W, Math.round(width + (ev.clientX - startX)));
      onPreview(last);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      onCommit(last);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <span
      className="cc2-grd-resize"
      onPointerDown={start}
      onDoubleClick={e => { e.stopPropagation(); onReset(); }}
      title="Drag to resize · double-click to reset"
      aria-hidden="true"
    />
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function HeaderCell({ column, index, count, width, editable, ops, resizable, coarse, onPreview, onCommitWidth, onResetWidth }: {
  column: MdTableColumn; index: number; count: number; width: number;
  editable: boolean; ops?: ColumnOps; resizable: boolean; coarse: boolean;
  onPreview: (w: number) => void;
  onCommitWidth: (w: number) => void;
  onResetWidth: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const style = { flex: `0 0 ${width}px`, width };

  /**
   * Obsidian's own Menu rather than a custom popover, for two concrete
   * reasons: it renders in Obsidian's layer so it can't be clipped by
   * `.cc2-grd-root { overflow: hidden }` (the failure styles.css warns about
   * for the non-portaled `.cc2-mc-menu`), and it needs no entry in the portal
   * token-bridge selector list. It also inherits the user's theme for free.
   */
  const openMenu = (e: React.MouseEvent) => {
    if (!editable || !ops) return;
    e.preventDefault();
    // The dashboard binds onContextMenu to `.cc2-stage`, an ancestor of every
    // widget — without this, right-clicking a header opens BOTH menus.
    e.stopPropagation();

    const menu = new Menu();
    menu.addItem(i => i.setTitle('Rename column').setIcon('pencil').onClick(() => setRenaming(true)));
    menu.addItem(i => i.setTitle('Move left').setIcon('arrow-left')
      .setDisabled(index === 0)
      .onClick(() => void ops.moveColumn(column.key, index - 1)));
    menu.addItem(i => i.setTitle('Move right').setIcon('arrow-right')
      .setDisabled(index === count - 1)
      .onClick(() => void ops.moveColumn(column.key, index + 1)));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Delete column').setIcon('trash')
      .setDisabled(count <= 1)
      .onClick(() => void ops.removeColumn(column.key)));
    menu.showAtMouseEvent(e.nativeEvent as MouseEvent);
  };

  return (
    <span
      className="cc2-grd-head-cell"
      style={style}
      title={editable ? `${column.label} — ${coarse ? 'tap' : 'right-click'} for column options` : column.label}
      onContextMenu={openMenu}
      // On touch the WHOLE header cell opens the menu — that turns a 16px
      // button into a ~140×44px target, which is the only version of this a
      // fingertip can hit reliably. Rename lives in the menu, so nothing is
      // lost by giving up the desktop double-click here.
      onClick={coarse ? openMenu : undefined}
      onDoubleClick={() => { if (!coarse && editable && ops) setRenaming(true); }}
    >
      {renaming && ops ? (
        <InlineEdit
          className="cc2-grd-input"
          value={column.label}
          onCommit={next => { setRenaming(false); void ops.renameColumn(column.key, next); }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <span className="cc2-grd-head-label">{column.label}</span>
          {editable && ops && (
            <button
              type="button"
              className="cc2-flush-btn cc2-grd-col-menu"
              title="Column options"
              aria-label={`Options for ${column.label}`}
              onClick={openMenu}
            >
              <svg {...ICON} width={12} height={12} strokeWidth={2.4}>
                <path d="M5 12h.01M12 12h.01M19 12h.01" />
              </svg>
            </button>
          )}
        </>
      )}

      {resizable && (
        <ResizeHandle
          width={width}
          onPreview={onPreview}
          onCommit={onCommitWidth}
          onReset={onResetWidth}
        />
      )}
    </span>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────────

function GridRow<Row extends CodecRow>({ row, columns, widthFor, cursor, setCursor, onEdit, onDelete, onNav }: {
  row: Row;
  columns: MdTableColumn[];
  widthFor: (key: string) => number;
  cursor: { rowId: string; colKey: string } | null;
  setCursor: (c: { rowId: string; colKey: string } | null) => void;
  onEdit: (key: string, next: string) => void;
  onDelete: () => void;
  onNav: (dir: Nav, wrap: boolean) => void;
}) {
  return (
    <div className="cc2-grd-row">
      {columns.map(col => {
        const value = typeof row[col.key] === 'string' ? (row[col.key] as string) : '';
        const editing = cursor?.rowId === row.id && cursor.colKey === col.key;
        const w = widthFor(col.key);

        return (
          <span
            key={col.key}
            className="cc2-grd-cell"
            style={{ flex: `0 0 ${w}px`, width: w }}
            onDoubleClick={() => setCursor({ rowId: row.id, colKey: col.key })}
          >
            {editing ? (
              <InlineEdit
                // Keyed on the coordinate so a cursor move REMOUNTS it — that
                // remount is what actually moves focus to the new cell.
                key={`${row.id}:${col.key}`}
                className="cc2-grd-input"
                value={value}
                onCommit={next => onEdit(col.key, next)}
                onCancel={() => setCursor(null)}
                onNav={onNav}
              />
            ) : (
              // An empty cell still needs a hit target, or a blank row can't be
              // filled in — the placeholder dot is that target, not decoration.
              <span className={'cc2-grd-value' + (value ? '' : ' cc2-grd-value-empty')}>
                {value || '·'}
              </span>
            )}
          </span>
        );
      })}

      <button
        type="button" className="cc2-flush-btn cc2-grd-row-del"
        title="Delete row" aria-label="Delete row"
        onClick={onDelete}
      >
        <svg {...ICON} width={10} height={10}><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

// ── The renderer ──────────────────────────────────────────────────────────

export function DataGrid<Row extends CodecRow>({
  rows, meta, mutate, loading, options, tone, wash, columnOps, onOptionsChange,
}: DataGridProps<Row>) {
  const {
    title, emptyText, addLabel = 'Add row', editableColumns = true,
    columnWidth = DEFAULT_COL_W, columnWidths,
  } = options;

  const [addingColumn, setAddingColumn] = useState(false);
  const [cursor, setCursor] = useState<{ rowId: string; colKey: string } | null>(null);
  /** In-flight resize — rendered instead of the stored width until released. */
  const [live, setLive] = useState<{ key: string; w: number } | null>(null);
  const coarse = useCoarsePointer();

  const columns  = meta?.columns ?? [];
  const editable = editableColumns && !!columnOps;
  const resizable = !!onOptionsChange;

  const widthFor = useCallback(
    (key: string) => (live?.key === key ? live.w : columnWidths?.[key] ?? columnWidth),
    [live, columnWidths, columnWidth],
  );

  // Hold the preview until the committed width actually arrives back through
  // config, otherwise the column snaps to its old size for a frame.
  useEffect(() => {
    if (live && columnWidths?.[live.key] === live.w) setLive(null);
  }, [live, columnWidths]);

  const commitWidth = useCallback((key: string, w: number) => {
    onOptionsChange?.({ columnWidths: { ...(columnWidths ?? {}), [key]: w } });
  }, [onOptionsChange, columnWidths]);

  const resetWidth = useCallback((key: string) => {
    const next = { ...(columnWidths ?? {}) };
    delete next[key];
    setLive(null);
    onOptionsChange?.({ columnWidths: next });
  }, [onOptionsChange, columnWidths]);

  const editCell = useCallback(
    (row: Row, key: string, next: string) => {
      void mutate.update(row.id, { [key]: next, raw: row.raw } as Partial<Row>);
    },
    [mutate],
  );

  /**
   * Moves the edit cursor. `wrap` (Tab) carries past a row's edge into the
   * next row; the arrow keys stop there instead. Running off the grid closes
   * the editor rather than creating a row — adding rows stays explicit.
   */
  const navigate = useCallback((dir: Nav, wrap: boolean) => {
    setCursor(current => {
      if (!current) return null;
      const r = rows.findIndex(x => x.id === current.rowId);
      const c = columns.findIndex(x => x.key === current.colKey);
      if (r < 0 || c < 0) return null;

      let nr = r + (dir === 'down' ? 1 : dir === 'up' ? -1 : 0);
      let nc = c + (dir === 'right' ? 1 : dir === 'left' ? -1 : 0);

      if (wrap) {
        if (nc < 0)                { nc = columns.length - 1; nr -= 1; }
        if (nc >= columns.length)  { nc = 0;                  nr += 1; }
      }
      if (nr < 0 || nr >= rows.length || nc < 0 || nc >= columns.length) return null;
      return { rowId: rows[nr].id, colKey: columns[nc].key };
    });
  }, [rows, columns]);

  // No table in the file yet — a real state, not an error. Without columns
  // there is nothing to draw a row against, so the only useful action is
  // creating the first column.
  if (!loading && meta && !meta.found) {
    return (
      <div className="cc2-grd-root" data-tone={tone} data-wash={wash || undefined}>
        <div className="cc2-grd-header">
          <span className="cc2-grd-title">{title}</span>
        </div>
        <div className="cc2-grd-empty">
          No table found{meta.heading ? ` under “${meta.heading}”` : ''} in this note.
        </div>
      </div>
    );
  }

  return (
    <div className="cc2-grd-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-grd-header">
        <span className="cc2-grd-title">{title}</span>
        <span className="cc2-grd-header-actions">
          {editable && (
            <button
              type="button" className="cc2-flush-btn cc2-grd-action"
              title="Add column" aria-label="Add column"
              onClick={() => setAddingColumn(true)}
            >
              <svg {...ICON} width={14} height={14}><path d="M12 5v14M5 12h14" /></svg>
              <span className="cc2-grd-action-label">Column</span>
            </button>
          )}
          <button
            type="button" className="cc2-flush-btn cc2-grd-action"
            title={addLabel} aria-label={addLabel}
            disabled={columns.length === 0}
            onClick={() => void mutate.add({} as Partial<Row>)}
          >
            <svg {...ICON} width={14} height={14}><path d="M12 5v14M5 12h14" /></svg>
            <span className="cc2-grd-action-label">Row</span>
          </button>
        </span>
      </div>

      {/* The one scroller. Header and rows share it, which is what keeps them
          locked to each other on both axes. */}
      <div className="cc2-grd-scroll">
        <div className="cc2-grd-head-row">
          {columns.map((col, i) => (
            <HeaderCell
              key={col.key}
              column={col}
              index={i}
              count={columns.length}
              width={widthFor(col.key)}
              editable={editable}
              ops={columnOps}
              resizable={resizable}
              coarse={coarse}
              onPreview={w => setLive({ key: col.key, w })}
              onCommitWidth={w => commitWidth(col.key, w)}
              onResetWidth={() => resetWidth(col.key)}
            />
          ))}

          {addingColumn && columnOps && (
            <span className="cc2-grd-head-cell" style={{ flex: `0 0 ${columnWidth}px`, width: columnWidth }}>
              <InlineEdit
                className="cc2-grd-input"
                value=""
                onCommit={label => { setAddingColumn(false); void columnOps.addColumn(label); }}
                onCancel={() => setAddingColumn(false)}
              />
            </span>
          )}

          {/* Balances the per-row delete button so headers stay over their cells. */}
          <span className="cc2-grd-row-del-spacer" />
        </div>

        {loading && rows.length === 0 && <div className="cc2-grd-empty">Loading…</div>}

        {!loading && rows.length === 0 && (
          <div className="cc2-grd-empty">{emptyText ?? 'No rows yet — use + Row to add one.'}</div>
        )}

        {rows.map(row => (
          <GridRow
            key={row.id}
            row={row}
            columns={columns}
            widthFor={widthFor}
            cursor={cursor}
            setCursor={setCursor}
            onEdit={(key, next) => editCell(row, key, next)}
            onDelete={() => void mutate.remove(row.id)}
            onNav={navigate}
          />
        ))}
      </div>
    </div>
  );
}
