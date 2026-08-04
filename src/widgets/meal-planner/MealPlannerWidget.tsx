import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Notice, TFile } from 'obsidian';
import {
  DAYS, MEAL_SLOTS, datesForWeek,
  readWeekPlan, placeMeal, moveMeal, stretchMeal, removeMeal, watchMealPlanFile, fitsPlan,
} from '../../data-sources/meal-plan';
import type { MealBlock } from '../../data-sources/meal-plan';
import { startOfWeek, addDays } from '../../core/dates';
import type { WidgetProps } from '../registry';
import { RecipeFullscreen } from '../recipe-vault/RecipeFullscreen';
import { RecipeBoxModal } from './RecipeBoxModal';
import { BlankMealModal } from './BlankMealModal';
import { TonePickerPopover } from '../shared/TonePickerPopover';

// Pointer-events-based drag (not native HTML5 draggable, unlike Kanban) —
// needed because this design also has stretch-resize and click-to-place
// duplicate, neither of which the dataTransfer API models well. A gesture
// is either a "new" placement (dragged out of the Recipe Box) or a "move"
// (dragged from one grid slot to another); ghost + hover-slot machinery is
// shared between the two via this one DragSpec union.
type DragSpec =
  | { type: 'new';  recipeTitle: string; colSpan: number }
  | { type: 'move'; recipeTitle: string; colSpan: number; fromDay: number; fromRow: number };
type DragState    = DragSpec & { x: number; y: number };
type PlacingState = { recipeTitle: string; colSpan: number; x: number; y: number };
type Slot = { day: number; row: number };

function fmtWeekRange(weekStart: Date): string {
  const monday = startOfWeek(weekStart);
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (monday.getMonth() !== sunday.getMonth()) {
    return `${monday.toLocaleDateString(undefined, opts)} – ${sunday.toLocaleDateString(undefined, opts)}, ${sunday.getFullYear()}`;
  }
  return `${monday.toLocaleDateString(undefined, { month: 'short' })} ${monday.getDate()} – ${sunday.getDate()}, ${sunday.getFullYear()}`;
}

// Small swatch-dot next to a slot's row label opening a per-slot TonePickerPopover
// (showWash={false} — a slot is just scattered 3px bars, not a surface to
// wash). Deliberately capped at these 4 fixed slots (never per-block/per-recipe)
// so this can't turn into an unbounded rainbow.
function MealSlotLabel({ slot, gridStyle, color, onColorChange }: {
  slot: string;
  gridStyle: React.CSSProperties;
  color?: { tone?: string };
  onColorChange: (color: { tone?: string }) => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const slotTone = color?.tone;

  return (
    <div className="cc2-mp-slot-label" style={gridStyle}>
      <button
        type="button"
        ref={colorBtnRef}
        className="cc2-mp-slot-color-btn"
        data-tone={slotTone}
        title={`${slot} color`}
        onClick={() => setColorOpen(o => !o)}
      />
      <span>{slot}</span>
      {colorOpen && (
        <TonePickerPopover
          anchorRef={colorBtnRef}
          tone={slotTone ?? 'paper'}
          wash={false}
          onToneChange={t => onColorChange({ tone: t === 'paper' ? undefined : t })}
          onWashChange={() => {}}
          onClose={() => setColorOpen(false)}
          showWash={false}
        />
      )}
    </div>
  );
}

function MealBlockCard({ block, isHot, slotTone, onBodyDown, onStretchDown, onDuplicate, onRemove }: {
  block: MealBlock; isHot: boolean; slotTone?: string;
  onBodyDown: (e: React.PointerEvent) => void;
  onStretchDown: (e: React.PointerEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  // No CSS distinction for a missing recipe anymore (blank meals get the
  // same full-color treatment as real ones, per explicit request) — the
  // only remaining difference is the tooltip and what a click does
  // (handleOpenBlock shows a "no recipe found" Notice instead of opening
  // RecipeFullscreen).
  const missing = !block.recipePath;
  return (
    <div
      className={'cc2-mp-blockwrap' + (isHot ? ' hot' : '')}
      style={{ gridColumn: `${block.day + 2} / span ${block.colSpan}`, gridRow: block.row + 2 }}
    >
      <div
        className="cc2-mp-block"
        onPointerDown={onBodyDown}
        title={missing ? `${block.recipeTitle} (recipe not found)` : block.recipeTitle}
      >
        <span
          className="cc2-mp-block-bar"
          data-tone={slotTone}
          // No slot color picked for this block's row — force the bar back
          // to its plain green fallback rather than letting the widget-level
          // Trim tone (set on .cc2-mp-root, an ancestor of this span) leak
          // through var(--t)'s normal inheritance. Per-slot color is meant
          // to be a separate, opt-in choice, not a side-effect of the
          // widget-level picker.
          style={!slotTone ? { ['--t' as any]: 'initial' } : undefined}
        />
        <span className="cc2-mp-block-title">{block.recipeTitle}</span>

        <div className="cc2-mp-block-controls" data-nodrag="1">
          <button type="button" className="cc2-mp-block-ctrl" title="Duplicate" onClick={onDuplicate}>⧉</button>
          <button type="button" className="cc2-mp-block-ctrl" title="Remove" onClick={onRemove}>×</button>
        </div>
        <div className="cc2-mp-block-stretch" data-nodrag="1" title="Drag to stretch across days" onPointerDown={onStretchDown}>
          <span className="cc2-mp-block-grip" />
        </div>
      </div>
    </div>
  );
}

export function MealPlannerWidget({ app, config, onConfigChange }: WidgetProps) {
  // Per-widget accent (right-click "Edit Widget Settings…"). Trim only — no
  // Wash on this widget's own root: it already carries a deliberate flat
  // background (see DESIGN_SYSTEM.md's ".cc2-mp-root" note), and combined
  // with per-slot block-bar colors (below) a full background tint on top
  // risks looking cluttered rather than adding anything.
  const tone = config?.tone as string | undefined;

  // Per-slot (Breakfast/Snacks/Lunch/Dinner) block-bar color — tone only,
  // no wash, independent of the widget-level tone above.
  const slotColors = (config?.slotColors as Record<string, { tone?: string }> | undefined) ?? {};
  const handleSlotColorChange = useCallback((slot: string, color: { tone?: string }) => {
    onConfigChange?.({ slotColors: { ...slotColors, [slot]: color } });
  }, [onConfigChange, slotColors]);

  const [weekStart,   setWeekStart]   = useState<Date>(() => startOfWeek(new Date()));
  const [blocks,      setBlocks]      = useState<MealBlock[]>([]);
  const [showBox,     setShowBox]     = useState(false);
  const [showBlank,   setShowBlank]   = useState(false);
  const [openFile,    setOpenFile]    = useState<TFile | null>(null);
  const [drag,        setDrag]        = useState<DragState | null>(null);
  const [placing,     setPlacing]     = useState<PlacingState | null>(null);
  const [hoverSlot,   setHoverSlot]   = useState<Slot | null>(null);
  const [liveStretch, setLiveStretch] = useState<{ day: number; row: number; colSpan: number } | null>(null);

  const dayHeadRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const load = useCallback(async () => {
    setBlocks(await readWeekPlan(app, weekStart));
  }, [app, weekStart]);

  useEffect(() => {
    load();
    return watchMealPlanFile(app, weekStart, load);
  }, [app, weekStart, load]);

  const dates = useMemo(() => datesForWeek(weekStart), [weekStart]);
  const isCurrentWeek = startOfWeek(new Date()).getTime() === startOfWeek(weekStart).getTime();

  function slotFromPoint(x: number, y: number): Slot | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell = el?.closest('[data-daycell="1"]') as HTMLElement | null;
    if (!cell) return null;
    return { day: Number(cell.dataset.day), row: Number(cell.dataset.row) };
  }

  // Nearest-day fallback lets the stretch handle keep tracking the cursor
  // even once it's dragged past the grid's own left/right edge.
  function dayFromX(x: number): number {
    const heads = Array.from(dayHeadRefs.current.entries());
    for (const [day, el] of heads) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return day;
    }
    let nearest = 0, best = Infinity;
    for (const [day, el] of heads) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.right) / 2);
      if (d < best) { best = d; nearest = day; }
    }
    return nearest;
  }

  async function commitPlacement(spec: DragSpec, slot: Slot) {
    if (spec.type === 'new') {
      await placeMeal(app, weekStart, slot.day, slot.row, spec.recipeTitle, spec.colSpan);
    } else {
      await moveMeal(app, weekStart, { day: spec.fromDay, row: spec.fromRow }, { day: slot.day, row: slot.row });
    }
    load();
  }

  // Local closures per gesture (not stable useCallbacks) — each start call
  // adds its own onMove/onUp pair and removes that exact same pair on up,
  // so there's no cross-render reference mismatch to worry about.
  function startDrag(spec: DragSpec, clientX: number, clientY: number) {
    setDrag({ ...spec, x: clientX, y: clientY });
    setHoverSlot(slotFromPoint(clientX, clientY));
    // Close the Recipe Box the instant a "new" drag starts (not on drop) —
    // it's a centered modal, so leaving it open (even "collapsed") still
    // blocks the grid the user needs to see to aim the drop. Both the
    // front- and back-face "Drag to plan" pills route through this same
    // startDrag call (via RecipeBoxModal's one onStartDrag prop), so this
    // covers both without any card-side change.
    if (spec.type === 'new') setShowBox(false);

    const onMove = (e: PointerEvent) => {
      setDrag(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      setHoverSlot(slotFromPoint(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const slot = slotFromPoint(e.clientX, e.clientY);
      if (slot) void commitPlacement(spec, slot);
      setDrag(null);
      setHoverSlot(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // 5px-movement threshold distinguishes "click to open" from "drag to move".
  function handleBodyDown(block: MealBlock, e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-nodrag="1"]')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (moved) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) {
        moved = true;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        startDrag(
          { type: 'move', recipeTitle: block.recipeTitle, colSpan: block.colSpan, fromDay: block.day, fromRow: block.row },
          ev.clientX, ev.clientY,
        );
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) handleOpenBlock(block);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Live-previews the span locally (setLiveStretch) instead of writing to
  // the vault on every pointermove — only committed once, on release.
  function handleStretchDown(block: MealBlock, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const day = dayFromX(ev.clientX);
      let span = Math.max(1, day - block.day + 1);
      while (span > 1 && !fitsPlan(blocks, block.day, block.row, span, block)) span--;
      setLiveStretch({ day: block.day, row: block.row, colSpan: span });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveStretch(current => {
        if (current) void stretchMeal(app, weekStart, current.day, current.row, current.colSpan).then(load);
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Click-to-place duplicate: arm on click, place on the next click anywhere
  // (capture-phase, deferred by a tick so the arming click itself isn't
  // immediately consumed), Escape/right-click cancels.
  function startPlacing(recipeTitle: string, colSpan: number, clientX: number, clientY: number) {
    setPlacing({ recipeTitle, colSpan, x: clientX, y: clientY });
    setHoverSlot(slotFromPoint(clientX, clientY));

    const onMove = (e: PointerEvent) => {
      setPlacing(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      setHoverSlot(slotFromPoint(e.clientX, e.clientY));
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      const slot = slotFromPoint(e.clientX, e.clientY);
      cleanup();
      if (slot) void placeMeal(app, weekStart, slot.day, slot.row, recipeTitle, colSpan).then(load);
      setPlacing(null);
      setHoverSlot(null);
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); cleanup(); setPlacing(null); setHoverSlot(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { cleanup(); setPlacing(null); setHoverSlot(null); } };
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

  const handleOpenBlock = useCallback((block: MealBlock) => {
    if (!block.recipePath) { new Notice(`No recipe found for "${block.recipeTitle}"`); return; }
    const file = app.vault.getAbstractFileByPath(block.recipePath);
    if (file instanceof TFile) setOpenFile(file);
  }, [app]);

  const handleRemove = useCallback((block: MealBlock) => {
    void removeMeal(app, weekStart, block.day, block.row).then(load);
  }, [app, weekStart, load]);

  const effectiveBlocks = useMemo(() => {
    if (!liveStretch) return blocks;
    return blocks.map(b => (b.day === liveStretch.day && b.row === liveStretch.row) ? { ...b, colSpan: liveStretch.colSpan } : b);
  }, [blocks, liveStretch]);

  const covered = useMemo(() => {
    const set = new Set<string>();
    for (const b of effectiveBlocks) {
      for (let d = b.day; d < b.day + b.colSpan; d++) set.add(`${d}|${b.row}`);
    }
    return set;
  }, [effectiveBlocks]);

  const ghostSpec = drag ?? placing;
  // Recipe Box closes the instant a "new" drag starts (see startDrag), so
  // this is only ever true while the box is already unmounted — it just
  // gates the floating drop hint.
  const showDropHint = drag?.type === 'new';

  return (
    <div className="cc2-mp-root" data-tone={tone}>
      <div className="cc2-mp-toolbar">
        <span className="cc2-mp-title">Meal Planner</span>
        <div className="cc2-mp-nav">
          <button type="button" className="cc2-flush-btn cc2-mp-nav-arrow" onClick={() => setWeekStart(d => addDays(d, -7))} title="Previous week">‹</button>
          {isCurrentWeek && <span className="cc2-mp-today-badge">THIS WEEK</span>}
          <button type="button" className="cc2-flush-btn cc2-mp-nav-arrow" onClick={() => setWeekStart(d => addDays(d, 7))} title="Next week">›</button>
          <span className="cc2-mp-range">{fmtWeekRange(weekStart)}</span>
          <button type="button" className="cc2-flush-btn cc2-mp-today-link" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="cc2-flush-btn cc2-mp-add-btn" onClick={() => setShowBlank(true)}>
          <span className="cc2-mp-add-plus">+</span> Blank
        </button>
        <button type="button" className="cc2-flush-btn cc2-mp-add-btn" onClick={() => setShowBox(true)}>
          <span className="cc2-mp-add-plus">+</span> Recipes
        </button>
      </div>

      <div className="cc2-mp-body">
        <div className="cc2-mp-grid">
          <div className="cc2-mp-corner" style={{ gridColumn: 1, gridRow: 1 }} />
          {DAYS.map((day, i) => (
            <div
              key={day}
              className="cc2-mp-day-hdr"
              data-dayhead="1"
              style={{ gridColumn: i + 2, gridRow: 1 }}
              ref={el => { if (el) dayHeadRefs.current.set(i, el); }}
            >
              <span className="cc2-mp-day-name">{day.slice(0, 3).toUpperCase()}</span>
              <span className="cc2-mp-day-date">{dates[i].getDate()}</span>
            </div>
          ))}
          {MEAL_SLOTS.map((slot, r) => (
            <MealSlotLabel
              key={slot}
              slot={slot}
              gridStyle={{ gridColumn: 1, gridRow: r + 2 }}
              color={slotColors[slot]}
              onColorChange={c => handleSlotColorChange(slot, c)}
            />
          ))}

          {MEAL_SLOTS.map((_, r) => DAYS.map((_, c) => {
            if (covered.has(`${c}|${r}`)) return null;
            const hot = !!ghostSpec && hoverSlot?.day === c && hoverSlot?.row === r;
            return (
              <div
                key={`empty-${c}-${r}`}
                className={'cc2-mp-daycell' + (hot ? ' hot' : '')}
                data-daycell="1" data-day={c} data-row={r}
                style={{ gridColumn: c + 2, gridRow: r + 2 }}
              />
            );
          }))}

          {effectiveBlocks.map(block => (
            <MealBlockCard
              key={`${block.day}|${block.row}`}
              block={block}
              isHot={!!ghostSpec && hoverSlot?.day === block.day && hoverSlot?.row === block.row}
              slotTone={slotColors[MEAL_SLOTS[block.row]]?.tone}
              onBodyDown={e => handleBodyDown(block, e)}
              onStretchDown={e => handleStretchDown(block, e)}
              onDuplicate={e => { e.stopPropagation(); startPlacing(block.recipeTitle, block.colSpan, e.clientX, e.clientY); }}
              onRemove={e => { e.stopPropagation(); handleRemove(block); }}
            />
          ))}
        </div>
      </div>

      {ghostSpec && createPortal(
        <>
          <div className="cc2-mp-ghost" data-tone={tone} style={{ left: ghostSpec.x, top: ghostSpec.y }}>
            <span className="cc2-mp-ghost-bar" />
            <span className="cc2-mp-ghost-title">{ghostSpec.recipeTitle}</span>
          </div>
          {showDropHint && <div className="cc2-mp-drop-hint" data-tone={tone}>Drop on a planner slot ↓</div>}
        </>,
        document.body,
      )}

      {showBox && (
        <RecipeBoxModal
          app={app}
          tone={tone}
          onClose={() => setShowBox(false)}
          onStartDrag={(recipeTitle, colSpan, e) => startDrag({ type: 'new', recipeTitle, colSpan }, e.clientX, e.clientY)}
          onOpenFullscreen={file => { setShowBox(false); setOpenFile(file); }}
        />
      )}

      {showBlank && (
        <BlankMealModal
          onClose={() => setShowBlank(false)}
          onConfirm={title => {
            setShowBlank(false);
            // No real cursor position available here (Enter-to-confirm has
            // no mouse coords) — the ghost snaps to the actual pointer on
            // the very next move anyway, so a viewport-center starting spot
            // is only ever visible for a single frame.
            startPlacing(title, 1, window.innerWidth / 2, window.innerHeight / 2);
          }}
        />
      )}

      {openFile && <RecipeFullscreen app={app} file={openFile} onClose={() => setOpenFile(null)} />}
    </div>
  );
}
