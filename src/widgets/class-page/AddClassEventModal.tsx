import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { resolveWeek } from '../../data-sources/class-schedule';
import type { ClassScheduleFile } from '../../data-sources/class-schedule';
import {
  startOfWeek, addDays, localISO, isSameDay as sameDay, MONTHS,
} from '../../core/dates';

const MONTH_NAMES = MONTHS;
const MINI_DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface Props {
  schedule:  ClassScheduleFile;
  slug:      string;
  classCode: string;
  tone?:     string;
  onClose:   () => void;
  onConfirm: (date: string, text: string) => void;
}

// Centered backdrop+box modal (.cc2-modal-backdrop), not an anchored
// popover — the anchored version kept getting clipped by GridStack's
// .grid-stack-item-content (overflow:hidden !important) even when portaled,
// and the user asked to just go back to a modal. Sized narrow (the mini
// calendar's own natural width, ~196px) rather than the original .cc2-modal/
// .cc2-cal-modal's 520-580px, which read as way oversized for a two-field
// calendar-then-text flow. Nested inside .cc2-modal-backdrop so it inherits
// that ancestor's --cc2-* token bridge for free — no separate bridge needed.
export function AddClassEventModal({ schedule, slug, classCode, tone, onClose, onConfirm }: Props) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [text, setText] = useState('');
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (selectedDate) textRef.current?.focus(); }, [selectedDate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cells = useMemo(() => {
    const monthStart = new Date(viewYear, viewMonth, 1);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [viewYear, viewMonth]);

  // One resolveWeek() call per unique week the 42-cell grid touches (a
  // month never spans more than 6), same de-dup-by-week-start technique the
  // Class Calendar widget's own 14-day timeline already uses.
  const meetingDates = useMemo(() => {
    const set = new Set<string>();
    const classesById = new Map([[slug, { code: classCode }]]);
    const seenWeeks = new Set<number>();
    for (const d of cells) {
      const wk = startOfWeek(d).getTime();
      if (seenWeeks.has(wk)) continue;
      seenWeeks.add(wk);
      const blocks = resolveWeek(schedule, new Date(wk), classesById).filter(b => b.classId === slug);
      for (const b of blocks) set.add(b.date);
    }
    return set;
  }, [cells, schedule, slug, classCode]);

  const prevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
  };
  const nextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
  };

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed || !selectedDate) return;
    onConfirm(localISO(selectedDate), trimmed);
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cc2-modal cc2-ccw-add-modal" data-tone={tone}>
        <div className="cc2-ccw-add-modal-title">Add a Class Event or Reminder</div>
        {!selectedDate ? (
          <>
            <div className="cc2-cal-wgt-month-nav">
              <button type="button" className="cc2-flush-btn cc2-cal-wgt-nav-btn" onClick={prevMonth}>‹</button>
              <span className="cc2-cal-wgt-month-label">{MONTH_NAMES[viewMonth]} {viewYear}</span>
              <button type="button" className="cc2-flush-btn cc2-cal-wgt-nav-btn" onClick={nextMonth}>›</button>
            </div>
            <div className="cc2-cal-mini-dow-row">
              {MINI_DOW.map((d, i) => <div key={i} className="cc2-cal-mini-dow">{d}</div>)}
            </div>
            <div className="cc2-cal-mini-grid">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === viewMonth;
                const isToday = sameDay(d, today);
                const hasDot  = inMonth && meetingDates.has(localISO(d));
                return (
                  <button
                    key={i}
                    type="button"
                    className={['cc2-cal-mini-cell', !inMonth ? 'out' : '', isToday ? 'today' : ''].filter(Boolean).join(' ')}
                    onClick={() => setSelectedDate(d)}
                  >
                    <span className="cc2-cal-mini-cell-num">{d.getDate()}</span>
                    {hasDot && <span className="cc2-cal-mini-dot" />}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <button type="button" className="cc2-flush-btn cc2-ccw-add-modal-back" onClick={() => setSelectedDate(null)}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
              {selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </button>
            <input
              ref={textRef}
              type="text"
              className="cc2-setup-input"
              placeholder="e.g. Presentation today!!"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            />
            <button type="button" className="cc2-setup-confirm cc2-ccw-add-modal-submit" onClick={commit} disabled={!text.trim()}>Add</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
