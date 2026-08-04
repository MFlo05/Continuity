import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { WidgetProps } from '../registry';
import {
  startOfWeek, addDays, localISO as localISOFromDate, fmtTime12h,
} from '../../core/dates';
import { listClasses } from '../../data-sources/class-info';
import type { ClassInfoFields } from '../../data-sources/class-info';
import {
  WEEKDAYS, readSchedule, watchScheduleFile, resolveWeek, fitsSchedule,
  addSeriesBlock, updateSeriesTime, deleteSeriesBlock,
  modifyOccurrence, skipOccurrence,
  addOneOffBlock, moveOneOffBlock, stretchOneOffBlock, removeOneOffBlock,
} from '../../data-sources/class-schedule';
import type { ClassScheduleFile, EffectiveBlock, EffectiveBlockKind } from '../../data-sources/class-schedule';
import { ClassPalettePopover } from './ClassPalettePopover';
import { InstanceOrSeriesPrompt } from './InstanceOrSeriesPrompt';
import { AddOneOffModal } from './AddOneOffModal';
import { EditTimeModal } from './EditTimeModal';

const ROW_MIN = 15;          // snapping/placement granularity
const ROW_HEIGHT_PX = 14;    // 1hr = 56px
const DEFAULT_DURATION_MIN = 60;

function fmtWeekRange(weekStart: Date): string {
  const monday = startOfWeek(weekStart);
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (monday.getMonth() !== sunday.getMonth()) {
    return `${monday.toLocaleDateString(undefined, opts)} – ${sunday.toLocaleDateString(undefined, opts)}, ${sunday.getFullYear()}`;
  }
  return `${monday.toLocaleDateString(undefined, { month: 'short' })} ${monday.getDate()} – ${sunday.getDate()}, ${sunday.getFullYear()}`;
}

function weekdayName(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
}
function shortDate(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Continuous drag — either a fresh placement (dragged out of the Class
// Palette) or an existing block being repositioned. Mirrors Meal Planner's
// DragSpec union exactly (see MealPlannerWidget.tsx's own comment); the
// only real addition is blockKind, since a 'move' here needs to know
// whether cross-day movement is even allowed (only for one-off blocks —
// see the widget's own top-level comment on why).
type DragSpec =
  | { type: 'new'; classId: string; label: string; color?: string; durationMin: number }
  | { type: 'move'; id: string; blockKind: EffectiveBlockKind; label: string; color?: string; durationMin: number; origWeekday: number; origDate: string };
type DragState = DragSpec & { x: number; y: number };

// Click-armed placement — used only by the Duplicate button (a discrete
// click has no pointer to continue dragging from), mirrors Meal Planner's
// startPlacing exactly.
type PlacingSpec =
  | { kind: 'new-series'; classId: string; label: string; color?: string; durationMin: number }
  | { kind: 'new-oneoff'; title: string; classId?: string; color?: string; durationMin: number };
type PlacingState = PlacingSpec & { x: number; y: number };

type Cell = { weekday: number; row: number };

// A structural edit (resize, same-day move, delete) on an existing
// series/series-modified block, waiting on the instance-vs-series prompt.
type PendingEdit =
  | { action: 'edit';   seriesId: string; date: string; label: string; startMin: number; endMin: number }
  | { action: 'delete'; seriesId: string; date: string; label: string; startMin: number; endMin: number };

function ClassBlockCard({ block, onBodyDown, onStretchDown, onDuplicate, onEditTime, onRemove }: {
  block: EffectiveBlock;
  onBodyDown:    (e: React.PointerEvent) => void;
  onStretchDown: (e: React.PointerEvent) => void;
  onDuplicate:   (e: React.MouseEvent) => void;
  onEditTime:    (e: React.MouseEvent) => void;
  onRemove:      (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={'cc2-cs-block' + (block.kind === 'series-modified' ? ' modified' : '')}
      data-tone={block.color}
      onPointerDown={onBodyDown}
      title={`${block.title} · ${fmtTime12h(block.startMin)}–${fmtTime12h(block.endMin)}${block.room ? ` · ${block.room}` : ''}`}
      draggable={false}
    >
      <span className="cc2-cs-block-bar" />
      <div className="cc2-cs-block-main">
        <span className="cc2-cs-block-title">{block.title}</span>
        <span className="cc2-cs-block-time">{fmtTime12h(block.startMin)}–{fmtTime12h(block.endMin)}</span>
        {block.room && <span className="cc2-cs-block-room">{block.room}</span>}
      </div>

      <div className="cc2-cs-block-controls" data-nodrag="1">
        <button type="button" className="cc2-cs-block-ctrl" title="Edit time" onClick={onEditTime}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>
        <button type="button" className="cc2-cs-block-ctrl" title="Duplicate" onClick={onDuplicate}>⧉</button>
        <button type="button" className="cc2-cs-block-ctrl" title="Remove" onClick={onRemove}>×</button>
      </div>
      <div className="cc2-cs-block-stretch" data-nodrag="1" title="Drag to change duration" onPointerDown={onStretchDown}>
        <span className="cc2-cs-block-grip" />
      </div>
    </div>
  );
}

export function ClassSchedulerWidget({ app, config, onConfigChange }: WidgetProps) {
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;
  const locked = !!config?.locked;
  const includeWeekends = !!config?.includeWeekends;
  const dayCount = includeWeekends ? 7 : 5;
  const visibleWeekdays = useMemo(() => WEEKDAYS.slice(0, dayCount), [dayCount]);

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [schedule,  setSchedule]  = useState<ClassScheduleFile | null>(null);
  const [classes,   setClasses]   = useState<ClassInfoFields[]>([]);
  const [showPalette, setShowPalette] = useState(false);
  const [showOneOff,  setShowOneOff]  = useState(false);

  const [drag,        setDrag]        = useState<DragState | null>(null);
  const [placing,     setPlacing]     = useState<PlacingState | null>(null);
  const [hoverCell,   setHoverCell]   = useState<Cell | null>(null);
  const [liveStretch, setLiveStretch] = useState<{ id: string; startMin: number; endMin: number } | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [editingBlock, setEditingBlock] = useState<EffectiveBlock | null>(null);

  const gridBodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [sched, cls] = await Promise.all([readSchedule(app), listClasses(app)]);
    setSchedule(sched);
    setClasses(cls);
  }, [app]);

  useEffect(() => {
    load();
    const unwatchSchedule = watchScheduleFile(app, load);
    return unwatchSchedule;
  }, [app, load]);

  const isCurrentWeek = startOfWeek(new Date()).getTime() === startOfWeek(weekStart).getTime();
  const dayStartMin = schedule?.dayStartMin ?? 7 * 60;
  const dayEndMin   = schedule?.dayEndMin   ?? 21 * 60;
  const totalRows   = Math.max(1, Math.round((dayEndMin - dayStartMin) / ROW_MIN));

  const classesById = useMemo(() => {
    const m = new Map<string, { code: string; color?: string; room?: string }>();
    for (const c of classes) m.set(c.slug, { code: c.code, color: c.color, room: c.room });
    return m;
  }, [classes]);

  const blocks = useMemo(() => {
    if (!schedule) return [];
    // Weekend blocks stay in the underlying file either way (toggling this
    // off never deletes data) — only which columns render is affected.
    return resolveWeek(schedule, weekStart, classesById).filter(b => b.weekday < dayCount);
  }, [schedule, weekStart, classesById, dayCount]);

  const effectiveBlocks = useMemo(() => {
    if (!liveStretch) return blocks;
    return blocks.map(b => {
      const id = b.seriesId ?? b.oneOffId;
      return id === liveStretch.id ? { ...b, startMin: liveStretch.startMin, endMin: liveStretch.endMin } : b;
    });
  }, [blocks, liveStretch]);

  // Pure arithmetic hit-testing (no per-cell DOM elements / elementFromPoint,
  // unlike Meal Planner) — safe here because rows and columns are perfectly
  // uniform, and it also gives scroll-aware Y for free via scrollTop.
  function cellFromPoint(x: number, y: number): Cell | null {
    const el = gridBodyRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const colWidth = rect.width / dayCount;
    const weekday = Math.max(0, Math.min(dayCount - 1, Math.floor((x - rect.left) / colWidth)));
    const relY = y - rect.top + el.scrollTop;
    const row = Math.max(0, Math.min(totalRows - 1, Math.floor(relY / ROW_HEIGHT_PX)));
    return { weekday, row };
  }

  function minutesFromY(y: number): number {
    const el = gridBodyRef.current;
    if (!el) return dayStartMin;
    const rect = el.getBoundingClientRect();
    const relY = y - rect.top + el.scrollTop;
    const row = Math.round(relY / ROW_HEIGHT_PX);
    return dayStartMin + row * ROW_MIN;
  }

  async function placeNewSeries(classId: string, weekday: number, startMin: number, durationMin: number) {
    let span = Math.max(ROW_MIN, durationMin);
    while (span > ROW_MIN && !fitsSchedule(blocks, weekday, startMin, startMin + span, dayEndMin)) span -= ROW_MIN;
    if (!fitsSchedule(blocks, weekday, startMin, startMin + span, dayEndMin)) return;
    await addSeriesBlock(app, weekday, startMin, startMin + span, classId);
    load();
  }

  async function placeNewOneOff(title: string, classId: string | undefined, weekday: number, startMin: number, durationMin: number) {
    let span = Math.max(ROW_MIN, durationMin);
    while (span > ROW_MIN && !fitsSchedule(blocks, weekday, startMin, startMin + span, dayEndMin)) span -= ROW_MIN;
    if (!fitsSchedule(blocks, weekday, startMin, startMin + span, dayEndMin)) return;
    const date = localISOFromDate(addDays(startOfWeek(weekStart), weekday));
    await addOneOffBlock(app, date, startMin, startMin + span, title, classId);
    load();
  }

  function requestSeriesEdit(seriesId: string, date: string, label: string, startMin: number, endMin: number) {
    setPendingEdit({ action: 'edit', seriesId, date, label, startMin, endMin });
  }

  async function commitDrag(spec: DragSpec, cell: Cell) {
    const startMin = dayStartMin + cell.row * ROW_MIN;

    if (spec.type === 'new') {
      await placeNewSeries(spec.classId, cell.weekday, startMin, spec.durationMin);
      return;
    }

    // 'move'
    if (spec.blockKind === 'one-off') {
      let span = Math.max(ROW_MIN, spec.durationMin);
      const ignore = blocks.find(b => b.oneOffId === spec.id);
      while (span > ROW_MIN && !fitsSchedule(blocks, cell.weekday, startMin, startMin + span, dayEndMin, ignore)) span -= ROW_MIN;
      if (!fitsSchedule(blocks, cell.weekday, startMin, startMin + span, dayEndMin, ignore)) return;
      const date = localISOFromDate(addDays(startOfWeek(weekStart), cell.weekday));
      await moveOneOffBlock(app, spec.id, date, startMin, startMin + span);
      load();
      return;
    }

    // series / series-modified — cross-day is rejected outright (see the
    // widget's own top-level comment: a recurring block only ever
    // repositions within its own weekday; a different day means dragging a
    // fresh chip from the palette there instead).
    if (cell.weekday !== spec.origWeekday) return;
    const endMin = startMin + spec.durationMin;
    const ignore = blocks.find(b => b.seriesId === spec.id && b.date === spec.origDate);
    if (!fitsSchedule(blocks, cell.weekday, startMin, endMin, dayEndMin, ignore)) return;
    requestSeriesEdit(spec.id, spec.origDate, spec.label, startMin, endMin);
  }

  function startDrag(spec: DragSpec, clientX: number, clientY: number) {
    setDrag({ ...spec, x: clientX, y: clientY });
    setHoverCell(cellFromPoint(clientX, clientY));
    if (spec.type === 'new') setShowPalette(false);

    const onMove = (e: PointerEvent) => {
      setDrag(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      setHoverCell(cellFromPoint(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (cell) void commitDrag(spec, cell);
      setDrag(null);
      setHoverCell(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // 5px-movement threshold distinguishes "just a tap" from "drag to move" —
  // same as Meal Planner. A plain tap currently does nothing (no Fullscreen
  // view to open yet); the native `title` tooltip on the block covers it
  // for now.
  function handleBodyDown(block: EffectiveBlock, e: React.PointerEvent) {
    if (e.button !== 0 || locked) return;
    if ((e.target as HTMLElement).closest('[data-nodrag="1"]')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (moved) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) {
        moved = true;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        startDrag({
          type: 'move',
          id: block.seriesId ?? block.oneOffId!,
          blockKind: block.kind,
          label: block.title,
          color: block.color,
          durationMin: block.endMin - block.startMin,
          origWeekday: block.weekday,
          origDate: block.date,
        }, ev.clientX, ev.clientY);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Live-previews locally (setLiveStretch) instead of writing on every
  // pointermove — committed once on release. Start time never changes
  // (mirrors Meal Planner's stretch, which only ever extends the fixed-start
  // block's far edge).
  function handleStretchDown(block: EffectiveBlock, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (locked) return;
    const id = block.seriesId ?? block.oneOffId!;

    const onMove = (ev: PointerEvent) => {
      let endMin = Math.max(block.startMin + ROW_MIN, minutesFromY(ev.clientY));
      while (endMin > block.startMin + ROW_MIN && !fitsSchedule(blocks, block.weekday, block.startMin, endMin, dayEndMin, block)) endMin -= ROW_MIN;
      setLiveStretch({ id, startMin: block.startMin, endMin });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveStretch(current => {
        if (current) {
          if (block.kind === 'one-off') {
            void stretchOneOffBlock(app, block.oneOffId!, current.startMin, current.endMin).then(load);
          } else {
            requestSeriesEdit(block.seriesId!, block.date, block.title, current.startMin, current.endMin);
          }
        }
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function commitPlacing(spec: PlacingSpec, cell: Cell) {
    const startMin = dayStartMin + cell.row * ROW_MIN;
    if (spec.kind === 'new-series') {
      await placeNewSeries(spec.classId, cell.weekday, startMin, spec.durationMin);
    } else {
      await placeNewOneOff(spec.title, spec.classId, cell.weekday, startMin, spec.durationMin);
    }
  }

  // Click-to-place duplicate — arm on click, place on the next click
  // anywhere (capture-phase, deferred a tick so the arming click itself
  // isn't immediately consumed), Escape/right-click cancels. Mirrors Meal
  // Planner's startPlacing exactly.
  function startPlacing(spec: PlacingSpec, clientX: number, clientY: number) {
    setPlacing({ ...spec, x: clientX, y: clientY });
    setHoverCell(cellFromPoint(clientX, clientY));

    const onMove = (e: PointerEvent) => {
      setPlacing(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      setHoverCell(cellFromPoint(e.clientX, e.clientY));
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      const cell = cellFromPoint(e.clientX, e.clientY);
      cleanup();
      if (cell) void commitPlacing(spec, cell).then(load);
      setPlacing(null);
      setHoverCell(null);
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); cleanup(); setPlacing(null); setHoverCell(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { cleanup(); setPlacing(null); setHoverCell(null); } };
    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKey);
    }
    setTimeout(() => {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('click', onClick, true);
      window.addEventListener('contextmenu', onContextMenu, true);
      window.addEventListener('keydown', onKey);
    }, 0);
  }

  const handleRemove = useCallback((block: EffectiveBlock) => {
    if (block.kind === 'one-off') {
      void removeOneOffBlock(app, block.oneOffId!).then(load);
    } else {
      setPendingEdit({ action: 'delete', seriesId: block.seriesId!, date: block.date, label: block.title, startMin: block.startMin, endMin: block.endMin });
    }
  }, [app, load]);

  // Precise time entry (EditTimeModal) — same downstream commit as a
  // drag-resize/move: a one-off just updates directly, a series/
  // series-modified block still goes through the instance-vs-series prompt,
  // since typing an exact time is just a different way to propose the same
  // kind of change a drag would.
  const handleEditTimeConfirm = useCallback((startMin: number, endMin: number) => {
    const block = editingBlock;
    setEditingBlock(null);
    if (!block) return;
    if (!fitsSchedule(blocks, block.weekday, startMin, endMin, dayEndMin, block)) return;
    if (block.kind === 'one-off') {
      void moveOneOffBlock(app, block.oneOffId!, block.date, startMin, endMin).then(load);
    } else {
      requestSeriesEdit(block.seriesId!, block.date, block.title, startMin, endMin);
    }
  }, [editingBlock, blocks, dayEndMin, app, load]);

  const handlePromptInstance = useCallback(() => {
    if (!pendingEdit) return;
    if (pendingEdit.action === 'delete') {
      void skipOccurrence(app, pendingEdit.seriesId, pendingEdit.date).then(load);
    } else {
      void modifyOccurrence(app, pendingEdit.seriesId, pendingEdit.date, pendingEdit.startMin, pendingEdit.endMin).then(load);
    }
    setPendingEdit(null);
  }, [app, pendingEdit, load]);

  const handlePromptSeries = useCallback(() => {
    if (!pendingEdit) return;
    if (pendingEdit.action === 'delete') {
      void deleteSeriesBlock(app, pendingEdit.seriesId).then(load);
    } else {
      void updateSeriesTime(app, pendingEdit.seriesId, pendingEdit.startMin, pendingEdit.endMin).then(load);
    }
    setPendingEdit(null);
  }, [app, pendingEdit, load]);

  const ghostSpec = drag ?? placing;
  const showDropHint = !!drag && drag.type === 'new';
  const hourLabels = useMemo(() => {
    const out: { min: number; label: string }[] = [];
    for (let m = dayStartMin; m < dayEndMin; m += 60) out.push({ min: m, label: fmtTime12h(m) });
    return out;
  }, [dayStartMin, dayEndMin]);

  return (
    <div className="cc2-cs-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-cs-toolbar">
        <span className="cc2-cs-title">Class Scheduler</span>
        <div className="cc2-cs-nav">
          <button type="button" className="cc2-flush-btn cc2-cs-nav-arrow" onClick={() => setWeekStart(d => addDays(d, -7))} title="Previous week">‹</button>
          {isCurrentWeek && <span className="cc2-cs-today-badge">THIS WEEK</span>}
          <button type="button" className="cc2-flush-btn cc2-cs-nav-arrow" onClick={() => setWeekStart(d => addDays(d, 7))} title="Next week">›</button>
          <span className="cc2-cs-range">{fmtWeekRange(weekStart)}</span>
          <button type="button" className="cc2-flush-btn cc2-cs-today-link" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className={'cc2-flush-btn cc2-cs-lock-btn' + (locked ? ' active' : '')}
          title={locked ? 'Unlock schedule' : 'Lock schedule (prevent accidental edits)'}
          onClick={() => onConfigChange?.({ locked: !locked })}
        >
          {locked ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.75-1.5" />
            </svg>
          )}
        </button>
        <button type="button" className="cc2-flush-btn cc2-cs-add-btn" onClick={() => setShowOneOff(true)}>
          <span className="cc2-cs-add-plus">+</span> One-off
        </button>
        <button type="button" className="cc2-flush-btn cc2-cs-add-btn" onClick={() => setShowPalette(true)}>
          <span className="cc2-cs-add-plus">+</span> Class
        </button>
      </div>

      <div className="cc2-cs-body">
        <div className="cc2-cs-scroll">
          <div className="cc2-cs-header-row">
            <div className="cc2-cs-corner" />
            <div className="cc2-cs-days-header" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(90px, 1fr))` }}>
              {visibleWeekdays.map(day => (
                <div key={day} className="cc2-cs-day-hdr">
                  <span className="cc2-cs-day-name">{day.slice(0, 3).toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="cc2-cs-body-row">
            <div className="cc2-cs-time-col" style={{ height: totalRows * ROW_HEIGHT_PX }}>
              {hourLabels.map(({ min, label }) => (
                <div
                  key={min}
                  className="cc2-cs-time-label"
                  style={{ top: ((min - dayStartMin) / ROW_MIN) * ROW_HEIGHT_PX }}
                >
                  {label}
                </div>
              ))}
            </div>

            <div
              className="cc2-cs-days-grid"
              ref={gridBodyRef}
              style={{
                gridTemplateColumns: `repeat(${dayCount}, minmax(90px, 1fr))`,
                gridTemplateRows: `repeat(${totalRows}, ${ROW_HEIGHT_PX}px)`,
                height: totalRows * ROW_HEIGHT_PX,
                // Grid lines drawn as a background pattern (see the CSS
                // block's own comment) rather than per-cell DOM elements —
                // kept in sync with the actual row height / column count via
                // these two custom properties instead of a hardcoded value.
                ['--cc2-cs-hour-px' as any]: `${ROW_HEIGHT_PX * 4}px`,
                ['--cc2-cs-col-pct' as any]: `${100 / dayCount}%`,
              }}
            >
              {hoverCell && ghostSpec && (
                <div
                  className="cc2-cs-hover-cell"
                  data-tone={ghostSpec.color}
                  style={{
                    gridColumn: hoverCell.weekday + 1,
                    gridRow: `${hoverCell.row + 1} / span ${Math.max(1, Math.round(ghostSpec.durationMin / ROW_MIN))}`,
                  }}
                />
              )}

              {effectiveBlocks.map(block => {
                const startRow = Math.round((block.startMin - dayStartMin) / ROW_MIN);
                const span = Math.max(1, Math.round((block.endMin - block.startMin) / ROW_MIN));
                const id = block.seriesId ?? block.oneOffId!;
                return (
                  <div
                    key={id + block.date}
                    className="cc2-cs-blockwrap"
                    style={{ gridColumn: block.weekday + 1, gridRow: `${startRow + 1} / span ${span}` }}
                  >
                    <ClassBlockCard
                      block={block}
                      onBodyDown={e => handleBodyDown(block, e)}
                      onStretchDown={e => handleStretchDown(block, e)}
                      onDuplicate={e => {
                        e.stopPropagation();
                        if (block.kind === 'one-off') {
                          startPlacing({ kind: 'new-oneoff', title: block.title, classId: block.classId, color: block.color, durationMin: block.endMin - block.startMin }, e.clientX, e.clientY);
                        } else {
                          startPlacing({ kind: 'new-series', classId: block.classId!, label: block.title, color: block.color, durationMin: block.endMin - block.startMin }, e.clientX, e.clientY);
                        }
                      }}
                      onEditTime={e => { e.stopPropagation(); setEditingBlock(block); }}
                      onRemove={e => { e.stopPropagation(); handleRemove(block); }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {ghostSpec && createPortal(
        <>
          <div className="cc2-cs-ghost" data-tone={ghostSpec.color} style={{ left: ghostSpec.x, top: ghostSpec.y }}>
            <span className="cc2-cs-ghost-bar" />
            <span className="cc2-cs-ghost-title">{'label' in ghostSpec ? ghostSpec.label : ghostSpec.title}</span>
          </div>
          {showDropHint && <div className="cc2-cs-drop-hint" data-tone={ghostSpec.color}>Drop on the schedule ↓</div>}
        </>,
        document.body,
      )}

      {showPalette && (
        <ClassPalettePopover
          app={app}
          tone={tone}
          onClose={() => setShowPalette(false)}
          onStartDrag={(cls, e) => startDrag({ type: 'new', classId: cls.slug, label: cls.code, color: cls.color, durationMin: DEFAULT_DURATION_MIN }, e.clientX, e.clientY)}
        />
      )}

      {showOneOff && (
        <AddOneOffModal
          classes={classes}
          onClose={() => setShowOneOff(false)}
          onConfirm={(title, classId) => {
            setShowOneOff(false);
            const color = classId ? classesById.get(classId)?.color : undefined;
            startPlacing({ kind: 'new-oneoff', title, classId, color, durationMin: DEFAULT_DURATION_MIN }, window.innerWidth / 2, window.innerHeight / 2);
          }}
        />
      )}

      {editingBlock && (
        <EditTimeModal
          title={editingBlock.title}
          startMin={editingBlock.startMin}
          endMin={editingBlock.endMin}
          onCancel={() => setEditingBlock(null)}
          onConfirm={handleEditTimeConfirm}
        />
      )}

      {pendingEdit && (
        <InstanceOrSeriesPrompt
          title={pendingEdit.action === 'delete' ? 'Delete this class block?' : 'Apply this time change to…'}
          subtitle={`${pendingEdit.label} · ${weekdayName(pendingEdit.date)} · ${fmtTime12h(pendingEdit.startMin)}–${fmtTime12h(pendingEdit.endMin)}`}
          instanceLabel={`Just this one — ${shortDate(pendingEdit.date)}`}
          seriesLabel={`Every ${weekdayName(pendingEdit.date)} at ${fmtTime12h(pendingEdit.startMin)}`}
          onInstance={handlePromptInstance}
          onSeries={handlePromptSeries}
          onCancel={() => setPendingEdit(null)}
        />
      )}
    </div>
  );
}
