import type { App } from 'obsidian';
import { addDays, localISO, parseLocalISO, startOfWeek } from '../../core/dates';
import { MEAL_SLOTS, mealPlanFolder, readWeekPlan } from '../../data-sources/meal-plan';
import type { TimelineAdapter, TimelineEvent } from '../types';

/**
 * Planned meals.
 *
 * The interesting part is that **a MealBlock carries no date at all** — its
 * identity is a `(day, row)` pair, and the week it belongs to is encoded in
 * the filename (`meal-plans/2026-08-03.md`, Monday-anchored). So the absolute
 * date is derived here: week start + block.day.
 *
 * A block can span several days (`colSpan`), which means one stored block
 * legitimately produces several timeline events — leftovers on Tuesday are
 * still dinner on Tuesday.
 *
 * Meals have no clock time; `row` is a named slot (Breakfast…Dinner), which
 * becomes the detail line rather than a startMin. Sorting within a day
 * therefore falls back to title, so the slot name is placed first in `detail`
 * where it's most useful to read.
 */
export const mealPlanAdapter: TimelineAdapter = {
  id:    'meal-plan',
  label: 'Meals',
  kinds: ['meal'],

  async read(app: App, from: string, to: string): Promise<TimelineEvent[]> {
    const start = parseLocalISO(from);
    const end   = parseLocalISO(to);
    if (!start || !end || end < start) return [];

    const out: TimelineEvent[] = [];
    const weeks: Date[] = [];
    for (let w = startOfWeek(start); w <= end; w = addDays(w, 7)) weeks.push(w);

    await Promise.all(weeks.map(async weekStart => {
      const plan = await readWeekPlan(app, weekStart);
      for (const block of plan) {
        // One block, colSpan days — each day is its own event.
        for (let i = 0; i < Math.max(1, block.colSpan); i++) {
          const date = localISO(addDays(weekStart, block.day + i));
          if (date < from || date > to) continue;

          out.push({
            id:       `meal:${localISO(weekStart)}:${block.day}:${block.row}:${i}`,
            date,
            title:    block.recipeTitle,
            detail:   MEAL_SLOTS[block.row] ?? '',
            kind:     'meal',
            sourceId: 'meal-plan',
            open:     block.recipePath
              ? () => { void app.workspace.openLinkText(block.recipePath!, ''); }
              : undefined,
          });
        }
      }
    }));

    return out;
  },

  watch(app: App) {
    // One file per week — watch the folder rather than enumerating paths.
    return { folders: [mealPlanFolder(app)] };
  },
};
