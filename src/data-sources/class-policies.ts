import { App, TFile } from 'obsidian';
import { classFolderPath } from './class-info';

export function classPoliciesPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Policies.md`;
}

// Narrow, hand-rolled — a flat bullet list, nothing else (no dates, no
// per-entry source tag). "In the future the AI can pull this directly from
// the syllabus" was the stated motivation, but that's explicitly a later
// phase — extending this format then (e.g. a trailing " (AI)" marker, same
// idea as class-resources.ts's own source field) is a small follow-up, not
// something to build ahead of the actual feature.
function parseEntries(content: string): string[] {
  return content
    .split('\n')
    .map(l => /^-\s+(.+)$/.exec(l.trim())?.[1])
    .filter((s): s is string => !!s);
}

function serialize(entries: string[]): string {
  const body = entries.map(e => `- ${e}`).join('\n');
  return `# Class Policies\n\n${body}${entries.length ? '\n' : ''}`;
}

async function ensurePoliciesFile(app: App, slug: string): Promise<TFile> {
  const path = classPoliciesPath(app, slug);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  return app.vault.create(path, serialize([]));
}

export async function readPolicies(app: App, slug: string): Promise<string[]> {
  const file = app.vault.getAbstractFileByPath(classPoliciesPath(app, slug));
  if (!(file instanceof TFile)) return [];
  return parseEntries(await app.vault.read(file));
}

export async function addPolicy(app: App, slug: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const file = await ensurePoliciesFile(app, slug);
  await app.vault.process(file, content => serialize([...parseEntries(content), trimmed]));
}

export async function editPolicy(app: App, slug: string, index: number, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const file = await ensurePoliciesFile(app, slug);
  await app.vault.process(file, content => {
    const entries = parseEntries(content);
    if (index < 0 || index >= entries.length) return content;
    entries[index] = trimmed;
    return serialize(entries);
  });
}

export async function removePolicy(app: App, slug: string, index: number): Promise<void> {
  const file = await ensurePoliciesFile(app, slug);
  await app.vault.process(file, content => {
    const entries = parseEntries(content);
    if (index < 0 || index >= entries.length) return content;
    entries.splice(index, 1);
    return serialize(entries);
  });
}
