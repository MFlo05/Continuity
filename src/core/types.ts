import type { ComponentType } from 'react';
import type { App } from 'obsidian';
import type { WidgetCategory, WidgetNeed } from '../widgets/registry';

/**
 * core/types.ts — the three-axis contract (codec / renderer / preset) the
 * refactor is built on. See REFACTOR-HANDOFF.md §3.
 *
 * Nothing in here executes: it is types plus small pure helpers over
 * SourceRef. Phase 0 lands the contract only — no widget reads any of this
 * yet, and no existing data-source file changes shape because of it.
 */

// ── Source descriptor ─────────────────────────────────────────────────────
// Stored at LayoutItem.config.source (see config-migration.ts). Replaces the
// ad-hoc per-widget keys (`listFile`, `budgetName`, …) as the one typed
// answer to "where does this widget's data live".
//
// Two physical shapes, not three: a source is either ONE file (`path`) or a
// FOLDER (`folder`). line-table appears in both because the Finance ledger is
// genuinely a folder (index + one file per year, see budget.ts) while a
// recurring-items style ledger is a single file — the codec, not the caller,
// decides which files inside a folder it reads. Narrow with sourcePath() /
// sourceFolder() below rather than hand-writing `'path' in src` at call sites.
export type SourceRef =
  | { codec: 'checklist';     path:   string }
  | { codec: 'line-table';    path:   string }
  | { codec: 'line-table';    folder: string }
  /**
   * `heading` scopes to ONE markdown table inside a note, because a note
   * routinely holds several: a Class-Transcript.md carries Assignments,
   * Day-by-Day Schedule and Grade Scale as three separate tables, and the
   * ledger index holds Recurring Items alongside prose. Omitted = the first
   * table in the file; present = the first table appearing after that heading.
   *
   * FIRST-MATCH is deliberate. A heading is not a unique address — a section
   * can hold two tables separated by bold text rather than a second heading —
   * so the rule is documented rather than guessed at. No data source this
   * codec actually reads is ambiguous under it.
   */
  | { codec: 'md-table';      path:   string; heading?: string }
  /**
   * `recordFile` switches the record unit from a NOTE to a FOLDER: each direct
   * child folder is one record, and its fields come from the designated note
   * inside it. That's how a class works — `Education/Classes/<slug>/` owns
   * Class-Info.md plus Tasks.md, Layout.json, Progress.md and more, so the
   * record can't be a single file. Omitted = one note per record.
   */
  | { codec: 'record-folder'; folder: string; recordFile?: string };

export type CodecId = SourceRef['codec'];

export const CODEC_IDS: CodecId[] = ['checklist', 'line-table', 'md-table', 'record-folder'];

/** The file this source is, or null when it's a folder source. */
export function sourcePath(src: SourceRef): string | null {
  return 'path' in src ? src.path : null;
}

/** The folder this source is, or null when it's a single-file source. */
export function sourceFolder(src: SourceRef): string | null {
  return 'folder' in src ? src.folder : null;
}

/** The designated note inside each record folder, when the source uses one. */
export function sourceRecordFile(src: SourceRef): string | null {
  return 'recordFile' in src ? src.recordFile ?? null : null;
}

/** The heading a table source is scoped to, when it names one. */
export function sourceHeading(src: SourceRef): string | null {
  return 'heading' in src ? src.heading ?? null : null;
}

/**
 * Stable identity string — safe as a React dep / Map key, and the source
 * cache's key.
 *
 * `recordFile` and `heading` both participate, for the same reason: they select
 * a different row set out of the same location. Without `heading` here, the
 * three tables in one Class-Transcript.md would collapse into a single cache
 * entry and every widget on that file would show whichever table was read first.
 */
export function sourceKey(src: SourceRef | null): string {
  if (!src) return '';
  if ('path' in src) {
    const h = sourceHeading(src);
    return `${src.codec}|f|${src.path}${h ? `|h|${h}` : ''}`;
  }
  const rf = sourceRecordFile(src);
  return `${src.codec}|d|${src.folder}${rf ? `|r|${rf}` : ''}`;
}

export function isSameSource(a: SourceRef | null, b: SourceRef | null): boolean {
  return sourceKey(a) === sourceKey(b);
}

/**
 * Validates an untyped value off `config.source` (data.json is hand-editable
 * and pre-migration configs won't have one at all), so every consumer gets
 * either a real SourceRef or null — never a half-shaped object.
 */
export function asSourceRef(value: unknown): SourceRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.codec !== 'string' || !CODEC_IDS.includes(v.codec as CodecId)) return null;
  if (typeof v.path === 'string' && v.path) {
    const heading = typeof v.heading === 'string' && v.heading ? v.heading : undefined;
    return { codec: v.codec, path: v.path, ...(heading ? { heading } : {}) } as SourceRef;
  }
  if (typeof v.folder === 'string' && v.folder) {
    const recordFile = typeof v.recordFile === 'string' && v.recordFile ? v.recordFile : undefined;
    return { codec: v.codec, folder: v.folder, ...(recordFile ? { recordFile } : {}) } as SourceRef;
  }
  return null;
}

/**
 * Rewrites a source onto a new path/folder, preserving the codec and any
 * qualifier that selects a subset of it (`heading`, `recordFile`).
 *
 * Preserving those is load-bearing, not tidiness: this is what useVaultData
 * calls when the watcher reports a rename, so dropping `heading` here would
 * silently turn a table-scoped source into a whole-file one the moment the user
 * renamed the note — and then persist that through onSourceMoved.
 */
export function withSourceLocation(src: SourceRef, location: string): SourceRef {
  if ('path' in src) {
    const h = sourceHeading(src);
    return { codec: src.codec, path: location, ...(h ? { heading: h } : {}) } as SourceRef;
  }
  const rf = sourceRecordFile(src);
  return { codec: src.codec, folder: location, ...(rf ? { recordFile: rf } : {}) } as SourceRef;
}

// ── Schema ────────────────────────────────────────────────────────────────
// Shipped by presets, user-extensible in settings later. Codecs use it to
// know which fields to parse/serialize; renderers use it to know what to draw
// (a table's columns, a card's fields) without hardcoding a row shape.
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';

export interface FieldDef {
  key:       string;
  label?:    string;
  type:      FieldType;
  required?: boolean;
  options?:  string[];   // for 'select'
}

// ── Rows ──────────────────────────────────────────────────────────────────
// Every codec returns rows carrying a stable id. This is the fix for today's
// "match the item by its raw text" CRUD (todos.ts setTaskDone/moveTask/…),
// which silently targets the wrong line whenever two items share text.
//
// v1 ids may be derived (line index, file path) rather than persisted — the
// contract is only that an id is stable for the lifetime of one parse, and
// that mutations are addressed by id, never by text.
export type RowId = string;

export interface CodecRow {
  id: RowId;
  /** Verbatim source text/frontmatter for this row — lets a renderer show
   *  hand-edited content it doesn't understand instead of dropping it. */
  raw?: string;
  [key: string]: unknown;
}

// ── Codec contract ────────────────────────────────────────────────────────
// How data lives on disk: parse, serialize, mutate. Zero UI, zero React.
export interface Codec<Row extends CodecRow = CodecRow> {
  id:    CodecId;
  label: string;

  read(app: App, src: SourceRef, schema: FieldDef[]): Promise<Row[]>;

  /**
   * File-level state that isn't a row: the checklist codec's bucket list and
   * Task-Manager pool, for instance. Rows alone can't express an empty bucket
   * (no rows to carry it) or which buckets are in the pool, and a widget
   * fetching that separately would need its own second watcher — the exact
   * duplication this layer exists to remove. useVaultData returns it as
   * `meta` alongside `rows`, from the same load.
   */
  readMeta?(app: App, src: SourceRef): Promise<unknown>;

  /**
   * Rows AND meta from a SINGLE pass. Optional — the source cache falls back
   * to read() + readMeta() when it's absent.
   *
   * Implement it whenever both derive from the same parse, which for a
   * single-file codec they always do: without it the cache reads and parses
   * the file twice on every load, which defeats the point of caching the parse
   * in the first place.
   */
  readAll?(app: App, src: SourceRef, schema: FieldDef[]): Promise<{ rows: Row[]; meta: unknown }>;

  add(app: App, src: SourceRef, row: Partial<Row>): Promise<void>;
  update(app: App, src: SourceRef, id: RowId, patch: Partial<Row>): Promise<void>;
  remove(app: App, src: SourceRef, id: RowId): Promise<void>;

  /** Plug-and-play scaffolding: create the file/folder if it doesn't exist. */
  ensure(app: App, src: SourceRef, template?: string): Promise<void>;

  /**
   * Which vault paths actually back this source, for the watcher. Optional —
   * useVaultData defaults to "the source's own path / folder", which is right
   * for every single-file codec. A folder source whose codec only reads a
   * couple of files inside it (the ledger's index + current year) overrides
   * this to avoid waking on every unrelated write in the folder.
   */
  watchTargets?(app: App, src: SourceRef): { paths?: string[]; folders?: string[] };
}

// ── Mutations, bound to one source ────────────────────────────────────────
// What useVaultData hands a renderer: the codec's CRUD with (app, src)
// already applied, so a renderer never sees either.
export interface BoundMutations<Row extends CodecRow = CodecRow> {
  add(row: Partial<Row>): Promise<void>;
  update(id: RowId, patch: Partial<Row>): Promise<void>;
  remove(id: RowId): Promise<void>;
  /** Force a re-read. Rarely needed — the watcher already does this. */
  reload(): Promise<void>;
}

// ── Renderer contract ─────────────────────────────────────────────────────
// How data looks and behaves. A real React component: layout, interactions,
// modals, CSS. Contains zero parsing, file I/O, or watcher wiring.
export interface RendererProps<Row extends CodecRow = CodecRow> {
  rows:    Row[];
  schema:  FieldDef[];
  mutate:  BoundMutations<Row>;
  loading: boolean;
  /** Renderer-specific knobs, supplied by the preset + widget settings. */
  options: Record<string, unknown>;
  tone:    string | undefined;
  wash:    boolean;
  /** Navigation/openFile only — NEVER vault I/O. That's the codec's job. */
  app:     App;
  /**
   * Persist a renderer-owned preference into this widget instance's config.
   *
   * For state that belongs to the VIEW rather than the data — a data-grid's
   * column widths, for instance. A markdown table has no notion of column
   * width, so it can't live in the file; it belongs to the widget looking at
   * it. Two widgets over one source can therefore differ, which is the point.
   *
   * Not a general escape hatch: anything describing the DATA belongs in the
   * file, through `mutate`. The sibling of WidgetProps.onConfigChange, which
   * component-backed widgets (Kanban's bucket colours, Meal Planner's slot
   * colours) already use for exactly this.
   */
  onOptionsChange?: (patch: Record<string, unknown>) => void;
}

export interface RendererDefinition<Row extends CodecRow = CodecRow> {
  id:     string;
  label:  string;
  /** Codecs this renderer can speak — drives the "View as…" swap list. */
  codecs: CodecId[];
  component: ComponentType<RendererProps<Row>>;
}

// ── Preset ────────────────────────────────────────────────────────────────
// What the widget library lists. DATA, not code: codec + renderer + options +
// where the data lives. Adding one is an array entry, not a new folder.

/**
 * Where a preset's data comes from. Resolved at render time rather than
 * stored as a literal path, because the Command Center root is a user setting
 * and its subfolders are numeric-prefix tolerant (see vault-paths.ts).
 */
export type PresetSource =
  /** A fixed folder under the Command Center root, e.g. ['Meetings']. */
  | { kind: 'fixed-folder'; segments: string[] }
  /** Whatever the settings modal's picker wrote into `config.source`. */
  | { kind: 'config' };

/**
 * How a widget's source gets chosen in the settings modal. Lives here rather
 * than in widgets/registry.ts because a preset declares its own picker, and
 * presets are a core contract.
 *
 * Distinct from registry.ts's legacy `FileSetupConfig`: that scans ONE fixed
 * folder and writes a legacy string key (`listFile`, `budgetName`) which the
 * migration shim then translates. These write `config.source` — the typed
 * SourceRef — directly.
 */
export interface SourcePickerConfig {
  /**
   * 'vault-folder' → a folder source; 'vault-file' → a single-file source;
   * 'vault-table' → one markdown TABLE, which is a file source plus a heading.
   *
   * 'vault-table' is the first picker that enumerates something finer-grained
   * than a file: one note routinely holds several tables, so listing notes
   * wouldn't identify a source.
   */
  kind:  'vault-folder' | 'vault-file' | 'vault-table';
  codec: CodecId;
  /** Section label, e.g. "Folder of notes" / "Checklist note". */
  label: string;
  /** Optional display-name field, written into config[configKey]. */
  nameField?: { label: string; placeholder: string; configKey: string };
  /** Show the frontmatter-key column picker (record-folder sources). */
  columns?: boolean;
  /**
   * 'vault-file' only — offer only notes whose metadata cache shows checkbox
   * items, so a Checklist widget lists checklists rather than every note in
   * the vault. Free: it's an index lookup, not a file read.
   */
  requireCheckboxes?: boolean;
  /**
   * 'vault-file' only — folder segments under the Command Center root where a
   * newly created file is written, e.g. ['checklists']. The modal only computes
   * the path; the codec's ensure() creates the file on first render.
   */
  scaffoldSegments?: string[];
}

export interface Preset {
  id:       string;
  label:    string;
  category: WidgetCategory;

  // ── Library copy ────────────────────────────────────────────────────────
  // What the Widget Library shows before this preset has been added.
  // presetDefinition() forwards all three onto the WidgetDefinition exactly
  // the way it forwards label/category, so the library reads one registry and
  // still knows nothing about presets. The preview GRAPHIC isn't here — it's
  // keyed by widget id in grid/preview-art.ts.
  /** One line, on the library card. Also what search matches against. */
  description?: string;
  /** The paragraph in the library's detail pane. */
  about?:       string;
  /** The detail pane's "Getting started" list. */
  needs?:       WidgetNeed[];

  codec:    CodecId;
  source:   PresetSource;
  /** Required when source.kind is 'config' — how the user picks it. */
  picker?:  SourcePickerConfig;
  /** Renderer id, looked up in the renderer registry. */
  renderer: string;
  /** Passed to the renderer verbatim — its own typed options bag. */
  rendererOptions?: Record<string, unknown>;
  schema?:  FieldDef[];

  /** Plug-and-play: ensure()'d with this on first load. */
  template?: string;

  /**
   * Id of a bespoke authoring flow (a "+ New…" modal) in the authoring
   * registry. Optional, and the one place a preset reaches back into code:
   * template-driven creation (meetings, recipes) is real functionality that no
   * generic "add a row" can express.
   */
  authoring?: string;

  /**
   * Id of a rich detail view in the detail registry — what opens when a row is
   * clicked, instead of the default "open the note in Obsidian".
   *
   * The sibling of `authoring`: that one owns "+ New…", this one owns "open
   * this record". A preset over a folder of recipes can open the full recipe
   * view rather than dumping the user into raw markdown, without the renderer
   * knowing anything about recipes.
   */
  detail?: string;

  defaults: {
    size:    { w: number; h: number };
    minSize: { w: number; h: number };
    tone?:   string;
  };

  classPageOnly?: boolean;
}
