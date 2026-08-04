import React, { useMemo, useState } from 'react';
import { addDays, fmtTime12h, isToday, localISO, parseLocalISO, MONTHS_SHORT, WEEKDAYS } from '../../core/dates';
import { useTimeline } from '../../time/useTimeline';
import { lastUndatedReport } from '../../time/adapters/assignments';
import type { TimelineEvent, TimelineKind } from '../../time/types';
import type { WidgetProps } from '../registry';

/**
 * widgets/my-day/MyDayWidget.tsx — one day, every source.
 *
 * The first consumer of the timeline query layer (src/time/), and the reason
 * it exists: class meetings, assignment due dates, reminders, planned meals,
 * Google events and upcoming bills all live in different files owned by
 * different widgets, and nothing could previously answer "what does today
 * actually look like".
 *
 * A COMPONENT-BACKED widget rather than a preset, necessarily: a preset binds
 * ONE codec to ONE source, and this binds none. It reads adapters, not a
 * SourceRef — which is also why it can't use the library's preview-source
 * seeding and takes preview art instead.
 *
 * Deliberately read-only. Every row opens the thing that owns it; nothing is
 * edited here, because "edit" means something different for each kind and the
 * owning widget already does it properly.
 */

const KIND_LABEL: Record<TimelineKind, string> = {
  class:      'Class',
  assignment: 'Due',
  reminder:   'Reminder',
  meal:       'Meal',
  calendar:   'Event',
  bill:       'Bill',
};

/** Fallback dot colour when a source supplies no tone of its own. */
const KIND_TONE: Record<TimelineKind, string> = {
  class:      'var(--cc2-tone-indigo)',
  assignment: 'var(--cc2-tone-rust)',
  reminder:   'var(--cc2-tone-ochre)',
  meal:       'var(--cc2-tone-moss)',
  calendar:   'var(--cc2-tone-slate)',
  bill:       'var(--cc2-tone-terracotta)',
};

function headerLabel(iso: string): string {
  const d = parseLocalISO(iso);
  if (!d) return iso;
  if (isToday(d)) return 'Today';
  if (localISO(addDays(new Date(), 1)) === iso) return 'Tomorrow';
  if (localISO(addDays(new Date(), -1)) === iso) return 'Yesterday';
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function EventRow({ ev }: { ev: TimelineEvent }) {
  const clickable = !!ev.open;
  return (
    <div
      className={'cc2-day-row' + (clickable ? ' cc2-day-row-clickable' : '')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => ev.open?.()}
      onKeyDown={e => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ev.open?.(); }
      }}
    >
      {/* Timed events show their clock time; all-day ones show their kind, so
          the column is never empty and the rows still align. */}
      <span className="cc2-day-time">
        {ev.startMin === undefined ? KIND_LABEL[ev.kind] : fmtTime12h(ev.startMin)}
      </span>
      <span className="cc2-day-dot" style={{ background: ev.tone || KIND_TONE[ev.kind] }} />
      <span className="cc2-day-body">
        <span className="cc2-day-title">{ev.title}</span>
        {ev.detail && <span className="cc2-day-detail">{ev.detail}</span>}
      </span>
    </div>
  );
}

export function MyDayWidget({ app, config }: WidgetProps) {
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [offset, setOffset] = useState(0);
  const date = useMemo(() => localISO(addDays(new Date(), offset)), [offset]);

  const { events, loading } = useTimeline(app, date, date);
  const undated = lastUndatedReport();

  const timed   = events.filter(e => e.startMin !== undefined);
  const allDay  = events.filter(e => e.startMin === undefined);

  return (
    <div className="cc2-day-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-day-header">
        <span className="cc2-day-title-label">{headerLabel(date)}</span>
        <span className="cc2-day-nav">
          <button
            type="button" className="cc2-flush-btn cc2-day-nav-btn"
            title="Previous day" aria-label="Previous day"
            onClick={() => setOffset(o => o - 1)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          {offset !== 0 && (
            <button type="button" className="cc2-flush-btn cc2-day-today-btn" onClick={() => setOffset(0)}>
              Today
            </button>
          )}
          <button
            type="button" className="cc2-flush-btn cc2-day-nav-btn"
            title="Next day" aria-label="Next day"
            onClick={() => setOffset(o => o + 1)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </span>
      </div>

      <div className="cc2-day-body-scroll">
        {loading && events.length === 0 && <div className="cc2-day-empty">Loading…</div>}

        {!loading && events.length === 0 && (
          <div className="cc2-day-empty">Nothing scheduled.</div>
        )}

        {timed.map(ev => <EventRow key={ev.id} ev={ev} />)}

        {/* All-day items sit below the timed ones under their own rule — they
            have no position in the day, so interleaving them by title would
            imply an order that doesn't exist. */}
        {allDay.length > 0 && timed.length > 0 && <div className="cc2-day-divider" />}
        {allDay.map(ev => <EventRow key={ev.id} ev={ev} />)}

        {/* Assignments with a hand-typed due date ("Oct 24") can't be placed on
            a day. They're counted rather than silently dropped — which is what
            happens elsewhere in the app today. */}
        {undated.undated > 0 && (
          <div className="cc2-day-undated" title={undated.examples.join('\n')}>
            {undated.undated} assignment{undated.undated === 1 ? '' : 's'} with no usable date
          </div>
        )}
      </div>
    </div>
  );
}
