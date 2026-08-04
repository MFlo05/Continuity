import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { listClasses } from '../../data-sources/class-info';
import type { ClassInfoFields } from '../../data-sources/class-info';

interface Props {
  app:   App;
  tone?: string;
  onClose:     () => void;
  onStartDrag: (cls: ClassInfoFields, e: React.PointerEvent) => void;
}

// Simplified sibling of Meal Planner's RecipeBoxModal — same portaled shell
// and "press-and-drag closes the popover instantly" behavior, but no
// peel-stack/flip/search: a class list is short (a handful of courses, not
// dozens of recipes), so a plain vertical list of small colored chips reads
// better than a card deck. Each chip IS the drag handle (no separate "click
// to flip vs. drag to place" conflict to resolve here, unlike Recipe Box's
// cards, since there's nothing else to click for.)
export function ClassPalettePopover({ app, tone, onClose, onStartDrag }: Props) {
  const [classes, setClasses] = useState<ClassInfoFields[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listClasses(app);
      if (!cancelled) { setClasses(list); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [app]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="cc2-modal-backdrop cc2-cs-palette-backdrop" data-tone={tone} onMouseDown={onClose}>
      <div className="cc2-modal cc2-cs-palette" onMouseDown={e => e.stopPropagation()}>
        <div className="cc2-modal-header">
          <div>
            <div className="cc2-modal-title">Add a Class</div>
            <div className="cc2-cs-palette-sub">Drag a class onto the schedule</div>
          </div>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-cs-palette-list">
          {loading && <div className="cc2-cs-palette-empty">Loading…</div>}
          {!loading && classes.length === 0 && (
            <div className="cc2-cs-palette-empty">No active classes yet — add one in My Classes first.</div>
          )}
          {!loading && classes.map(cls => (
            <div
              key={cls.slug}
              className="cc2-cs-palette-chip"
              data-tone={cls.color}
              title="Drag onto the schedule"
              onPointerDown={e => onStartDrag(cls, e)}
            >
              <span className="cc2-cs-palette-chip-bar" />
              <span className="cc2-cs-palette-chip-text">
                <span className="cc2-cs-palette-chip-code">{cls.code}</span>
                {cls.name && <span className="cc2-cs-palette-chip-name">{cls.name}</span>}
              </span>
              <span className="cc2-cs-palette-chip-grip">⠿</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
