import { App, TFile, TAbstractFile } from 'obsidian';
import { startOfWeek, addDays, localISO, WEEKDAYS } from '../core/dates';
import { recipesFolder } from './recipes';
import { resolveCommandCenterPath } from './vault-paths';

export function mealPlanFolder(app: App): string {
  return resolveCommandCenterPath(app, 'meal-plans');
}

// Days are columns (full-width, 7 across), meal slots are rows — matches the
// widget's own 12x4 shape (width -> days, height -> slots). Blocks reference
// these by numeric index (0-6 / 0-3) rather than by name — a meal can span
// multiple day-columns (colSpan), and a row/day range can only ever belong
// to ONE meal at a time (fitsPlan enforces no overlap), unlike the earlier
// version of this widget which allowed several meals stacked in one cell.
// "Duplicate" now means placing a second, independent block elsewhere — not
// a second entry in the same slot.
/** Kept as `DAYS` for its existing callers; the names come from core/dates. */
export const DAYS = WEEKDAYS;
export const MEAL_SLOTS = ['Breakfast', 'Snacks', 'Lunch', 'Dinner'] as const;
export type Day = typeof DAYS[number];
export type MealSlot = typeof MEAL_SLOTS[number];

// Identified by its own (day, row) start position rather than a persisted
// id — safe because fitsPlan guarantees no two blocks in the same row ever
// share a start day, so (day, row) is already a stable, unique key for as
// long as the block exists.
export interface MealBlock {
  day:         number; // 0-6, index into DAYS
  row:         number; // 0-3, index into MEAL_SLOTS
  colSpan:     number; // >=1, day + colSpan - 1 always <= 6
  recipeTitle: string;
  recipePath?: string; // resolved fresh on every read; absent if the recipe no longer exists
}

export type WeekPlan = MealBlock[];

export function weekFilePath(app: App, weekStart: Date): string {
  return `${mealPlanFolder(app)}/${localISO(startOfWeek(weekStart))}.md`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  await app.vault.createFolder(path).catch(() => { /* race with another creator — fine */ });
}

// Only a block's STARTING day gets a line — the days it spans over are
// implied by day + colSpan, never written under their own section.
function parseWeekPlan(content: string): MealBlock[] {
  const blocks: MealBlock[] = [];
  let curDay = -1;
  let curRow = -1;

  for (const raw of content.split('\n')) {
    const line = raw.trim();

    const dayMatch = /^##\s+(.+)$/.exec(line);
    if (dayMatch) {
      const idx = (DAYS as readonly string[]).indexOf(dayMatch[1].trim());
      if (idx !== -1) { curDay = idx; curRow = -1; continue; }
    }

    const slotMatch = /^###\s+(.+)$/.exec(line);
    if (slotMatch && curDay !== -1) {
      const idx = (MEAL_SLOTS as readonly string[]).indexOf(slotMatch[1].trim());
      if (idx !== -1) { curRow = idx; continue; }
    }

    const mealMatch = /^-\s*\[\[([^\]]+)\]\](?:\s*\(span\s*(\d+)\))?\s*$/.exec(line);
    if (mealMatch && curDay !== -1 && curRow !== -1) {
      const requested = mealMatch[2] ? Math.max(1, parseInt(mealMatch[2], 10)) : 1;
      const colSpan = Math.min(requested, DAYS.length - curDay); // clamp — never let a stale span run past Sunday
      blocks.push({ day: curDay, row: curRow, colSpan, recipeTitle: mealMatch[1].trim() });
    }
  }
  return blocks;
}

function serializeWeekPlan(blocks: MealBlock[]): string {
  const lines: string[] = [];
  for (let d = 0; d < DAYS.length; d++) {
    lines.push(`## ${DAYS[d]}`);
    for (let r = 0; r < MEAL_SLOTS.length; r++) {
      lines.push(`### ${MEAL_SLOTS[r]}`);
      for (const b of blocks) {
        if (b.day !== d || b.row !== r) continue;
        lines.push(b.colSpan > 1 ? `- [[${b.recipeTitle}]] (span ${b.colSpan})` : `- [[${b.recipeTitle}]]`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function resolveRecipePaths(app: App, blocks: MealBlock[]): MealBlock[] {
  const folder = recipesFolder(app);
  return blocks.map(b => {
    const path = `${folder}/${b.recipeTitle}.md`;
    return app.vault.getAbstractFileByPath(path) instanceof TFile ? { ...b, recipePath: path } : b;
  });
}

// Same overlap/bounds rule the design prototype uses: a block may not run
// past Sunday, and no two blocks in the same row may overlap. `ignore` lets
// a block's own current position be excluded while stretching/moving it.
export function fitsPlan(blocks: MealBlock[], day: number, row: number, colSpan: number, ignore?: MealBlock): boolean {
  if (day + colSpan - 1 > DAYS.length - 1) return false;
  for (const b of blocks) {
    if (b === ignore || b.row !== row) continue;
    const a0 = day, a1 = day + colSpan - 1, b0 = b.day, b1 = b.day + b.colSpan - 1;
    if (a0 <= b1 && b0 <= a1) return false;
  }
  return true;
}

export async function ensureWeekFile(app: App, weekStart: Date): Promise<void> {
  const path = weekFilePath(app, weekStart);
  if (app.vault.getAbstractFileByPath(path)) return;
  await ensureFolder(app, mealPlanFolder(app));
  await app.vault.create(path, serializeWeekPlan([]));
}

export async function readWeekPlan(app: App, weekStart: Date): Promise<WeekPlan> {
  const path = weekFilePath(app, weekStart);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return [];
  return resolveRecipePaths(app, parseWeekPlan(await app.vault.read(file)));
}

// Used for both "place a new meal from the Recipe Box" and "duplicate" (a
// duplicate is just placeMeal called again with the same recipe/span at a
// different spot the user clicks). requestedSpan shrinks until it fits,
// exactly like the design's own _place(); if it doesn't fit even at 1, the
// call is a silent no-op (mirrors the prototype only placing on a valid
// data-daycell hit — this is the persistence-layer equivalent of that guard).
export async function placeMeal(
  app: App, weekStart: Date, day: number, row: number, recipeTitle: string, requestedSpan = 1,
): Promise<void> {
  await ensureWeekFile(app, weekStart);
  const path = weekFilePath(app, weekStart);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.vault.process(file, content => {
    const blocks = parseWeekPlan(content);
    let span = Math.max(1, requestedSpan);
    while (span > 1 && !fitsPlan(blocks, day, row, span)) span--;
    if (!fitsPlan(blocks, day, row, span)) return content;
    blocks.push({ day, row, colSpan: span, recipeTitle });
    return serializeWeekPlan(blocks);
  });
}

export async function moveMeal(
  app: App, weekStart: Date,
  from: { day: number; row: number }, to: { day: number; row: number },
): Promise<void> {
  const path = weekFilePath(app, weekStart);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.vault.process(file, content => {
    const blocks = parseWeekPlan(content);
    const idx = blocks.findIndex(b => b.day === from.day && b.row === from.row);
    if (idx === -1) return content;
    const [moving] = blocks.splice(idx, 1);
    let span = Math.max(1, moving.colSpan);
    while (span > 1 && !fitsPlan(blocks, to.day, to.row, span)) span--;
    if (!fitsPlan(blocks, to.day, to.row, span)) return content; // can't fit anywhere at the target — leave untouched
    blocks.push({ ...moving, day: to.day, row: to.row, colSpan: span });
    return serializeWeekPlan(blocks);
  });
}

export async function stretchMeal(app: App, weekStart: Date, day: number, row: number, newColSpan: number): Promise<void> {
  const path = weekFilePath(app, weekStart);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.vault.process(file, content => {
    const blocks = parseWeekPlan(content);
    const b = blocks.find(x => x.day === day && x.row === row);
    if (!b) return content;
    let span = Math.max(1, newColSpan);
    while (span > 1 && !fitsPlan(blocks, day, row, span, b)) span--;
    b.colSpan = span;
    return serializeWeekPlan(blocks);
  });
}

export async function removeMeal(app: App, weekStart: Date, day: number, row: number): Promise<void> {
  const path = weekFilePath(app, weekStart);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.vault.process(file, content =>
    serializeWeekPlan(parseWeekPlan(content).filter(b => !(b.day === day && b.row === row))),
  );
}

export function watchMealPlanFile(app: App, weekStart: Date, onChange: () => void): () => void {
  const path = weekFilePath(app, weekStart);
  const handler = (file: TAbstractFile) => { if (file.path === path) onChange(); };
  const ref = app.vault.on('modify', handler);
  return () => app.vault.offref(ref);
}

// Monday-indexed day dates for a given week — used to render "Mon Jul 6" style headers.
export function datesForWeek(weekStart: Date): Date[] {
  const monday = startOfWeek(weekStart);
  return DAYS.map((_, i) => addDays(monday, i));
}
