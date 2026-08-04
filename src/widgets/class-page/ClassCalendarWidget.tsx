import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { readClassTranscript, watchClassesFolder } from '../../data-sources/class-info';
import type { ClassTranscript } from '../../data-sources/class-info';
import { readSchedule, resolveWeek, watchScheduleFile, WEEKDAYS } from '../../data-sources/class-schedule';
import type { ClassScheduleFile, SeriesBlock } from '../../data-sources/class-schedule';
import { readReminders, addReminder, editReminder, removeReminder } from '../../data-sources/class-reminders';
import type { Reminder } from '../../data-sources/class-reminders';
import {
  startOfWeek, addDays, localISO, fmtTime12h, WEEKDAYS_SHORT, MONTHS_SHORT,
} from '../../core/dates';
import { AddClassEventModal } from './AddClassEventModal';
import type { WidgetProps } from '../registry';

// This timeline renders its labels uppercase; the shared tables are Title Case.
const WEEKDAY_SHORT = WEEKDAYS_SHORT.map(d => d.toUpperCase());
const MONTH_SHORT   = MONTHS_SHORT.map(m => m.toUpperCase());

interface TimelineRow {
  key: string;
  date: string;
  dow: string;
  day: string;
  title: string;
  meta: string;
  isDue: boolean;
  topics: string[];
  reminders: Reminder[];
}

// Double-click-to-edit + delete, same convention as PolicyRow/TodoRow — the
// one part of a timeline row the user actually owns (topics/due-dates are
// read-only, syllabus-derived).
function ReminderItem({ reminder, onEdit, onRemove }: {
  reminder: Reminder; onEdit: (text: string) => void; onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(reminder.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);

  const commit = () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (!trimmed || trimmed === reminder.text) { setDraft(reminder.text); return; }
    onEdit(trimmed);
  };
  const cancel = () => { setDraft(reminder.text); setIsEditing(false); };

  return (
    <div className="cc2-ccw-reminder">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cc2-ccw-reminder-icon">
        <path d="M12 2a6 6 0 0 0-6 6c0 3.5-1.5 5-2 6h16c-.5-1-2-2.5-2-6a6 6 0 0 0-6-6Z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="cc2-ccw-reminder-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          onBlur={commit}
        />
      ) : (
        <span className="cc2-ccw-reminder-text" onDoubleClick={() => setIsEditing(true)}>{reminder.text}</span>
      )}
      {!isEditing && (
        <button type="button" className="cc2-flush-btn cc2-ccw-reminder-delete" title="Remove reminder" onClick={onRemove}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// One of the class-page-only grid widgets — a 14-day rolling window merging
// real dated occurrences of this class's own recurring Class-Schedule.md
// pattern with syllabus due-dates/topics from Class-Transcript.md, PLUS
// user-added reminders (Reminders.md — the only piece of this timeline the
// user directly owns; meetings need zero AI/syllabus involvement, and
// topics/due-dates only appear once a syllabus/manual entry has populated
// them). Reminders can be added to any day, even one with nothing else
// going on, via AddClassEventPopover's calendar-then-text flow.
export function ClassCalendarWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const classCode = (config?.classCode as string | undefined) ?? '';
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [transcript, setTranscript] = useState<ClassTranscript | null>(null);
  const [schedule,   setSchedule]   = useState<ClassScheduleFile | null>(null);
  const [series,     setSeries]     = useState<SeriesBlock[]>([]);
  const [reminders,  setReminders]  = useState<Reminder[]>([]);

  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    const [t, s, r] = await Promise.all([readClassTranscript(app, slug), readSchedule(app), readReminders(app, slug)]);
    setTranscript(t);
    setSchedule(s);
    setSeries(s.series.filter(sb => sb.classId === slug));
    setReminders(r);
  }, [app, slug]);

  useEffect(() => {
    if (!slug) return;
    load();
    const unwatchClasses  = watchClassesFolder(app, load);
    const unwatchSchedule = watchScheduleFile(app, load);
    return () => { unwatchClasses(); unwatchSchedule(); };
  }, [app, slug, load]);

  const meetingPattern = useMemo(() => {
    const days = Array.from(new Set(series.map(s => s.weekday))).sort((a, b) => a - b);
    return days.map(d => WEEKDAY_SHORT[d]).join(' · ');
  }, [series]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  // Recurring meetings stay a tight 14-day glance ("what's this week/next") —
  // extending that far would mean rendering every single weekly occurrence
  // for months, which is a lot of near-identical rows for very little value.
  // Syllabus topics/due-dates/reminders are sparse (only days that actually
  // have something get a row at all — see the merge below), so there's no
  // real cost to showing much further out; capped at 180 days rather than
  // truly open-ended, since a class is only ever "done" when the student
  // archives it — 6 months comfortably covers a full term plus finals
  // without the window growing forever for a class left un-archived.
  const windowEnd = useMemo(() => addDays(today, 13), [today]);
  const scheduleWindowEnd = useMemo(() => addDays(today, 179), [today]);

  const timeline = useMemo(() => {
    if (!schedule) return [] as TimelineRow[];

    // Real dated occurrences of this class's own recurring pattern, over
    // however many calendar weeks the 14-day window touches. Passes the
    // FULL schedule (not just this class's series) into resolveWeek so its
    // own exceptions (skip/modify) and one-offs are actually applied —
    // filtered down to this class only afterward — rather than silently
    // ignoring a cancelled/rescheduled occurrence.
    const classesById = new Map([[slug!, { code: classCode }]]);
    const occurrences: TimelineRow[] = [];
    const seenWeeks = new Set<number>();
    for (let d = new Date(today); d <= windowEnd; d = addDays(d, 1)) {
      const wk = startOfWeek(d).getTime();
      if (seenWeeks.has(wk)) continue;
      seenWeeks.add(wk);
      const blocks = resolveWeek(schedule, new Date(wk), classesById).filter(b => b.classId === slug);
      for (const b of blocks) {
        if (b.date < localISO(today) || b.date > localISO(windowEnd)) continue;
        const dow = new Date(`${b.date}T00:00:00`);
        occurrences.push({
          key: `meet-${b.seriesId ?? b.oneOffId}-${b.date}`,
          date: b.date,
          dow: WEEKDAYS[(dow.getDay() + 6) % 7].slice(0, 3).toUpperCase(),
          day: String(dow.getDate()),
          title: b.title,
          meta: `${fmtTime12h(b.startMin)}–${fmtTime12h(b.endMin)}`,
          isDue: false,
          topics: [],
          reminders: [],
        });
      }
    }

    // Syllabus topics (grouped by date) and due-dated assignments, both
    // only present once a syllabus/manual entry has populated them. Uses the
    // longer scheduleWindowEnd (not the meeting-only windowEnd) — this is
    // the whole reason a full-semester AI import actually shows up here.
    const topicsByDate = new Map<string, string[]>();
    for (const row of transcript?.schedule ?? []) {
      if (row.dateOrWeek < localISO(today) || row.dateOrWeek > localISO(scheduleWindowEnd)) continue;
      if (!topicsByDate.has(row.dateOrWeek)) topicsByDate.set(row.dateOrWeek, []);
      topicsByDate.get(row.dateOrWeek)!.push(row.topic);
    }
    // Attach topics to a same-day meeting row if one exists, else give the
    // date its own standalone row.
    for (const [date, topics] of topicsByDate) {
      const onDay = occurrences.filter(o => o.date === date);
      if (onDay.length > 0) { onDay[0].topics.push(...topics); continue; }
      const dow = new Date(`${date}T00:00:00`);
      occurrences.push({
        key: `topics-${date}`, date,
        dow: WEEKDAYS[(dow.getDay() + 6) % 7].slice(0, 3).toUpperCase(), day: String(dow.getDate()),
        title: 'Topics', meta: '', isDue: false, topics, reminders: [],
      });
    }

    for (const a of transcript?.assignments ?? []) {
      if (!a.dateOrWeek || a.dateOrWeek < localISO(today) || a.dateOrWeek > localISO(scheduleWindowEnd)) continue;
      const dow = new Date(`${a.dateOrWeek}T00:00:00`);
      occurrences.push({
        key: `due-${a.item}`, date: a.dateOrWeek,
        dow: WEEKDAYS[(dow.getDay() + 6) % 7].slice(0, 3).toUpperCase(), day: String(dow.getDate()),
        title: `${a.item} due`, meta: a.worth ? `worth ${a.worth}` : '', isDue: true, topics: [], reminders: [],
      });
    }

    // Reminders last, so one can attach to a row of ANY origin above
    // (meeting/topic/due-date) — or, if the day has nothing else going on,
    // get its own standalone row, same as topic-only days do.
    const remindersByDate = new Map<string, Reminder[]>();
    for (const r of reminders) {
      if (r.date < localISO(today) || r.date > localISO(scheduleWindowEnd)) continue;
      if (!remindersByDate.has(r.date)) remindersByDate.set(r.date, []);
      remindersByDate.get(r.date)!.push(r);
    }
    for (const [date, rems] of remindersByDate) {
      const onDay = occurrences.filter(o => o.date === date);
      if (onDay.length > 0) { onDay[0].reminders.push(...rems); continue; }
      const dow = new Date(`${date}T00:00:00`);
      occurrences.push({
        key: `reminders-${date}`, date,
        dow: WEEKDAYS[(dow.getDay() + 6) % 7].slice(0, 3).toUpperCase(), day: String(dow.getDate()),
        title: 'Reminder', meta: '', isDue: false, topics: [], reminders: rems,
      });
    }

    return occurrences.sort((a, b) => a.date.localeCompare(b.date));
  }, [schedule, transcript, reminders, slug, classCode, today, windowEnd, scheduleWindowEnd]);

  const commitAdd = useCallback(async (date: string, text: string) => {
    if (!slug) return;
    await addReminder(app, slug, date, text);
    setAddOpen(false);
    load();
  }, [app, slug, load]);

  const handleEditReminder = useCallback((id: string, text: string) => {
    if (!slug) return;
    editReminder(app, slug, id, text).then(load);
  }, [app, slug, load]);

  const handleRemoveReminder = useCallback((id: string) => {
    if (!slug) return;
    removeReminder(app, slug, id).then(load);
  }, [app, slug, load]);

  if (!slug) return null;

  return (
    <div className="cc2-ccw-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-ccw-header">
        <span className="cc2-ccw-title">Class Calendar</span>
        {meetingPattern && <span className="cc2-ccw-pattern">{meetingPattern}</span>}
        <button
          type="button"
          className="cc2-flush-btn cc2-cfs-add-btn"
          title="Add a class event or reminder"
          onClick={() => setAddOpen(o => !o)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {addOpen && schedule && (
          <AddClassEventModal
            schedule={schedule}
            slug={slug}
            classCode={classCode}
            tone={tone}
            onClose={() => setAddOpen(false)}
            onConfirm={commitAdd}
          />
        )}
      </div>
      <div className="cc2-ccw-body">
        {timeline.length === 0 && (
          <div className="cc2-ccw-empty">
            {series.length === 0
              ? 'No meeting times set yet — add this class to the Class Scheduler widget.'
              : 'Only your meeting times so far — hit + to add a reminder, or import a syllabus to fill this in.'}
          </div>
        )}
        {timeline.map((row, i) => {
          // A rolling window that now runs up to 6 months deep is genuinely
          // confusing without month context — "MON 8" alone doesn't say
          // which of the (possibly 6) Augusts/Septembers/etc it is. One slim
          // divider per month transition, not a label repeated on every row.
          const monthKey = row.date.slice(0, 7);
          const prevMonthKey = i > 0 ? timeline[i - 1].date.slice(0, 7) : null;
          const monthLabel = MONTH_SHORT[parseInt(row.date.slice(5, 7), 10) - 1];
          return (
            <React.Fragment key={row.key}>
              {monthKey !== prevMonthKey && (
                <div className="cc2-ccw-month-divider">{monthLabel}</div>
              )}
              <div className="cc2-ccw-row">
                <div className="cc2-ccw-date-col">
                  <div className="cc2-ccw-dow">{row.dow}</div>
                  <div className="cc2-ccw-day">{row.day}</div>
                </div>
                <div className="cc2-ccw-dot-col">
                  <span className={'cc2-ccw-dot' + (row.isDue ? ' due' : '')} />
                  {i < timeline.length - 1 && <span className="cc2-ccw-connector" />}
                </div>
                <div className="cc2-ccw-content">
                  <div className="cc2-ccw-event-title">{row.title}</div>
                  {row.meta && <div className="cc2-ccw-event-meta">{row.meta}</div>}
                  {row.topics.map((tp, ti) => (
                    <div key={ti} className="cc2-ccw-topic">
                      <span className="cc2-ccw-topic-dot" />
                      <span className="cc2-ccw-topic-text">{tp}</span>
                    </div>
                  ))}
                  {row.reminders.map(r => (
                    <ReminderItem
                      key={r.id}
                      reminder={r}
                      onEdit={text => handleEditReminder(r.id, text)}
                      onRemove={() => handleRemoveReminder(r.id)}
                    />
                  ))}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
