import { App, TFile } from 'obsidian';
import { classFolderPath } from './class-info';
import type { AssignmentRow } from './class-info';

export function progressPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Progress.md`;
}

export type AssignmentStatus = 'not-started' | 'in-progress' | 'completed';

export interface AssignmentProgress {
  status?: AssignmentStatus;   // default 'not-started' when unset
  score?:  string;
  resourceLabels: string[];    // references into this class's own Resources.md, by label
  noteLinks:      string[];    // vault paths to notes linked to this assignment
}

function emptyAssignmentProgress(): AssignmentProgress {
  return { resourceLabels: [], noteLinks: [] };
}

export interface ClassProgress {
  doneTopics:  Set<string>;
  noteLinks:   Map<string, string>;             // topic text -> note link, once created
  assignments: Map<string, AssignmentProgress>; // assignment item text -> entered state
  customAssignments: AssignmentRow[];           // user-added, not sourced from Class-Transcript.md
  gradeOverride: string | null;                 // manual "set my grade directly" value — wins over the computed average
}

function emptyProgress(): ClassProgress {
  return { doneTopics: new Set(), noteLinks: new Map(), assignments: new Map(), customAssignments: [], gradeOverride: null };
}

// Merge-written, never regenerated — see class-info.ts's ClassTranscript
// comment on why student-entered state can't live in the same file that gets
// fully regenerated on every AI (re-)import. Keyed by the row's own text
// (topic text / assignment item name) rather than a stable ID — simple, and
// stable enough in practice; a re-imported syllabus that meaningfully
// rewords a row just resets that one row's progress, an accepted edge case.
// Resource/note links are their own sections (one "item | value" line per
// link) rather than packed into one delimited field, so a label/path
// containing "|" can't collide with the record separator.
function parseProgress(content: string): ClassProgress {
  const data = emptyProgress();
  let section: 'topics' | 'notes' | 'meta' | 'resources' | 'assignNotes' | 'custom' | 'grade' | null = null;
  for (const raw of content.split('\n')) {
    const t = raw.trim();
    if (/^##\s+Topics Done/i.test(t))          { section = 'topics';      continue; }
    if (/^##\s+Topic Notes/i.test(t))          { section = 'notes';       continue; }
    if (/^##\s+Assignment Meta/i.test(t))      { section = 'meta';        continue; }
    if (/^##\s+Assignment Resources/i.test(t)) { section = 'resources';   continue; }
    if (/^##\s+Assignment Notes/i.test(t))     { section = 'assignNotes'; continue; }
    if (/^##\s+Custom Assignments/i.test(t))   { section = 'custom';      continue; }
    if (/^##\s+Grade Override/i.test(t))       { section = 'grade';       continue; }
    if (/^##\s+/.test(t))                      { section = null; continue; }
    if (!section || !t.startsWith('-')) continue;

    const line = t.slice(1).trim();
    const getAssignment = (item: string) => {
      if (!data.assignments.has(item)) data.assignments.set(item, emptyAssignmentProgress());
      return data.assignments.get(item)!;
    };

    if (section === 'topics') {
      if (line) data.doneTopics.add(line);
    } else if (section === 'notes') {
      const i = line.indexOf('|');
      if (i === -1) continue;
      data.noteLinks.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    } else if (section === 'meta') {
      const parts = line.split('|').map(p => p.trim());
      const key = parts[0];
      if (!key) continue;
      const entry = getAssignment(key);
      for (const p of parts.slice(1)) {
        const scoreMatch  = /^score:(.*)$/.exec(p);
        const statusMatch = /^status:(not-started|in-progress|completed)$/.exec(p);
        if (scoreMatch)  entry.score  = scoreMatch[1].trim();
        if (statusMatch) entry.status = statusMatch[1] as AssignmentStatus;
      }
    } else if (section === 'resources') {
      const i = line.indexOf('|');
      if (i === -1) continue;
      getAssignment(line.slice(0, i).trim()).resourceLabels.push(line.slice(i + 1).trim());
    } else if (section === 'assignNotes') {
      const i = line.indexOf('|');
      if (i === -1) continue;
      getAssignment(line.slice(0, i).trim()).noteLinks.push(line.slice(i + 1).trim());
    } else if (section === 'custom') {
      const parts = line.split('|').map(p => p.trim());
      if (!parts[0]) continue;
      data.customAssignments.push({ item: parts[0], dateOrWeek: parts[1] ?? '', worth: parts[2] ?? '', category: parts[3] || undefined });
    } else if (section === 'grade') {
      if (line) data.gradeOverride = line;
    }
  }
  return data;
}

function serializeProgress(data: ClassProgress): string {
  const lines: string[] = ['## Topics Done'];
  for (const t of data.doneTopics) lines.push(`- ${t}`);

  lines.push('', '## Topic Notes');
  for (const [topic, link] of data.noteLinks) lines.push(`- ${topic} | ${link}`);

  lines.push('', '## Assignment Meta');
  for (const [key, entry] of data.assignments) {
    const bits = [key];
    if (entry.score !== undefined)  bits.push(`score:${entry.score}`);
    if (entry.status !== undefined) bits.push(`status:${entry.status}`);
    if (bits.length > 1) lines.push(`- ${bits.join(' | ')}`);
  }

  lines.push('', '## Assignment Resources');
  for (const [key, entry] of data.assignments) {
    for (const label of entry.resourceLabels) lines.push(`- ${key} | ${label}`);
  }

  lines.push('', '## Assignment Notes');
  for (const [key, entry] of data.assignments) {
    for (const link of entry.noteLinks) lines.push(`- ${key} | ${link}`);
  }

  lines.push('', '## Custom Assignments');
  for (const row of data.customAssignments) lines.push(`- ${row.item} | ${row.dateOrWeek} | ${row.worth} | ${row.category ?? ''}`);

  lines.push('', '## Grade Override');
  if (data.gradeOverride) lines.push(`- ${data.gradeOverride}`);

  return lines.join('\n') + '\n';
}

export async function readProgress(app: App, slug: string): Promise<ClassProgress> {
  const file = app.vault.getAbstractFileByPath(progressPath(app, slug));
  if (!(file instanceof TFile)) return emptyProgress();
  return parseProgress(await app.vault.read(file));
}

async function ensureProgressFile(app: App, slug: string): Promise<TFile> {
  const path = progressPath(app, slug);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  return app.vault.create(path, serializeProgress(emptyProgress()));
}

export async function setTopicDone(app: App, slug: string, topicText: string, done: boolean): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    if (done) data.doneTopics.add(topicText); else data.doneTopics.delete(topicText);
    return serializeProgress(data);
  });
}

export async function setTopicNoteLink(app: App, slug: string, topicText: string, link: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    data.noteLinks.set(topicText, link);
    return serializeProgress(data);
  });
}

export async function setAssignmentScore(app: App, slug: string, item: string, score: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const entry = data.assignments.get(item) ?? emptyAssignmentProgress();
    entry.score = score;
    data.assignments.set(item, entry);
    return serializeProgress(data);
  });
}

export async function setAssignmentStatus(app: App, slug: string, item: string, status: AssignmentStatus): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const entry = data.assignments.get(item) ?? emptyAssignmentProgress();
    entry.status = status;
    data.assignments.set(item, entry);
    return serializeProgress(data);
  });
}

export async function linkAssignmentResource(app: App, slug: string, item: string, label: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const entry = data.assignments.get(item) ?? emptyAssignmentProgress();
    if (!entry.resourceLabels.includes(label)) entry.resourceLabels.push(label);
    data.assignments.set(item, entry);
    return serializeProgress(data);
  });
}

export async function unlinkAssignmentResource(app: App, slug: string, item: string, label: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const entry = data.assignments.get(item);
    if (!entry) return content;
    entry.resourceLabels = entry.resourceLabels.filter(l => l !== label);
    return serializeProgress(data);
  });
}

export async function linkAssignmentNote(app: App, slug: string, item: string, notePath: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const entry = data.assignments.get(item) ?? emptyAssignmentProgress();
    if (!entry.noteLinks.includes(notePath)) entry.noteLinks.push(notePath);
    data.assignments.set(item, entry);
    return serializeProgress(data);
  });
}

export async function unlinkAssignmentNote(app: App, slug: string, item: string, notePath: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const entry = data.assignments.get(item);
    if (!entry) return content;
    entry.noteLinks = entry.noteLinks.filter(l => l !== notePath);
    return serializeProgress(data);
  });
}

export async function addCustomAssignment(app: App, slug: string, row: AssignmentRow): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    data.customAssignments.push(row);
    return serializeProgress(data);
  });
}

export async function removeCustomAssignment(app: App, slug: string, item: string): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    data.customAssignments = data.customAssignments.filter(r => r.item !== item);
    data.assignments.delete(item);
    return serializeProgress(data);
  });
}

// Patches an existing custom row's item/dateOrWeek/worth in place. When the
// item text itself changes, re-keys its AssignmentProgress entry in the
// `assignments` map (score/status/resourceLabels/noteLinks are all keyed by
// that text) so a rename doesn't orphan them under the old key — "Save"
// must preserve everything already entered, not just the row's own fields.
export async function editCustomAssignment(app: App, slug: string, oldItem: string, row: AssignmentRow): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    const idx = data.customAssignments.findIndex(r => r.item === oldItem);
    if (idx === -1) return content;
    data.customAssignments[idx] = row;
    if (row.item !== oldItem) {
      const entry = data.assignments.get(oldItem);
      if (entry) {
        data.assignments.delete(oldItem);
        data.assignments.set(row.item, entry);
      }
    }
    return serializeProgress(data);
  });
}

export async function setGradeOverride(app: App, slug: string, value: string | null): Promise<void> {
  const file = await ensureProgressFile(app, slug);
  await app.vault.process(file, content => {
    const data = parseProgress(content);
    data.gradeOverride = value;
    return serializeProgress(data);
  });
}
