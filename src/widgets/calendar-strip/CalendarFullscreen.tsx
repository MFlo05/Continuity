/**
 * CalendarFullscreen — full-screen calendar overlay portaled to document.body.
 * Uses DayView, WeekView, MonthView, MiniMonth from CalendarViews.tsx.
 */

import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import { useCalendar } from '../../calendar/CalendarContext';
import { useMergedEvents } from '../../calendar/useMergedEvents';
import { DayView, WeekView, MonthView, MiniMonth, CalendarLegend } from '../../calendar/CalendarViews';
import { isEditableEvent, eventsInRange } from '../../calendar/calendar';
import type { CalEvent } from '../../calendar/calendar';
import {
  startOfWeek, addDays, startOfDay, endOfDay,
  localISO as formatDateISO, parseLocalISO,
} from '../../core/dates';
import type { EventInitialData } from './CalendarStripWidget';

type CalView = 'day' | 'week' | 'month';

/** A Google all-day `date` string as a local Date; epoch on anything else. */
function parseDateLocal(s: string): Date {
  return parseLocalISO(s) ?? new Date(1970, 0, 1);
}
function fmtWeekHeader(ws: Date) {
  const we = addDays(ws, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (ws.getFullYear() !== we.getFullYear())
    return `${ws.toLocaleDateString(undefined,{...opts,year:'numeric'})} – ${we.toLocaleDateString(undefined,{...opts,year:'numeric'})}`;
  if (ws.getMonth() !== we.getMonth())
    return `${ws.toLocaleDateString(undefined,opts)} – ${we.toLocaleDateString(undefined,opts)} ${we.getFullYear()}`;
  return `${ws.toLocaleDateString(undefined,{month:'short'})} ${ws.getDate()} – ${we.getDate()}, ${we.getFullYear()}`;
}

function fmtEventLine(ev: CalEvent) {
  if (ev.allDay) {
    const s = parseDateLocal(ev.start.date ?? '');
    return { time: s.toLocaleDateString(undefined,{month:'numeric',day:'numeric'})+', All day', title: ev.summary };
  }
  const s = new Date(ev.start.dateTime ?? '');
  return {
    time: `${s.toLocaleDateString(undefined,{month:'numeric',day:'numeric'})}, ${s.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',hour12:true})}`,
    title: ev.summary,
  };
}

function UpcomingSidebar({ events }: { events: CalEvent[] }) {
  const { status, refreshing } = useCalendar();
  const today = new Date();
  // Not gated on `status` — see CalendarStripWidget's upcoming list for why.
  const upcoming = eventsInRange(events, today, endOfDay(addDays(today, 14)))
    .filter(ev => ev.endMs > today.getTime())
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 5);
  return (
    <div className="cc2-cal-fs-section">
      <div className="cc2-cal-fs-section-label">Upcoming</div>
      {status !== 'connected' && upcoming.length === 0 && <div className="cc2-cal-fs-empty">Not connected</div>}
      {refreshing && upcoming.length === 0 && <div className="cc2-cal-fs-empty" style={{opacity:0.4}}>Loading…</div>}
      {status === 'connected' && !refreshing && upcoming.length === 0 && <div className="cc2-cal-fs-empty">No upcoming events</div>}
      {upcoming.map(ev => {
        const { time, title } = fmtEventLine(ev);
        return (
          <div key={ev.id+ev.calendarId} className="cc2-cal-fs-upcoming-row">
            <span className="cc2-cal-fs-upcoming-dot" style={{ background: ev.calendarColor }} />
            <div className="cc2-cal-fs-upcoming-info">
              <div className="cc2-cal-fs-upcoming-time">{time}</div>
              <div className="cc2-cal-fs-upcoming-title">{title}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  onClose:     () => void;
  initialDate: Date;
  initialView: CalView;
  onOpenModal: (data?: EventInitialData, edit?: { eventId: string; calId: string }) => void;
  modalOpen:   boolean;
  /**
   * What a click on a NON-Google event does. Google's edit modal can't serve
   * one, so the owning source decides — usually opening the note or page the
   * event came from. Absent means such an event simply isn't actionable.
   */
  onOpenSourceEvent?: (ev: CalEvent) => void;
  app: App;
  // Same per-widget accent as CalendarStripWidget's own root — passed through
  // so the fullscreen overlay (a separate document.body portal, outside the
  // compact widget's DOM) picks up the same tone instead of reverting to
  // Obsidian's default accent.
  tone?: string;
  wash?: boolean;
}

export function CalendarFullScreen({ onClose, initialDate, initialView, onOpenModal, modalOpen, onOpenSourceEvent, app, tone, wash }: Props) {
  const { refresh } = useCalendar();
  const [view,        setView]        = useState<CalView>(initialView);
  const [selDate,     setSelDate]     = useState(initialDate);
  const [miniYear,    setMiniYear]    = useState(initialDate.getFullYear());
  const [miniMonth,   setMiniMonth]   = useState(initialDate.getMonth());
  // Collapsed by default on a phone, open everywhere else — 200px of sidebar
  // is comfortable on a desktop and over half the width of an iPhone.
  const [sidebarOpen, setSidebarOpen] = useState(!Platform.isPhone);

  const weekStart = startOfWeek(selDate);

  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modalOpen) onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose, modalOpen]);

  const goToDate = (d: Date) => { setSelDate(d); setMiniYear(d.getFullYear()); setMiniMonth(d.getMonth()); };
  const goToToday = () => { const n = startOfDay(new Date()); goToDate(n); };
  // Clicking a day cell in Month/Week view drills into that day — the sidebar's
  // MiniMonth date picker stays on goToDate (it's a persistent picker, not a grid
  // you're "opening a day" from) so it doesn't force a view switch.
  const goToDayView = (d: Date) => { goToDate(d); setView('day'); };

  const stepPrev = () => {
    if (view === 'day') setSelDate(d => addDays(d, -1));
    else if (view === 'week') setSelDate(d => addDays(d, -7));
    else { let nm = miniMonth-1, ny = miniYear; if (nm < 0) { nm = 11; ny--; } setMiniMonth(nm); setMiniYear(ny); }
  };
  const stepNext = () => {
    if (view === 'day') setSelDate(d => addDays(d, 1));
    else if (view === 'week') setSelDate(d => addDays(d, 7));
    else { let nm = miniMonth+1, ny = miniYear; if (nm > 11) { nm = 0; ny++; } setMiniMonth(nm); setMiniYear(ny); }
  };

  // The visible window, widened to cover the sidebar's 14-day upcoming list.
  // Deliberately view-scoped rather than the context's 3-month range: the vault
  // adapters expand recurrences over whatever they're asked for.
  const rangeStart = React.useMemo(() => startOfDay(
    view === 'month' ? new Date(miniYear, miniMonth, 1)
    : view === 'week' ? weekStart
    : selDate,
  ), [view, miniYear, miniMonth, weekStart.getTime(), selDate.getTime()]);
  const rangeEnd = React.useMemo(() => {
    const base = view === 'month' ? new Date(miniYear, miniMonth + 1, 0)
      : view === 'week' ? addDays(weekStart, 6)
      : selDate;
    return endOfDay(new Date(Math.max(base.getTime(), addDays(new Date(), 14).getTime())));
  }, [view, miniYear, miniMonth, weekStart.getTime(), selDate.getTime()]);

  const { events: mergedEvents, legend, openEvent } = useMergedEvents(app, rangeStart, rangeEnd);

  const today = new Date();
  const isOnToday = view === 'day' && selDate.getFullYear() === today.getFullYear() && selDate.getMonth() === today.getMonth() && selDate.getDate() === today.getDate();

  const headerText = view === 'day'
    ? selDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : view === 'week' ? fmtWeekHeader(weekStart)
    : new Date(miniYear, miniMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const onEventClick = useCallback((ev: CalEvent) => {
    // A vault-sourced event has no Google id to PATCH. Without this guard the
    // click would open the full "Edit Event" modal — Delete button and all —
    // and saving would fire a request against a synthetic id that exists on no
    // Google calendar. Read-only events defer to whatever the source itself
    // offers instead.
    if (!isEditableEvent(ev)) { (onOpenSourceEvent ?? openEvent)(ev); return; }

    let startDate: string, endDate: string, startTime: string, endTime: string;
    if (ev.allDay) {
      const s = parseDateLocal(ev.start.date ?? '');
      const eExcl = parseDateLocal(ev.end.date ?? '');
      const eIncl = new Date(eExcl.getTime() - 86_400_000);
      startDate = formatDateISO(s); endDate = formatDateISO(eIncl);
      startTime = '09:00'; endTime = '10:00';
    } else {
      const s = new Date(ev.start.dateTime ?? ''); const e = new Date(ev.end.dateTime ?? '');
      startDate = formatDateISO(s); endDate = formatDateISO(e);
      startTime = `${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`;
      endTime   = `${String(e.getHours()).padStart(2,'0')}:${String(e.getMinutes()).padStart(2,'0')}`;
    }
    onOpenModal({ title: ev.summary, allDay: ev.allDay, startDate, endDate, startTime, endTime, location: ev.location, description: ev.description, calId: ev.calendarId, colorId: ev.colorId }, { eventId: ev.id, calId: ev.calendarId });
  }, [onOpenModal, onOpenSourceEvent, openEvent]);

  const onSlotClick = useCallback((date: Date, hour: number) => {
    const h = Math.max(0, Math.min(23, hour));
    onOpenModal({ startDate: formatDateISO(date), endDate: formatDateISO(date), startTime: `${String(h).padStart(2,'0')}:00`, endTime: `${String(Math.min(23,h+1)).padStart(2,'0')}:00` });
  }, [onOpenModal, onOpenSourceEvent]);

  return createPortal(
    <div className="cc2-cal-fs-backdrop" data-tone={tone} data-wash={wash || undefined}>
      <div className={'cc2-cal-fs' + (Platform.isPhone ? ' cc2-fs--phone' : '')}>

        {/* Topbar */}
        <div className="cc2-cal-fs-topbar">
          <button className="cc2-flush-btn cc2-cal-fs-exit" onClick={onClose} title="Exit fullscreen (Esc)">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M5 1H1v4M9 1h4v4M13 9v4H9M1 9v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Exit</span>
          </button>

          {/* Sidebar toggle. The mini-month, upcoming list and legend cost 200px
              of a 390px screen — more than half the width for context, leaving
              the day/week grid unreadable. Starts collapsed on a phone and is
              always available so the sidebar is a deliberate visit, not a tax. */}
          <button
            className={'cc2-flush-btn cc2-cal-fs-side-toggle' + (sidebarOpen ? ' active' : '')}
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarOpen}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>

          <div className="cc2-cal-fs-nav-pill">
            <button className="cc2-flush-btn cc2-cal-fs-nav-arrow" onClick={stepPrev}>‹</button>
            <button className="cc2-flush-btn cc2-cal-fs-nav-date" onClick={goToToday}>
              {isOnToday && <span className="cc2-cal-fs-today-badge">TODAY</span>}
              <span>{headerText}</span>
            </button>
            <button className="cc2-flush-btn cc2-cal-fs-nav-arrow" onClick={stepNext}>›</button>
          </div>

          <div className="cc2-cal-fs-view-pill">
            {(['day','week','month'] as CalView[]).map(v => (
              <button key={v} className={'cc2-flush-btn cc2-cal-fs-view-opt'+(view===v?' active':'')} onClick={() => setView(v)}>
                {v.charAt(0).toUpperCase()+v.slice(1)}
              </button>
            ))}
          </div>

          <button className="cc2-flush-btn cc2-cal-wgt-detailed-btn" style={{ marginLeft: 'auto' }} onClick={() => onOpenModal()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Event
          </button>
        </div>

        {/* Body */}
        <div className="cc2-cal-fs-body">

          {/* Sidebar */}
          {sidebarOpen && (
          <div className="cc2-cal-fs-sidebar">
            <MiniMonth
              year={miniYear} month={miniMonth} selectedDate={selDate}
              onSelectDate={goToDate}
            />
            <div className="cc2-cal-fs-divider" />
            <UpcomingSidebar events={mergedEvents} />
            <div className="cc2-cal-fs-divider" />
            <div className="cc2-cal-fs-section">
              <CalendarLegend entries={legend} />
            </div>
          </div>
          )}

          {/* Main area */}
          <div className="cc2-cal-fs-main">
            {view === 'day'   && <DayView   date={selDate} events={mergedEvents} onEventClick={onEventClick} onSlotClick={onSlotClick} />}
            {view === 'week'  && <WeekView  weekStart={weekStart} events={mergedEvents} onSelectDate={goToDayView} onEventClick={onEventClick} onSlotClick={onSlotClick} />}
            {view === 'month' && <MonthView year={miniYear} month={miniMonth} selectedDate={selDate} events={mergedEvents} onSelectDate={goToDayView} onEventClick={onEventClick} />}
          </div>

        </div>
      </div>
    </div>,
    document.body,
  );
}
