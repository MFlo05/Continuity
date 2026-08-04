/**
 * calendar-views.tsx — Day, Week, Month, and MiniMonth view components.
 *
 * v3 changes:
 *   - WeekView header spacer now matches hour-label column width (48px)
 *   - MonthView completely restructured: 6 WeekRow components each with
 *       • a number row (day numbers, clickable)
 *       • a span layer (multi-day events as CSS grid-column spans)
 *       • an events row (single-day event chips per cell)
 *   - Multi-day events render as colored bars spanning across day columns,
 *     with smart row stacking when spans overlap
 *   - Fixed-height week rows prevent long titles from stretching the grid
 */

import * as React from "react";
import { useCalendar } from "./CalendarContext";
import { eventsInRange } from "./calendar";
import type { CalendarMeta } from "./calendar";
import type { CalEvent } from "./calendar";
import {
  startOfDay, endOfDay, addDays, startOfWeek,
  isSameDay, isToday, parseLocalISO, WEEKDAYS_SHORT, MONTHS,
} from "../core/dates";

// ─── Shared constants ─────────────────────────────────────────────────────────

const HOUR_START   = 0;    // midnight
const HOUR_END     = 24;   // end of day
const HOUR_HEIGHT  = 56;   // px per hour
const TOTAL_H      = (HOUR_END - HOUR_START) * HOUR_HEIGHT; // 1344px
const SCROLL_TO_H  = 7;    // auto-scroll viewport to 7am on mount
const MIN_WEEK_W   = 640;  // minimum week grid width (triggers horizontal scroll)
const MIN_COL_W    = 80;   // minimum day column width in week view
const LABEL_W      = 48;   // hour label column width — must match CSS .cc2-cal-hour-labels

// ─── Shared helpers ───────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmt12(h: number, m = 0): string {
  const ampm = h >= 12 ? "pm" : "am";
  const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function fmtRange(e: CalEvent): string {
  if (e.allDay) return "All day";
  const s  = new Date(e.start.dateTime ?? e.start.date ?? "");
  const en = new Date(e.end.dateTime   ?? e.end.date   ?? "");
  return `${fmt12(s.getHours(), s.getMinutes())} – ${fmt12(en.getHours(), en.getMinutes())}`;
}

function fmtTimeShort(e: CalEvent): string {
  if (e.allDay) return "";
  const s = new Date(e.start.dateTime ?? "");
  return fmt12(s.getHours(), s.getMinutes());
}

/**
 * Events for a range — from the `events` prop when a caller supplies one,
 * otherwise from the Google context.
 *
 * This is the seam that lets a view draw something other than Google. Every
 * view called `useCalendar()` directly before, so there was no way to hand one
 * a merged list; now the context is the DEFAULT rather than the only option,
 * and all existing call sites keep working untouched.
 *
 * A caller passing `events` owns visibility filtering — its list may contain
 * vault sources, whose hiding isn't keyed on `calendarId`.
 */
function useRangeEvents(events: CalEvent[] | undefined, start: Date, end: Date): CalEvent[] {
  // Called unconditionally: hooks can't be skipped, and the provider is always
  // mounted at the app root.
  const { eventsForRange } = useCalendar();
  return events ? eventsInRange(events, start, end) : eventsForRange(start, end);
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** top offset + height (px) for a timed event in the hour grid */
function eventGeometry(ev: CalEvent): { top: number; height: number } | null {
  if (ev.allDay) return null;
  const start = new Date(ev.start.dateTime ?? "");
  const end   = new Date(ev.end.dateTime   ?? "");
  const sf    = start.getHours() + start.getMinutes() / 60;
  const ef    = end.getHours()   + end.getMinutes()   / 60;
  if (ef <= HOUR_START || sf >= HOUR_END) return null;
  const cs = Math.max(sf, HOUR_START);
  const ce = Math.min(ef, HOUR_END);
  return {
    top:    (cs - HOUR_START) * HOUR_HEIGHT,
    height: Math.max(22, (ce - cs) * HOUR_HEIGHT - 2),
  };
}

/** Assign overlap columns so simultaneous events don't completely hide each other */
function layoutEvents(evts: CalEvent[]): (CalEvent & { col: number; cols: number })[] {
  const out: (CalEvent & { col: number; cols: number })[] = [];
  const groups: (CalEvent & { col: number; cols: number })[][] = [];

  for (const ev of evts) {
    if (!eventGeometry(ev)) continue;
    let placed = false;
    for (const group of groups) {
      if (group.some((g) => g.startMs < ev.endMs && g.endMs > ev.startMs)) {
        const used = new Set(group.map((g) => g.col));
        let col = 0;
        while (used.has(col)) col++;
        const entry = { ...ev, col, cols: 0 };
        group.push(entry);
        out.push(entry);
        const max = Math.max(...group.map((g) => g.col));
        for (const g of group) g.cols = max + 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const entry = { ...ev, col: 0, cols: 1 };
      groups.push([entry]);
      out.push(entry);
    }
  }
  return out;
}

// ─── Event block (Day + Week views) ──────────────────────────────────────────

function EventBlock({
  ev, top, height, col, cols, narrow = false, onClick,
}: {
  ev: CalEvent; top: number; height: number;
  col: number; cols: number; narrow?: boolean;
  onClick?: () => void;
}) {
  const widthPct = cols > 1 ? 100 / cols - 1 : 99;
  const leftPct  = col * (100 / cols);
  return (
    <div
      className="cc2-cal-event-block"
      style={{
        top, height,
        left:            `${leftPct}%`,
        width:           `${widthPct}%`,
        borderLeftColor: ev.calendarColor,
        background:      hexAlpha(ev.calendarColor, 0.15),
        cursor:          onClick ? "pointer" : "default",
      }}
      title={`${ev.summary}\n${fmtRange(ev)}`}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      <div className="cc2-cal-event-title" style={{ fontSize: narrow ? 10 : 11 }}>
        {ev.summary}
      </div>
      {height > 36 && (
        <div className="cc2-cal-event-time">{fmtRange(ev)}</div>
      )}
    </div>
  );
}

// ─── All-day banner ───────────────────────────────────────────────────────────

function AllDayBanner({
  events,
  onEventClick,
}: {
  events: CalEvent[];
  onEventClick?: (ev: CalEvent) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="cc2-cal-allday-banner">
      <div className="cc2-cal-allday-section-label">All Day Events</div>
      {events.map((ev) => (
        <div
          key={ev.id}
          className="cc2-cal-allday-chip"
          style={{
            borderLeftColor: ev.calendarColor,
            background:      hexAlpha(ev.calendarColor, 0.18),
            cursor:          onEventClick ? "pointer" : "default",
          }}
          onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
        >
          {ev.summary}
        </div>
      ))}
    </div>
  );
}

// ─── Current-time indicator ───────────────────────────────────────────────────

function NowLine() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < HOUR_START || h > HOUR_END) return null;
  return (
    <div className="cc2-cal-now-line" style={{ top: (h - HOUR_START) * HOUR_HEIGHT }}>
      <div className="cc2-cal-now-dot" />
    </div>
  );
}

// ─── Hour-label column ────────────────────────────────────────────────────────

function HourLabels() {
  return (
    <div className="cc2-cal-hour-labels" style={{ height: TOTAL_H }}>
      {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
        <div
          key={i}
          className="cc2-cal-hour-label"
          style={{
            top:       i * HOUR_HEIGHT,
            transform: i === 0 ? "none" : "translateY(-50%)",
          }}
        >
          {fmt12(HOUR_START + i)}
        </div>
      ))}
    </div>
  );
}

// ─── Hour gridlines ───────────────────────────────────────────────────────────

function HourLines() {
  return (
    <>
      {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
        <div
          key={i}
          className="cc2-cal-hour-line"
          style={{ top: i * HOUR_HEIGHT, left: 0, right: 0 }}
        />
      ))}
    </>
  );
}

// ─── DAY VIEW ─────────────────────────────────────────────────────────────────

export function DayView({
  date,
  events,
  onEventClick,
  onSlotClick,
}: {
  date:          Date;
  /** Merged event list. Omitted = read Google from the context. */
  events?:       CalEvent[];
  onEventClick?: (ev: CalEvent) => void;
  onSlotClick?:  (date: Date, hour: number) => void;
}) {
  const { ensureRange } = useCalendar();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ensureRange(startOfDay(date), endOfDay(date));
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_H * HOUR_HEIGHT;
  }, []);

  const allEvts = useRangeEvents(events, startOfDay(date), endOfDay(date));
  const allDay  = allEvts.filter((e) => e.allDay);
  const timed   = layoutEvents(allEvts.filter((e) => !e.allDay));

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick) return;
    const hour = Math.floor(e.nativeEvent.offsetY / HOUR_HEIGHT) + HOUR_START;
    onSlotClick(date, Math.max(0, Math.min(23, hour)));
  };

  return (
    <div className="cc2-cal-day-view">
      <AllDayBanner events={allDay} onEventClick={onEventClick} />
      <div ref={scrollRef} className="cc2-cal-scroll">
        <HourLabels />
        <div
          className="cc2-cal-event-canvas"
          style={{ height: TOTAL_H, cursor: onSlotClick ? "crosshair" : "default" }}
          onClick={handleCanvasClick}
        >
          <HourLines />
          {isToday(date) && <NowLine />}
          {timed.map((ev) => {
            const g = eventGeometry(ev);
            if (!g) return null;
            return (
              <EventBlock
                key={ev.id + ev.calendarId}
                ev={ev} top={g.top} height={g.height}
                col={ev.col} cols={ev.cols}
                onClick={() => onEventClick?.(ev)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── WEEK VIEW ────────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = WEEKDAYS_SHORT;

export function WeekView({
  weekStart,
  events,
  onSelectDate,
  onEventClick,
  onSlotClick,
}: {
  weekStart:     Date;
  /** Merged event list. Omitted = read Google from the context. */
  events?:       CalEvent[];
  onSelectDate:  (d: Date) => void;
  onEventClick?: (ev: CalEvent) => void;
  onSlotClick?:  (date: Date, hour: number) => void;
}) {
  const { ensureRange } = useCalendar();
  const vScrollRef = React.useRef<HTMLDivElement>(null);
  const weekEnd    = endOfDay(addDays(weekStart, 6));
  const days       = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  React.useEffect(() => {
    ensureRange(weekStart, weekEnd);
  }, [weekStart.toISOString()]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (vScrollRef.current) vScrollRef.current.scrollTop = SCROLL_TO_H * HOUR_HEIGHT;
  }, []);

  // All-day events for the week — use computeAllDaySlots which handles
  // both single-day (e.g. Canada Day) and multi-day spanning events.
  const weekAllEvts     = useRangeEvents(events, weekStart, weekEnd);
  const weekAllDaySpans = computeAllDaySlots(weekAllEvts, days);
  const numAllDayRows   = weekAllDaySpans.reduce((m, s) => Math.max(m, s.row + 1), 0);

  return (
    <div className="cc2-cal-week-view">
      <div className="cc2-cal-week-hscroll">
        {/* flex:1 + minHeight:0 is more reliable than height:100% inside a flex container */}
        <div style={{ minWidth: MIN_WEEK_W, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

          {/* ── Column headers ── */}
          <div className="cc2-cal-week-header">
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            {days.map((d, i) => (
              <button
                key={i}
                className={"cc2-cal-week-col-hd" + (isToday(d) ? " today" : "")}
                style={{ flex: 1, minWidth: MIN_COL_W }}
                onClick={() => onSelectDate(d)}
              >
                <span className="cc2-cal-week-dow">{WEEKDAY_SHORT[i]}</span>
                <span className="cc2-cal-week-sep">–</span>
                <span className="cc2-cal-week-num">{ordinal(d.getDate())}</span>
              </button>
            ))}
          </div>

          {/* ── All-day event strip (hidden when empty) ── */}
          {numAllDayRows > 0 && (
            <div className="cc2-cal-week-allday-row">
              <div className="cc2-cal-week-allday-gutter" style={{ width: LABEL_W, flexShrink: 0 }}>
                all‑day
              </div>
              <div
                className="cc2-cal-week-allday-grid"
                style={{
                  gridTemplateColumns: `repeat(7, minmax(${MIN_COL_W}px, 1fr))`,
                  gridTemplateRows:    `repeat(${numAllDayRows}, 18px)`,
                }}
              >
                {weekAllDaySpans.map(({ ev, colStart, colEnd, startsHere, endsHere, row }) => (
                  <div
                    key={ev.id + ev.calendarId + row}
                    className={[
                      "cc2-cal-week-allday-chip",
                      startsHere ? "" : "cont-l",
                      endsHere   ? "" : "cont-r",
                    ].filter(Boolean).join(" ")}
                    style={{
                      gridColumn: `${colStart + 1} / ${colEnd + 2}`,
                      gridRow:    row + 1,
                      background: hexAlpha(ev.calendarColor, 0.78),
                      cursor:     onEventClick ? "pointer" : "default",
                    }}
                    title={ev.summary}
                    onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
                  >
                    {startsHere ? ev.summary : ""}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Vertically scrollable timed-event grid ── */}
          <div ref={vScrollRef} className="cc2-cal-scroll" style={{ flex: 1, minHeight: 0 }}>
            <HourLabels />
            <div style={{ flex: 1, display: "flex", marginLeft: LABEL_W }}>
              {days.map((d, i) => {
                const dayEvts = eventsInRange(weekAllEvts, startOfDay(d), endOfDay(d)).filter((e) => !e.allDay);
                const laidOut = layoutEvents(dayEvts);
                return (
                  <div
                    key={i}
                    className={"cc2-cal-week-col" + (isToday(d) ? " today" : "")}
                    style={{
                      flex: 1, minWidth: MIN_COL_W,
                      position: "relative", height: TOTAL_H,
                      cursor: onSlotClick ? "crosshair" : "default",
                    }}
                    onClick={(e) => {
                      if (!onSlotClick) return;
                      const hour = Math.floor(e.nativeEvent.offsetY / HOUR_HEIGHT) + HOUR_START;
                      onSlotClick(d, Math.max(0, Math.min(23, hour)));
                    }}
                  >
                    <HourLines />
                    {isToday(d) && <NowLine />}
                    {laidOut.map((ev) => {
                      const g = eventGeometry(ev);
                      if (!g) return null;
                      return (
                        <EventBlock
                          key={ev.id + ev.calendarId}
                          ev={ev} top={g.top} height={g.height}
                          col={ev.col} cols={ev.cols} narrow
                          onClick={() => onEventClick?.(ev)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── MONTH VIEW ───────────────────────────────────────────────────────────────
// Proper Google-Calendar-style month view:
//   • Fixed cell sizes (height is distributed equally across 6 rows)
//   • Multi-day events render as colored spans across day columns
//   • Single-day timed events show as compact chips per cell
//   • Overlapping multi-day spans are stacked into separate rows

type SpanSlot = {
  ev:         CalEvent;
  colStart:   number; // 0-6 (inclusive, in this week)
  colEnd:     number; // 0-6 (inclusive, in this week)
  startsHere: boolean;
  endsHere:   boolean;
  row:        number; // assigned display row (0-based)
};

/**
 * A Google all-day `date` field as a local Date.
 *
 * Centralises the epoch fallback the three call sites below each repeated.
 * `parseLocalISO` returns null for anything unparseable — where the old local
 * helper handed back an Invalid Date that silently poisoned the arithmetic
 * downstream — so the sentinel is explicit now rather than accidental.
 */
function allDayDate(iso: string | undefined): Date {
  return parseLocalISO(iso ?? "") ?? new Date(1970, 0, 1);
}

/** Determine if an event spans more than one calendar day */
function isMultiDay(ev: CalEvent): boolean {
  if (ev.allDay) {
    const s = allDayDate(ev.start.date);
    const eExcl = allDayDate(ev.end.date);
    const eIncl = new Date(eExcl.getTime() - 86_400_000);
    return !isSameDay(s, eIncl);
  }
  const s = new Date(ev.start.dateTime ?? "");
  const e = new Date(ev.end.dateTime ?? "");
  return !isSameDay(s, e) && e.getTime() > s.getTime();
}

/** Inclusive start/end calendar dates for an event */
function evDayRange(ev: CalEvent): { start: Date; end: Date } {
  if (ev.allDay) {
    const s = allDayDate(ev.start.date);
    const eExcl = allDayDate(ev.end.date);
    return { start: s, end: new Date(eExcl.getTime() - 86_400_000) };
  }
  return {
    start: startOfDay(new Date(ev.start.dateTime ?? "")),
    end:   startOfDay(new Date(ev.end.dateTime   ?? "")),
  };
}

/**
 * Like computeSpanSlots but for the week-view all-day strip — includes
 * BOTH single-day and multi-day all-day events. Single-day events occupy
 * exactly one column; multi-day events span their full column range.
 */
function computeAllDaySlots(events: CalEvent[], days: Date[]): SpanSlot[] {
  const weekStart = startOfDay(days[0]);
  const weekEnd   = endOfDay(days[6]);

  const allDay = events
    .filter((ev) => {
      if (!ev.allDay) return false;
      const { start, end } = evDayRange(ev);
      return start.getTime() <= weekEnd.getTime() && end.getTime() >= weekStart.getTime();
    })
    .sort((a, b) => a.startMs - b.startMs);

  const rawSlots: Omit<SpanSlot, "row">[] = allDay.map((ev) => {
    const { start: evS, end: evE } = evDayRange(ev);
    const startsHere = evS.getTime() >= weekStart.getTime();
    const endsHere   = evE.getTime() <= weekEnd.getTime();

    let colStart = startsHere
      ? Math.max(0, days.findIndex((d) => isSameDay(d, evS)))
      : 0;
    let colEnd = endsHere
      ? Math.max(colStart, days.findIndex((d) => isSameDay(d, evE)))
      : 6;

    // findIndex returns -1 if day not found — clamp to valid range
    if (colStart < 0) colStart = 0;
    if (colEnd   < colStart) colEnd = colStart;
    colStart = Math.min(6, colStart);
    colEnd   = Math.min(6, colEnd);

    return { ev, colStart, colEnd, startsHere, endsHere };
  });

  const rowEnds: number[] = [];
  return rawSlots.map((slot) => {
    let r = rowEnds.findIndex((end) => end < slot.colStart);
    if (r === -1) r = rowEnds.length;
    rowEnds[r] = slot.colEnd;
    return { ...slot, row: r };
  });
}

function computeSpanSlots(events: CalEvent[], days: Date[]): SpanSlot[] {
  const weekStart = startOfDay(days[0]);
  const weekEnd   = endOfDay(days[6]);

  const multi = events
    .filter((ev) => {
      if (!isMultiDay(ev)) return false;
      // Must overlap this week
      const { start, end } = evDayRange(ev);
      return start.getTime() <= weekEnd.getTime() && end.getTime() >= weekStart.getTime();
    })
    .sort((a, b) => a.startMs - b.startMs);

  // Compute column range (0–6) for each multi-day event in this week
  const rawSlots: Omit<SpanSlot, "row">[] = multi.map((ev) => {
    const { start: evS, end: evE } = evDayRange(ev);
    const startsHere = evS.getTime() >= weekStart.getTime();
    const endsHere   = evE.getTime() <= weekEnd.getTime();

    let colStart = 0;
    let colEnd   = 6;

    if (startsHere) {
      const idx = days.findIndex((d) => isSameDay(d, evS));
      if (idx !== -1) colStart = idx;
    }
    if (endsHere) {
      const idx = days.findIndex((d) => isSameDay(d, evE));
      if (idx !== -1) colEnd = idx;
    }

    // Clamp
    colStart = Math.max(0, Math.min(6, colStart));
    colEnd   = Math.max(colStart, Math.min(6, colEnd));

    return { ev, colStart, colEnd, startsHere, endsHere };
  });

  // Greedy row assignment — events that don't overlap share a row
  const rowEnds: number[] = [];
  return rawSlots.map((slot) => {
    let r = rowEnds.findIndex((end) => end < slot.colStart);
    if (r === -1) r = rowEnds.length;
    rowEnds[r] = slot.colEnd;
    return { ...slot, row: r };
  });
}

// ── Placement algorithm for unified month-view event grid ────────────────────
// Assigns every event (multi-day OR single-day) to a {colStart, colEnd, row}
// so multi-day events span visually across columns and single-day events sit
// in their own column — no separate header rows, everything packed top-down.

type EventPlacement = {
  ev:       CalEvent;
  colStart: number; // 0–6, inclusive
  colEnd:   number; // 0–6, inclusive
  row:      number; // 0-based display row
};

function computePlacements(events: CalEvent[], days: Date[]): EventPlacement[] {
  const wkS = startOfDay(days[0]).getTime();
  const wkE = endOfDay(days[6]).getTime();

  // Only events overlapping this week; multi-day first (longer first), then by start
  const weekEvts = events
    .filter(ev => ev.startMs < wkE && ev.endMs > wkS)
    .sort((a, b) => {
      const am = isMultiDay(a), bm = isMultiDay(b);
      if (am !== bm) return am ? -1 : 1;
      if (am && bm) return (b.endMs - b.startMs) - (a.endMs - a.startMs);
      return a.startMs - b.startMs;
    });

  // Column range (0–6) that an event occupies in this week
  function colRange(ev: CalEvent): { cs: number; ce: number } {
    const { start: evS, end: evE } = evDayRange(ev);

    let cs = evS.getTime() >= wkS
      ? Math.max(0, days.findIndex(d => isSameDay(d, evS)))
      : 0;

    let ce = evE.getTime() <= wkE
      ? days.findIndex(d => isSameDay(d, evE))
      : 6;
    if (ce < 0 || ce < cs) ce = cs;

    return {
      cs: Math.max(0, Math.min(6, cs)),
      ce: Math.max(0, Math.min(6, ce)),
    };
  }

  const placements: EventPlacement[] = [];

  for (const ev of weekEvts) {
    const { cs, ce } = colRange(ev);
    // Greedy row assignment: first row with no column overlap
    let row = 0;
    while (placements.some(p => p.row === row && p.colEnd >= cs && p.colStart <= ce)) {
      row++;
    }
    placements.push({ ev, colStart: cs, colEnd: ce, row });
  }

  return placements;
}

// ── WeekRow ───────────────────────────────────────────────────────────────────

function WeekRow({
  days,
  month,
  selectedDate,
  onSelectDate,
  monthEvts,
  onEventClick,
}: {
  days:          Date[];
  month:         number;
  selectedDate:  Date;
  onSelectDate:  (d: Date) => void;
  monthEvts:     CalEvent[];
  onEventClick?: (ev: CalEvent) => void;
}) {
  const MAX_ROWS = 3;

  const allPlacements = computePlacements(monthEvts, days);
  const visibleP      = allPlacements.filter(p => p.row < MAX_ROWS);
  const hiddenP       = allPlacements.filter(p => p.row >= MAX_ROWS);

  // Per-column overflow count for "+N more"
  const hiddenPerCol = days.map((_, c) =>
    hiddenP.filter(p => p.colStart <= c && c <= p.colEnd).length
  );

  return (
    <div className="cc2-cal-month-week-row">

      {/* ── Day numbers ── */}
      <div className="cc2-cal-month-numrow">
        {days.map((d, i) => {
          const inM = d.getMonth() === month;
          const tod = isToday(d);
          const sel = isSameDay(d, selectedDate);
          return (
            <div
              key={i}
              className={["cc2-cal-month-numcell", !inM ? "out" : ""].filter(Boolean).join(" ")}
              onClick={() => onSelectDate(d)}
            >
              <span className={["cc2-cal-month-num",
                tod         ? "today"    : "",
                sel && !tod ? "selected" : "",
              ].filter(Boolean).join(" ")}>
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Unified event grid: spans stretch, single-day events sit in column ── */}
      <div className="cc2-cal-month-event-grid">

        {visibleP.map(({ ev, colStart, colEnd, row }) => (
          <div
            key={ev.id + ev.calendarId + row}
            className="cc2-cal-month-event"
            style={{
              gridColumn:      `${colStart + 1} / ${colEnd + 2}`,
              gridRow:         row + 1,
              background:      hexAlpha(ev.calendarColor, 0.24),
              borderLeftColor: ev.calendarColor,
              cursor:          onEventClick ? "pointer" : "default",
            }}
            title={ev.summary}
            onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
          >
            {!ev.allDay && !isMultiDay(ev) && (
              <span className="cc2-cal-month-ev-time">{fmtTimeShort(ev)}</span>
            )}
            <span className="cc2-cal-month-ev-title">{ev.summary}</span>
          </div>
        ))}

        {hiddenPerCol.map((count, c) => count > 0 && (
          <div
            key={`more-${c}`}
            className="cc2-cal-month-more"
            style={{ gridColumn: c + 1, gridRow: MAX_ROWS + 1 }}
          >
            +{count} more
          </div>
        ))}

      </div>

    </div>
  );
}

// ── MonthView ─────────────────────────────────────────────────────────────────

export function MonthView({
  year,
  month,
  selectedDate,
  events,
  onSelectDate,
  onEventClick,
}: {
  year:          number;
  month:         number;
  selectedDate:  Date;
  /** Merged event list. Omitted = read Google from the context. */
  events?:       CalEvent[];
  onSelectDate:  (d: Date) => void;
  onEventClick?: (ev: CalEvent) => void;
}) {
  const { ensureRange } = useCalendar();

  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
  const gridStart  = startOfWeek(monthStart);
  const monthEvts  = useRangeEvents(events, monthStart, monthEnd);

  React.useEffect(() => {
    ensureRange(monthStart, monthEnd);
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeks = Array.from({ length: 6 }, (_, wi) =>
    Array.from({ length: 7 }, (_, di) => addDays(gridStart, wi * 7 + di))
  );

  return (
    <div className="cc2-cal-month-view">
      {/* Day-of-week header */}
      <div className="cc2-cal-month-dow-row">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="cc2-cal-month-dow">{d}</div>
        ))}
      </div>

      {/* 6 week rows */}
      <div className="cc2-cal-month-body">
        {weeks.map((weekDays, wi) => (
          <WeekRow
            key={wi}
            days={weekDays}
            month={month}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
            monthEvts={monthEvts}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}

// ─── MINI MONTH (compact date picker in panel header) ─────────────────────────

export function MiniMonth({
  year,
  month,
  selectedDate,
  events,
  onSelectDate,
}: {
  year:          number;
  month:         number;
  selectedDate:  Date;
  /** Merged event list. Omitted = read Google from the context. */
  events?:       CalEvent[];
  onSelectDate:  (d: Date) => void;
}) {

  const MONTH_NAMES = MONTHS;

  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
  const gridStart  = startOfWeek(monthStart);
  const cells      = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthEvts  = useRangeEvents(events, monthStart, monthEnd);

  function hasEvents(d: Date): boolean {
    return monthEvts.some((ev) => {
      const s = ev.allDay
        ? allDayDate(ev.start.date)
        : new Date(ev.start.dateTime ?? "");
      return isSameDay(s, d);
    });
  }

  return (
    <div className="cc2-cal-mini-month">
      {/* No prev/next here — redundant with the topbar's own month/day/week
          stepper right above it. This is a display + date-picker only. */}
      <div className="cc2-cal-mini-header">
        <span className="cc2-cal-mini-title">{MONTH_NAMES[month]} {year}</span>
      </div>

      <div className="cc2-cal-mini-dow-row">
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <div key={i} className="cc2-cal-mini-dow">{d}</div>
        ))}
      </div>

      <div className="cc2-cal-mini-grid">
        {cells.map((d, i) => {
          const inMonth  = d.getMonth() === month;
          const today    = isToday(d);
          const selected = isSameDay(d, selectedDate);
          const hasDot   = inMonth && hasEvents(d);
          return (
            <button
              key={i}
              className={[
                "cc2-cal-mini-cell",
                !inMonth ? "out"      : "",
                today    ? "today"    : "",
                selected ? "selected" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onSelectDate(d)}
            >
              <span className="cc2-cal-mini-cell-num">{d.getDate()}</span>
              {hasDot && <span className="cc2-cal-mini-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Calendar legend (interactive toggle list) ────────────────────────────────
// Used in both the slide-out panel and the fullscreen sidebar.
// Layout: name on left, colored checkbox on right.
// Clicking a row toggles that calendar's visibility globally (hiddenCalIds).

export function CalendarLegend({ entries }: { entries?: CalendarMeta[] } = {}) {
  const { calendars, hiddenCalIds, toggleCalendar } = useCalendar();
  // `entries` lets a caller list vault sources beside Google's calendars. They
  // are plain CalendarMeta carrying a synthetic id, so toggling, hiding and the
  // check state all run through the same `hiddenCalIds` path — there is no
  // second visibility mechanism that could drift out of agreement with it.
  const list = entries ?? calendars;
  if (list.length === 0) return null;
  return (
    <div className="cc2-cal-legend">
      <div className="cc2-cal-legend-header">CALENDARS</div>
      {list.map((cal) => {
        const hidden = hiddenCalIds.includes(cal.id);
        return (
          <button
            key={cal.id}
            className={"cc2-cal-legend-item" + (hidden ? " off" : "")}
            onClick={() => toggleCalendar(cal.id)}
            title={hidden ? `Show ${cal.summary}` : `Hide ${cal.summary}`}
          >
            <span className="cc2-cal-legend-name">{cal.summary}</span>
            <span
              className="cc2-cal-legend-check"
              style={{
                background:  hidden ? "transparent" : cal.backgroundColor,
                borderColor: cal.backgroundColor,
              }}
            >
              {!hidden && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1 4l2 2 4-4" stroke="#fff" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
