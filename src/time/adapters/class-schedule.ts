import type { App } from 'obsidian';
import { addDays, localISO, parseLocalISO, startOfWeek } from '../../core/dates';
import { classesFolder, listClasses } from '../../data-sources/class-info';
import { readSchedule, resolveWeek, scheduleFilePath } from '../../data-sources/class-schedule';
import { getCC2Plugin } from '../../../main';
import type { TimelineAdapter, TimelineEvent } from '../types';

/**
 * Class meetings — the only source in the app with a real recurrence model.
 *
 * `resolveWeek` does all the work: it folds the weekly template together with
 * skip/modify exceptions and standalone one-offs, and returns concrete dated
 * occurrences. This adapter's whole job is to call it once per week the window
 * touches, because resolveWeek is week-scoped by design (the schedule file
 * stores a template, never materialised weeks).
 *
 * The week-stepping loop mirrors ClassCalendarWidget's, which has been doing
 * exactly this since before the timeline layer existed.
 */
export const classScheduleAdapter: TimelineAdapter = {
  id:    'class-schedule',
  label: 'Classes',
  kinds: ['class'],

  async read(app: App, from: string, to: string): Promise<TimelineEvent[]> {
    const start = parseLocalISO(from);
    const end   = parseLocalISO(to);
    if (!start || !end || end < start) return [];

    const [schedule, classes] = await Promise.all([readSchedule(app), listClasses(app)]);
    const byId = new Map(classes.map(c => [c.slug, { code: c.code, color: c.color, room: c.room }]));

    const out: TimelineEvent[] = [];
    const seenWeeks = new Set<number>();

    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const monday = startOfWeek(d);
      if (seenWeeks.has(monday.getTime())) continue;
      seenWeeks.add(monday.getTime());

      for (const block of resolveWeek(schedule, monday, byId)) {
        // resolveWeek returns the whole week; the window may start or end
        // mid-week, so clip. Lexical comparison is safe on YYYY-MM-DD.
        if (block.date < from || block.date > to) continue;

        out.push({
          id:       `class:${block.seriesId ?? block.oneOffId}:${block.date}`,
          date:     block.date,
          startMin: block.startMin,
          endMin:   block.endMin,
          title:    block.title,
          detail:   block.room,
          kind:     'class',
          sourceId: 'class-schedule',
          tone:     block.color,
          open:     block.classId ? () => { void getCC2Plugin(app)?.activateClassView(block.classId!); } : undefined,
        });
      }
    }
    return out;
  },

  watch(app: App) {
    // The classes folder matters as much as the schedule file: a class's code,
    // colour or room is resolved into every occurrence's display.
    return {
      paths:   [scheduleFilePath(app)],
      folders: [classesFolder(app)],
    };
  },
};
