import { App, TFile, TAbstractFile } from 'obsidian';
import { resolveCommandCenterPath } from './vault-paths';

// Manual, non-class-derived contacts (student services, an advisor, etc.) —
// My Teachers merges these alongside teachers it derives from
// listClasses()/Class-Info.md. A single flat "- Name | Role | Email" list,
// same hand-rolled-per-file convention as every other data source here.

export function contactsPath(app: App): string {
  return resolveCommandCenterPath(app, 'Education', 'Contacts.md');
}

export interface ExtraContact {
  name:  string;
  role:  string;
  email?: string;
}

function parseLine(line: string): ExtraContact | null {
  const m = /^-\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  return { name: m[1], role: m[2], email: m[3].trim() || undefined };
}

function serializeLine(c: ExtraContact): string {
  return `- ${c.name} | ${c.role} | ${c.email ?? ''}`;
}

export async function readExtraContacts(app: App): Promise<ExtraContact[]> {
  const file = app.vault.getAbstractFileByPath(contactsPath(app));
  if (!(file instanceof TFile)) return [];
  const content = await app.vault.read(file);
  return content.split('\n').map(parseLine).filter((c): c is ExtraContact => !!c);
}

export async function addExtraContact(app: App, contact: ExtraContact): Promise<void> {
  const path = contactsPath(app);
  const existing = app.vault.getAbstractFileByPath(path);

  if (!(existing instanceof TFile)) {
    const root = resolveCommandCenterPath(app, 'Education');
    if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root);
    await app.vault.create(path, `${serializeLine(contact)}\n`);
    return;
  }

  await app.vault.process(existing, content => {
    const trimmed = content.replace(/\n+$/, '');
    return trimmed ? `${trimmed}\n${serializeLine(contact)}\n` : `${serializeLine(contact)}\n`;
  });
}

// Matched by (name, email) pair — the same identity used to build each row's
// key in MyTeachersWidget, so a delete always targets the exact row shown.
export async function removeExtraContact(app: App, name: string, email: string | undefined): Promise<void> {
  const file = app.vault.getAbstractFileByPath(contactsPath(app));
  if (!(file instanceof TFile)) return;

  await app.vault.process(file, content => {
    const lines = content.split('\n').filter(line => {
      const c = parseLine(line);
      if (!c) return true; // keep blank/unparseable lines untouched
      return !(c.name === name && (c.email ?? '') === (email ?? ''));
    });
    return lines.join('\n');
  });
}

export function watchContactsFile(app: App, cb: () => void): () => void {
  const path = contactsPath(app);
  const handler = (file: TAbstractFile) => { if (file.path === path) cb(); };
  const refs = [
    app.vault.on('modify', handler),
    app.vault.on('create', handler),
  ];
  return () => refs.forEach(r => app.vault.offref(r));
}
