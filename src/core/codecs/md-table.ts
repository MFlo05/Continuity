import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { Codec, CodecRow, FieldDef, RowId, SourceRef } from '../types';
import { sourceHeading, sourcePath } from '../types';
import { CodecError } from './checklist';

/**
 * core/codecs/md-table.ts — the markdown-table codec.
 *
 * The fourth codec, and the first one whose SCHEMA COMES FROM THE FILE rather
 * than from a preset: a table's header row *is* its column list, so pointing a
 * widget at a table is enough to know what to draw. That's what makes a
 * user-authored table (a reading list, a grocery list with price and category)
 * expressible without any new code per table.
 *
 * ON-DISK — a GitHub-style pipe table, exactly as Obsidian renders it:
 *
 *     ## Recurring Items
 *
 *     | Amount    | Description | Category | Section  | Schedule           |
 *     | --------- | ----------- | -------- | -------- | ------------------ |
 *     | $1,870.93 | Mortgage    | Housing  | Expenses | 1st of each month  |
 *
 * WHY THIS IS NOT `line-table`. Despite the name, that codec parses LIST ITEMS
 * that happen to contain pipes (`- HH:MM | date | $amt | desc | cat`) with a
 * hardcoded five-field schema, no header row and no separator row, scoped by
 * enclosing `###` headings. The two formats share only the pipe character;
 * there is nothing reusable between the parsers.
 *
 * ADDRESSING — `{ path, heading? }`. A note routinely holds several tables (a
 * Class-Transcript.md carries Assignments, Day-by-Day Schedule and Grade Scale;
 * the ledger index holds Recurring Items beside prose), so a bare path can't
 * identify one. `heading` omitted means the first table in the file; present
 * means the first table inside that heading's section. FIRST-MATCH is a
 * documented rule rather than a guess: a section can legitimately hold two
 * tables separated by bold text instead of a second heading.
 *
 * FOUR THINGS THE PARSER HAS TO GET RIGHT, each a real case in this vault:
 *
 * 1. FENCED CODE BLOCKS ARE NOT DATA. Skills/Syllabus-Import.md contains the
 *    literal table template it tells the AI to write — byte-identical in shape
 *    to the real transcript tables it produces. Without fence tracking this
 *    codec would happily parse the instructions as rows.
 * 2. A SEPARATOR ROW IS REQUIRED. Skills/budget-reconciliation.md documents
 *    pipe-delimited CSV samples that have a header-looking line and no
 *    separator; a header-only lookahead matches them.
 * 3. EMPTY CELLS ARE MEANINGFUL. Transcript rows genuinely look like
 *    `| | Participation | 20% | |`. Rows are padded out to the column count and
 *    never trimmed back to their last non-empty cell.
 * 4. ALIGNMENT AND PADDING ROUND-TRIP. data-sources/recurring.ts (which this
 *    replaces) reads `:---` fine but always writes `| --- |`, silently
 *    destroying a user's column alignment on every single mutation.
 *
 * Row mutations deliberately never touch the header or separator lines, so the
 * only thing that can perturb a table's formatting is an explicit column
 * operation.
 */

// ── Row / meta shapes ─────────────────────────────────────────────────────

export interface MdTableColumn {
  /** Key used on every row object. Derived from the label, uniquified. */
  key:    string;
  /** The header cell's text, verbatim — what's actually written in the file. */
  label:  string;
  align?: 'left' | 'center' | 'right';
}

export interface MdTableRow extends CodecRow {
  /** Line index of this row in the file — stable for the lifetime of a parse. */
  id:   RowId;
  /** Verbatim line, so a mutation can verify it's still addressing this row. */
  raw?: string;
  /** One entry per column, keyed by MdTableColumn.key. Always a string. */
  [column: string]: unknown;
}

export interface MdTableMeta {
  columns: MdTableColumn[];
  /**
   * Ordered column keys. Named `fieldKeys` on purpose — PresetHost already
   * forwards a meta with this key into the renderer's options, so a table
   * source drives RecordTable's column derivation with no new wiring.
   */
  fieldKeys: string[];
  /** The heading this table was found under, if the source named one. */
  heading: string | null;
  /** False when no table was located — an empty state, not an error. */
  found:   boolean;
}

/** Seed for a brand-new table note. */
export const TABLE_TEMPLATE = [
  '| Name | Notes |',
  '| --- | --- |',
  '',
].join('\n');

// ── Low-level line helpers ────────────────────────────────────────────────

const HEADING_RE   = /^(#{1,6})\s+(.*)$/;
const FENCE_RE     = /^(`{3,}|~{3,})/;
const SEP_CELL_RE  = /^:?-+:?$/;

/** Reserved by CodecRow — a column with either name would shadow it. */
const RESERVED_KEYS = new Set(['id', 'raw']);

/**
 * Marks every line sitting inside a fenced code block (``` or ~~~), including
 * the fence lines themselves. See the header note: without this, a skill file's
 * example table parses as real data.
 */
function fenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  let fenceChar: string | null = null;

  lines.forEach((line, i) => {
    const m = FENCE_RE.exec(line.trim());
    if (m) {
      const char = m[1][0];
      if (fenceChar === null)    { fenceChar = char; mask[i] = true; return; }
      if (char === fenceChar)    { fenceChar = null; mask[i] = true; return; }
    }
    mask[i] = fenceChar !== null;
  });

  return mask;
}

function headingAt(line: string): { level: number; text: string } | null {
  const m = HEADING_RE.exec(line.trim());
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.length > 1;
}

/**
 * Splits a table row into cells, unescaping `\|` as it goes. Hand-rolled
 * rather than a split(): a cell may legitimately contain an escaped pipe, and
 * `String.split('|')` would cut it in half and corrupt the table on write-back.
 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every(c => SEP_CELL_RE.test(c.trim()));
}

function alignOf(sepCell: string): MdTableColumn['align'] {
  const c = sepCell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return undefined;
}

/** `|` inside a cell must be escaped or it becomes a column boundary. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * A table keeps the formatting style it already has. Three real styles occur:
 * tight (`|a|b|`), single-spaced (`| a | b |`), and COLUMN-ALIGNED, where every
 * cell is padded out to its column's widest value and the separator's dashes
 * match that width:
 *
 *     | Amount    | Description     |
 *     | --------- | --------------- |
 *     | $1,870.93 | Mortgage        |
 *
 * Aligned is what Obsidian itself writes and what the ledger index uses. An
 * earlier version of this codec emitted single-spaced rows unconditionally,
 * which silently reflowed that whole file on the first edit — a visible,
 * unrequested change to a V1-compatible file the budget-capture skill reads.
 * Detecting and preserving alignment is why every mutation re-emits the whole
 * table block rather than splicing one line: adding a longer value can widen a
 * column, and every other row has to move with it.
 */
interface TableStyle { padded: boolean; aligned: boolean }

function styleOf(separatorLine: string): TableStyle {
  const cells = splitRow(separatorLine);
  return {
    padded: /^\|\s/.test(separatorLine.trim()),
    // Count DASHES, not cell length: `:---:` and `---:` are the minimal
    // alignment markers at 5 and 4 characters, so measuring the whole cell
    // would read any aligned-but-unpadded table as width-padded and then
    // reflow it on the first edit.
    aligned: cells.some(c => (c.match(/-/g) ?? []).length > 3),
  };
}

/** Display width of a cell once escaped — what alignment has to account for. */
function cellWidth(value: string): number {
  return escapeCell(value).length;
}

/** Colons an alignment marker costs, on top of its dashes. */
function alignColons(align: MdTableColumn['align']): number {
  return align === 'center' ? 2 : align ? 1 : 0;
}

/**
 * Counts DASHES rather than total characters. `---`, `:---`, `---:` and
 * `:---:` are all the canonical minimal markers despite being 3-5 characters
 * wide, so sizing by total width would shrink them to `:-:` on the first write.
 */
function separatorCell(align: MdTableColumn['align'], width: number, aligned: boolean): string {
  const dashes = aligned ? Math.max(3, width - alignColons(align)) : 3;
  const bar = '-'.repeat(dashes);
  switch (align) {
    case 'left':   return `:${bar}`;
    case 'right':  return `${bar}:`;
    case 'center': return `:${bar}:`;
    default:       return bar;
  }
}

function joinCells(cells: string[], style: TableStyle): string {
  const body = cells.join(style.padded ? ' | ' : '|');
  return style.padded ? `| ${body} |` : `|${body}|`;
}

/**
 * Renders the header, separator and every data row as one block. The single
 * place row and column mutations both go through, so the two can't drift into
 * producing differently-formatted output for the same table.
 */
function emitTable(columns: MdTableColumn[], rowCells: string[][], style: TableStyle): string[] {
  const escaped = rowCells.map(cells => columns.map((_c, i) => escapeCell(cells[i] ?? '')));
  const labels  = columns.map(c => escapeCell(c.label));

  // The floor is the column's own minimal separator, so an alignment marker
  // can never end up wider than the column it labels.
  const widths = columns.map((c, i) =>
    style.aligned
      ? Math.max(3 + alignColons(c.align), cellWidth(c.label), ...escaped.map(r => r[i].length))
      : 0,
  );

  const pad = (v: string, i: number) => (style.aligned ? v.padEnd(widths[i]) : v);

  return [
    joinCells(labels.map(pad), style),
    joinCells(columns.map((c, i) => separatorCell(c.align, widths[i], style.aligned)), style),
    ...escaped.map(cells => joinCells(cells.map(pad), style)),
  ];
}

/**
 * Header labels → unique row keys. Two real hazards force the uniquifying:
 * a header cell can be empty (`| | Count |` exists in this vault), and nothing
 * stops a table from repeating a column name or naming one `id`, which would
 * shadow CodecRow's own field.
 */
function columnsFrom(headerCells: string[], sepCells: string[]): MdTableColumn[] {
  const used = new Set<string>();
  return headerCells.map((label, i) => {
    const base = label.trim() || `Column ${i + 1}`;
    let key = base;
    if (RESERVED_KEYS.has(key)) key = `${base} (col)`;
    let n = 2;
    while (used.has(key)) key = `${base} ${n++}`;
    used.add(key);
    return { key, label, align: alignOf(sepCells[i] ?? '') };
  });
}

// ── Parsing ───────────────────────────────────────────────────────────────

interface FoundTable {
  headerIdx: number;
  sepIdx:    number;
  /** Exclusive end of the data rows. */
  rowsEnd:   number;
  columns:   MdTableColumn[];
  style:     TableStyle;
}

/**
 * Locates the target table. Scoped to a heading's own section when the source
 * names one, and the scope ENDS at the next heading of the same or higher level
 * — without that, asking for a section that has no table would silently return
 * a table belonging to some later section.
 */
function findTable(lines: string[], mask: boolean[], heading: string | null): FoundTable | null {
  let start = 0;
  let stopLevel = 0;

  if (heading) {
    const idx = lines.findIndex((l, i) => !mask[i] && headingAt(l)?.text === heading);
    if (idx < 0) return null;
    start = idx + 1;
    stopLevel = headingAt(lines[idx])!.level;
  }

  for (let i = start; i < lines.length; i++) {
    if (mask[i]) continue;

    if (stopLevel > 0) {
      const h = headingAt(lines[i]);
      if (h && h.level <= stopLevel) return null;   // left the section
    }

    if (!isTableRow(lines[i])) continue;
    // A separator on the very next line is what distinguishes a real table
    // from a pipe-delimited prose line or a CSV sample.
    const sepIdx = i + 1;
    if (sepIdx >= lines.length || mask[sepIdx] || !isSeparatorRow(lines[sepIdx])) continue;

    let rowsEnd = sepIdx + 1;
    while (rowsEnd < lines.length && !mask[rowsEnd] && isTableRow(lines[rowsEnd])) rowsEnd++;

    const headerCells = splitRow(lines[i]);
    const sepCells    = splitRow(lines[sepIdx]);
    return {
      headerIdx: i,
      sepIdx,
      rowsEnd,
      columns: columnsFrom(headerCells, sepCells),
      style:   styleOf(lines[sepIdx]),
    };
  }

  return null;
}

export interface ParsedMdTable {
  lines: string[];
  table: FoundTable | null;
  rows:  MdTableRow[];
  meta:  MdTableMeta;
}

export function parseMdTable(content: string, heading: string | null): ParsedMdTable {
  const lines = content.split('\n');
  const mask  = fenceMask(lines);
  const table = findTable(lines, mask, heading);

  if (!table) {
    return {
      lines, table: null, rows: [],
      meta: { columns: [], fieldKeys: [], heading, found: false },
    };
  }

  const rows: MdTableRow[] = [];
  for (let i = table.sepIdx + 1; i < table.rowsEnd; i++) {
    const cells = splitRow(lines[i]);
    const row: MdTableRow = { id: String(i), raw: lines[i] };
    // Pad rather than truncate: a short row is a row with trailing empties,
    // and an over-long one keeps its extra cells out of the row object rather
    // than silently gaining an unnamed column.
    table.columns.forEach((col, c) => { row[col.key] = cells[c] ?? ''; });
    rows.push(row);
  }

  return {
    lines, table, rows,
    meta: {
      columns:   table.columns,
      fieldKeys: table.columns.map(c => c.key),
      heading,
      found:     true,
    },
  };
}

// ── Discovery (for the settings-modal picker) ─────────────────────────────

export interface DiscoveredTable {
  path:    string;
  /** Nearest preceding heading, or null for a table with none above it. */
  heading: string | null;
  columns: string[];
  rows:    number;
}

/**
 * Every table in one note, each tagged with the heading it sits under.
 *
 * Deliberately drops a second table sharing a heading with an earlier one:
 * `heading` addresses the FIRST match, so offering the second in a picker
 * would hand the user a source that silently resolves to the wrong table.
 * Only documentation files in this vault actually hit that case.
 */
export function scanTables(content: string): DiscoveredTable[] {
  const lines = content.split('\n');
  const mask  = fenceMask(lines);
  const out: DiscoveredTable[] = [];
  const seen = new Set<string>();

  let heading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;

    const h = headingAt(lines[i]);
    if (h) { heading = h.text; continue; }

    if (!isTableRow(lines[i])) continue;
    const sepIdx = i + 1;
    if (sepIdx >= lines.length || mask[sepIdx] || !isSeparatorRow(lines[sepIdx])) continue;

    let rowsEnd = sepIdx + 1;
    while (rowsEnd < lines.length && !mask[rowsEnd] && isTableRow(lines[rowsEnd])) rowsEnd++;

    const key = heading ?? ' first';
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        path: '',
        heading,
        columns: columnsFrom(splitRow(lines[i]), splitRow(lines[sepIdx])).map(c => c.label),
        rows: rowsEnd - sepIdx - 1,
      });
    }
    i = rowsEnd - 1;
  }

  return out;
}

/**
 * Every addressable table in the vault. Skips `.obsidian/` — the plugin's own
 * docs hold most of the vault's tables and none of them are user data.
 */
export async function discoverTables(app: App): Promise<DiscoveredTable[]> {
  const out: DiscoveredTable[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (file.path.startsWith('.obsidian/')) continue;
    const found = scanTables(await app.vault.cachedRead(file));
    found.forEach(t => out.push({ ...t, path: file.path }));
  }
  return out;
}

// ── Vault plumbing ────────────────────────────────────────────────────────

function fileFor(app: App, src: SourceRef): TFile | null {
  const path = sourcePath(src);
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

/** Every write funnels through here: parse, edit lines, re-emit. */
async function edit(
  app: App,
  src: SourceRef,
  fn: (parsed: ParsedMdTable) => string[] | null,
): Promise<void> {
  const file = fileFor(app, src);
  if (!file) return;

  await app.vault.process(file, content => {
    const parsed = parseMdTable(content, sourceHeading(src));
    const next = fn(parsed);
    return next ? next.join('\n') : content;   // null = no-op, target moved
  });
}

/**
 * Re-locates the row a mutation was addressed to, verifying the line still
 * looks like the row it was addressed to. Same contract as the checklist
 * codec's rowAt(): a line that moved underneath us makes the mutation a no-op
 * and the widget's own reload shows the truth.
 */
function rowAt(parsed: ParsedMdTable, id: RowId, expectRaw?: string): MdTableRow | null {
  const row = parsed.rows.find(r => r.id === id);
  if (!row) return null;
  if (expectRaw !== undefined && row.raw !== expectRaw) return null;
  return row;
}

/** Cells for one row, in column order, from a row-shaped patch. */
function cellsFor(columns: MdTableColumn[], source: Record<string, unknown>): string[] {
  return columns.map(c => {
    const v = source[c.key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Every data row as a padded cell array, in file order. */
function bodyCells(parsed: ParsedMdTable): string[][] {
  const { lines, table } = parsed;
  if (!table) return [];
  const out: string[][] = [];
  for (let i = table.sepIdx + 1; i < table.rowsEnd; i++) {
    const cells = splitRow(lines[i]);
    out.push(table.columns.map((_c, c) => cells[c] ?? ''));
  }
  return out;
}

/**
 * Splices a freshly-emitted table block over the old one, leaving every line
 * outside it — prose, headings, other tables — untouched.
 */
function replaceTable(
  parsed: ParsedMdTable,
  columns: MdTableColumn[],
  rowCells: string[][],
): string[] {
  const { lines, table } = parsed;
  if (!table) return lines;
  const out = [...lines];
  out.splice(table.headerIdx, table.rowsEnd - table.headerIdx, ...emitTable(columns, rowCells, table.style));
  return out;
}

function columnIndex(parsed: ParsedMdTable, key: string): number {
  return parsed.table ? parsed.table.columns.findIndex(c => c.key === key) : -1;
}

// ── The codec ─────────────────────────────────────────────────────────────

export interface MdTableCodec extends Codec<MdTableRow> {
  readMeta(app: App, src: SourceRef): Promise<MdTableMeta>;

  /** Appends a column, or inserts it at `atIndex`. */
  addColumn(app: App, src: SourceRef, label: string, atIndex?: number): Promise<void>;
  renameColumn(app: App, src: SourceRef, key: string, nextLabel: string): Promise<void>;
  removeColumn(app: App, src: SourceRef, key: string): Promise<void>;
  moveColumn(app: App, src: SourceRef, key: string, toIndex: number): Promise<void>;
}

const EMPTY_META: MdTableMeta = { columns: [], fieldKeys: [], heading: null, found: false };

export const mdTableCodec: MdTableCodec = {
  id:    'md-table',
  label: 'Table',

  async read(app: App, src: SourceRef, _schema: FieldDef[]): Promise<MdTableRow[]> {
    const file = fileFor(app, src);
    if (!file) return [];
    return parseMdTable(await app.vault.cachedRead(file), sourceHeading(src)).rows;
  },

  async readMeta(app: App, src: SourceRef): Promise<MdTableMeta> {
    const file = fileFor(app, src);
    if (!file) return { ...EMPTY_META, heading: sourceHeading(src) };
    return parseMdTable(await app.vault.cachedRead(file), sourceHeading(src)).meta;
  },

  /** One parse for both — without this the shared cache reads the file twice. */
  async readAll(app: App, src: SourceRef, _schema: FieldDef[]) {
    const file = fileFor(app, src);
    if (!file) return { rows: [] as MdTableRow[], meta: { ...EMPTY_META, heading: sourceHeading(src) } };
    const parsed = parseMdTable(await app.vault.cachedRead(file), sourceHeading(src));
    return { rows: parsed.rows, meta: parsed.meta };
  },

  /**
   * Creates the note if missing. When the source names a heading, also appends
   * that section with an empty table — otherwise a brand-new table widget would
   * render "no table found" and leave the user with nothing to click.
   */
  async ensure(app: App, src: SourceRef, template = TABLE_TEMPLATE): Promise<void> {
    const path = sourcePath(src);
    if (!path) return;
    const heading = sourceHeading(src);

    const existing = app.vault.getAbstractFileByPath(path);
    if (!existing) {
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
      await app.vault.create(path, heading ? `## ${heading}\n\n${template}` : template);
      return;
    }

    if (!(existing instanceof TFile) || !heading) return;

    // File exists but this heading's table doesn't — add just that section.
    await app.vault.process(existing, content => {
      if (parseMdTable(content, heading).table) return content;
      const trimmed = content.replace(/\s+$/, '');
      return `${trimmed}\n\n## ${heading}\n\n${template}`;
    });
  },

  async add(app: App, src: SourceRef, row: Partial<MdTableRow>): Promise<void> {
    let failed: string | null = null;
    await edit(app, src, parsed => {
      if (!parsed.table) { failed = 'No table found to add a row to.'; return null; }
      const cells = bodyCells(parsed);
      cells.push(cellsFor(parsed.table.columns, row));
      return replaceTable(parsed, parsed.table.columns, cells);
    });
    if (failed) throw new CodecError(failed);
  },

  async update(app: App, src: SourceRef, id: RowId, patch: Partial<MdTableRow>): Promise<void> {
    await edit(app, src, parsed => {
      if (!parsed.table) return null;
      const row = rowAt(parsed, id, patch.raw as string | undefined);
      if (!row) return null;

      // Merge over the row as parsed, so a patch touching one cell can't blank
      // the others.
      const merged: Record<string, unknown> = { ...row };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id' || k === 'raw') continue;
        merged[k] = v;
      }

      const at = Number(id) - (parsed.table.sepIdx + 1);
      const cells = bodyCells(parsed);
      cells[at] = cellsFor(parsed.table.columns, merged);
      return replaceTable(parsed, parsed.table.columns, cells);
    });
  },

  async remove(app: App, src: SourceRef, id: RowId): Promise<void> {
    await edit(app, src, parsed => {
      if (!parsed.table || !rowAt(parsed, id)) return null;
      const at = Number(id) - (parsed.table.sepIdx + 1);
      const cells = bodyCells(parsed);
      cells.splice(at, 1);
      return replaceTable(parsed, parsed.table.columns, cells);
    });
  },

  async addColumn(app: App, src: SourceRef, label: string, atIndex?: number): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new CodecError('Column name is required.');

    let failed: string | null = null;
    await edit(app, src, parsed => {
      if (!parsed.table) { failed = 'No table found.'; return null; }
      const cols = parsed.table.columns;
      const at = atIndex === undefined ? cols.length : Math.max(0, Math.min(atIndex, cols.length));

      const next = [...cols];
      next.splice(at, 0, { key: trimmed, label: trimmed });
      const cells = bodyCells(parsed).map(c => {
        const row = [...c];
        row.splice(at, 0, '');
        return row;
      });
      return replaceTable(parsed, next, cells);
    });
    if (failed) throw new CodecError(failed);
  },

  async renameColumn(app: App, src: SourceRef, key: string, nextLabel: string): Promise<void> {
    const trimmed = nextLabel.trim();
    if (!trimmed) throw new CodecError('Column name is required.');

    await edit(app, src, parsed => {
      const at = columnIndex(parsed, key);
      if (at < 0) return null;
      const next = parsed.table!.columns.map((c, i) => (i === at ? { ...c, label: trimmed } : c));
      return replaceTable(parsed, next, bodyCells(parsed));
    });
  },

  async removeColumn(app: App, src: SourceRef, key: string): Promise<void> {
    let failed: string | null = null;
    await edit(app, src, parsed => {
      const at = columnIndex(parsed, key);
      if (at < 0) return null;
      const cols = parsed.table!.columns;
      if (cols.length <= 1) { failed = 'A table needs at least one column.'; return null; }

      const cells = bodyCells(parsed).map(c => c.filter((_v, i) => i !== at));
      return replaceTable(parsed, cols.filter((_c, i) => i !== at), cells);
    });
    if (failed) throw new CodecError(failed);
  },

  async moveColumn(app: App, src: SourceRef, key: string, toIndex: number): Promise<void> {
    await edit(app, src, parsed => {
      const from = columnIndex(parsed, key);
      if (from < 0) return null;
      const cols = parsed.table!.columns;
      const to = Math.max(0, Math.min(toIndex, cols.length - 1));
      if (from === to) return null;

      const move = <T,>(arr: T[]): T[] => {
        const a = [...arr];
        const [item] = a.splice(from, 1);
        a.splice(to, 0, item);
        return a;
      };

      return replaceTable(parsed, move(cols), bodyCells(parsed).map(move));
    });
  },

  watchTargets(_app: App, src: SourceRef) {
    const path = sourcePath(src);
    return path ? { paths: [path] } : {};
  },
};
