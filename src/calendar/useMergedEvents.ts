import { useMemo } from 'react';
import type { App } from 'obsidian';
import { localISO } from '../core/dates';
import { useCalendar } from './CalendarContext';
import { toCalEvents, isSourceCalId, SOURCE_CALENDARS } from './timeline-bridge';
import { useTimeline } from '../time/useTimeline';
import type { CalEvent, CalendarMeta } from './calendar';
import type { TimelineKind } from '../time/types';

/**
 * calendar/useMergedEvents.ts — Google events plus vault events, as one list.
 *
 * MERGES AT READ TIME, NEVER INTO CONTEXT STATE. `CalendarContext.loadRange`
 * does `setEvents(evts)` — replacing the whole array — on every 30-minute
 * refresh, and `logout()` sets it to `[]`. Anything merged into that state
 * would be silently wiped twice: once every half hour, and again on sign-out.
 * Keeping the merge here means the context stays purely Google's, which is
 * also what makes this reversible.
 *
 * Visibility rides entirely on the existing `hiddenCalIds` mechanism, because
 * every vault source is given a synthetic calendar id (see timeline-bridge).
 * No second filter, no second toggle, no second place for the two to disagree.
 */

/** Vault sources the user has switched off, as timeline kinds. */
function enabledKinds(hiddenCalIds: string[]): TimelineKind[] {
  const hidden = new Set(hiddenCalIds.filter(isSourceCalId));
  const all: Array<[TimelineKind, string]> = [
    ['class',      'cc2:class-schedule'],
    ['assignment', 'cc2:assignments'],
    ['reminder',   'cc2:reminders'],
    ['meal',       'cc2:meal-plan'],
    ['bill',       'cc2:recurring'],
  ];
  // 'calendar' is Google's own and never comes from the timeline layer here.
  return all.filter(([, calId]) => !hidden.has(calId)).map(([kind]) => kind);
}

export interface MergedEvents {
  /** Google + vault, visibility already applied. */
  events: CalEvent[];
  /** Every toggleable source, Google's calendars first. */
  legend: CalendarMeta[];
  loading: boolean;
  /**
   * Opens a vault-sourced event.
   *
   * `CalEvent` has no room for a callback, so the conversion drops the
   * timeline event's own `open()`. Rather than widen the calendar's type for
   * something only vault events use, the original actions are kept beside the
   * list and looked up by id here.
   */
  openEvent: (ev: CalEvent) => void;
}

/**
 * `from`/`to` are local `YYYY-MM-DD`. Keep the window modest — the vault
 * adapters expand recurrences across it, so a year-wide range is real work.
 */
export function useMergedEvents(app: App, from: Date, to: Date): MergedEvents {
  const { events: googleEvents, hiddenCalIds, calendars } = useCalendar();

  const fromISO = localISO(from);
  const toISO   = localISO(to);
  const kinds   = useMemo(() => enabledKinds(hiddenCalIds), [hiddenCalIds]);

  // The timeline layer never yields Google events — those come from the
  // context above. Asking for both would double every calendar entry.
  const { events: timelineEvents, loading } = useTimeline(app, fromISO, toISO, kinds);

  const events = useMemo(() => {
    const vault = toCalEvents(timelineEvents);
    const google = googleEvents.filter(e => !hiddenCalIds.includes(e.calendarId));
    return [...google, ...vault].sort((a, b) => a.startMs - b.startMs);
  }, [googleEvents, timelineEvents, hiddenCalIds]);

  const legend = useMemo(() => [...calendars, ...SOURCE_CALENDARS], [calendars]);

  // id → the timeline event's own open(). Ids are namespaced per adapter, so
  // they can't collide with a Google event id.
  const actions = useMemo(() => {
    const map = new Map<string, () => void>();
    for (const ev of timelineEvents) if (ev.open) map.set(ev.id, ev.open);
    return map;
  }, [timelineEvents]);

  const openEvent = useMemo(
    () => (ev: CalEvent) => { actions.get(ev.id)?.(); },
    [actions],
  );

  return { events, legend, loading, openEvent };
}
