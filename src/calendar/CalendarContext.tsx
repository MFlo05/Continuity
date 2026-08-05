/**
 * calendar-context.tsx — shared Google Calendar state across all Command Center tabs.
 *
 * Wrap the root <App> with <CalendarProvider> to give every component access to:
 *   - auth status (disconnected / connecting / connected)
 *   - list of the user's calendars (with colors)
 *   - cached events for a rolling date window
 *   - login / logout / refresh
 *   - addEvent / deleteEvent
 *
 * Event cache strategy:
 *   We load a 3-month window (prev month → next month) on first connect, then
 *   extend lazily when the user navigates outside the loaded range.
 */

import * as React from "react";
import type { TokenStore } from "./google-oauth";
import { loginWithGoogle, refreshTokens } from "./google-oauth";
import type { CalendarMeta, CalEvent, EventPayload } from "./calendar";
import {
  fetchCalendars,
  fetchEvents,
  createEvent,
  updateEvent as apiUpdateEvent,
  deleteEvent as apiDeleteEvent,
  startOfDay,
  endOfDay,
  addDays,
} from "./calendar";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalStatus = "disconnected" | "connecting" | "connected";

export interface CalendarCtx {
  status:     CalStatus;
  connecting: boolean;
  refreshing: boolean;
  error:      string | null;

  calendars: CalendarMeta[];
  events:    CalEvent[];

  /** Calendar IDs the user has toggled off in the fullscreen sidebar. */
  hiddenCalIds:   string[];
  toggleCalendar: (id: string) => void;

  login:        () => Promise<void>;
  logout:       (message?: string | null) => Promise<void>;
  refresh:      () => Promise<void>;

  eventsForDay:   (date: Date) => CalEvent[];
  eventsForRange: (start: Date, end: Date) => CalEvent[];
  ensureRange:    (start: Date, end: Date) => Promise<void>;

  addEvent:    (calendarId: string, payload: EventPayload) => Promise<CalEvent>;
  updateEvent: (calendarId: string, eventId: string, patch: Partial<EventPayload>) => Promise<void>;
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const CalCtx = React.createContext<CalendarCtx | null>(null);

export function useCalendar(): CalendarCtx {
  const ctx = React.useContext(CalCtx);
  if (!ctx) throw new Error("useCalendar must be used inside <CalendarProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ProviderProps {
  tokenStore:   TokenStore;
  clientId:     string;
  clientSecret: string;
  children:     React.ReactNode;
}

interface LoadedRange {
  start: Date;
  end:   Date;
}

export function CalendarProvider({ tokenStore, clientId, clientSecret, children }: ProviderProps) {
  const [status,       setStatus]       = React.useState<CalStatus>("disconnected");
  const [refreshing,   setRefreshing]   = React.useState(false);
  const [error,        setError]        = React.useState<string | null>(null);
  const [calendars,    setCalendars]    = React.useState<CalendarMeta[]>([]);
  const [events,       setEvents]       = React.useState<CalEvent[]>([]);
  const [loadedRange,  setLoadedRange]  = React.useState<LoadedRange | null>(null);
  const [hiddenCalIds, setHiddenCalIds] = React.useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("cc-hidden-cal-ids");
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch { return []; }
  });

  function toggleCalendar(id: string): void {
    setHiddenCalIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem("cc-hidden-cal-ids", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ── Initial connection check ───────────────────────────────────────────────
  React.useEffect(() => {
    // Unconfigured device: stay disconnected without touching the network.
    // Loading anyway would fail with "Token refresh failed", which isAuthDead()
    // reads as an expired session and answers by clearing the stored refresh
    // token — destroying a working connection over a missing config value.
    //
    // Deliberately NOT setError: "no credentials entered yet" is a normal
    // starting state, not a failure, and setError paints a red banner across
    // the widget. Leaving status at "disconnected" shows the ordinary Connect
    // prompt, which is both accurate and actionable. The error channel is for
    // things that actually went wrong.
    if (!clientId || !clientSecret) return;
    tokenStore.getTokens().then((tokens) => {
      if (tokens) {
        setStatus("connected");
        loadInitialData();
      }
    }).catch(console.error);
  // Keyed on the credentials, not []: they can arrive after mount, when they're
  // typed into the settings tab and pushed in as new props. With [] this ran
  // once against empty strings, bailed at the guard above, and never looked
  // again — so a freshly entered client id appeared to do nothing until
  // Obsidian was reloaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clientSecret]);

  // ── Background auto-refresh every 30 minutes ──────────────────────────────
  React.useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => {
      if (loadedRange) loadRange(loadedRange.start, loadedRange.end, false);
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, loadedRange]);

  // ── Load a 3-month window on connect ──────────────────────────────────────
  async function loadInitialData() {
    try {
      setRefreshing(true);
      setError(null);

      const cals = await fetchCalendars(tokenStore, clientId, clientSecret);
      setCalendars(cals);

      // Load prev month → next 2 months
      const start = startOfDay(addDays(new Date(), -31));
      const end   = endOfDay(addDays(new Date(), 62));
      const evts  = await fetchEvents(tokenStore, clientId, cals, start, end, clientSecret);
      setEvents(evts);
      setLoadedRange({ start, end });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Command Center] Calendar initial load failed:", msg, e);
      if (isAuthDead(e)) {
        await logout("Google Calendar connection expired — please reconnect.");
      } else {
        setError(msg);
      }
    } finally {
      setRefreshing(false);
    }
  }

  // ── Load (or extend) a date range ─────────────────────────────────────────
  async function loadRange(
    start:    Date,
    end:      Date,
    showSpinner = true,
  ): Promise<void> {
    try {
      if (showSpinner) setRefreshing(true);
      setError(null);

      const unionStart = loadedRange ? new Date(Math.min(loadedRange.start.getTime(), start.getTime())) : start;
      const unionEnd   = loadedRange ? new Date(Math.max(loadedRange.end.getTime(),   end.getTime()))   : end;

      const cals = calendars.length > 0 ? calendars : await fetchCalendars(tokenStore, clientId, clientSecret);
      if (calendars.length === 0) setCalendars(cals);

      const evts = await fetchEvents(tokenStore, clientId, cals, unionStart, unionEnd, clientSecret);
      setEvents(evts);
      setLoadedRange({ start: unionStart, end: unionEnd });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Command Center] Calendar range load failed:", msg, e);
      if (isAuthDead(e)) {
        await logout("Google Calendar connection expired — please reconnect.");
      } else {
        setError(msg);
      }
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  // ── Ensure a range is loaded (extend cache if needed) ─────────────────────
  async function ensureRange(start: Date, end: Date): Promise<void> {
    if (!loadedRange) return; // Not connected yet
    const alreadyLoaded =
      start.getTime() >= loadedRange.start.getTime() &&
      end.getTime()   <= loadedRange.end.getTime();
    if (!alreadyLoaded) {
      await loadRange(start, end, false);
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  async function login(): Promise<void> {
    try {
      setStatus("connecting");
      setError(null);
      await loginWithGoogle(tokenStore, clientId, clientSecret);
      setStatus("connected");
      await loadInitialData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Command Center] Google login failed:", msg, e);
      setStatus("disconnected");
      setError(msg);
      throw e;
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  // `message` lets the auth-dead auto-heal path (below) leave a human-readable
  // reason visible after resetting to "disconnected", instead of silently
  // clearing it the way a manual disconnect click should.
  async function logout(message: string | null = null): Promise<void> {
    await tokenStore.clearTokens();
    setStatus("disconnected");
    setCalendars([]);
    setEvents([]);
    setLoadedRange(null);
    setError(message);
  }

  // A refresh-token rejection (revoked access, expired grant) is unrecoverable
  // without the user reconnecting — previously this just set `error` (which
  // nothing rendered) while `status` stayed "connected" forever, permanently
  // wedging the widget with no visible problem and no way back to the
  // "Connect Google Calendar" button. Detect it and force back to
  // "disconnected" automatically instead.
  function isAuthDead(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes("Token refresh failed") || msg.includes("Not connected to Google");
  }

  // ── Refresh ────────────────────────────────────────────────────────────────
  async function refresh(): Promise<void> {
    if (!loadedRange) return;
    await loadRange(loadedRange.start, loadedRange.end, true);
  }

  // ── Event helpers (hidden calendars filtered out globally) ────────────────
  function eventsForDay(date: Date): CalEvent[] {
    const dayStart = startOfDay(date).getTime();
    const dayEnd   = endOfDay(date).getTime();
    return events.filter((e) =>
      e.startMs < dayEnd && e.endMs > dayStart && !hiddenCalIds.includes(e.calendarId)
    );
  }

  function eventsForRange(start: Date, end: Date): CalEvent[] {
    const s = start.getTime();
    const e = end.getTime();
    return events.filter((ev) =>
      ev.startMs < e && ev.endMs > s && !hiddenCalIds.includes(ev.calendarId)
    );
  }

  // ── Add event ─────────────────────────────────────────────────────────────
  async function addEvent(calendarId: string, payload: EventPayload): Promise<CalEvent> {
    const created = await createEvent(tokenStore, clientId, calendarId, payload, clientSecret);
    // Refresh the range containing the new event to get the full server response
    if (loadedRange) {
      await loadRange(loadedRange.start, loadedRange.end, false);
    }
    return created;
  }

  // ── Update event ──────────────────────────────────────────────────────────
  async function updateEvent(calendarId: string, eventId: string, patch: Partial<EventPayload>): Promise<void> {
    await apiUpdateEvent(tokenStore, clientId, calendarId, eventId, patch, clientSecret);
    if (loadedRange) {
      await loadRange(loadedRange.start, loadedRange.end, false);
    }
  }

  // ── Delete event ──────────────────────────────────────────────────────────
  async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await apiDeleteEvent(tokenStore, clientId, calendarId, eventId, clientSecret);
    setEvents((prev) => prev.filter((e) => !(e.id === eventId && e.calendarId === calendarId)));
  }

  // ── Context value ──────────────────────────────────────────────────────────
  const value: CalendarCtx = {
    status,
    connecting: status === "connecting",
    refreshing,
    error,
    calendars,
    events,
    hiddenCalIds,
    toggleCalendar,
    login,
    logout,
    refresh,
    eventsForDay,
    eventsForRange,
    ensureRange,
    addEvent,
    updateEvent,
    deleteEvent,
  };

  return <CalCtx.Provider value={value}>{children}</CalCtx.Provider>;
}
