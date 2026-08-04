import React, { useMemo } from 'react';
import type { App } from 'obsidian';
import type { CodecRow, RendererProps } from '../core';

/**
 * renderers/RecordTable.tsx — the table renderer. The first real renderer in
 * the app, and the template for the ones that follow.
 *
 * It knows nothing about meetings, recipes or classes. It takes rows, is told
 * which keys to show as columns, and draws them. Point it at any source whose
 * codec produces rows with those keys and it works — that's the renderers ×
 * codecs matrix the whole refactor exists to get.
 *
 * DESIGN CONTRACT (DESIGN_SYSTEM.md), because "pointing a table at a random
 * folder must still look like this app, not a spreadsheet" is a stated
 * product principle, not a nice-to-have:
 *
 *   - Widget Header standard: 46px min-height, 10px/600/0.14em uppercase
 *     micro-label title in --cc2-faint, 1px bottom divider. The header
 *     carries a real action (add), so it keeps its divider per the
 *     divider-vs-no-divider rule.
 *   - No table chrome. No gridlines, no zebra striping, no column borders —
 *     a spreadsheet look is exactly what the principle rules out. Columns are
 *     established by alignment and type styling alone.
 *   - Tone: Trim + Wash, following the "default to giving a new widget Wash"
 *     guidance. Trim colours the date column and chip text only.
 *   - Container queries, never media queries: a widget's pixel width comes
 *     from its grid span, not the viewport. Secondary columns drop out as the
 *     widget narrows.
 *   - Every button is .cc2-flush-btn with hand-guarded svg sizing, per the
 *     Obsidian override gotchas.
 */

export type ColumnKind = 'date' | 'text' | 'chip' | 'number';

export interface TableColumn {
  /** Row key to read — any frontmatter key a codec produced. */
  key:   string;
  label: string;
  kind?: ColumnKind;
  /** The one column that carries the row's identity; gets full text weight. */
  primary?: boolean;
  /** Hidden first as the widget narrows. Primary columns never collapse. */
  secondary?: boolean;
}

export interface RecordTableOptions {
  /** Header micro-label. */
  title:      string;
  /**
   * Omit to derive from `fieldKeys` — a preset pointed at a user-chosen folder
   * can't know its columns in advance, so the renderer owns that fallback.
   */
  columns?:   TableColumn[];
  /** The source's frontmatter keys, for deriving default columns. */
  fieldKeys?: string[];
  emptyText?: string;
  /** Tooltip/aria for the header's add button. Omitted = no add button. */
  addLabel?:  string;
  /** Shown when a row is clicked, if the row carries a `path`. */
  openOnClick?: boolean;
  /**
   * Header divider. Opt-in, and default OFF on purpose: "divider vs
   * no-divider is a deliberate per-widget decision, not a blanket rollout"
   * (DESIGN_SYSTEM.md). A shared renderer must not quietly impose chrome on
   * the presets using it — that's exactly what changed Meeting Log's look
   * when this renderer first landed.
   */
  divider?: boolean;
  /**
   * A labelled header row above the data, plus fixed column widths so the
   * labels line up with the values beneath them.
   *
   * Default ON: a bare `6` under no heading means nothing where "SERVINGS / 6"
   * does, and "default renderers must be opinionated" (handoff §1.2). Opt OUT
   * for a preset that genuinely wants a bare list with no table chrome.
   */
  showColumnHeaders?: boolean;
}

// Narrows RendererProps' generic `options: Record<string, unknown>` to this
// renderer's own typed options. Phase 4's preset loader is what will validate
// an untyped options bag into this shape; until then callers pass it directly.
interface RecordTableProps<Row extends CodecRow> extends Omit<RendererProps<Row>, 'options'> {
  options: RecordTableOptions;
  onAdd?:  () => void;
  /**
   * Supplied when the preset declares a `detail` view. Replaces the default
   * row click (open the note in Obsidian) — the renderer stays ignorant of
   * what actually opens.
   */
  onOpenRow?: (row: Row) => void;
}

/**
 * Frontmatter key → column label. `cookTime` reads as "Cook Time", not as a
 * raw key — a column header only earns its space if it's readable.
 */
export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Sensible columns for a folder nobody has configured yet — also the seed the
 * settings modal's column picker starts from. `date` and `title` are produced
 * by the record-folder codec for every row regardless of frontmatter, so they
 * are always safe to offer; one more key becomes a chip so the row isn't bare.
 */
export function defaultColumnsFor(fieldKeys: string[]): TableColumn[] {
  const columns: TableColumn[] = [
    { key: 'date',  label: 'Date',  kind: 'date' },
    { key: 'title', label: 'Title', kind: 'text', primary: true },
  ];
  const extra = fieldKeys.find(k => !['date', 'created', 'title', 'position'].includes(k));
  if (extra) columns.push({ key: extra, label: humanizeKey(extra), kind: 'chip' });
  return columns;
}

/**
 * Shared by the header row and every body cell, so a column's width and its
 * container-query hide/show behaviour can never drift between the two.
 */
function cellClass(column: TableColumn): string {
  return [
    'cc2-tbl-cell',
    `cc2-tbl-cell-${column.kind ?? 'text'}`,
    column.primary   ? 'cc2-tbl-cell-primary'   : '',
    column.secondary ? 'cc2-tbl-cell-secondary' : '',
  ].filter(Boolean).join(' ');
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d))
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Cell({ column, value }: { column: TableColumn; value: string }) {
  // An empty cell keeps its column classes so it still holds the column's
  // width in aligned mode — otherwise a row with one missing value would
  // shift every later column out from under its header.
  if (!value) return <span className={`${cellClass(column)} cc2-tbl-cell-empty`} />;

  const classes = cellClass(column);

  if (column.kind === 'chip') {
    return <span className={classes}><span className="cc2-tbl-chip">{value}</span></span>;
  }
  return (
    <span className={classes} title={value}>
      {column.kind === 'date' ? formatDate(value) : value}
    </span>
  );
}

export function RecordTable<Row extends CodecRow>({
  rows, loading, options, tone, wash, app, onAdd, onOpenRow,
}: RecordTableProps<Row>) {
  const {
    title, columns: given, fieldKeys, emptyText, addLabel,
    openOnClick = true, divider = false, showColumnHeaders = true,
  } = options;

  // A curated preset ships its columns; a folder-picking one derives them from
  // whatever frontmatter the chosen folder actually has.
  const columns = useMemo(
    () => (given?.length ? given : defaultColumnsFor(fieldKeys ?? [])),
    [given, fieldKeys],
  );

  // Rows are flex, not grid, with fixed widths per column kind. A grid would
  // align columns more strictly, but hiding a cell in a narrow container
  // (below) would then leave its track behind and shift every later column —
  // flex just closes the gap. Alignment comes from the per-kind widths.
  const openRow = (row: Row) => {
    if (!openOnClick) return;
    // A preset-declared detail view wins over the raw note.
    if (onOpenRow) { onOpenRow(row); return; }
    const path = typeof row.path === 'string' ? row.path : null;
    if (path) app.workspace.openLinkText(path, '');
  };

  return (
    <div
      // Aligned mode gives every non-primary column a fixed width so the
      // header row lines up with the values beneath it. Tied to the headers
      // themselves: without labels above them there's nothing to align to, and
      // content-width columns read better in a bare list.
      className={'cc2-tbl-root' + (showColumnHeaders ? ' cc2-tbl-root--aligned' : '')}
      data-tone={tone}
      data-wash={wash || undefined}
    >
      <div className={'cc2-tbl-header' + (divider ? ' cc2-tbl-header-divided' : '')}>
        <span className="cc2-tbl-title">{title}</span>
        {addLabel && onAdd && (
          <button
            type="button"
            className="cc2-flush-btn cc2-tbl-add"
            title={addLabel}
            aria-label={addLabel}
            onClick={onAdd}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {/* Sits OUTSIDE .cc2-tbl-body (the scroll container) so it stays put
          while rows scroll — no position:sticky, which would need an opaque
          background this widget doesn't always have (wash vs no wash). Its
          padding matches the body's 8px + the row's 6px so header labels line
          up with the values beneath them. */}
      {showColumnHeaders && columns.length > 0 && (
        <div className="cc2-tbl-head-row">
          {columns.map(col => (
            <span key={col.key} className={`${cellClass(col)} cc2-tbl-head-cell`}>
              {col.label}
            </span>
          ))}
        </div>
      )}

      <div className="cc2-tbl-body">
        {loading && rows.length === 0 && <div className="cc2-tbl-empty">Loading…</div>}

        {!loading && rows.length === 0 && (
          <div className="cc2-tbl-empty">{emptyText ?? 'Nothing here yet.'}</div>
        )}

        {rows.map(row => (
          <div
            key={row.id}
            className={'cc2-tbl-row' + (openOnClick && row.path ? ' cc2-tbl-row-clickable' : '')}
            role={openOnClick && row.path ? 'button' : undefined}
            tabIndex={openOnClick && row.path ? 0 : undefined}
            title={openOnClick && row.path ? `Open ${row.name ?? row.title ?? ''}` : undefined}
            onClick={() => openRow(row)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(row); }
            }}
          >
            {columns.map(col => (
              <Cell
                key={col.key}
                column={col}
                value={typeof row[col.key] === 'string' ? (row[col.key] as string) : ''}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
