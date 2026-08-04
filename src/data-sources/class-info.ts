import { App, TFile, TFolder } from 'obsidian';
import { resolveCommandCenterPath } from './vault-paths';
import { deleteSeriesBlocksForClass } from './class-schedule';
import { subscribeVault, recordFolderCodec } from '../core';
import { todayISO } from '../core/dates';
import type { RecordRow, SourceRef } from '../core';

// The one shared "truth" data source for the Education suite — every other
// widget (Scheduler, My Teachers, Class Notes, Fullscreen) reads classes
// through listClasses()/readClassInfo() rather than scanning Education/Classes
// itself, so archiving/renaming a class only has to be taught to this one file.

export function classesFolder(app: App): string {
  return resolveCommandCenterPath(app, 'Education', 'Classes');
}
export function archivedClassesFolder(app: App): string {
  return resolveCommandCenterPath(app, 'Education', 'Archived');
}
export function classFolderPath(app: App, slug: string): string {
  return `${classesFolder(app)}/${slug}`;
}
export function classInfoPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Class-Info.md`;
}
export function classTranscriptPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Class-Transcript.md`;
}
// A plain todos.ts TodoFile living inside the class's own folder — passed
// directly as todos.ts's `listFile` param (todoFilePath() treats any path
// containing "/" as already-resolved, see todos.ts's own comment), so
// reading/writing a class's tasks needs no new data source at all. Also
// means archiving a class (which moves its whole folder) carries this file
// along automatically, with zero extra code.
export function classTasksPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Tasks.md`;
}

export interface ClassInfoFields {
  slug:         string;
  code:         string;
  name:         string;
  teacher?:     string;
  teacherEmail?: string;
  room?:        string;   // e.g. "Bldg 4, Room 212" — shown on the card and on Scheduler blocks
  officeHours?: string;   // free text, e.g. "By appointment" — not a schedulable weekly slot
  officeLocation?: string;
  grade?:       string;   // manual override, e.g. "91%" — takes priority over a computed grade
  color?:       string;   // tone id (e.g. "sage") — absent = Paper default
  gradeMode?:   'assignment' | 'category'; // absent = 'assignment', today's only behavior
  archived:     boolean;
  hasTranscript: boolean; // derived: Class-Transcript.md exists alongside this file
}

// AssignmentRow doubles as the grading breakdown — a real syllabus's own
// assignments table already has name/date/weight in one place, so a
// separate weight-only "grading breakdown" table (this used to be a
// GradingRow[] here) was redundant. `score` is NOT persisted here — it
// lives in class-progress.ts's Progress.md instead (alongside status,
// linked resources, and linked notes), since this file gets fully
// regenerated on every (re-)import and would otherwise wipe a student's own
// entered state.
//
// `worth` and `category` both always exist regardless of the class's
// gradeMode — only one is ever meaningful at a time (worth in 'assignment'
// mode, category in 'category' mode), which is exactly what makes switching
// gradeMode non-destructive: nothing is ever deleted off a row, the other
// field just goes unused until you switch back.
export interface AssignmentRow {
  item:       string;
  dateOrWeek: string;   // ISO date, or '' for a "varies"/no-fixed-date cluster
  worth:      string;   // e.g. "10%" — meaningful in 'assignment' gradeMode
  category?:  string;   // e.g. "Homework" — meaningful in 'category' gradeMode
  score?:     string;   // populated at read time from Progress.md, not stored in this table
}

// Multiple rows MAY share the same dateOrWeek — a real day-by-day syllabus
// section often lists several topics for one date, not one topic per date.
export interface ScheduleRow {
  dateOrWeek: string;
  topic:      string;
  done?:      boolean;  // populated at read time from Progress.md, not stored in this table
  noteLink?:  string;   // set once a note's been created from this topic (see class-progress.ts)
}

// Optional — present only when the source syllabus actually had a letter
// grade scale (95-100 = A+, etc., a real, common syllabus section).
export interface GradeScaleRow { min: number; max: number; letter: string; }

export interface ClassTranscript {
  generated:   string;
  source:      'AI import' | 'Manual entry';
  assignments: AssignmentRow[];
  schedule:    ScheduleRow[];
  gradeScale?: GradeScaleRow[];
}

// ── Frontmatter — narrow, hand-rolled, duplicated from recipes.ts/meetings.ts
// rather than shared (each data-source file owns its own parser scoped to
// exactly what it writes — the accepted convention across this codebase). ──

// Un-escapes a value this file itself wrote via yamlValue() below. Handles
// both a properly double-quoted+escaped value and the old bare single-char
// quote-stripping this used to do (kept as a fallback so files written
// before this hardening pass still read back the same as always).
function unquoteValue(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  return v.replace(/^['"]|['"]$/g, '');
}

function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!block) return { fields: {}, body: content };
  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    fields[kv[1].trim()] = unquoteValue(kv[2]);
  }
  return { fields, body: content.slice(block[0].length) };
}

// Real syllabus content routinely contains a colon or an apostrophe in a
// course title or teacher name (e.g. "Introduction à l'enseignement: et
// stage d'orientation") — left bare, a `: ` sequence inside a YAML scalar
// looks like a nested mapping key to Obsidian's own metadata-cache YAML
// parser (not just this file's own reader), which can flag the frontmatter
// block as malformed. Quote-wrap (with proper backslash/quote escaping)
// whenever a value isn't safe to leave bare; everything else stays
// unquoted exactly as before, so existing simple values don't change shape.
function needsYamlQuoting(v: string): boolean {
  return v === '' || /:(\s|$)/.test(v) || /^[\s"'#\-?:,[\]{}&*!|>%@`]/.test(v) || /\s$/.test(v) || v.includes('\n') || v.includes('"');
}

function yamlValue(v: string): string {
  if (!needsYamlQuoting(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function serializeFrontmatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${yamlValue(v)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function setOrDelete(fields: Record<string, string>, key: string, value: string | undefined): void {
  if (value) fields[key] = value; else delete fields[key];
}

// "CHEM 101" -> "CHEM-101" — folder-safe, stable identity used everywhere
// else in the suite (Class-Schedule.md's classId, Class-Tasks.md's #tag).
function slugify(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}

function fieldsToClassInfo(slug: string, fields: Record<string, string>, hasTranscript: boolean): ClassInfoFields {
  return {
    slug,
    code:         fields['cc2-code'] ?? slug,
    name:         fields['cc2-name'] ?? '',
    teacher:      fields['cc2-teacher'] || undefined,
    teacherEmail: fields['cc2-teacher-email'] || undefined,
    room:         fields['cc2-room'] || undefined,
    officeHours:  fields['cc2-office-hours'] || undefined,
    officeLocation: fields['cc2-office-location'] || undefined,
    grade:        fields['cc2-grade'] || undefined,
    color:        fields['cc2-color'] || undefined,
    gradeMode:    fields['cc2-grade-mode'] === 'category' ? 'category' : undefined,
    archived:     fields['cc2-archived'] === 'true',
    hasTranscript,
  };
}

/**
 * A classes root as a typed source. `recordFile` is what makes a class folder —
 * not a note — the record unit: a class owns Class-Info.md plus Tasks.md,
 * Layout.json, Progress.md and more, and archiving moves the whole folder.
 */
export function classesSource(app: App): SourceRef {
  return { codec: 'record-folder', folder: classesFolder(app), recordFile: 'Class-Info.md' };
}
export function archivedClassesSource(app: App): SourceRef {
  return { codec: 'record-folder', folder: archivedClassesFolder(app), recordFile: 'Class-Info.md' };
}

/**
 * Maps a codec row onto the suite's typed shape. `hasTranscript` is the
 * two-layer part — a sibling-file existence check the codec doesn't (and
 * shouldn't) know about, resolved off the row's own `folder`.
 */
export function rowToClassInfo(app: App, row: RecordRow): ClassInfoFields {
  const folderPath = typeof row.folder === 'string' ? row.folder : '';
  const hasTranscript = app.vault.getAbstractFileByPath(`${folderPath}/Class-Transcript.md`) instanceof TFile;
  return fieldsToClassInfo(row.name, row.fields, hasTranscript);
}

export async function readClassInfo(app: App, slug: string): Promise<ClassInfoFields | null> {
  const all = await recordFolderCodec.read(app, classesSource(app), []);
  const row = all.find(r => r.name === slug)
    ?? (await recordFolderCodec.read(app, archivedClassesSource(app), [])).find(r => r.name === slug);
  return row ? rowToClassInfo(app, row) : null;
}

/**
 * Scans Classes/ (and Archived/ too, when includeArchived) — the one place
 * every other Education widget reads class data through, so nothing else in
 * the suite scans these folders itself.
 *
 * Reads through the record-folder codec now: the folder walk, the frontmatter
 * parse and the caching all belong to shared machinery, so the ~6 widgets that
 * call this share one read instead of each doing their own.
 */
export async function listClasses(app: App, opts?: { includeArchived?: boolean }): Promise<ClassInfoFields[]> {
  const sources = [classesSource(app)];
  if (opts?.includeArchived) sources.push(archivedClassesSource(app));

  const out: ClassInfoFields[] = [];
  for (const src of sources) {
    for (const row of await recordFolderCodec.read(app, src, [])) {
      out.push(rowToClassInfo(app, row));
    }
  }
  return out;
}

export async function createClass(
  app: App, code: string, name: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const trimmedCode = code.trim();
  const trimmedName = name.trim();
  if (!trimmedCode) return { ok: false, error: 'Class code is required.' };

  const slug = slugify(trimmedCode);
  if (!slug) return { ok: false, error: 'Class code must contain letters or numbers.' };

  const folderPath = classFolderPath(app, slug);
  if (app.vault.getAbstractFileByPath(folderPath)) {
    return { ok: false, error: 'A class with that code already exists.' };
  }

  const root = classesFolder(app);
  if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root);
  await app.vault.createFolder(folderPath);

  const fields: Record<string, string> = {
    'cc2-code':     trimmedCode,
    'cc2-name':     trimmedName || trimmedCode,
    'cc2-archived': 'false',
  };
  await app.vault.create(classInfoPath(app, slug), serializeFrontmatter(fields, `\n# ${trimmedName || trimmedCode}\n`));
  return { ok: true, slug };
}

// Merge-write — preserves unknown frontmatter keys (e.g. ones a future field
// or the AI import skill adds) instead of clobbering the whole block. Pass an
// empty string to clear a field; omit the key entirely to leave it untouched.
export async function writeClassInfo(app: App, slug: string, patch: Partial<ClassInfoFields>): Promise<void> {
  const file = app.vault.getAbstractFileByPath(classInfoPath(app, slug));
  if (!(file instanceof TFile)) return;

  await app.vault.process(file, content => {
    const { fields, body } = parseFrontmatter(content);
    if (patch.code !== undefined)         fields['cc2-code'] = patch.code;
    if (patch.name !== undefined)         fields['cc2-name'] = patch.name;
    if (patch.teacher !== undefined)      setOrDelete(fields, 'cc2-teacher', patch.teacher);
    if (patch.teacherEmail !== undefined) setOrDelete(fields, 'cc2-teacher-email', patch.teacherEmail);
    if (patch.room !== undefined)         setOrDelete(fields, 'cc2-room', patch.room);
    if (patch.officeHours !== undefined)  setOrDelete(fields, 'cc2-office-hours', patch.officeHours);
    if (patch.officeLocation !== undefined) setOrDelete(fields, 'cc2-office-location', patch.officeLocation);
    if (patch.grade !== undefined)        setOrDelete(fields, 'cc2-grade', patch.grade);
    if (patch.color !== undefined)        setOrDelete(fields, 'cc2-color', patch.color);
    if (patch.gradeMode !== undefined)    setOrDelete(fields, 'cc2-grade-mode', patch.gradeMode === 'category' ? 'category' : undefined);
    if (patch.archived !== undefined)     fields['cc2-archived'] = String(patch.archived);
    return serializeFrontmatter(fields, body);
  });
}

// Moves the whole class folder from Classes/<slug> to Archived/<slug>
// (link-preserving rename, not a raw vault move) and stamps archived:true —
// stamped BEFORE the move, while Class-Info.md still resolves under
// Classes/, since writeClassInfo's path assumes that location. Also prunes
// every Class Scheduler series block tied to this class, so an archived
// class's recurring sessions disappear from the scheduler too — My Teachers
// needs no equivalent cascade, since it re-derives from listClasses() on
// every reload instead of holding its own separate reference to a class.
export async function archiveClass(app: App, slug: string): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(classFolderPath(app, slug));
  if (!(folder instanceof TFolder)) return;

  await writeClassInfo(app, slug, { archived: true });
  await deleteSeriesBlocksForClass(app, slug);

  const archivedRoot = archivedClassesFolder(app);
  if (!app.vault.getAbstractFileByPath(archivedRoot)) await app.vault.createFolder(archivedRoot);
  await app.fileManager.renameFile(folder, `${archivedRoot}/${slug}`);
}

// ── Class-Transcript.md — always fully regenerated (by the AI import skill
// or the manual Class Settings form), never hand-spliced like Class-Info.md's
// frontmatter — so parse/serialize just walk the whole body once. ──

function tableCells(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith('|')) return [];
  return t.split('|').map(c => c.trim()).slice(1, -1);
}

export async function readClassTranscript(app: App, slug: string): Promise<ClassTranscript | null> {
  const file = app.vault.getAbstractFileByPath(classTranscriptPath(app, slug));
  if (!(file instanceof TFile)) return null;

  const { fields, body } = parseFrontmatter(await app.vault.read(file));
  const assignments: AssignmentRow[] = [];
  const schedule: ScheduleRow[] = [];
  const gradeScale: GradeScaleRow[] = [];

  let section: 'assignments' | 'schedule' | 'gradeScale' | null = null;
  let rowIdx = 0;
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (/^##\s+Assignments/i.test(t))          { section = 'assignments'; rowIdx = 0; continue; }
    if (/^##\s+Day-by-Day Schedule/i.test(t))  { section = 'schedule';    rowIdx = 0; continue; }
    if (/^##\s+Grade Scale/i.test(t))          { section = 'gradeScale';  rowIdx = 0; continue; }
    if (/^##\s+/.test(t))                      { section = null; continue; }
    if (!section || !t.startsWith('|')) continue;

    rowIdx++;
    if (rowIdx <= 2) continue; // header row + "| --- |" separator row
    const cells = tableCells(t);
    if (section === 'assignments' && cells.length >= 2) {
      assignments.push({ item: cells[1] ?? '', dateOrWeek: cells[0] ?? '', worth: cells[2] ?? '', category: cells[3] || undefined });
    }
    if (section === 'schedule' && cells.length >= 2) {
      schedule.push({ dateOrWeek: cells[0], topic: cells[1] });
    }
    if (section === 'gradeScale' && cells.length >= 3) {
      const min = parseInt(cells[0], 10);
      const max = parseInt(cells[1], 10);
      if (!isNaN(min) && !isNaN(max)) gradeScale.push({ min, max, letter: cells[2] });
    }
  }

  return {
    generated: fields['cc2-generated'] ?? '',
    source:    fields['cc2-source'] === 'AI import' ? 'AI import' : 'Manual entry',
    assignments, schedule,
    gradeScale: gradeScale.length ? gradeScale : undefined,
  };
}

export async function writeClassTranscript(app: App, slug: string, data: Omit<ClassTranscript, 'generated'>): Promise<void> {
  // Was toISOString().slice(0,10) — that's UTC, so a transcript imported after
  // ~6pm local was stamped with TOMORROW's date. See core/dates.ts's header.
  const today = todayISO();
  const fields: Record<string, string> = { 'cc2-generated': today, 'cc2-source': data.source };

  const parts: string[] = [];
  if (data.assignments.length) {
    parts.push(
      '## Assignments & Due Dates', '| Date | Item | Worth | Category |', '| --- | --- | --- | --- |',
      ...data.assignments.map(r => `| ${r.dateOrWeek} | ${r.item} | ${r.worth} | ${r.category ?? ''} |`), '',
    );
  }
  if (data.schedule.length) {
    parts.push(
      '## Day-by-Day Schedule', '| Date/Week | Topic |', '| --- | --- |',
      ...data.schedule.map(r => `| ${r.dateOrWeek} | ${r.topic} |`), '',
    );
  }
  if (data.gradeScale?.length) {
    parts.push(
      '## Grade Scale', '| Min | Max | Letter |', '| --- | --- | --- |',
      ...data.gradeScale.map(r => `| ${r.min} | ${r.max} | ${r.letter} |`), '',
    );
  }

  const content = serializeFrontmatter(fields, `\n# Transcript\n\n${parts.join('\n')}`);
  const path = classTranscriptPath(app, slug);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}

/**
 * Any vault change under Education/ (Classes/ or Archived/) — broad on purpose,
 * since My Classes / My Teachers / Class Tasks and every class-page widget need
 * to re-derive on any class add/edit/archive, not just one known path.
 *
 * Now a thin wrapper over the shared vault-event hub. It used to register four
 * raw `vault.on` listeners per caller, and it has **ten** callers — a Class Page
 * with seven widgets plus the page itself was running ~32 listeners against one
 * folder, every one of them re-testing the same prefix on every write anywhere
 * in the vault. The hub keeps four listeners for the entire plugin and fans out,
 * with debouncing this hand-rolled version never had.
 *
 * Signature deliberately unchanged so none of the ten call sites move.
 */
export function watchClassesFolder(app: App, cb: () => void): () => void {
  return subscribeVault(app, {
    folders:  [resolveCommandCenterPath(app, 'Education')],
    onChange: cb,
  });
}
