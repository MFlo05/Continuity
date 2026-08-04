import { App, TFile } from 'obsidian';
import { classFolderPath } from './class-info';

export function gradeCategoriesPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Grade-Categories.md`;
}

// Only meaningful when the class's cc2-grade-mode is 'category' (see
// class-info.ts's ClassInfoFields.gradeMode) — each assignment then gets
// tagged with one of these category names instead of carrying its own
// weight, and the Grade Breakdown widget computes one bar per category using
// this file's weight instead of a per-assignment worth. Narrow, hand-rolled,
// same ensureXFile + vault.process convention as class-policies.ts. Keyed by
// name (not an id) since a category name is already the natural unique key
// an assignment row tags itself with.
export interface GradeCategory {
  name:   string;
  weight: string; // e.g. "20%"
}

function parseEntries(content: string): GradeCategory[] {
  const out: GradeCategory[] = [];
  for (const line of content.split('\n')) {
    const m = /^-\s*(.+?)\s*\|\s*(.+)$/.exec(line.trim());
    if (m) out.push({ name: m[1], weight: m[2] });
  }
  return out;
}

function serialize(entries: GradeCategory[]): string {
  const body = entries.map(e => `- ${e.name} | ${e.weight}`).join('\n');
  return `# Grade Categories\n\n${body}${entries.length ? '\n' : ''}`;
}

async function ensureGradeCategoriesFile(app: App, slug: string): Promise<TFile> {
  const path = gradeCategoriesPath(app, slug);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  return app.vault.create(path, serialize([]));
}

export async function readGradeCategories(app: App, slug: string): Promise<GradeCategory[]> {
  const file = app.vault.getAbstractFileByPath(gradeCategoriesPath(app, slug));
  if (!(file instanceof TFile)) return [];
  return parseEntries(await app.vault.read(file));
}

export async function addGradeCategory(app: App, slug: string, name: string, weight: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const file = await ensureGradeCategoriesFile(app, slug);
  await app.vault.process(file, content => {
    const entries = parseEntries(content);
    if (entries.some(e => e.name === trimmedName)) return content;
    return serialize([...entries, { name: trimmedName, weight: weight.trim() }]);
  });
}

export async function editGradeCategory(app: App, slug: string, oldName: string, name: string, weight: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const file = await ensureGradeCategoriesFile(app, slug);
  await app.vault.process(file, content => {
    const entries = parseEntries(content);
    const idx = entries.findIndex(e => e.name === oldName);
    if (idx === -1) return content;
    entries[idx] = { name: trimmedName, weight: weight.trim() };
    return serialize(entries);
  });
}

export async function removeGradeCategory(app: App, slug: string, name: string): Promise<void> {
  const file = await ensureGradeCategoriesFile(app, slug);
  await app.vault.process(file, content => serialize(parseEntries(content).filter(e => e.name !== name)));
}
