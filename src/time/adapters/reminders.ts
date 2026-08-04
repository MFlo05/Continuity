import type { App } from 'obsidian';
import { classesFolder, listClasses } from '../../data-sources/class-info';
import { readReminders } from '../../data-sources/class-reminders';
import { getCC2Plugin } from '../../../main';
import type { TimelineAdapter, TimelineEvent } from '../types';

/**
 * Per-class reminders — the one part of the class timeline the user authors
 * directly, rather than importing from a syllabus.
 *
 * Already `{ id, date, text }` on disk with a real stable id, so this is close
 * to a straight mapping. Day-granular: a reminder has no clock time.
 */
export const remindersAdapter: TimelineAdapter = {
  id:    'reminders',
  label: 'Reminders',
  kinds: ['reminder'],

  async read(app: App, from: string, to: string): Promise<TimelineEvent[]> {
    const classes = await listClasses(app);
    const out: TimelineEvent[] = [];

    await Promise.all(classes.map(async cls => {
      for (const r of await readReminders(app, cls.slug)) {
        if (r.date < from || r.date > to) continue;
        out.push({
          id:       `reminder:${cls.slug}:${r.id}`,
          date:     r.date,
          title:    r.text,
          detail:   cls.code,
          kind:     'reminder',
          sourceId: 'reminders',
          tone:     cls.color,
          open:     () => { void getCC2Plugin(app)?.activateClassView(cls.slug); },
        });
      }
    }));

    return out;
  },

  watch(app: App) {
    return { folders: [classesFolder(app)] };
  },
};
