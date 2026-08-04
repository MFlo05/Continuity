import { App, TFile } from 'obsidian';
import { classFolderPath } from './class-info';

// Manual + AI-proposed resource links/files for one class — merge-written,
// same reasoning as class-progress.ts's own file: a student's manually added
// link/file must survive a future AI re-import, so this never gets wiped
// wholesale the way Class-Transcript.md does. Flat "- Label | type | target |
// source" list, same hand-rolled convention as class-contacts.ts's
// Contacts.md (no frontmatter, no section headers needed for one row shape).

export function resourcesFilePath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Resources.md`;
}
export function resourcesFolderPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Resources`;
}

export interface ResourceRow {
  label:  string;
  type:   'link' | 'file';
  target: string; // a URL for 'link', a vault-relative path (inside Resources/) for 'file'
  source: 'AI import' | 'Manual entry';
}

function parseLine(line: string): ResourceRow | null {
  const m = /^-\s*(.+?)\s*\|\s*(link|file)\s*\|\s*(.+?)\s*\|\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  return { label: m[1], type: m[2] as 'link' | 'file', target: m[3], source: m[4].trim() === 'AI import' ? 'AI import' : 'Manual entry' };
}

function serializeLine(r: ResourceRow): string {
  return `- ${r.label} | ${r.type} | ${r.target} | ${r.source}`;
}

export async function readResources(app: App, slug: string): Promise<ResourceRow[]> {
  const file = app.vault.getAbstractFileByPath(resourcesFilePath(app, slug));
  if (!(file instanceof TFile)) return [];
  const content = await app.vault.read(file);
  return content.split('\n').map(parseLine).filter((r): r is ResourceRow => !!r);
}

async function appendRow(app: App, slug: string, row: ResourceRow): Promise<void> {
  const path = resourcesFilePath(app, slug);
  const existing = app.vault.getAbstractFileByPath(path);
  if (!(existing instanceof TFile)) {
    await app.vault.create(path, `${serializeLine(row)}\n`);
    return;
  }
  await app.vault.process(existing, content => {
    const trimmed = content.replace(/\n+$/, '');
    return trimmed ? `${trimmed}\n${serializeLine(row)}\n` : `${serializeLine(row)}\n`;
  });
}

export async function addResourceLink(
  app: App, slug: string, label: string, url: string, source: ResourceRow['source'] = 'Manual entry',
): Promise<void> {
  await appendRow(app, slug, { label, type: 'link', target: url, source });
}

// Avoids clobbering an existing file of the same name inside Resources/ —
// appends " (2)", " (3)", etc. before the extension rather than overwriting.
function uniqueFileName(app: App, folderPath: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let n = 2;
  while (app.vault.getAbstractFileByPath(`${folderPath}/${candidate}`)) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  return candidate;
}

// New to this codebase (app.vault.createBinary hasn't been used elsewhere
// yet — AIPanel.tsx's fileToImageAttachment only base64-encodes for the
// Claude API, it never persists to the vault) but a standard, well-supported
// Obsidian API. Writes into the class's own Resources/ subfolder rather than
// the vault's default attachments folder, per the whole point of this feature.
// Returns the final vault-relative path — uniqueFileName's collision suffix
// means the caller can't predict it in advance (needed by the syllabus
// importer, which hands this path straight to the AI in its prompt).
export async function addResourceFile(
  app: App, slug: string, label: string, file: File, source: ResourceRow['source'] = 'Manual entry',
): Promise<string> {
  const folderPath = resourcesFolderPath(app, slug);
  if (!app.vault.getAbstractFileByPath(folderPath)) await app.vault.createFolder(folderPath);

  const name = uniqueFileName(app, folderPath, file.name);
  const buf = await file.arrayBuffer();
  const path = `${folderPath}/${name}`;
  await app.vault.createBinary(path, buf);
  await appendRow(app, slug, { label, type: 'file', target: path, source });
  return path;
}

export async function removeResource(app: App, slug: string, label: string, target: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(resourcesFilePath(app, slug));
  if (!(file instanceof TFile)) return;

  await app.vault.process(file, content => {
    const lines = content.split('\n').filter(line => {
      const r = parseLine(line);
      if (!r) return true; // keep blank/unparseable lines untouched
      return !(r.label === label && r.target === target);
    });
    return lines.join('\n');
  });
}
