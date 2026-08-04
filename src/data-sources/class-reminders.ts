import { App, TFile } from 'obsidian';
import { classFolderPath } from './class-info';

export function classRemindersPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Reminders.md`;
}

export interface Reminder {
  id:   string;
  date: string; // ISO yyyy-mm-dd
  text: string;
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Narrow, hand-rolled — same convention as class-policies.ts. Flat lines,
// one reminder each: "- YYYY-MM-DD | id | text". The id (not date+text) is
// what add/edit/delete address, so two reminders on the same day with
// identical text are never ambiguous.
function parseReminders(content: string): Reminder[] {
  const out: Reminder[] = [];
  for (const line of content.split('\n')) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2})\s*\|\s*(\S+)\s*\|\s*(.+)$/.exec(line.trim());
    if (m) out.push({ date: m[1], id: m[2], text: m[3] });
  }
  return out;
}

function serialize(reminders: Reminder[]): string {
  const body = reminders.map(r => `- ${r.date} | ${r.id} | ${r.text}`).join('\n');
  return `# Reminders\n\n${body}${reminders.length ? '\n' : ''}`;
}

async function ensureRemindersFile(app: App, slug: string): Promise<TFile> {
  const path = classRemindersPath(app, slug);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  return app.vault.create(path, serialize([]));
}

export async function readReminders(app: App, slug: string): Promise<Reminder[]> {
  const file = app.vault.getAbstractFileByPath(classRemindersPath(app, slug));
  if (!(file instanceof TFile)) return [];
  return parseReminders(await app.vault.read(file));
}

export async function addReminder(app: App, slug: string, date: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !date) return;
  const file = await ensureRemindersFile(app, slug);
  await app.vault.process(file, content => serialize([...parseReminders(content), { id: makeId(), date, text: trimmed }]));
}

export async function editReminder(app: App, slug: string, id: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const file = await ensureRemindersFile(app, slug);
  await app.vault.process(file, content => {
    const reminders = parseReminders(content);
    const row = reminders.find(r => r.id === id);
    if (!row) return content;
    row.text = trimmed;
    return serialize(reminders);
  });
}

export async function removeReminder(app: App, slug: string, id: string): Promise<void> {
  const file = await ensureRemindersFile(app, slug);
  await app.vault.process(file, content => serialize(parseReminders(content).filter(r => r.id !== id)));
}
