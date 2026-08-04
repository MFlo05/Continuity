import type { App } from 'obsidian';
import { isISODate } from '../../core/dates';
import { classesFolder, listClasses, readClassTranscript } from '../../data-sources/class-info';
import { readProgress } from '../../data-sources/class-progress';
import { mergeAssignments } from '../../widgets/class-page/assignment-utils';
import { getCC2Plugin } from '../../../main';
import type { TimelineAdapter, TimelineEvent } from '../types';

/**
 * Assignment due dates, across every active class.
 *
 * Reuses mergeAssignments, so syllabus rows and the student's own custom ones
 * arrive already folded together with their status — this adapter never
 * re-derives that.
 *
 * ── THE FREE-TEXT HAZARD ──────────────────────────────────────────────────
 *
 * `AssignmentRow.dateOrWeek` is TYPED as an ISO date but isn't reliably one.
 * ClassAssignmentsWidget collects it from a field whose placeholder is
 * literally "Due (e.g. Oct 24)", and real syllabi contain "Varies", "Weekly",
 * and week numbers. ClassCalendarWidget filters the same field by LEXICAL
 * string comparison, so anything non-ISO is silently dropped from the class
 * timeline today — it just never appears, with no indication.
 *
 * This adapter drops them too (there is no date to place them on), but
 * reports the count so a consumer can say "3 undated" rather than quietly
 * losing them. Fixing the input side is a separate job; hiding the problem
 * here would make that job harder to notice.
 */

/** How many assignments were skipped for having an unparseable date. */
export interface UndatedReport { undated: number; examples: string[] }

let lastReport: UndatedReport = { undated: 0, examples: [] };

/** Undated assignments seen on the most recent read. */
export function lastUndatedReport(): UndatedReport {
  return lastReport;
}

export const assignmentsAdapter: TimelineAdapter = {
  id:    'assignments',
  label: 'Assignments',
  kinds: ['assignment'],

  async read(app: App, from: string, to: string): Promise<TimelineEvent[]> {
    const classes = await listClasses(app);
    const out: TimelineEvent[] = [];
    const report: UndatedReport = { undated: 0, examples: [] };

    await Promise.all(classes.map(async cls => {
      const [transcript, progress] = await Promise.all([
        readClassTranscript(app, cls.slug),
        readProgress(app, cls.slug),
      ]);

      for (const a of mergeAssignments(transcript, progress)) {
        const raw = (a.dateOrWeek ?? '').trim();
        if (!raw) continue;                       // deliberately blank ("Varies")
        if (!isISODate(raw)) {
          report.undated += 1;
          if (report.examples.length < 5) report.examples.push(`${cls.code}: ${a.item} (“${raw}”)`);
          continue;
        }
        const date = raw.slice(0, 10);
        if (date < from || date > to) continue;

        out.push({
          id:       `assignment:${cls.slug}:${a.item}:${date}`,
          date,
          // Due dates are day-granular — no clock time exists anywhere in the
          // transcript format, so these are all-day by construction.
          title:    a.item,
          detail:   [cls.code, a.worth].filter(Boolean).join(' · '),
          kind:     'assignment',
          sourceId: 'assignments',
          tone:     cls.color,
          open:     () => { void getCC2Plugin(app)?.activateClassView(cls.slug); },
        });
      }
    }));

    lastReport = report;
    return out;
  },

  watch(app: App) {
    // Both Class-Transcript.md and Progress.md live inside the class folder.
    return { folders: [classesFolder(app)] };
  },
};
