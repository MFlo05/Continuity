/**
 * CalendarStripWidget — 5×4 calendar widget for CC2.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  6 July              [⛶ expand] [⟳ sync]│  ← header
 *   │  SUN.                                    │
 *   ├────────────────┬─────────────────────────┤
 *   │  ‹ Jul 2026 ›  │  UPCOMING               │  ← body
 *   │  [mini month]  │  • event rows           │
 *   ├────────────────┴─────────────────────────┤
 *   │  ✦ Quick add…                      [Add] │  ← quick add
 *   └──────────────────────────────────────────┘
 *
 * The expand button opens a fullscreen calendar overlay (portal to body).
 */

import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { useCalendar } from '../../calendar/CalendarContext';
import { CC_EVENT_COLORS, eventsInRange, isEditableEvent } from '../../calendar/calendar';
import type { CalEvent } from '../../calendar/calendar';
import { useMergedEvents } from '../../calendar/useMergedEvents';
import {
  startOfDay, endOfDay, addDays, startOfWeek,
  isSameDay, isToday, localISO as formatDateISO, parseLocalISO, MONTHS,
} from '../../core/dates';
import { CalendarFullScreen } from './CalendarFullscreen';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A Google all-day `date` string as a local Date; epoch on anything else. */
function parseDateLocal(s: string): Date {
  return parseLocalISO(s) ?? new Date(1970, 0, 1);
}

function fmtEventLine(ev: CalEvent): { time: string; title: string } {
  if (ev.allDay) {
    const s = parseDateLocal(ev.start.date ?? '');
    return {
      time:  s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · All day',
      title: ev.summary,
    };
  }
  const s    = new Date(ev.start.dateTime ?? '');
  const time = s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  return { time, title: ev.summary };
}

// ─── NLP parser (inline — mirrors calendar-quick-add.tsx) ─────────────────────

const DAY_MAP: Record<string, number> = {
  sun:0,sunday:0, mon:1,monday:1, tue:2,tuesday:2, wed:3,wednesday:3,
  thu:4,thursday:4, fri:5,friday:5, sat:6,saturday:6,
};
function nextWeekday(name: string, forceNext = false): Date {
  const target = DAY_MAP[name.toLowerCase()];
  if (target === undefined) return new Date();
  const today = new Date(); const todayN = today.getDay();
  let diff = (target - todayN + 7) % 7;
  if (diff === 0) diff = 7;
  if (forceNext && diff === 0) diff = 7;
  const d = new Date(today); d.setDate(d.getDate() + diff); return d;
}

interface ParsedEvent {
  title: string; date: Date;
  startHour: number; startMin: number;
  durationMin: number; durationDays: number; allDay: boolean;
}

function parseEventText(raw: string): ParsedEvent | null {
  if (!raw.trim()) return null;
  let text = raw;
  let date: Date = new Date();
  let startHour = 9, startMin = 0, durationMin = 60, durationDays = 1;
  let hasTime = false;

  const daysM = text.match(/\bfor\s+(\d+)\s+(?:day|days|night|nights)\b/i);
  const weeksM = text.match(/\bfor\s+(\d+)\s+(?:week|weeks)\b/i);
  const aWeekM = text.match(/\bfor\s+a\s+week\b/i);
  if (daysM)  { durationDays = Math.max(1, parseInt(daysM[1]));  text = text.replace(daysM[0],  ''); }
  else if (weeksM) { durationDays = Math.max(1, parseInt(weeksM[1]) * 7); text = text.replace(weeksM[0], ''); }
  else if (aWeekM) { durationDays = 7; text = text.replace(aWeekM[0], ''); }

  const nextM = text.match(/\bnext\s+(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (nextM) { date = nextWeekday(nextM[1], true); text = text.replace(nextM[0], ''); }

  const thisM = !nextM && text.match(/\bthis\s+(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (thisM) { date = nextWeekday(thisM[1]); text = text.replace(thisM[0], ''); }

  const tomM = !nextM && !thisM && text.match(/\btomorrow\b/i);
  if (tomM) { const d = new Date(); d.setDate(d.getDate()+1); date = d; text = text.replace(tomM[0], ''); }

  const todM = !nextM && !thisM && !tomM && text.match(/\btoday\b/i);
  if (todM) { date = new Date(); text = text.replace(todM[0], ''); }

  if (!nextM && !thisM && !tomM && !todM) {
    const dayM = text.match(/\b(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (dayM) { date = nextWeekday(dayM[1]); text = text.replace(dayM[0], ''); }
  }

  if (durationDays === 1) {
    const hmM = text.match(/\b(\d+)\s*h(?:r|rs|our|ours)?\s*(\d+)\s*m(?:in|ins)?\b/i);
    if (hmM) { durationMin = parseInt(hmM[1])*60 + parseInt(hmM[2]); text = text.replace(hmM[0], ''); }
    else {
      const hM = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:r|rs|our|ours)?\b/i);
      if (hM) { durationMin = Math.round(parseFloat(hM[1])*60); text = text.replace(hM[0], ''); }
      else {
        const mM = text.match(/\b(\d+)\s*m(?:in|ins)?\b/i);
        if (mM) { durationMin = parseInt(mM[1]); text = text.replace(mM[0], ''); }
      }
    }
  }

  const noonM = text.match(/\bnoon\b/i);
  if (noonM) { startHour = 12; hasTime = true; text = text.replace(noonM[0], ''); }
  else {
    const midM = text.match(/\bmidnight\b/i);
    if (midM) { startHour = 0; hasTime = true; text = text.replace(midM[0], ''); }
    else {
      const tColAmPm = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
      if (tColAmPm) {
        let h = parseInt(tColAmPm[1]); const m = parseInt(tColAmPm[2]);
        if (tColAmPm[3].toLowerCase() === 'pm' && h !== 12) h += 12;
        if (tColAmPm[3].toLowerCase() === 'am' && h === 12) h = 0;
        startHour = h; startMin = m; hasTime = true; text = text.replace(tColAmPm[0], '');
      } else {
        const tAmPm = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
        if (tAmPm) {
          let h = parseInt(tAmPm[1]);
          if (tAmPm[2].toLowerCase() === 'pm' && h !== 12) h += 12;
          if (tAmPm[2].toLowerCase() === 'am' && h === 12) h = 0;
          startHour = h; hasTime = true; text = text.replace(tAmPm[0], '');
        }
      }
    }
  }

  const title = text.replace(/\bat\b/gi,'').replace(/\bstay\b/gi,'').replace(/\bthis\b/gi,'').replace(/\s+/g,' ').trim();
  if (!title) return null;
  const allDay = durationDays > 1 || (!hasTime && /\b(all[- ]?day|overnight|vacation|holiday|trip|stay|hotel|conference)\b/i.test(raw));
  return { title, date, startHour, startMin, durationMin, durationDays, allDay };
}

function fmt12(h: number, m: number) {
  const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2,'0')}${ap}`;
}
function fmtDate(d: Date) {
  const today = new Date(); const tom = new Date(); tom.setDate(today.getDate()+1);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, tom))   return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDur(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min/60); const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
function toISO(date: Date, hour: number, min: number) {
  const d = new Date(date); d.setHours(hour, min, 0, 0); return d.toISOString();
}

// ─── Mini month (no navigation controls — nav is in the header) ───────────────

const DOW = ['S','M','T','W','T','F','S'];

function MiniMonth({ year, month, selectedDate, onSelectDate }: {
  year: number; month: number; selectedDate: Date; onSelectDate: (d: Date) => void;
}) {
  const { eventsForRange } = useCalendar();
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
  const gridStart  = startOfWeek(monthStart);
  const cells      = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthEvts  = eventsForRange(monthStart, monthEnd);

  function hasDot(d: Date) {
    return monthEvts.some(ev => {
      const s = ev.allDay ? parseDateLocal(ev.start.date ?? '') : new Date(ev.start.dateTime ?? '');
      return isSameDay(s, d);
    });
  }

  return (
    <div className="cc2-cal-mini">
      <div className="cc2-cal-mini-dow-row">
        {DOW.map((d, i) => <div key={i} className="cc2-cal-mini-dow">{d}</div>)}
      </div>
      <div className="cc2-cal-mini-grid">
        {cells.map((d, i) => {
          const inM = d.getMonth() === month;
          const tod = isToday(d);
          const sel = isSameDay(d, selectedDate);
          const dot = inM && hasDot(d);
          return (
            <button
              key={i}
              className={['cc2-cal-mini-cell',!inM?'out':'',tod?'today':'',sel?'selected':''].filter(Boolean).join(' ')}
              onClick={() => onSelectDate(d)}
            >
              <span className="cc2-cal-mini-cell-num">{d.getDate()}</span>
              {dot && <span className="cc2-cal-mini-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Detailed Add Modal ───────────────────────────────────────────────────────

export interface EventInitialData {
  title?: string; allDay?: boolean;
  startDate?: string; endDate?: string; startTime?: string; endTime?: string;
  location?: string; description?: string; calId?: string; colorId?: string;
}

interface DetailedAddProps {
  onClose: () => void; onCreated?: () => void;
  initialData?: EventInitialData;
  editTarget?: { eventId: string; calId: string };
}

function DetailedAddModal({ onClose, onCreated, initialData, editTarget }: DetailedAddProps) {
  const { calendars, addEvent, updateEvent, deleteEvent } = useCalendar();
  const isEdit     = !!editTarget;
  const primaryCal = calendars.find(c => c.primary) ?? calendars[0];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [title,       setTitle]       = useState(initialData?.title       ?? '');
  const [calId,       setCalId]       = useState(initialData?.calId       ?? primaryCal?.id ?? '');
  const [allDay,      setAllDay]      = useState(initialData?.allDay      ?? false);
  const [startDate,   setStartDate]   = useState(initialData?.startDate   ?? formatDateISO(new Date()));
  const [endDate,     setEndDate]     = useState(initialData?.endDate     ?? formatDateISO(new Date()));
  const [startTime,   setStartTime]   = useState(initialData?.startTime   ?? '09:00');
  const [endTime,     setEndTime]     = useState(initialData?.endTime     ?? '10:00');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [location,    setLocation]    = useState(initialData?.location    ?? '');
  const [repeatType,  setRepeatType]  = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'custom'>('none');
  const [customN,     setCustomN]     = useState('1');
  const [customUnit,  setCustomUnit]  = useState<'day'|'week'|'month'>('day');
  const [colorId,     setColorId]     = useState(initialData?.colorId ?? '');
  const [submitting,  setSubmitting]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [error,       setError]       = useState('');

  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  const onStartTimeChange = (val: string) => {
    setStartTime(val);
    const [h, m] = val.split(':').map(Number);
    const tot = h * 60 + m + 60;
    setEndTime(`${String(Math.min(23, Math.floor(tot/60))).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`);
  };

  const buildRRule = () => {
    if (repeatType === 'none')     return undefined;
    if (repeatType === 'daily')    return ['RRULE:FREQ=DAILY'];
    if (repeatType === 'weekly')   return ['RRULE:FREQ=WEEKLY'];
    if (repeatType === 'biweekly') return ['RRULE:FREQ=WEEKLY;INTERVAL=2'];
    if (repeatType === 'monthly')  return ['RRULE:FREQ=MONTHLY'];
    const n = Math.max(1, parseInt(customN) || 1);
    const freq = customUnit === 'day' ? 'DAILY' : customUnit === 'week' ? 'WEEKLY' : 'MONTHLY';
    return n === 1 ? [`RRULE:FREQ=${freq}`] : [`RRULE:FREQ=${freq};INTERVAL=${n}`];
  };

  const buildPayload = () => {
    const rec = buildRRule(); const col = colorId ? { colorId } : {};
    if (allDay) {
      const endExcl = formatDateISO(addDays(parseDateLocal(endDate), 1));
      return { summary: title.trim(), description: description.trim()||undefined, location: location.trim()||undefined,
        start: { date: startDate }, end: { date: endExcl }, ...(rec?{recurrence:rec}:{}), ...col };
    }
    return { summary: title.trim(), description: description.trim()||undefined, location: location.trim()||undefined,
      start: { dateTime: `${startDate}T${startTime}:00`, timeZone: tz },
      end:   { dateTime: `${endDate}T${endTime}:00`,     timeZone: tz },
      ...(rec?{recurrence:rec}:{}), ...col };
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || !calId || submitting) return;
    if (!allDay && startDate === endDate && startTime >= endTime) { setError('End time must be after start time.'); return; }
    setSubmitting(true); setError('');
    try {
      if (isEdit && editTarget) await updateEvent(editTarget.calId, editTarget.eventId, buildPayload());
      else await addEvent(calId, buildPayload());
      onCreated?.(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} event.`);
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editTarget || deleting) return;
    setDeleting(true); setError('');
    try { await deleteEvent(editTarget.calId, editTarget.eventId); onCreated?.(); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete event.'); setDeleting(false); }
  };

  return createPortal(
    <div className="cc2-cal-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cc2-cal-modal">
        <div className="cc2-cal-modal-header">
          <span className="cc2-cal-modal-title">{isEdit ? 'Edit Event' : 'New Event'}</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="cc2-cal-modal-body">

            <div className="cc2-cal-field">
              <label>Title *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title…" autoFocus />
            </div>

            {calendars.length > 1 && (
              <div className="cc2-cal-field">
                <label>Calendar</label>
                <select value={calId} onChange={e => setCalId(e.target.value)}>
                  {calendars.map(cal => <option key={cal.id} value={cal.id}>{cal.summary}</option>)}
                </select>
              </div>
            )}

            <div className="cc2-cal-field-row" onClick={() => setAllDay(v => !v)}>
              <span className="cc2-cal-field-label-sm">ALL DAY</span>
              <button type="button" className={'cc2-cal-toggle' + (allDay ? ' on' : '')} onClick={e => { e.stopPropagation(); setAllDay(v => !v); }}>
                <span className="cc2-cal-toggle-thumb" />
              </button>
            </div>

            {allDay ? (
              <div className="cc2-cal-field-2col">
                <div className="cc2-cal-field"><label>Start date</label>
                  <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} /></div>
                <div className="cc2-cal-field"><label>End date</label>
                  <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} /></div>
              </div>
            ) : (
              <div className="cc2-cal-field-3col">
                <div className="cc2-cal-field"><label>Date</label>
                  <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} /></div>
                <div className="cc2-cal-field"><label>Start time</label>
                  <input type="time" value={startTime} onChange={e => onStartTimeChange(e.target.value)} /></div>
                <div className="cc2-cal-field"><label>End time</label>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
              </div>
            )}

            <div className="cc2-cal-field">
              <label>Location <span className="cc2-cal-optional">(optional)</span></label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Add a location…" />
            </div>

            <div className="cc2-cal-field">
              <label>Repeat</label>
              <select value={repeatType} onChange={e => setRepeatType(e.target.value as typeof repeatType)}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom…</option>
              </select>
            </div>

            {repeatType === 'custom' && (
              <div className="cc2-cal-repeat-custom">
                <span>Every</span>
                <input type="number" className="cc2-cal-repeat-n" value={customN} min={1} max={365}
                  onChange={e => setCustomN(e.target.value)} />
                <select value={customUnit} onChange={e => setCustomUnit(e.target.value as typeof customUnit)}>
                  <option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option>
                </select>
              </div>
            )}

            <div className="cc2-cal-field">
              <label>Description <span className="cc2-cal-optional">(optional)</span></label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add details…" />
            </div>

            <div className="cc2-cal-field">
              <label>Color <span className="cc2-cal-optional">(optional)</span></label>
              <div className="cc2-cal-color-row">
                <button type="button" className={'cc2-cal-color-default' + (!colorId ? ' active' : '')}
                  onClick={() => setColorId('')} title="Calendar default">
                  {!colorId && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 4.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  Default
                </button>
                {CC_EVENT_COLORS.map(c => (
                  <button key={c.id} type="button"
                    className={'cc2-cal-color-swatch' + (colorId === c.id ? ' active' : '')}
                    style={{ background: c.color }} onClick={() => setColorId(prev => prev === c.id ? '' : c.id)} title={c.name}>
                    {colorId === c.id && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 4.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="cc2-cal-error">{error}</div>}

            <div className="cc2-cal-modal-actions">
              {isEdit && (
                <button type="button" className="pill cc2-cal-delete-btn"
                  onClick={handleDelete} disabled={deleting || submitting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
              <button type="button" className="cc2-flush-btn cc2-cal-modal-cancel-btn" onClick={onClose} disabled={submitting || deleting}>Cancel</button>
              <button type="submit" className="pill highlight" disabled={submitting || deleting || !title.trim()}>
                {submitting ? (isEdit ? 'Saving…' : 'Adding…') : isEdit ? '✓ Save' : '✓ Add Event'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ─── Main Widget ──────────────────────────────────────────────────────────────

const MONTH_NAMES = MONTHS;
const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

interface Props {
  config?: Record<string, unknown>;
  app: App;
}

export function CalendarStripWidget({ config, app }: Props) {
  const { eventsForRange, status, refreshing, refresh, login, logout, connecting, error } = useCalendar();

  // Per-widget accent (right-click "Edit Widget Settings…" -> WidgetSettingsModal).
  // tone is omitted entirely (no data-tone attribute) rather than defaulted
  // to 'paper' — that's what lets an untouched vault render pixel-identical
  // to before this feature existed.
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const today   = new Date();
  const dayName = DAY_NAMES[today.getDay()].slice(0, 3).toUpperCase();

  const [year,     setYear]     = useState(today.getFullYear());
  const [month,    setMonth]    = useState(today.getMonth());
  const [selDate,  setSelDate]  = useState(today);
  const [fsOpen,   setFsOpen]   = useState(false);
  const [modalData, setModalData] = useState<{ initial?: EventInitialData; edit?: {eventId:string;calId:string} } | null>(null);

  // Quick add state
  const { calendars, addEvent } = useCalendar();
  const [qaText,      setQaText]      = useState('');
  const [qaSubmitting, setQaSubmitting] = useState(false);
  const [qaFlashOk,   setQaFlashOk]   = useState(false);
  const [qaFlashErr,  setQaFlashErr]  = useState('');
  const qaInputRef = useRef<HTMLInputElement>(null);

  const qaDisabled = status !== 'connected';
  const qaParsed   = useMemo(() => parseEventText(qaText), [qaText]);
  const primaryCal = calendars.find(c => c.primary) ?? calendars[0];

  // Google + vault, in one list. The window spans whatever the mini-month is
  // showing plus the 14-day upcoming lookahead, so both read from the same
  // fetch — the vault adapters expand recurrences across this range, so it's
  // deliberately kept to weeks rather than the context's own 3-month window.
  const rangeStart = useMemo(
    () => startOfDay(new Date(Math.min(new Date(year, month, 1).getTime(), today.getTime()))),
    [year, month, today.getTime()],
  );
  const rangeEnd = useMemo(
    () => endOfDay(new Date(Math.max(new Date(year, month + 1, 0).getTime(), addDays(today, 14).getTime()))),
    [year, month, today.getTime()],
  );
  const { events: mergedEvents, openEvent } = useMergedEvents(app, rangeStart, rangeEnd);

  // Upcoming events (next 14 days, max 4).
  //
  // No longer gated on `status === 'connected'`. That gate predates this
  // widget showing anything but Google, and suppressed events precisely when
  // Google is ABSENT — backwards once vault sources feed in.
  const upcoming = eventsInRange(mergedEvents, today, endOfDay(addDays(today, 14)))
    .filter(ev => ev.endMs > today.getTime())
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 4);

  const prevMonth = () => {
    const d = new Date(year, month - 1, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth());
  };
  const nextMonth = () => {
    const d = new Date(year, month + 1, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth());
  };

  const handleQaSubmit = async () => {
    if (!qaParsed || !primaryCal || qaSubmitting) return;
    setQaSubmitting(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (qaParsed.durationDays > 1) {
        await addEvent(primaryCal.id, {
          summary: qaParsed.title,
          start: { date: formatDateISO(qaParsed.date) },
          end:   { date: formatDateISO(addDays(qaParsed.date, qaParsed.durationDays)) },
        });
      } else if (qaParsed.allDay) {
        await addEvent(primaryCal.id, {
          summary: qaParsed.title,
          start: { date: formatDateISO(qaParsed.date) },
          end:   { date: formatDateISO(addDays(qaParsed.date, 1)) },
        });
      } else {
        const endH = qaParsed.startHour + Math.floor((qaParsed.startMin + qaParsed.durationMin) / 60);
        const endM = (qaParsed.startMin + qaParsed.durationMin) % 60;
        await addEvent(primaryCal.id, {
          summary: qaParsed.title,
          start: { dateTime: toISO(qaParsed.date, qaParsed.startHour, qaParsed.startMin), timeZone: tz },
          end:   { dateTime: toISO(qaParsed.date, endH, endM), timeZone: tz },
        });
      }
      setQaText('');
      setQaFlashOk(true); setTimeout(() => setQaFlashOk(false), 1800);
    } catch (e) {
      setQaFlashErr(e instanceof Error ? e.message : 'Failed to create event');
      setTimeout(() => setQaFlashErr(''), 3500);
    } finally {
      setQaSubmitting(false);
    }
  };

  // QA preview meta string
  let qaMeta = '';
  if (qaParsed) {
    if (qaParsed.durationDays > 1) {
      const end = addDays(qaParsed.date, qaParsed.durationDays - 1);
      qaMeta = `${fmtDate(qaParsed.date)} → ${fmtDate(end)} · ${qaParsed.durationDays} days · All day`;
    } else if (qaParsed.allDay) {
      qaMeta = `${fmtDate(qaParsed.date)} · All day`;
    } else {
      qaMeta = `${fmtDate(qaParsed.date)} · ${fmt12(qaParsed.startHour, qaParsed.startMin)} · ${fmtDur(qaParsed.durationMin)}`;
    }
  }

  return (
    <div className="cc2-cal-widget" data-tone={tone} data-wash={wash || undefined}>

      {/* ── Header ── */}
      <div className="cc2-cal-wgt-header">
        <div className="cc2-cal-wgt-date-block">
          <div className="cc2-cal-wgt-date-line">
            {today.getDate()} {MONTH_NAMES[today.getMonth()]}
          </div>
          <div className="cc2-cal-wgt-day-name">
            {dayName}<span className="cc2-cal-wgt-accent">.</span>
          </div>
        </div>
        <div className="cc2-cal-wgt-actions">
          {status === 'connected' && (
            <button className="cc2-flush-btn cc2-cal-wgt-icon-btn cc2-cal-wgt-sync-btn" onClick={() => refresh()} title="Sync calendar" disabled={refreshing}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 2.5v3.5H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {status === 'connected' && (
            <button className="cc2-flush-btn cc2-cal-wgt-icon-btn cc2-cal-wgt-disconnect-btn" onClick={() => void logout()} title="Disconnect Google Calendar">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10.5 11.5 14 8l-3.5-3.5M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <button className="cc2-flush-btn cc2-cal-wgt-icon-btn cc2-cal-wgt-expand-btn" onClick={() => setFsOpen(true)} title="Open fullscreen calendar">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body: mini month + upcoming ── */}
      <div className="cc2-cal-wgt-body">

        {/* Left: mini month with nav */}
        <div className="cc2-cal-wgt-left">
          <div className="cc2-cal-wgt-month-nav">
            <button className="cc2-flush-btn cc2-cal-wgt-nav-btn" onClick={prevMonth}>‹</button>
            <span className="cc2-cal-wgt-month-label">
              {MONTH_NAMES[month].slice(0, 3)} {year}
            </span>
            <button className="cc2-flush-btn cc2-cal-wgt-nav-btn" onClick={nextMonth}>›</button>
          </div>
          <MiniMonth year={year} month={month} selectedDate={selDate} onSelectDate={setSelDate} />
        </div>

        <div className="cc2-cal-wgt-divider" />

        {/* Right: upcoming events */}
        <div className="cc2-cal-wgt-right">
          <div className="cc2-cal-wgt-events-label">UPCOMING</div>

          {refreshing && upcoming.length === 0 && (
            <div className="cc2-cal-wgt-no-events" style={{ opacity: 0.4 }}>Loading…</div>
          )}
          {status === 'connected' && !refreshing && upcoming.length === 0 && (
            <div className="cc2-cal-wgt-no-events">No upcoming events</div>
          )}

          {upcoming.map(ev => {
            const { time, title } = fmtEventLine(ev);
            // These rows were never clickable — not for Google events either.
            // Now that vault events appear here, "click it to see what it is"
            // is the obvious expectation, so both kinds are wired: a local one
            // opens its own note/page, a Google one opens the edit modal, the
            // same split the fullscreen makes.
            const openIt = () => {
              if (!isEditableEvent(ev)) { openEvent(ev); return; }
              setSelDate(new Date(ev.startMs));
              setFsOpen(true);
            };
            return (
              <div
                key={ev.id + ev.calendarId}
                className="cc2-cal-wgt-event-row cc2-cal-wgt-event-row-clickable"
                role="button"
                tabIndex={0}
                title={isEditableEvent(ev) ? `Open ${title} in the calendar` : `Open ${title}`}
                onClick={openIt}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } }}
              >
                <span className="cc2-cal-wgt-event-dot" style={{ background: ev.calendarColor }} />
                <div className="cc2-cal-wgt-event-info">
                  <div className="cc2-cal-wgt-event-time">{time}</div>
                  <div className="cc2-cal-wgt-event-title">{title}</div>
                </div>
              </div>
            );
          })}

          <button
            className="cc2-flush-btn cc2-cal-wgt-detailed-btn"
            onClick={() => setModalData({})}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Event
          </button>

          {/* Google is OPTIONAL — the widget is fully useful on vault sources
              alone. So this is a quiet footer link, not a call to action: it
              used to be a centred `flex: 1` block that claimed the whole
              column, which nagged anyone who simply doesn't use Google.
              An actual connection ERROR still shows, because that's a real
              condition the user needs to see rather than a suggestion. */}
          {status !== 'connected' && (
            <>
              {error && <div className="cc2-cal-wgt-connect-error">{error}</div>}
              <button
                className="cc2-flush-btn cc2-cal-wgt-connect-link"
                onClick={() => login()}
                disabled={connecting}
                title="Connect a Google Calendar account — optional"
              >
                {connecting ? 'Connecting…' : 'Connect Google Calendar'}
              </button>
            </>
          )}
        </div>

      </div>

      {/* ── Quick add bar ── */}
      <div className="cc2-cal-qa">
        <div className="cc2-cal-qa-row">
          <span className="cc2-cal-qa-icon">
            {qaFlashOk ? '✓' : qaSubmitting ? '…' : '✦'}
          </span>
          <input
            ref={qaInputRef}
            className="cc2-cal-qa-input"
            placeholder={qaDisabled ? 'Connect Google Calendar to add events' : 'Quick add… "Dentist Thu 3pm 1hr"'}
            value={qaText}
            disabled={qaDisabled || qaSubmitting}
            onChange={e => setQaText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  { e.preventDefault(); handleQaSubmit(); }
              if (e.key === 'Escape') { e.preventDefault(); setQaText(''); qaInputRef.current?.blur(); }
            }}
          />
          {qaParsed && qaText && (
            <button className="cc2-cal-qa-submit" onClick={handleQaSubmit} disabled={qaSubmitting}>
              {qaSubmitting ? '…' : 'Add'}
            </button>
          )}
        </div>
        {qaParsed && qaText && (
          <div className="cc2-cal-qa-preview">
            <span className="cc2-cal-qa-title">{qaParsed.title}</span>
            <span className="cc2-cal-qa-meta">{qaMeta}</span>
          </div>
        )}
        {qaFlashErr && <div className="cc2-cal-qa-err">{qaFlashErr}</div>}
      </div>

      {/* ── Detailed Add Modal ── */}
      {modalData !== null && (
        <DetailedAddModal
          onClose={() => setModalData(null)}
          onCreated={() => refresh()}
          initialData={modalData.initial}
          editTarget={modalData.edit}
        />
      )}

      {/* ── Fullscreen Calendar ── */}
      {fsOpen && (
        <CalendarFullScreen
          onClose={() => setFsOpen(false)}
          initialDate={selDate}
          initialView="month"
          onOpenModal={(initial, edit) => setModalData({ initial, edit })}
          modalOpen={modalData !== null}
          app={app}
          tone={tone}
          wash={wash}
        />
      )}

    </div>
  );
}
