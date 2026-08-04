import { App, TFile, TFolder, TAbstractFile } from 'obsidian';
import { localISO, todayISO } from '../core/dates';
import { resolveCommandCenterPath } from './vault-paths';

export function meetingsFolder(app: App): string {
  return resolveCommandCenterPath(app, 'Meetings');
}
export function meetingTemplatesFolder(app: App): string {
  return resolveCommandCenterPath(app, 'Meetings', 'Templates');
}
export const BLANK_STARTER_TEMPLATE_NAME = 'Blank';

// Used if Templates/Meetings/Blank.md is missing (deleted/renamed, or a fresh
// install before the content work lands) — "+ New template" must never hard-fail.
const FALLBACK_BLANK_TEMPLATE = '---\ncc2-extra-fields: \n---\n\n# {{title}}\n\n## Notes\n';

export interface MeetingExtraFieldDef { key: string; label: string; }

export interface MeetingTemplate {
  file:        TFile;
  name:        string;
  extraFields: MeetingExtraFieldDef[];
}

// ── Frontmatter — narrow, hand-rolled, same spirit as todos.ts's parser but a
// different shape (arbitrary key/value map, not a single flow-list directive). ──

function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!block) return { fields: {}, body: content };

  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    fields[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: content.slice(block[0].length) };
}

// string[] values (used for project/related-meetings links) emit YAML
// block-list style, not inline "[...]" — wikilink values themselves contain
// "[" and "]", which would be ambiguous/ugly in flow style. Empty arrays are
// omitted entirely (no "key:" with nothing under it). Write-only: the simple
// per-line matcher in parseFrontmatter won't reconstruct these back into an
// array if the file is re-read — nothing needs that yet.
function serializeFrontmatter(fields: Record<string, string | string[]>, body: string): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${item.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// A template declares its own capture fields, e.g.:
//   cc2-extra-fields: attendees:Attendees, client:Client name
function parseExtraFieldsDirective(raw: string | undefined): MeetingExtraFieldDef[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const idx = entry.indexOf(':');
      if (idx === -1) return { key: entry, label: entry };
      const key   = entry.slice(0, idx).trim();
      const label = entry.slice(idx + 1).trim() || key;
      return { key, label };
    });
}

// Plain global {{key}} find-replace — no engine, no conditionals.
function substitutePlaceholders(text: string, values: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

// ── Filename convention — title/date are derived FROM the filename, not
// forced into frontmatter (see meetings widget plan for why). ──

function sanitizeForFilename(s: string): string {
  return s.trim().replace(/[/\\:*?"<>|]/g, '-').slice(0, 60).trim();
}

// The local-vs-UTC reasoning this file documented is now core/dates.ts's
// header, and localISO is the one implementation of it.
export function todayLocalISO(): string {
  return todayISO();
}

function meetingFilename(date: string, title: string): string {
  return `${date} - ${sanitizeForFilename(title)}`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  await app.vault.createFolder(path).catch(() => { /* race with another creator — fine */ });
}

// ── Template scanning ──

export async function listMeetingTemplates(app: App): Promise<MeetingTemplate[]> {
  const folder = app.vault.getAbstractFileByPath(meetingTemplatesFolder(app));
  if (!(folder instanceof TFolder)) return [];

  const files = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
  const templates: MeetingTemplate[] = [];
  for (const file of files) {
    try {
      const { fields } = parseFrontmatter(await app.vault.read(file));
      templates.push({
        file,
        name: file.basename,
        extraFields: parseExtraFieldsDirective(fields['cc2-extra-fields']),
      });
    } catch { /* skip unreadable files */ }
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

// Meeting-note LISTING moved to the record-folder codec (core/codecs/
// record-folder.ts) — the scan, the frontmatter read, the date/title
// derivation and the folder watcher were all the generic "folder of notes"
// behavior, and both consumers (the widget and LinkPickerModal) now read the
// same rows through it instead of scanning the folder twice.

// ── Project scanning — vault-wide, identified purely by "type: project" in
// frontmatter rather than a fixed folder (none exists yet, and even once one
// does the vault might not funnel everything through a single folder). Uses
// metadataCache (already indexed) since only frontmatter is needed, not file
// content — synchronous and cheap, unlike the meetings/templates scanners. ──

export interface ProjectEntry { file: TFile; title: string; sortDate: string; }

export function listProjectNotes(app: App): ProjectEntry[] {
  const entries: ProjectEntry[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm['type'] !== 'project') continue;

    const fmTitle = fm['title'];
    const title = typeof fmTitle === 'string' && fmTitle.trim() ? fmTitle.trim() : file.basename;

    const created = fm['created'];
    const sortDate = typeof created === 'string' && /^\d{4}-\d{2}-\d{2}/.test(created)
      ? created.slice(0, 10)
      : localISO(new Date(file.stat.ctime));

    entries.push({ file, title, sortDate });
  }
  return entries.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

// ── Creation ──

export async function createMeetingNote(
  app: App,
  opts: {
    template: TFile; title: string; date: string; extraValues: Record<string, string>;
    // Optional — writes real Obsidian [[links]] into frontmatter so the
    // connection shows up natively in Obsidian's own backlinks/graph. Fully
    // optional: if omitted or empty, no project/related-meetings keys are
    // added at all.
    projectLinks?: TFile[]; relatedMeetingLinks?: TFile[];
  },
): Promise<TFile> {
  const folder = meetingsFolder(app);
  await ensureFolder(app, folder);

  // Resolve the destination path FIRST, before building content —
  // generateMarkdownLink needs the new note's own path to compute correct
  // relative links, and it only needs the path string, not an existing file.
  const base = meetingFilename(opts.date, opts.title);
  let name = base;
  let path = `${folder}/${name}.md`;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    name = `${base} (${suffix})`;
    path = `${folder}/${name}.md`;
    suffix++;
  }

  const raw = await app.vault.read(opts.template);
  const values: Record<string, string> = { title: opts.title, date: opts.date, ...opts.extraValues };
  const substituted = substitutePlaceholders(raw, values);

  // Re-parse the substituted content so extra-field values can be forced into
  // frontmatter under their own key — this is safe (no naming collision) since
  // those keys are exactly what the template's own cc2-extra-fields directive
  // declared. Title/date are NOT forced in here; the filename is their source
  // of truth, so a hand-authored template's own frontmatter (e.g. "created:")
  // is left exactly as the user wrote it, just with {{date}} substituted.
  const parsed = parseFrontmatter(substituted);
  const fields: Record<string, string | string[]> = { ...parsed.fields };
  delete fields['cc2-extra-fields'];
  for (const [key, value] of Object.entries(opts.extraValues)) {
    fields[key] = value;
  }

  const projectLinks = (opts.projectLinks ?? []).map(f => app.fileManager.generateMarkdownLink(f, path));
  if (projectLinks.length) fields['project'] = projectLinks;

  const relatedLinks = (opts.relatedMeetingLinks ?? []).map(f => app.fileManager.generateMarkdownLink(f, path));
  if (relatedLinks.length) fields['related-meetings'] = relatedLinks;

  const content = Object.keys(fields).length ? serializeFrontmatter(fields, parsed.body) : substituted;

  return app.vault.create(path, content);
}

// ── Template cloning ("+ New template") ──

export async function cloneBlankTemplate(app: App, newName: string): Promise<TFile> {
  const folder = meetingTemplatesFolder(app);
  await ensureFolder(app, folder);

  const blankPath = `${folder}/${BLANK_STARTER_TEMPLATE_NAME}.md`;
  const blankFile = app.vault.getAbstractFileByPath(blankPath);
  const blankContent = blankFile instanceof TFile ? await app.vault.read(blankFile) : FALLBACK_BLANK_TEMPLATE;

  const sanitized = sanitizeForFilename(newName) || 'New Template';
  let name = sanitized;
  let path = `${folder}/${name}.md`;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    name = `${sanitized} (${suffix})`;
    path = `${folder}/${name}.md`;
    suffix++;
  }

  return app.vault.create(path, blankContent);
}

// Live reload is the shared vault-event hub's job now (core/vault-events.ts)
// — this file's own four-listener, 200ms-debounced watcher was the ninth copy
// of that pattern in src/data-sources/.
