import { App, TFile, TFolder } from 'obsidian';
import { classFolderPath, listClasses } from './class-info';
import { todayISO, isSameDay } from '../core/dates';

// Notes live in their own <class>/Notes/ subfolder (same pattern as
// class-resources.ts's Resources/ folder) rather than the class-folder root.
// Scanning a dedicated subfolder means every suite-owned per-class file
// (Class-Info, Progress, Resources, Policies, Tasks, Reminders, and whatever
// gets added next) can never leak into "Recent Notes" — there's no blocklist
// to remember to update, since nothing but a real note is ever created here.
export function classNotesFolderPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Notes`;
}

export interface ClassNote {
  file:    TFile;
  slug:    string;
  title:   string;
  excerpt: string;
  mtime:   number;
}

function excerptOf(content: string): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const stripped = body
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')                    // embeds/transclusions ![[...]] — drop entirely
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')       // [[Page|Alias]] -> Alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                  // [[Page]] -> Page
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')             // [text](url) -> text
    .replace(/[#*_`>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 120 ? `${stripped.slice(0, 120)}…` : stripped;
}

async function notesInFolder(app: App, slug: string): Promise<ClassNote[]> {
  const folder = app.vault.getAbstractFileByPath(classNotesFolderPath(app, slug));
  if (!(folder instanceof TFolder)) return [];
  const out: ClassNote[] = [];
  for (const child of folder.children) {
    if (!(child instanceof TFile) || child.extension !== 'md') continue;
    out.push({
      file: child, slug, title: child.basename,
      excerpt: excerptOf(await app.vault.cachedRead(child)),
      mtime: child.stat.mtime,
    });
  }
  return out;
}

// Scans one class's Notes/ folder (opts.slug set — Class Fullscreen's usage)
// or every active class's Notes/ folder (opts.slug omitted — a future
// standalone aggregate widget), newest first.
export async function listClassNotes(app: App, opts?: { slug?: string; limit?: number }): Promise<ClassNote[]> {
  let notes: ClassNote[];
  if (opts?.slug) {
    notes = await notesInFolder(app, opts.slug);
  } else {
    notes = [];
    for (const cls of await listClasses(app)) {
      notes.push(...await notesInFolder(app, cls.slug));
    }
  }
  notes.sort((a, b) => b.mtime - a.mtime);
  return opts?.limit ? notes.slice(0, opts.limit) : notes;
}

// Create-then-open flow (mirrors MeetingCreateModal) — lands in the class's
// own Notes/ subfolder (created on first use), never the vault's default
// new-note location. Title collisions get a " (2)", " (3)"... suffix rather
// than overwriting.
export async function createClassNote(app: App, slug: string, title: string, body?: string): Promise<TFile> {
  const folderPath = classNotesFolderPath(app, slug);
  if (!app.vault.getAbstractFileByPath(folderPath)) await app.vault.createFolder(folderPath);
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled';
  let path = `${folderPath}/${safeTitle}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${folderPath}/${safeTitle} (${n}).md`;
    n++;
  }
  return app.vault.create(path, body ?? `# ${safeTitle}\n\n`);
}

// A genuinely blank note (no caller-supplied title) — used by the Notes
// widget's own "+ New note" button. Unlike createClassNote's other callers
// (an assignment/topic already has a meaningful title to use verbatim),
// there's nothing to title this note yet, so the filename is just a dated
// placeholder and the body opens with prefilled metadata (class code,
// created date) plus a bare, empty "# " heading — an explicit, cursor-ready
// place for the student to type the real title directly in Obsidian.
export async function createBlankClassNote(app: App, slug: string, classCode: string): Promise<TFile> {
  // Was toISOString().slice(0,10) — UTC, so a note created after ~6pm local
  // got tomorrow's date in BOTH its frontmatter and its filename.
  const isoDate = todayISO();
  const body = `---\ncc2-class: ${classCode}\ncc2-created: ${isoDate}\n---\n# \n`;
  return createClassNote(app, slug, `New Note ${isoDate}`, body);
}

export function relativeDate(mtime: number): string {
  const now = new Date();
  const d = new Date(mtime);
  if (isSameDay(d, now)) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
