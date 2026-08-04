import { localISO, parseLocalISO, addDays } from '../core/dates';
import type { CalEvent, CalendarMeta } from './calendar';
import type { TimelineEvent, TimelineKind } from '../time/types';

/**
 * calendar/timeline-bridge.ts — vault events, wearing the calendar's shape.
 *
 * The calendar views were written against Google's resource and still read it
 * directly: `ev.start.dateTime` / `ev.start.date` strings rather than the
 * `startMs`/`endMs` numbers sitting beside them. So a vault event can't just
 * supply a timestamp — it has to fabricate the whole `DateTimeOrDate`
 * envelope, including Google's convention that an all-day `end.date` is
 * EXCLUSIVE (evDayRange subtracts a day to get the inclusive end).
 *
 * Rebuilding the views around a neutral event type would be the purer fix, but
 * it's a much larger change to well-tested layout maths. Meeting the existing
 * shape here is the smaller, safer seam — and it keeps every Google code path
 * byte-identical.
 */

/**
 * A synthetic calendar id per source.
 *
 * Deliberately shaped like a calendar id so the ENTIRE existing visibility
 * mechanism — `hiddenCalIds`, `toggleCalendar`, the legend's check state —
 * works on vault sources with no new machinery. The `cc2:` prefix can't
 * collide with a Google id (those are email-shaped).
 */
export const SOURCE_CAL_PREFIX = 'cc2:';
export const sourceCalId = (sourceId: string) => `${SOURCE_CAL_PREFIX}${sourceId}`;
export const isSourceCalId = (id: string) => id.startsWith(SOURCE_CAL_PREFIX);

/**
 * Per-kind colours, as HEX — not CSS variables.
 *
 * `hexAlpha` in CalendarViews does `parseInt(hex.slice(1, 3), 16)`, so a
 * `var(--cc2-tone-…)` string would produce `rgba(NaN,NaN,NaN,…)` and paint
 * nothing. Timeline events carry `tone` values that are sometimes CSS vars
 * (the recurring adapter emits `var(--cc2-income)`), so anything that isn't a
 * literal hex is replaced here rather than trusted.
 *
 * Values are the dark-mode "glow" variants of the app's own 10-tone palette,
 * which is the same choice `CC_EVENT_COLORS` made and for the same reason:
 * they read better as small chips than the light-mode inks.
 */
const KIND_COLOR: Record<TimelineKind, string> = {
  class:      '#8FA6F0',  // indigo
  assignment: '#D98A72',  // rust
  reminder:   '#E0B872',  // ochre
  meal:       '#9BC48A',  // moss
  calendar:   '#A8B0BE',  // slate
  bill:       '#D9A07A',  // terracotta
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function colorFor(ev: TimelineEvent): string {
  return ev.tone && HEX_RE.test(ev.tone) ? ev.tone : KIND_COLOR[ev.kind];
}

/** `2026-08-14` + 570 → `2026-08-14T09:30:00` (parsed as LOCAL by Date). */
function localDateTime(date: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * One timeline event as a read-only CalEvent.
 *
 * Returns null for an event whose date can't be parsed — a corrupt row should
 * drop out, not render at the epoch.
 */
export function toCalEvent(ev: TimelineEvent): CalEvent | null {
  const day = parseLocalISO(ev.date);
  if (!day) return null;

  const color = colorFor(ev);
  const base = {
    id:            ev.id,
    summary:       ev.title,
    description:   ev.detail,
    calendarId:    sourceCalId(ev.sourceId),
    calendarColor: color,
    source:        ev.sourceId,
    sourceLabel:   ev.sourceId,
    readOnly:      true,
  };

  if (ev.startMin === undefined) {
    // All-day. Google's `end.date` is EXCLUSIVE, so it's the following day —
    // evDayRange subtracts 86_400_000 to recover the inclusive end, and would
    // render a day early otherwise.
    const next = localISO(addDays(day, 1));
    const startMs = day.getTime();
    return {
      ...base,
      start:   { date: ev.date },
      end:     { date: next },
      allDay:  true,
      startMs,
      endMs:   startMs + 86_400_000,
    };
  }

  const end = ev.endMin ?? ev.startMin + 60;
  const startDate = new Date(day.getTime());
  startDate.setHours(Math.floor(ev.startMin / 60), ev.startMin % 60, 0, 0);
  const endDate = new Date(day.getTime());
  endDate.setHours(Math.floor(end / 60), end % 60, 0, 0);

  return {
    ...base,
    start:   { dateTime: localDateTime(ev.date, ev.startMin) },
    end:     { dateTime: localDateTime(ev.date, end) },
    allDay:  false,
    startMs: startDate.getTime(),
    endMs:   endDate.getTime(),
  };
}

export function toCalEvents(events: TimelineEvent[]): CalEvent[] {
  const out: CalEvent[] = [];
  for (const ev of events) {
    const c = toCalEvent(ev);
    if (c) out.push(c);
  }
  return out;
}

/** Legend entries for the vault sources, in the calendar's own meta shape. */
export const SOURCE_CALENDARS: CalendarMeta[] = [
  { id: sourceCalId('class-schedule'), summary: 'Classes',    backgroundColor: KIND_COLOR.class,      foregroundColor: '#ffffff' },
  { id: sourceCalId('assignments'),    summary: 'Due dates',  backgroundColor: KIND_COLOR.assignment, foregroundColor: '#ffffff' },
  { id: sourceCalId('reminders'),      summary: 'Reminders',  backgroundColor: KIND_COLOR.reminder,   foregroundColor: '#ffffff' },
  { id: sourceCalId('meal-plan'),      summary: 'Meals',      backgroundColor: KIND_COLOR.meal,       foregroundColor: '#ffffff' },
  { id: sourceCalId('recurring'),      summary: 'Bills',      backgroundColor: KIND_COLOR.bill,       foregroundColor: '#ffffff' },
];
