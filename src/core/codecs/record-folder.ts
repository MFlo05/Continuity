import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { Codec, CodecRow, FieldDef, RowId, SourceRef } from '../types';
import { sourceFolder, sourceRecordFile } from '../types';
import { CodecError } from './checklist';

/**
 * core/codecs/record-folder.ts — the record-folder codec.
 *
 * One note per row, frontmatter = fields. The shape behind meetings, recipes
 * and (with the extension noted below) classes.
 *
 * ON-DISK: a folder of markdown notes.
 *
 *     Meetings/
 *       2026-06-26 - ERP Debrief.md     ← a row
 *       Templates/                      ← NOT a row (see below)
 *         Standup.md
 *
 * A record is a DIRECT-CHILD `.md` file. Non-recursive on purpose: it's what
 * makes `Templates/` disappear for free, with no exclusion list to configure
 * and no way for a user to accidentally surface their own templates as data.
 * Both real consumers (Meetings, Recipes) keep templates in exactly that
 * shape, so the convention was already there to be honoured.
 *
 * THREE THINGS THIS CODEC DOES THAT ITS PREDECESSORS DIDN'T:
 *
 * 1. Real ids. A row's id is its vault path — genuinely stable, unlike the
 *    checklist codec's line indices. Renaming a note changes its id, which is
 *    correct: it IS a different record location, and useVaultData's rename
 *    handling re-points the source anyway.
 *
 * 2. Frontmatter via Obsidian, not a hand-rolled parser. Reads come from
 *    `metadataCache` (already indexed, real YAML — `tags: [meeting]` arrives
 *    as an array, not the string "[meeting]" the old regex produced) and
 *    writes go through `fileManager.processFrontMatter`, the official
 *    edit-in-place API. meetings.ts's parseFrontmatter/serializeFrontmatter
 *    pair — which explicitly documented itself as write-only and unable to
 *    round-trip its own list output — is deleted.
 *
 * 3. Fields are spread onto the row. `row[key]` works for any frontmatter
 *    key, which is what lets one table renderer show any record folder
 *    without knowing a thing about meetings.
 *
 * KNOWN EXTENSION POINT — record-as-folder. Classes store their fields in
 * `Education/Classes/<slug>/Class-Info.md`: the record is the *subfolder*,
 * with a designated note inside it. That's a one-function change here
 * (`recordFiles()` would yield child folders' designated notes instead of
 * child files) plus an optional `recordFile` on the SourceRef. Deliberately
 * NOT built yet — no consumer, and speculative config keys are harder to
 * remove from persisted data than to add. Phase 2's evaluation of My Classes
 * is where that gets decided.
 */

export interface RecordRow extends CodecRow {
  /** The note's vault path — a real, stable identity. */
  id:    RowId;
  path:  string;
  /** The note's file name, without extension. */
  name:  string;
  /** Frontmatter `title`, else the record name with any date prefix stripped. */
  title: string;
  /**
   * The record's own folder — set only for `recordFile` sources, where a record
   * IS a folder. This is what lets a consumer find the record's sibling files
   * (a class's Progress.md, Class-Transcript.md, Tasks.md) without re-deriving
   * the path from the note.
   */
  folder?: string;
  /** Frontmatter `date`/`created`, else an ISO date leading the file name. */
  date:  string | null;
  /** Every frontmatter key, normalized to display strings. */
  fields: Record<string, string>;
  mtime: number;
  /** Frontmatter keys are also spread onto the row, so row[key] just works. */
  [key: string]: unknown;
}

export interface RecordFolderMeta {
  /** Union of every frontmatter key present, for column pickers. */
  fieldKeys: string[];
  count:     number;
}

// `2026-06-26 - ERP Debrief` → date + title. A leading ISO date in a filename
// is a near-universal Obsidian convention (daily notes, meeting notes,
// journals), so it's read as data rather than left as noise in the title.
const DATED_NAME_RE = /^(\d{4}-\d{2}-\d{2})\s*[-–—]?\s*(.*)$/;

function splitDatedName(basename: string): { date: string | null; title: string } {
  const m = DATED_NAME_RE.exec(basename);
  if (!m) return { date: null, title: basename };
  return { date: m[1], title: m[2].trim() || basename };
}

/** Frontmatter values arrive as real YAML types; flatten for display. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return '';
  return String(value).trim();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function firstDateLike(fields: Record<string, unknown>): string | null {
  for (const key of ['date', 'created']) {
    const raw = displayValue(fields[key]);
    if (ISO_DATE_RE.test(raw)) return raw.slice(0, 10);
  }
  return null;
}

/**
 * The note backing each record.
 *
 * Default: direct-child `.md` files — which is what makes `Templates/` vanish
 * without an exclusion list.
 *
 * With `recordFile` set, the record unit is a child FOLDER and its fields come
 * from the designated note inside it (`<child>/Class-Info.md`). A record that
 * owns several files — a class folder also holds Tasks.md, Layout.json,
 * Progress.md — can't be represented as a single note, and archiving it moves
 * the whole folder, which is exactly why it's modelled this way.
 */
function recordFiles(app: App, src: SourceRef): TFile[] {
  const path = sourceFolder(src);
  if (!path) return [];
  const folder = app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder)) return [];

  const recordFile = sourceRecordFile(src);
  if (recordFile) {
    return folder.children
      .filter((c): c is TFolder => c instanceof TFolder)
      .map(sub => app.vault.getAbstractFileByPath(`${sub.path}/${recordFile}`))
      .filter((f): f is TFile => f instanceof TFile);
  }

  return folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
}

function buildRow(app: App, file: TFile, isFolderRecord: boolean): RecordRow {
  const raw = app.metadataCache.getFileCache(file)?.frontmatter ?? {};

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'position') continue;   // metadataCache's own internal key
    fields[key] = displayValue(value);
  }

  // For a folder-record the identity is the FOLDER's name (a class's slug) —
  // every one of them would otherwise be called "Class-Info".
  const recordFolder = isFolderRecord ? file.parent?.path : undefined;
  const recordName   = isFolderRecord ? (file.parent?.name ?? file.basename) : file.basename;

  const fromName = splitDatedName(recordName);

  // Frontmatter wins over the filename for both — it's the explicit
  // statement, the filename is a convention. For notes that carry both and
  // agree (the normal case) this is indistinguishable either way.
  const title = fields.title || fromName.title;
  const date  = firstDateLike(raw) ?? fromName.date;

  return {
    // Spread first so a reserved key below always wins — a note with
    // `path:` in its frontmatter must not be able to break row identity.
    ...fields,
    id:    file.path,
    path:  file.path,
    name:  recordName,
    ...(recordFolder ? { folder: recordFolder } : {}),
    title, date, fields,
    mtime: file.stat.mtime,
  };
}

/**
 * Newest first, name as the tiebreak — a sensible default for dated records.
 * A renderer that wants another order sorts the rows itself; this only has to
 * be stable.
 */
function sortRows(rows: RecordRow[]): RecordRow[] {
  return rows.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.name.localeCompare(b.name);
  });
}

function sanitizeForFilename(s: string): string {
  return s.trim().replace(/[/\\:*?"<>|#^[\]]/g, '-').slice(0, 60).trim();
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  await app.vault.createFolder(path).catch(() => { /* race with another creator — fine */ });
}

function fileFor(app: App, id: RowId): TFile | null {
  const f = app.vault.getAbstractFileByPath(id);
  return f instanceof TFile ? f : null;
}

export interface RecordFolderCodec extends Codec<RecordRow> {
  readMeta(app: App, src: SourceRef): Promise<RecordFolderMeta>;
}

export const recordFolderCodec: RecordFolderCodec = {
  id:    'record-folder',
  label: 'Folder of notes',

  async read(app: App, src: SourceRef, _schema: FieldDef[]): Promise<RecordRow[]> {
    const folderRecord = !!sourceRecordFile(src);
    return sortRows(recordFiles(app, src).map(f => buildRow(app, f, folderRecord)));
  },

  /**
   * One walk of the folder for both rows and field keys — read() + readMeta()
   * would otherwise build every row's frontmatter twice per load.
   */
  async readAll(app: App, src: SourceRef, _schema: FieldDef[]) {
    const folderRecord = !!sourceRecordFile(src);
    const rows = sortRows(recordFiles(app, src).map(f => buildRow(app, f, folderRecord)));
    const keys = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row.fields)) keys.add(key);
    return { rows, meta: { fieldKeys: [...keys].sort(), count: rows.length } };
  },

  async readMeta(app: App, src: SourceRef): Promise<RecordFolderMeta> {
    const files = recordFiles(app, src);
    const keys = new Set<string>();
    for (const file of files) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      for (const key of Object.keys(fm)) if (key !== 'position') keys.add(key);
    }
    return { fieldKeys: [...keys].sort(), count: files.length };
  },

  async ensure(app: App, src: SourceRef): Promise<void> {
    const folder = sourceFolder(src);
    if (folder) await ensureFolder(app, folder);
  },

  async add(app: App, src: SourceRef, row: Partial<RecordRow>): Promise<void> {
    const folder = sourceFolder(src);
    if (!folder) throw new CodecError('No folder configured.');
    await ensureFolder(app, folder);

    const title = String(row.title ?? '').trim();
    if (!title) throw new CodecError('Title is required.');

    const date = typeof row.date === 'string' && ISO_DATE_RE.test(row.date) ? row.date : null;
    const base = sanitizeForFilename(date ? `${date} - ${title}` : title);
    const recordFile = sourceRecordFile(src);

    // A folder-record is created as a FOLDER holding the designated note; a
    // note-record is just the note.
    let name = base;
    let path = recordFile ? `${folder}/${name}/${recordFile}` : `${folder}/${name}.md`;
    for (let n = 2; app.vault.getAbstractFileByPath(recordFile ? `${folder}/${name}` : path); n++) {
      name = `${base} (${n})`;
      path = recordFile ? `${folder}/${name}/${recordFile}` : `${folder}/${name}.md`;
    }
    if (recordFile) await ensureFolder(app, `${folder}/${name}`);

    const file = await app.vault.create(path, `# ${title}\n`);

    // Everything that isn't derived/reserved becomes frontmatter.
    const skip = new Set(['id', 'path', 'name', 'title', 'date', 'fields', 'mtime', 'raw', 'folder']);
    const extra = Object.entries(row).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== '');
    if (extra.length) {
      await app.fileManager.processFrontMatter(file, fm => {
        for (const [k, v] of extra) fm[k] = v;
      });
    }
  },

  async update(app: App, src: SourceRef, id: RowId, patch: Partial<RecordRow>): Promise<void> {
    const file = fileFor(app, id);
    if (!file) return;   // deleted underneath us — the reload will show truth

    // Frontmatter edits only. Renaming on a title change is deliberately NOT
    // done here: a note's filename is user-owned and may be linked from
    // elsewhere in the vault, so moving it is a decision a renderer has to
    // make explicitly, not a side effect of editing a field.
    const skip = new Set(['id', 'path', 'name', 'fields', 'mtime', 'raw']);
    const entries = Object.entries(patch).filter(([k]) => !skip.has(k));
    if (!entries.length) return;

    await app.fileManager.processFrontMatter(file, fm => {
      for (const [k, v] of entries) {
        if (v === undefined || v === '') delete fm[k];
        else fm[k] = v;
      }
    });
  },

  async remove(app: App, src: SourceRef, id: RowId): Promise<void> {
    const file = fileFor(app, id);
    if (!file) return;

    // For a folder-record, the record IS the folder — trashing only the
    // designated note would leave the class's Tasks.md, Progress.md and
    // Layout.json orphaned in a folder that no longer lists as a record.
    const target = sourceRecordFile(src) && file.parent ? file.parent : file;

    // trashFile, not vault.delete — honours the user's "deleted files"
    // preference (system trash / .trash / permanent) instead of overriding it.
    await app.fileManager.trashFile(target);
  },

  watchTargets(_app: App, src: SourceRef) {
    const folder = sourceFolder(src);
    return folder ? { folders: [folder] } : {};
  },
};
