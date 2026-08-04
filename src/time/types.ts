import type { App } from 'obsidian';

/**
 * src/time/ — the timeline query layer.
 *
 * A FOURTH axis, alongside codec / renderer / preset. Those three describe one
 * source: a codec says how it lives on disk, a renderer how it's drawn, a
 * preset which pair to use. This layer describes a QUESTION asked across many
 * sources at once — "what is happening on this day" — and it deliberately owns
 * no storage of its own.
 *
 * ── WHY THIS IS NOT A CODEC ───────────────────────────────────────────────
 *
 * It was proposed as one. Three things make that impossible, and they're worth
 * recording so it isn't re-proposed:
 *
 * 1. A `SourceRef` addresses exactly ONE physical location — a `path` or a
 *    `folder`. There is no array, union, or virtual variant, and sourceKey,
 *    sourcePath and withSourceLocation all assume that. A cross-source view
 *    has no single location to name.
 * 2. `Codec` requires add/update/remove/ensure and has no read-only flavour.
 *    "Add an event" has no coherent answer here — the target file depends
 *    entirely on what KIND of event it is.
 * 3. Most of what this reads isn't codec-backed anyway: class schedules,
 *    reminders, meal plans and transcripts are all bespoke, and Google
 *    Calendar is a remote API with no vault file at all.
 *
 * WIDGET-INVENTORY.md named this shape when it filed My Teachers as a derived
 * join: "Needs a query layer, not a codec." This is that, one layer wider.
 *
 * ── WHY `date` + `startMin` RATHER THAN EPOCH MS ──────────────────────────
 *
 * Five of the six sources already speak exactly this. The class schedule
 * stores minutes-from-midnight because a weekly template has no date to hang
 * a timestamp on; meal plans and reminders are date-only with no clock time at
 * all. Only Google Calendar uses epoch ms. Converting one adapter is far
 * cheaper than converting five, and — more importantly — it avoids inventing
 * timezone semantics for sources that genuinely have none. A meal planned for
 * Tuesday is planned for Tuesday, not for an instant.
 */

export type TimelineKind =
  | 'class'        // a class meeting, from the weekly schedule
  | 'assignment'   // a due date from a syllabus or the student's own additions
  | 'reminder'     // a user-authored per-class note
  | 'meal'         // a planned meal
  | 'calendar'     // a Google Calendar event
  | 'bill';        // an upcoming recurring financial item

export interface TimelineEvent {
  /**
   * Namespaced by adapter, e.g. `class:cs123:2026-08-14`. Must be stable for
   * one read so React keys don't thrash, and unique across adapters — two
   * sources can legitimately produce an event for the same day with the same
   * title.
   */
  id:        string;
  /** Local `YYYY-MM-DD`. Every adapter emits this; none emit a timestamp. */
  date:      string;
  /** Minutes from local midnight. ABSENT means all-day / no clock time. */
  startMin?: number;
  endMin?:   number;
  title:     string;
  /** Secondary line — a room, a category, a class code. */
  detail?:   string;
  kind:      TimelineKind;
  /** Which adapter produced this, for filtering and provenance. */
  sourceId:  string;
  /** Colour hint: a class's colour, a calendar's colour, a slot's tone. */
  tone?:     string;
  /**
   * What a click does. The adapter decides, because only it knows what the
   * event points at — a note, a class page, a Google link, or nothing.
   * Absent means the event isn't actionable.
   */
  open?:     () => void;
}

/**
 * One source's contribution to the timeline.
 *
 * Read-only by construction: there is no write method, and there will not be
 * one. Editing an event means going to the widget that owns it — which is
 * also the only place that knows what "editing" means for that kind.
 */
export interface TimelineAdapter {
  id:    string;
  label: string;
  /** Which kinds this adapter can emit, so a consumer can filter cheaply. */
  kinds: TimelineKind[];
  /**
   * Events falling within [from, to], both inclusive local `YYYY-MM-DD`.
   *
   * Must not throw: a source that is unconfigured, disconnected or absent
   * returns an empty array. One missing class file should never blank the
   * whole day.
   */
  read(app: App, from: string, to: string): Promise<TimelineEvent[]>;
  /**
   * Vault paths/folders whose changes should trigger a re-read. Omitted for
   * sources with no vault presence (Google Calendar). Same shape as a codec's
   * `watchTargets`, and fed to the same shared subscription hub.
   */
  watch?(app: App): { paths?: string[]; folders?: string[] };
}

/** Sort key: by date, then timed-before-untimed, then title. */
export function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  // An all-day event has no start; it sorts AFTER timed ones for the same day,
  // which is how every calendar UI in this app already presents them.
  const am = a.startMin ?? 24 * 60 + 1;
  const bm = b.startMin ?? 24 * 60 + 1;
  if (am !== bm) return am - bm;
  return a.title.localeCompare(b.title);
}
