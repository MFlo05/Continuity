/**
 * calendar.ts — Google Calendar v3 API client
 *
 * Wraps every API call the Command Center needs:
 *   - List the user's calendars (for color metadata)
 *   - Fetch events across a date range (merges all calendars)
 *   - Create, update, and delete events
 *
 * All methods call getValidToken() first — tokens refresh transparently.
 */

import { requestUrl } from "obsidian";
import type { TokenStore } from "./google-oauth";
import { getValidToken } from "./google-oauth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalendarMeta {
  id:              string;
  summary:         string;
  description?:    string;
  backgroundColor: string;   // hex, e.g. "#7986cb"
  foregroundColor: string;   // hex, usually "#ffffff"
  primary?:        boolean;
  selected?:       boolean;
}

/** A named event label defined on a calendar (labelProperties.eventLabels[]). */
export interface CalendarLabel {
  id:              string;  // UUID
  name:            string;  // e.g. "Work", "Gym"
  backgroundColor: string;  // hex, e.g. "#039be5"
}

/** A single event as returned by the API, enriched with calendar color info. */
export interface CalEvent {
  id:             string;
  summary:        string;
  description?:   string;
  location?:      string;
  start:          DateTimeOrDate;
  end:            DateTimeOrDate;
  colorId?:       string;         // event-level colorId override (1–11)
  htmlLink?:      string;         // link to open in Google Calendar
  status?:        "confirmed" | "tentative" | "cancelled";
  // Fields we inject after fetching:
  calendarId:     string;
  calendarColor:  string;         // resolved: label → colorId → calendar color
  allDay:         boolean;        // true when start.date exists (no time)
  startMs:        number;         // epoch ms for easy sorting / math
  endMs:          number;

  // ── The source seam ──────────────────────────────────────────────────────
  // This type began as the raw Google resource, and every view still assumes
  // that shape. These two fields are what let something that ISN'T from Google
  // — a class meeting, a planned meal, an upcoming bill — travel through the
  // same views without pretending to be editable.
  //
  // Both OPTIONAL, so the ~40 places that construct or read a CalEvent are
  // untouched: absent means "a real Google event", which is what every
  // existing one is.

  /** Which source produced this. Absent = Google. */
  source?:        string;
  /** Human label for the source, for legends and filters. */
  sourceLabel?:   string;
  /**
   * True when this event cannot be edited from the calendar UI.
   *
   * Load-bearing: CalendarFullscreen's onEventClick maps ANY clicked event
   * into a Google edit target ({eventId, calId}) and the modal then PATCHes
   * that id to googleapis.com. Without this flag a vault-sourced event would
   * open an "Edit Event" dialog with a Delete button, and saving would fire a
   * request against a synthetic id that doesn't exist on any Google calendar.
   */
  readOnly?:      boolean;
}

/** Google events have no `source`; anything else is read-only by nature. */
export function isEditableEvent(ev: CalEvent): boolean {
  return !ev.readOnly && !ev.source;
}

/**
 * Events overlapping [start, end). The one interval predicate in the app.
 *
 * Extracted so a view fed events through a prop filters them EXACTLY as
 * CalendarContext's own eventsForDay/eventsForRange do — two copies of an
 * overlap test is how a multi-day event ends up visible in one view and not
 * another.
 *
 * Deliberately does NOT filter hidden calendars: the caller supplying a merged
 * list owns visibility, and applying it twice would be both redundant and
 * wrong for non-Google sources, whose visibility isn't keyed on calendarId.
 */
export function eventsInRange(events: CalEvent[], start: Date, end: Date): CalEvent[] {
  const s = start.getTime();
  const e = end.getTime();
  return events.filter(ev => ev.startMs < e && ev.endMs > s);
}

export interface DateTimeOrDate {
  dateTime?: string;   // ISO 8601 with time, e.g. "2026-06-30T14:00:00-06:00"
  date?:     string;   // ISO 8601 date only, e.g. "2026-06-30"
  timeZone?: string;
}

/** Payload for creating or patching an event. */
export interface EventPayload {
  summary:        string;
  description?:   string;
  location?:      string;
  start:          DateTimeOrDate;
  end:            DateTimeOrDate;
  colorId?:     string;
  recurrence?:  string[]; // e.g. ["RRULE:FREQ=WEEKLY"]
}

// ─── CC event color palette ───────────────────────────────────────────────────
// Google's 11 stock event colors, remapped one-for-one to the plugin's own
// curated 10-tone widget palette (see DESIGN_SYSTEM.md's "Per-Widget Accent
// Color" section — command-center-widget-palette.html) so calendar events
// feel on-brand instead of showing Google's raw Material colors. Matched by
// hue/character, not by list position: Tomato→Rust (both the reddest),
// Flamingo→Rose (both a muted pink), Tangerine→Terracotta (both warm orange),
// Banana→Ochre (both the yellow), Sage→Sage (literal name match), Basil→Moss
// (both a herbal/olive green), Peacock→Spruce (both teal), Blueberry→Indigo
// (both a deep blue), Lavender→Slate (the remaining blue-leaning tone once
// Indigo/Plum are taken), Grape→Plum (both a purple fruit). Graphite (id 8)
// is deliberately left unmapped — Google's own neutral gray, not one of our
// 10 hues, since a "no strong color" option should stay actually neutral.
// Hex values are copied verbatim from styles.css's dark-mode --cc2-tone-*
// tokens (the brighter "glow" variants, not the light-mode "ink" ones) since
// this is a single flat palette used regardless of Obsidian's active theme —
// same accepted tradeoff the previous "brightened for dark glass UI" palette
// already made, just now sourced from one real palette instead of a
// one-off hand-tuned set. Ordered warm → cool for the color picker grid.
export const CC_EVENT_COLORS: Array<{ id: string; name: string; color: string }> = [
  { id: "11", name: "Tomato",    color: "#F47F76" }, // Rust
  { id: "4",  name: "Flamingo",  color: "#ECA3AC" }, // Rose
  { id: "6",  name: "Tangerine", color: "#E89D7C" }, // Terracotta
  { id: "5",  name: "Banana",    color: "#E3C293" }, // Ochre
  { id: "2",  name: "Sage",      color: "#8FD2AD" }, // Sage
  { id: "10", name: "Basil",     color: "#C9D48F" }, // Moss
  { id: "7",  name: "Peacock",   color: "#85D2C4" }, // Spruce
  { id: "9",  name: "Blueberry", color: "#B1A6F2" }, // Indigo
  { id: "1",  name: "Lavender",  color: "#8FD2F0" }, // Slate
  { id: "3",  name: "Grape",     color: "#C39FE0" }, // Plum
  { id: "8",  name: "Graphite",  color: "#888888" }, // unmapped — Google's own neutral gray
];

// Derived from CC_EVENT_COLORS rather than a second hand-maintained hex table
// — one source of truth for both the color-picker swatches AND resolving an
// already-created event's display color, so they can't drift apart the way
// CC_EVENT_COLORS/GOOGLE_EVENT_COLORS (two separate tables) used to.
const CC_EVENT_COLOR_MAP: Record<string, string> = Object.fromEntries(
  CC_EVENT_COLORS.map(c => [c.id, c.color]),
);

// ─── Internal request helpers ─────────────────────────────────────────────────

const BASE = "https://www.googleapis.com/calendar/v3";

async function gcalGet(path: string, token: string): Promise<unknown> {
  const resp = await requestUrl({
    url:     `${BASE}${path}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json;
}

async function gcalPost(path: string, body: unknown, token: string): Promise<unknown> {
  const resp = await requestUrl({
    url:     `${BASE}${path}`,
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return resp.json;
}

async function gcalPatch(path: string, body: unknown, token: string): Promise<unknown> {
  const resp = await requestUrl({
    url:     `${BASE}${path}`,
    method:  "PATCH",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return resp.json;
}

async function gcalDelete(path: string, token: string): Promise<void> {
  await requestUrl({
    url:     `${BASE}${path}`,
    method:  "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toMs(dt: DateTimeOrDate): number {
  if (dt.dateTime) return new Date(dt.dateTime).getTime();
  if (dt.date)     return new Date(dt.date + "T00:00:00").getTime();
  return 0;
}

/**
 * Date helpers now live in core/dates.ts.
 *
 * They were defined here for historical reasons and five non-Google modules
 * ended up importing them from the Google Calendar API client — meal-plan.ts
 * and class-schedule.ts among them, which have nothing to do with Google.
 * Re-exported so those call sites keep working; prefer importing from
 * `core/dates` directly in new code.
 */
import { startOfDay, endOfDay, addDays, startOfWeek } from '../core/dates';
export { startOfDay, endOfDay, addDays, startOfWeek };

// ─── Calendar labels ──────────────────────────────────────────────────────────

/**
 * Fetches named event labels defined on a specific calendar.
 * Uses GET /calendars/{calendarId}?fields=labelProperties
 * Returns an empty array if the calendar has no labels or the field is absent.
 */
// NOTE: fetchCalendarLabels is kept as a stub for future use.
// Google Calendar's "Event Labels" (named labels like Work/School/Gym) are
// currently not exposed via the public Calendar API v3 for personal accounts.
// The labelProperties field is absent from the calendar resource response.
// If Google opens this up in the future, re-enable in calendar-context.tsx.
export async function fetchCalendarLabels(
  _store:         TokenStore,
  _clientId:      string,
  _calendarId:    string,
  _clientSecret?: string,
): Promise<CalendarLabel[]> {
  return [];
}

// ─── Calendar list ────────────────────────────────────────────────────────────

/**
 * Returns all calendars the user has in their Google Calendar list.
 * Sorted: primary first, then alphabetically.
 */
export async function fetchCalendars(
  store:         TokenStore,
  clientId:      string,
  clientSecret?: string,
): Promise<CalendarMeta[]> {
  const token = await getValidToken(store, clientId, clientSecret);
  const json  = await gcalGet(
    "/users/me/calendarList?fields=items(id,summary,description,backgroundColor,foregroundColor,primary,selected)",
    token,
  ) as { items?: CalendarMeta[] };

  const items = json.items ?? [];
  return items.sort((a, b) => {
    if (a.primary) return -1;
    if (b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });
}

// ─── Fetch events ─────────────────────────────────────────────────────────────

/**
 * Fetches events from ALL calendars within [timeMin, timeMax].
 * Merges results and sorts by start time.
 * Injects calendarId, calendarColor, allDay, startMs, endMs.
 */
export async function fetchEvents(
  store:         TokenStore,
  clientId:      string,
  calendars:     CalendarMeta[],
  timeMin:       Date,
  timeMax:       Date,
  clientSecret?: string,
): Promise<CalEvent[]> {
  const token = await getValidToken(store, clientId, clientSecret);

  const batches = await Promise.all(
    calendars.map(async (cal) => {
      const params = new URLSearchParams({
        timeMin:      timeMin.toISOString(),
        timeMax:      timeMax.toISOString(),
        singleEvents: "true",
        orderBy:      "startTime",
        maxResults:   "250",
        fields:       "items(id,summary,description,location,start,end,colorId,htmlLink,status)",
      });

      const json = await gcalGet(
        `/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        token,
      ) as { items?: Record<string, unknown>[] };

      return (json.items ?? [])
        .filter((item) => item["status"] !== "cancelled")
        .map((item): CalEvent => {
          const start        = (item["start"] ?? {}) as DateTimeOrDate;
          const end          = (item["end"]   ?? {}) as DateTimeOrDate;
          const colorId = item["colorId"] as string | undefined;
          // Resolve display color: colorId override (our own on-brand
          // remap, not Google's raw color) → calendar default
          const calendarColor = colorId
            ? (CC_EVENT_COLOR_MAP[colorId] ?? cal.backgroundColor)
            : cal.backgroundColor;

          return {
            id:            item["id"]          as string,
            summary:       (item["summary"]    as string) ?? "(No title)",
            description:   item["description"] as string | undefined,
            location:      item["location"]    as string | undefined,
            start,
            end,
            colorId,
            htmlLink:      item["htmlLink"]    as string | undefined,
            status:        item["status"]      as CalEvent["status"],
            calendarId:    cal.id,
            calendarColor,
            allDay:  !!start.date && !start.dateTime,
            startMs: toMs(start),
            endMs:   toMs(end),
          };
        });
    }),
  );

  return batches.flat().sort((a, b) => a.startMs - b.startMs);
}

// ─── Convenience fetch windows ────────────────────────────────────────────────

export const fetchTodayEvents = (
  store:     TokenStore,
  clientId:  string,
  calendars: CalendarMeta[],
) => fetchEvents(store, clientId, calendars, startOfDay(), endOfDay());

export const fetchWeekEvents = (
  store:     TokenStore,
  clientId:  string,
  calendars: CalendarMeta[],
) => {
  const mon = startOfWeek();
  const sun = endOfDay(addDays(mon, 6));
  return fetchEvents(store, clientId, calendars, mon, sun);
};

export const fetchRangeEvents = (
  store:     TokenStore,
  clientId:  string,
  calendars: CalendarMeta[],
  start:     Date,
  end:       Date,
) => fetchEvents(store, clientId, calendars, start, end);

// ─── Create event ─────────────────────────────────────────────────────────────

export async function createEvent(
  store:         TokenStore,
  clientId:      string,
  calendarId:    string,
  payload:       EventPayload,
  clientSecret?: string,
): Promise<CalEvent> {
  const token = await getValidToken(store, clientId, clientSecret);
  const json  = await gcalPost(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    payload,
    token,
  ) as Record<string, unknown>;

  // Re-shape the minimal response into our CalEvent shape
  const start = (json["start"] ?? {}) as DateTimeOrDate;
  const end   = (json["end"]   ?? {}) as DateTimeOrDate;
  return {
    id:            json["id"]      as string,
    summary:       json["summary"] as string,
    start, end,
    calendarId,
    calendarColor: "#7986cb",  // default; caller can update from calendar list
    allDay:        !!start.date && !start.dateTime,
    startMs:       toMs(start),
    endMs:         toMs(end),
  };
}

// ─── Update event ─────────────────────────────────────────────────────────────

export async function updateEvent(
  store:         TokenStore,
  clientId:      string,
  calendarId:    string,
  eventId:       string,
  patch:         Partial<EventPayload>,
  clientSecret?: string,
): Promise<void> {
  const token = await getValidToken(store, clientId, clientSecret);
  await gcalPatch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    patch,
    token,
  );
}

// ─── Delete event ─────────────────────────────────────────────────────────────

export async function deleteEvent(
  store:         TokenStore,
  clientId:      string,
  calendarId:    string,
  eventId:       string,
  clientSecret?: string,
): Promise<void> {
  const token = await getValidToken(store, clientId, clientSecret);
  await gcalDelete(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
  );
}
