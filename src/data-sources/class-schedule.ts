import { App, TFile, TAbstractFile } from 'obsidian';
import {
  startOfWeek, addDays, localISO, timeToMin, minToTime,
  WEEKDAYS as SHARED_WEEKDAYS,
} from '../core/dates';
import { resolveCommandCenterPath } from './vault-paths';

// One evergreen file, not one file per real week (unlike meal-plan.ts) — a
// term's schedule is ~95% identical week to week, so persisting the
// recurring template + a sparse set of exceptions + standalone one-offs
// avoids duplicating the whole template into every week. Weeks are never
// separately persisted; resolveWeek() below always computes what a given
// real week looks like on demand.

/** Re-exported under its long-standing name; the values come from core/dates. */
export const WEEKDAYS = SHARED_WEEKDAYS;

export function scheduleFilePath(app: App): string {
  return resolveCommandCenterPath(app, 'Education', 'Class-Schedule.md');
}

export interface SeriesBlock {
  id:       string;  // "cs" + random suffix, generated once, stable identity
  weekday:  number;  // 0-6, Monday-indexed
  startMin: number;  // minutes from midnight
  endMin:   number;
  classId:  string;  // class folder slug
}

export type ExceptionType = 'skip' | 'modify';

export interface ScheduleException {
  seriesId:  string;
  date:      string;  // YYYY-MM-DD — the one occurrence this targets
  type:      ExceptionType;
  startMin?: number;  // only for 'modify'
  endMin?:   number;
}

export interface OneOffBlock {
  id:       string;  // "oo" + random suffix
  date:     string;  // YYYY-MM-DD
  startMin: number;
  endMin:   number;
  title:    string;
  classId?: string;  // optional — ties it to a class for color only
}

export interface ClassScheduleFile {
  dayStartMin: number;
  dayEndMin:   number;
  series:      SeriesBlock[];
  exceptions:  ScheduleException[];
  oneOffs:     OneOffBlock[];
}

const DEFAULT_SCHEDULE: ClassScheduleFile = {
  dayStartMin: 7 * 60,
  dayEndMin:   21 * 60,
  series: [], exceptions: [], oneOffs: [],
};

// What actually renders for one real calendar week — always computed from
// the three sources above, never itself persisted.
export type EffectiveBlockKind = 'series' | 'series-modified' | 'one-off';

export interface EffectiveBlock {
  kind:      EffectiveBlockKind;
  date:      string;    // YYYY-MM-DD, the real date this occurrence falls on
  weekday:   number;
  startMin:  number;
  endMin:    number;
  title:     string;    // resolved display text — class code, or the one-off's own title
  classId?:  string;
  color?:    string;    // resolved from the class's own cc2-color
  room?:     string;    // resolved from the class's own cc2-room
  seriesId?: string;    // present for 'series' / 'series-modified'
  oneOffId?: string;    // present for 'one-off'
}

// Time helpers (HH:MM in the file, minutes-from-midnight internally) and the
// local-ISO formatter now come from core/dates.

function genId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 8);
}

// ── Frontmatter — narrow, hand-rolled, same per-file convention as every
// other data source here (recipes.ts, class-info.ts, etc). ──

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

function serializeFrontmatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// ── Parse / serialize the whole file ──
// Three sub-shapes: day-grouped list lines for the template (mirrors
// meal-plan.ts's ## day / - item idiom), a markdown table for the sparse
// exceptions (mirrors recurring.ts's table convention), day-grouped list
// lines again for one-offs.

function parseSchedule(content: string): ClassScheduleFile {
  const { fields, body } = parseFrontmatter(content);
  const dayStartMin = fields['cc2-schedule-day-start'] ? timeToMin(fields['cc2-schedule-day-start']) : DEFAULT_SCHEDULE.dayStartMin;
  const dayEndMin   = fields['cc2-schedule-day-end']   ? timeToMin(fields['cc2-schedule-day-end'])   : DEFAULT_SCHEDULE.dayEndMin;

  const series: SeriesBlock[] = [];
  const exceptions: ScheduleException[] = [];
  const oneOffs: OneOffBlock[] = [];

  type Section = 'template' | 'exceptions' | 'oneoffs' | null;
  let section: Section = null;
  let curWeekday = -1;
  let curDate = '';
  let tableRow = 0;

  for (const raw of body.split('\n')) {
    const t = raw.trim();

    if (/^##\s+Weekly Template/i.test(t))   { section = 'template'; continue; }
    if (/^##\s+Exceptions/i.test(t))        { section = 'exceptions'; tableRow = 0; continue; }
    if (/^##\s+One-Off Blocks/i.test(t))    { section = 'oneoffs'; continue; }
    if (/^##\s+/.test(t)) { section = null; continue; }

    if (section === 'template') {
      const dayMatch = /^###\s+(.+)$/.exec(t);
      if (dayMatch) { curWeekday = (WEEKDAYS as readonly string[]).indexOf(dayMatch[1].trim()); continue; }
      const m = /^-\s*id:(\S+)\s*\|\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*\|\s*(\S+)/.exec(t);
      if (m && curWeekday !== -1) {
        series.push({ id: m[1], weekday: curWeekday, startMin: timeToMin(m[2]), endMin: timeToMin(m[3]), classId: m[4] });
      }
      continue;
    }

    if (section === 'exceptions') {
      if (!t.startsWith('|')) continue;
      tableRow++;
      if (tableRow <= 2) continue; // header + "| --- |" separator
      const cells = t.split('|').map(c => c.trim()).slice(1, -1);
      if (cells.length < 4) continue;
      const [seriesId, date, typeRaw, newTime] = cells;
      const type: ExceptionType = /skip/i.test(typeRaw) ? 'skip' : 'modify';
      let startMin: number | undefined, endMin: number | undefined;
      if (type === 'modify' && newTime) {
        const tm = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(newTime.trim());
        if (tm) { startMin = timeToMin(tm[1]); endMin = timeToMin(tm[2]); }
      }
      exceptions.push({ seriesId, date, type, startMin, endMin });
      continue;
    }

    if (section === 'oneoffs') {
      const dateMatch = /^###\s+(\d{4}-\d{2}-\d{2})$/.exec(t);
      if (dateMatch) { curDate = dateMatch[1]; continue; }
      const m = /^-\s*id:(\S+)\s*\|\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*\|\s*([^|]+?)(?:\s*\|\s*(\S+))?\s*$/.exec(t);
      if (m && curDate) {
        oneOffs.push({ id: m[1], date: curDate, startMin: timeToMin(m[2]), endMin: timeToMin(m[3]), title: m[4].trim(), classId: m[5] || undefined });
      }
      continue;
    }
  }

  return { dayStartMin, dayEndMin, series, exceptions, oneOffs };
}

function serializeSchedule(s: ClassScheduleFile): string {
  const fields: Record<string, string> = {
    'cc2-schedule-day-start': `"${minToTime(s.dayStartMin)}"`,
    'cc2-schedule-day-end':   `"${minToTime(s.dayEndMin)}"`,
  };

  const lines: string[] = ['## Weekly Template', ''];
  for (let d = 0; d < WEEKDAYS.length; d++) {
    lines.push(`### ${WEEKDAYS[d]}`);
    for (const b of s.series.filter(x => x.weekday === d)) {
      lines.push(`- id:${b.id} | ${minToTime(b.startMin)}-${minToTime(b.endMin)} | ${b.classId}`);
    }
    lines.push('');
  }

  lines.push('## Exceptions');
  if (s.exceptions.length > 0) {
    lines.push('| Series | Date | Type | New Time |', '| --- | --- | --- | --- |');
    for (const e of s.exceptions) {
      const typeLabel = e.type === 'skip' ? 'Skip' : 'Modify';
      const newTime = e.type === 'modify' && e.startMin != null && e.endMin != null
        ? `${minToTime(e.startMin)}-${minToTime(e.endMin)}` : '';
      lines.push(`| ${e.seriesId} | ${e.date} | ${typeLabel} | ${newTime} |`);
    }
  }
  lines.push('');

  lines.push('## One-Off Blocks');
  const byDate = new Map<string, OneOffBlock[]>();
  for (const o of s.oneOffs) {
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date)!.push(o);
  }
  for (const [date, items] of Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${date}`);
    for (const o of items) {
      lines.push(`- id:${o.id} | ${minToTime(o.startMin)}-${minToTime(o.endMin)} | ${o.title}${o.classId ? ` | ${o.classId}` : ''}`);
    }
  }
  lines.push('');

  return serializeFrontmatter(fields, `\n${lines.join('\n')}`);
}

// ── Read / ensure / watch ──

export async function ensureScheduleFile(app: App): Promise<void> {
  const path = scheduleFilePath(app);
  if (app.vault.getAbstractFileByPath(path)) return;
  const root = resolveCommandCenterPath(app, 'Education');
  if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root).catch(() => {});
  await app.vault.create(path, serializeSchedule(DEFAULT_SCHEDULE)).catch(() => {});
}

export async function readSchedule(app: App): Promise<ClassScheduleFile> {
  await ensureScheduleFile(app);
  const file = app.vault.getAbstractFileByPath(scheduleFilePath(app));
  if (!(file instanceof TFile)) return DEFAULT_SCHEDULE;
  return parseSchedule(await app.vault.read(file));
}

export function watchScheduleFile(app: App, cb: () => void): () => void {
  const path = scheduleFilePath(app);
  const handler = (file: TAbstractFile) => { if (file.path === path) cb(); };
  const ref = app.vault.on('modify', handler);
  return () => app.vault.offref(ref);
}

async function withSchedule(app: App, mutate: (s: ClassScheduleFile) => void): Promise<void> {
  await ensureScheduleFile(app);
  const file = app.vault.getAbstractFileByPath(scheduleFilePath(app));
  if (!(file instanceof TFile)) return;
  await app.vault.process(file, content => {
    const s = parseSchedule(content);
    mutate(s);
    return serializeSchedule(s);
  });
}

// ── Series (whole-recurrence) mutations ──

export async function addSeriesBlock(app: App, weekday: number, startMin: number, endMin: number, classId: string): Promise<string> {
  const id = genId('cs');
  await withSchedule(app, s => { s.series.push({ id, weekday, startMin, endMin, classId }); });
  return id;
}

// Whole-series time change ("every session") — used by the instance/series
// prompt's "series" branch when the edit originated from a resize/reschedule.
export async function updateSeriesTime(app: App, seriesId: string, startMin: number, endMin: number): Promise<void> {
  await withSchedule(app, s => {
    const b = s.series.find(x => x.id === seriesId);
    if (b) { b.startMin = startMin; b.endMin = endMin; }
  });
}

// Deletes the whole series AND every exception that referenced it — an
// orphaned exception row would otherwise silently linger, keyed to an id
// nothing resolves to anymore.
export async function deleteSeriesBlock(app: App, seriesId: string): Promise<void> {
  await withSchedule(app, s => {
    s.series = s.series.filter(b => b.id !== seriesId);
    s.exceptions = s.exceptions.filter(e => e.seriesId !== seriesId);
  });
}

// Deletes every series block tied to a given class — called from
// class-info.ts's archiveClass cascade so an archived class's recurring
// sessions disappear from the scheduler too.
export async function deleteSeriesBlocksForClass(app: App, classId: string): Promise<void> {
  await withSchedule(app, s => {
    const removedIds = new Set(s.series.filter(b => b.classId === classId).map(b => b.id));
    if (removedIds.size === 0) return;
    s.series = s.series.filter(b => b.classId !== classId);
    s.exceptions = s.exceptions.filter(e => !removedIds.has(e.seriesId));
  });
}

// ── Exceptions (single-occurrence overrides) — upsert-by-(seriesId,date) ──

export async function modifyOccurrence(app: App, seriesId: string, date: string, startMin: number, endMin: number): Promise<void> {
  await withSchedule(app, s => {
    const idx = s.exceptions.findIndex(e => e.seriesId === seriesId && e.date === date);
    const row: ScheduleException = { seriesId, date, type: 'modify', startMin, endMin };
    if (idx === -1) s.exceptions.push(row); else s.exceptions[idx] = row;
  });
}

export async function skipOccurrence(app: App, seriesId: string, date: string): Promise<void> {
  await withSchedule(app, s => {
    const idx = s.exceptions.findIndex(e => e.seriesId === seriesId && e.date === date);
    const row: ScheduleException = { seriesId, date, type: 'skip' };
    if (idx === -1) s.exceptions.push(row); else s.exceptions[idx] = row;
  });
}

// ── One-off blocks — no recurrence, no ambiguity. Same shape as
// meal-plan.ts's placeMeal/moveMeal/stretchMeal/removeMeal. ──

export async function addOneOffBlock(app: App, date: string, startMin: number, endMin: number, title: string, classId?: string): Promise<string> {
  const id = genId('oo');
  await withSchedule(app, s => { s.oneOffs.push({ id, date, startMin, endMin, title, classId }); });
  return id;
}

export async function moveOneOffBlock(app: App, id: string, date: string, startMin: number, endMin: number): Promise<void> {
  await withSchedule(app, s => {
    const b = s.oneOffs.find(x => x.id === id);
    if (b) { b.date = date; b.startMin = startMin; b.endMin = endMin; }
  });
}

export async function stretchOneOffBlock(app: App, id: string, startMin: number, endMin: number): Promise<void> {
  await withSchedule(app, s => {
    const b = s.oneOffs.find(x => x.id === id);
    if (b) { b.startMin = startMin; b.endMin = endMin; }
  });
}

export async function removeOneOffBlock(app: App, id: string): Promise<void> {
  await withSchedule(app, s => { s.oneOffs = s.oneOffs.filter(b => b.id !== id); });
}

export async function updateDayBounds(app: App, dayStartMin: number, dayEndMin: number): Promise<void> {
  await withSchedule(app, s => { s.dayStartMin = dayStartMin; s.dayEndMin = dayEndMin; });
}

// ── Resolve a real week ──

// Merges series + exceptions + one-offs into what actually renders for one
// real calendar week. Series blocks are exact-match on weekday (the "row"
// axis in meal-plan.ts's fitsPlan is exact-match there too) — start/end
// minute is the span axis (was day+colSpan there). Computed fresh on every
// call, never persisted.
export function resolveWeek(
  schedule: ClassScheduleFile,
  weekStart: Date,
  classesById: Map<string, { code: string; color?: string; room?: string }>,
): EffectiveBlock[] {
  const out: EffectiveBlock[] = [];
  const monday = startOfWeek(weekStart);
  const weekDates: string[] = [];
  for (let d = 0; d < 7; d++) weekDates.push(localISO(addDays(monday, d)));

  for (let d = 0; d < 7; d++) {
    const date = weekDates[d];
    for (const series of schedule.series.filter(s => s.weekday === d)) {
      const exception = schedule.exceptions.find(e => e.seriesId === series.id && e.date === date);
      if (exception?.type === 'skip') continue;

      const cls = classesById.get(series.classId);
      const modified = exception?.type === 'modify' && exception.startMin != null && exception.endMin != null;
      out.push({
        kind:     modified ? 'series-modified' : 'series',
        date, weekday: d,
        startMin: modified ? exception!.startMin! : series.startMin,
        endMin:   modified ? exception!.endMin!   : series.endMin,
        title:    cls?.code ?? series.classId,
        classId:  series.classId,
        color:    cls?.color,
        room:     cls?.room,
        seriesId: series.id,
      });
    }
  }

  const weekDateSet = new Set(weekDates);
  for (const o of schedule.oneOffs) {
    if (!weekDateSet.has(o.date)) continue;
    const dt = new Date(`${o.date}T00:00:00`);
    const weekday = (dt.getDay() + 6) % 7; // Sun=0..Sat=6 -> Mon=0..Sun=6
    out.push({
      kind: 'one-off', date: o.date, weekday,
      startMin: o.startMin, endMin: o.endMin,
      title: o.title, classId: o.classId,
      color: o.classId ? classesById.get(o.classId)?.color : undefined,
      room:  o.classId ? classesById.get(o.classId)?.room : undefined,
      oneOffId: o.id,
    });
  }

  return out;
}

// Vertical rotation of meal-plan.ts's fitsPlan: weekday is now the
// exact-match axis (was row there), start/end-minute is the span axis (was
// day+colSpan there) — a real axis swap, not just relabeled variable names.
export function fitsSchedule(
  blocks: EffectiveBlock[], weekday: number, startMin: number, endMin: number, dayEndMin: number, ignore?: EffectiveBlock,
): boolean {
  if (endMin > dayEndMin) return false;
  for (const b of blocks) {
    if (b === ignore || b.weekday !== weekday) continue;
    if (startMin < b.endMin && b.startMin < endMin) return false;
  }
  return true;
}
