import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { Codec, CodecRow, FieldDef, RowId, SourceRef } from '../types';
import { sourcePath } from '../types';

/**
 * core/codecs/checklist.ts — the checklist codec.
 *
 * Promoted from data-sources/todos.ts (parser + CRUD) and data-sources/
 * groceries.ts (a strictly flatter dialect of the same thing). One format,
 * one parser, one writer, for every `- [ ]` file in the vault: TODO lists,
 * Kanban boards, Task Manager's pool, per-class Tasks.md, grocery lists.
 *
 * ON-DISK FORMAT — unchanged, byte for byte:
 *
 *     ---
 *     cc2-active-buckets: ["Active"]
 *     ---
 *     ## Active
 *     - [ ] Ship the thing #work [due:: 2026-08-01]
 *     - [x] Already done
 *     ## On Hold
 *
 * Buckets are `## ` headers; items are checkbox lines beneath one. A file
 * with no headers at all (every grocery list) puts its items in the implicit
 * root bucket `''`, which is what lets one codec serve both shapes.
 *
 * THREE DELIBERATE IMPROVEMENTS over what it replaces:
 *
 * 1. Stable row ids. Every mutation today matches its target by raw text
 *    (`setTaskDone(app, file, item.text, bucket, done)`), which silently hits
 *    the wrong line whenever two items share text. Rows now carry an id and
 *    mutations address that. Per the handoff, v1 ids are line indices —
 *    stable for the lifetime of one parse, not persisted — and every mutation
 *    re-verifies the target line still looks like the row it was addressed
 *    to, no-op'ing rather than writing to a line that moved underneath it.
 *
 * 2. Frontmatter is preserved, not rewritten. The old writers rebuilt the
 *    whole block from `cc2-active-buckets` alone, silently deleting any other
 *    key the user had put there. Now the block round-trips verbatim and only
 *    that one line is touched — and a file that had no frontmatter doesn't
 *    grow one, which is what keeps grocery lists clean.
 *
 * 3. Inline fields. `[key:: value]` (Dataview-compatible, per handoff §1.4)
 *    parses into `row.fields`, generalizing the old `#tag`-only extraction.
 *    `#tag` keeps working exactly as before and still lands in `row.project`.
 */

// ── Row shape ─────────────────────────────────────────────────────────────

export interface ChecklistRow extends CodecRow {
  id:     RowId;
  /** Verbatim text after the checkbox marker — the round-trip source. */
  text:   string;
  done:   boolean;
  /** `## Header` this row sits under; '' for a header-less (grocery) file. */
  bucket: string;
  /** Whether that bucket is in the file's Task Manager pool. */
  bucketActive: boolean;
  /** `text` minus #tags and [key:: value] pairs — what a renderer shows. */
  displayText: string;
  /** First #tag, the long-standing project shorthand. */
  project: string | null;
  /** Parsed [key:: value] inline fields. */
  fields: Record<string, string>;
}

export interface ChecklistBucket {
  name:   string;
  /** In the file's `cc2-active-buckets` frontmatter list. */
  active: boolean;
  count:  number;
  doneCount: number;
}

export interface ChecklistMeta {
  buckets: ChecklistBucket[];
  activeBucketNames: string[];
  /** True when the file has no `## ` headers at all (grocery-style). */
  flat: boolean;
}

/** Thrown for user-correctable problems; widgets surface `.message` inline. */
export class CodecError extends Error {}

/**
 * Seed content for a new multi-bucket checklist file. The two starter buckets
 * aren't special — nothing protects them, and either can be renamed or
 * deleted like any user-created one.
 */
export const TODO_TEMPLATE = '## Active\n\n## On Hold\n';

/** Seed for a flat, header-less checklist (grocery lists) — nothing at all. */
export const FLAT_TEMPLATE = '';

// ── Parsing ───────────────────────────────────────────────────────────────

const FM_RE      = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADER_RE  = /^##\s+(.+)$/;
const DONE_RE    = /^- \[x\] (.+)$/i;
const TODO_RE    = /^- \[ \] (.+)$/;
// Raw (un-trimmed) form, for writing back in place with indentation intact.
const CHECK_LINE_RE = /^(\s*- \[)([ xX])(\] )(.*?)(\s*)$/;

const INLINE_FIELD_RE = /\[([A-Za-z][\w-]*)::\s*([^\]]*)\]/g;
const TAG_RE          = /#([\w-]+)/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Narrow reader for the one flow-style YAML list we write. Inherited from
 * todos.ts verbatim, including its fallback: a hand-edited multi-line list
 * degrades to the default rather than throwing (handoff §1.4).
 */
function readActiveBuckets(inner: string): string[] {
  const listMatch = /^cc2-active-buckets:\s*\[(.*)\]\s*$/m.exec(inner);
  if (!listMatch) return ['Active'];
  const names = listMatch[1]
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return names.length ? names : ['Active'];
}

interface SplitFile {
  /** The frontmatter block verbatim, delimiters included; null if absent. */
  frontmatter: string | null;
  activeBucketNames: string[];
  body: string;
}

function splitFile(content: string): SplitFile {
  const block = FM_RE.exec(content);
  if (!block) return { frontmatter: null, activeBucketNames: ['Active'], body: content };
  return {
    frontmatter:       block[0],
    activeBucketNames: readActiveBuckets(block[1]),
    body:              content.slice(block[0].length),
  };
}

/**
 * Rewrites only the cc2-active-buckets line, leaving every other key in the
 * block alone. Creates a block when there wasn't one — the sole path by which
 * a checklist file ever gains frontmatter.
 */
function writeActiveBuckets(frontmatter: string | null, names: string[]): string {
  const line = `cc2-active-buckets: [${names.map(n => `"${n.replace(/"/g, '\\"')}"`).join(', ')}]`;
  if (!frontmatter) return `---\n${line}\n---\n`;

  const inner = FM_RE.exec(frontmatter)?.[1] ?? '';
  const next  = /^cc2-active-buckets:.*$/m.test(inner)
    ? inner.replace(/^cc2-active-buckets:.*$/m, line)
    : (inner ? `${inner}\n${line}` : line);
  return `---\n${next}\n---\n`;
}

/** Splits `#tag` and `[key:: value]` off an item's text for display. */
export function parseItemText(raw: string): {
  displayText: string; project: string | null; fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  let stripped = raw.replace(INLINE_FIELD_RE, (_m, key: string, value: string) => {
    fields[key] = value.trim();
    return '';
  });

  const tag = TAG_RE.exec(stripped);
  stripped = stripped.replace(/#[\w-]+/g, '');

  return {
    displayText: stripped.replace(/\s{2,}/g, ' ').trim(),
    project:     tag ? tag[1] : null,
    fields,
  };
}

interface ParsedChecklist {
  split: SplitFile;
  lines: string[];
  rows:  ChecklistRow[];
  meta:  ChecklistMeta;
}

export function parseChecklist(content: string): ParsedChecklist {
  const split = splitFile(content);
  const lines = split.body.split('\n');
  const active = new Set(split.activeBucketNames);

  const rows: ChecklistRow[] = [];
  const buckets: ChecklistBucket[] = [];
  let current = '';
  let sawHeader = false;

  lines.forEach((line, index) => {
    const t = line.trim();

    const header = HEADER_RE.exec(t);
    if (header) {
      current = header[1].trim();
      sawHeader = true;
      buckets.push({ name: current, active: active.has(current), count: 0, doneCount: 0 });
      return;
    }

    const done = DONE_RE.exec(t);
    const todo = TODO_RE.exec(t);
    const m    = done ?? todo;
    if (!m) return;

    const text = m[1];
    const { displayText, project, fields } = parseItemText(text);
    rows.push({
      id:     String(index),
      text,
      done:   !!done,
      bucket: current,
      bucketActive: active.has(current),
      displayText, project, fields,
      raw:    line,
    });

    const bucket = buckets.find(b => b.name === current);
    if (bucket) { bucket.count++; if (done) bucket.doneCount++; }
  });

  return {
    split, lines, rows,
    meta: { buckets, activeBucketNames: split.activeBucketNames, flat: !sawHeader },
  };
}

// ── Line-level helpers (operate on body lines) ────────────────────────────

/**
 * Locates a bucket's line span: its header line, up to (not including) the
 * next `## ` header or EOF. The implicit root bucket spans from the top of
 * the file to the first header.
 */
function bucketRange(lines: string[], name: string): { start: number; end: number } | null {
  if (name === '') {
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i].trim())) { end = i; break; }
    }
    return { start: -1, end };
  }

  const headerRe = new RegExp(`^##\\s+${escapeRegex(name)}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i].trim())) { start = i; break; }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) { end = i; break; }
  }
  return { start, end };
}

/**
 * Re-locates the row a mutation was addressed to. The id is a line index from
 * the parse the caller was looking at; between that read and this write the
 * file may have changed (another pane, a sync). So: re-parse, take the row at
 * that index, and hand it back only if it's still a checkbox line. A caller
 * that also knows the expected text gets it verified — otherwise a moved line
 * makes the mutation a no-op and the widget's own reload shows the truth,
 * which is strictly safer than the text-matching it replaces.
 */
function rowAt(parsed: ParsedChecklist, id: RowId, expectRaw?: string): ChecklistRow | null {
  const row = parsed.rows.find(r => r.id === id);
  if (!row) return null;
  if (expectRaw !== undefined && row.raw !== expectRaw) return null;
  return row;
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
  fn: (parsed: ParsedChecklist) => { lines?: string[]; frontmatter?: string | null } | null,
): Promise<void> {
  const file = fileFor(app, src);
  if (!file) return;

  await app.vault.process(file, content => {
    const parsed = parseChecklist(content);
    const result = fn(parsed);
    if (!result) return content;   // no-op: target vanished or moved

    const frontmatter = result.frontmatter !== undefined
      ? result.frontmatter
      : parsed.split.frontmatter;
    const lines = result.lines ?? parsed.lines;
    return (frontmatter ?? '') + lines.join('\n');
  });
}

// ── The codec ─────────────────────────────────────────────────────────────

export interface ChecklistCodec extends Codec<ChecklistRow> {
  readMeta(app: App, src: SourceRef): Promise<ChecklistMeta>;

  /** Moves a row to the bottom of another bucket, preserving checked state. */
  moveRow(app: App, src: SourceRef, id: RowId, destBucket: string, expectRaw?: string): Promise<void>;

  addBucket(app: App, src: SourceRef, name: string, includeInTaskManager: boolean): Promise<void>;
  deleteBucket(app: App, src: SourceRef, name: string): Promise<void>;
  setBucketActive(app: App, src: SourceRef, name: string, active: boolean): Promise<void>;

  /** Removes every checked row (optionally only within one bucket). */
  clearDone(app: App, src: SourceRef, bucket?: string): Promise<void>;
}

export const checklistCodec: ChecklistCodec = {
  id:    'checklist',
  label: 'Checklist',

  async read(app: App, src: SourceRef, _schema: FieldDef[]): Promise<ChecklistRow[]> {
    const file = fileFor(app, src);
    if (!file) return [];
    // cachedRead, not read: this is a display path, and Obsidian keeps the
    // content hot. Mutations go through vault.process, which reads fresh.
    return parseChecklist(await app.vault.cachedRead(file)).rows;
  },

  async readMeta(app: App, src: SourceRef): Promise<ChecklistMeta> {
    const file = fileFor(app, src);
    if (!file) return { buckets: [], activeBucketNames: ['Active'], flat: true };
    return parseChecklist(await app.vault.cachedRead(file)).meta;
  },

  /**
   * Rows and buckets come from the same parse, so hand back both — the source
   * cache would otherwise call read() and readMeta() separately and parse the
   * file twice on every load.
   */
  async readAll(app: App, src: SourceRef, _schema: FieldDef[]) {
    const file = fileFor(app, src);
    if (!file) {
      return { rows: [] as ChecklistRow[], meta: { buckets: [], activeBucketNames: ['Active'], flat: true } };
    }
    const parsed = parseChecklist(await app.vault.cachedRead(file));
    return { rows: parsed.rows, meta: parsed.meta };
  },

  async ensure(app: App, src: SourceRef, template = ''): Promise<void> {
    const path = sourcePath(src);
    if (!path || app.vault.getAbstractFileByPath(path)) return;

    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
    await app.vault.create(path, template);
  },

  async add(app: App, src: SourceRef, row: Partial<ChecklistRow>): Promise<void> {
    const text = (row.text ?? '').trim();
    if (!text) throw new CodecError('Task text is required.');
    const bucket = row.bucket ?? '';
    const marker = row.done ? 'x' : ' ';

    if (!fileFor(app, src)) throw new CodecError('List file not found.');

    let failed: string | null = null;
    await edit(app, src, parsed => {
      const lines = [...parsed.lines];

      // The implicit root bucket has no header to insert under — append at
      // the end of the file, which is what every grocery add has always done.
      if (bucket === '') {
        const trimmed = lines.join('\n').replace(/\n+$/, '');
        const next = trimmed ? `${trimmed}\n- [${marker}] ${text}\n` : `- [${marker}] ${text}\n`;
        return { lines: next.split('\n') };
      }

      const range = bucketRange(lines, bucket);
      if (!range) { failed = 'Bucket not found.'; return null; }
      lines.splice(range.end, 0, `- [${marker}] ${text}`);
      return { lines };
    });
    if (failed) throw new CodecError(failed);
  },

  async update(app: App, src: SourceRef, id: RowId, patch: Partial<ChecklistRow>): Promise<void> {
    await edit(app, src, parsed => {
      const row = rowAt(parsed, id, patch.raw);
      if (!row) return null;

      const lines = [...parsed.lines];
      const m = CHECK_LINE_RE.exec(lines[Number(id)]);
      if (!m) return null;

      const mark = patch.done === undefined ? m[2] : (patch.done ? 'x' : ' ');
      const text = patch.text === undefined ? m[4] : patch.text.trim();
      if (!text) return null;

      lines[Number(id)] = `${m[1]}${mark}${m[3]}${text}`;
      return { lines };
    });
  },

  async remove(app: App, src: SourceRef, id: RowId): Promise<void> {
    await edit(app, src, parsed => {
      if (!rowAt(parsed, id)) return null;
      const lines = [...parsed.lines];
      lines.splice(Number(id), 1);
      return { lines };
    });
  },

  async moveRow(app: App, src: SourceRef, id: RowId, destBucket: string, expectRaw?: string): Promise<void> {
    await edit(app, src, parsed => {
      const row = rowAt(parsed, id, expectRaw);
      if (!row || row.bucket === destBucket) return null;

      const lines = [...parsed.lines];
      const [moved] = lines.splice(Number(id), 1);
      const dest = bucketRange(lines, destBucket);
      if (!dest) return null;   // destination vanished concurrently
      lines.splice(dest.end, 0, moved);
      return { lines };
    });
  },

  async addBucket(app: App, src: SourceRef, name: string, includeInTaskManager: boolean): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new CodecError('Bucket name is required.');
    if (/[#[\]\n]/.test(trimmed)) throw new CodecError("Bucket name can't contain #, [, ], or a line break.");
    if (!fileFor(app, src)) throw new CodecError('List file not found.');

    let failed: string | null = null;
    await edit(app, src, parsed => {
      const exists = parsed.meta.buckets.some(b => b.name.toLowerCase() === trimmed.toLowerCase());
      if (exists) { failed = 'A bucket with that name already exists.'; return null; }

      const body  = parsed.lines.join('\n').replace(/\n+$/, '');
      const lines = `${body}\n\n## ${trimmed}\n`.split('\n');

      const names = includeInTaskManager
        ? [...new Set([...parsed.split.activeBucketNames, trimmed])]
        : null;

      return {
        lines,
        frontmatter: names ? writeActiveBuckets(parsed.split.frontmatter, names) : undefined,
      };
    });
    if (failed) throw new CodecError(failed);
  },

  async deleteBucket(app: App, src: SourceRef, name: string): Promise<void> {
    await edit(app, src, parsed => {
      const lines = [...parsed.lines];
      const range = bucketRange(lines, name);
      if (!range || range.start === -1) return null;

      lines.splice(range.start, range.end - range.start);
      const remaining = parsed.split.activeBucketNames.filter(n => n !== name);

      // Only rewrite frontmatter if this bucket was actually listed in it —
      // otherwise a file with no frontmatter would grow one on every delete.
      const listed = parsed.split.activeBucketNames.includes(name);
      return { lines, frontmatter: listed ? writeActiveBuckets(parsed.split.frontmatter, remaining) : undefined };
    });
  },

  async setBucketActive(app: App, src: SourceRef, name: string, active: boolean): Promise<void> {
    await edit(app, src, parsed => {
      const names = active
        ? [...new Set([...parsed.split.activeBucketNames, name])]
        : parsed.split.activeBucketNames.filter(n => n !== name);
      return { frontmatter: writeActiveBuckets(parsed.split.frontmatter, names) };
    });
  },

  async clearDone(app: App, src: SourceRef, bucket?: string): Promise<void> {
    await edit(app, src, parsed => {
      const doomed = new Set(
        parsed.rows
          .filter(r => r.done && (bucket === undefined || r.bucket === bucket))
          .map(r => Number(r.id)),
      );
      if (doomed.size === 0) return null;
      return { lines: parsed.lines.filter((_line, i) => !doomed.has(i)) };
    });
  },

  watchTargets(_app: App, src: SourceRef) {
    const path = sourcePath(src);
    return path ? { paths: [path] } : {};
  },
};
