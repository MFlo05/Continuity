import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { App } from 'obsidian';
import { localISO } from '../core/dates';
import { subscribeVault } from '../core';
import { useCalendar } from '../calendar/CalendarContext';
import type { CalEvent } from '../calendar/calendar';
import { classScheduleAdapter } from './adapters/class-schedule';
import { assignmentsAdapter } from './adapters/assignments';
import { remindersAdapter } from './adapters/reminders';
import { mealPlanAdapter } from './adapters/meal-plan';
import { recurringAdapter } from './adapters/recurring';
import { compareEvents } from './types';
import type { TimelineAdapter, TimelineEvent, TimelineKind } from './types';

/**
 * time/useTimeline.ts — merges every source into one ordered event list.
 *
 * The vault adapters are plain async reads and go through the shared vault
 * subscription hub, exactly like a codec source. Google Calendar does not,
 * and can't: its events live in React context (fetched from a remote API,
 * held in memory, cleared on logout), so there is no path to watch and no
 * `app` to read from. It's folded in separately below rather than pretending
 * to be a TimelineAdapter — a fake adapter that ignored its own `app` and
 * `watch` arguments would be the more confusing shape.
 */

export const VAULT_ADAPTERS: TimelineAdapter[] = [
  classScheduleAdapter,
  assignmentsAdapter,
  remindersAdapter,
  mealPlanAdapter,
  recurringAdapter,
];

/** Every kind the timeline can show, in the order a day reads best. */
export const ALL_KINDS: TimelineKind[] = ['class', 'assignment', 'reminder', 'meal', 'calendar', 'bill'];

/**
 * A Google event → a TimelineEvent.
 *
 * Google is the only source carrying a timezone-aware instant, so this is the
 * one place epoch-ms becomes date + minutes-from-midnight. An all-day event
 * gets no startMin, which is exactly the distinction the rest of the layer
 * uses.
 */
function fromCalEvent(ev: CalEvent, open: () => void): TimelineEvent {
  const start = new Date(ev.startMs);
  const end   = new Date(ev.endMs);
  return {
    id:       `calendar:${ev.calendarId}:${ev.id}`,
    date:     localISO(start),
    startMin: ev.allDay ? undefined : start.getHours() * 60 + start.getMinutes(),
    endMin:   ev.allDay ? undefined : end.getHours() * 60 + end.getMinutes(),
    title:    ev.summary,
    detail:   ev.location,
    kind:     'calendar',
    sourceId: 'calendar',
    tone:     ev.calendarColor,
    open,
  };
}

export interface UseTimelineResult {
  events:  TimelineEvent[];
  loading: boolean;
  /** Re-read every source. The watcher already does this on vault changes. */
  reload:  () => void;
}

/**
 * Events across [from, to], inclusive, both local `YYYY-MM-DD`.
 *
 * `kinds` filters at the ADAPTER level, so an excluded source is never read
 * at all rather than read and then discarded.
 */
export function useTimeline(
  app: App,
  from: string,
  to: string,
  kinds: TimelineKind[] = ALL_KINDS,
): UseTimelineResult {
  const [vaultEvents, setVaultEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Serialised so the effect deps are values, not a fresh array each render.
  const kindKey = kinds.join(',');

  const active = useMemo(
    () => VAULT_ADAPTERS.filter(a => a.kinds.some(k => kinds.includes(k))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kindKey],
  );

  // Guards against an out-of-order response overwriting a newer one when the
  // window changes faster than a read completes (paging days quickly).
  const readId = useRef(0);

  const load = useCallback(async () => {
    const id = ++readId.current;
    setLoading(true);
    const results = await Promise.all(
      // One failing source must not blank the whole day.
      active.map(a => a.read(app, from, to).catch(err => {
        console.error(`[CC2] timeline adapter "${a.id}" failed:`, err);
        return [] as TimelineEvent[];
      })),
    );
    if (id !== readId.current) return;
    setVaultEvents(results.flat());
    setLoading(false);
  }, [app, from, to, active]);

  useEffect(() => { void load(); }, [load]);

  // One subscription for the union of every active adapter's targets, through
  // the shared hub — never a raw vault.on.
  useEffect(() => {
    const paths   = new Set<string>();
    const folders = new Set<string>();
    for (const a of active) {
      const t = a.watch?.(app);
      t?.paths?.forEach(p => paths.add(p));
      t?.folders?.forEach(f => folders.add(f));
    }
    if (paths.size === 0 && folders.size === 0) return;

    return subscribeVault(app, {
      paths:   [...paths],
      folders: [...folders],
      onChange: () => { void load(); },
    });
  }, [app, active, load]);

  // ── Google Calendar ─────────────────────────────────────────────────────
  // Read straight from context. `status` is checked because CalendarContext
  // holds a stale array between logout and its own clear, and because an
  // unconnected vault should simply show no calendar events — never an error.
  const { events: calEvents, status } = useCalendar();
  const wantCalendar = kinds.includes('calendar');

  const googleEvents = useMemo(() => {
    if (!wantCalendar || status !== 'connected') return [];
    return calEvents
      .map(ev => fromCalEvent(ev, () => { /* opening a Google event is the Calendar widget's job */ }))
      .filter(e => e.date >= from && e.date <= to);
  }, [wantCalendar, status, calEvents, from, to]);

  const events = useMemo(
    () => [...vaultEvents, ...googleEvents].sort(compareEvents),
    [vaultEvents, googleEvents],
  );

  return { events, loading, reload: () => { void load(); } };
}
