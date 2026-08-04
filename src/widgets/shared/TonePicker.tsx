import React from 'react';

export const WIDGET_TONES = [
  { id: 'paper',      label: 'Paper' },
  { id: 'ochre',      label: 'Ochre' },
  { id: 'terracotta', label: 'Terracotta' },
  { id: 'rust',       label: 'Rust' },
  { id: 'rose',       label: 'Clay Rose' },
  { id: 'plum',       label: 'Plum' },
  { id: 'indigo',     label: 'Indigo' },
  { id: 'slate',      label: 'Slate' },
  { id: 'spruce',     label: 'Spruce' },
  { id: 'sage',       label: 'Sage' },
  { id: 'moss',       label: 'Moss' },
] as const;

interface Props {
  tone:         string; // a WIDGET_TONES id, or 'paper' for the default
  wash:         boolean;
  onToneChange: (tone: string) => void;
  onWashChange: (wash: boolean) => void;
  // Hides the Trim/Wash toggle entirely (swatches only) for callers where
  // Wash has no meaning — Recipe Box's Widget Settings (no page-level wash
  // on that widget at all) and Meal Planner's per-slot popover (a slot is
  // just scattered 3px bars, not a surface to wash). Defaults to true so
  // every existing caller keeps the toggle unless it opts out.
  showWash?: boolean;
}

// The swatch row + Trim/Wash toggle, factored out of WidgetSettingsModal once
// Kanban's per-bucket color popover needed the exact same picker a second
// time — pure presentational, no state of its own, so both callers can wire
// it to whatever they're actually persisting (widget-level config vs. a
// single bucket's entry in config.bucketColors).
export function TonePicker({ tone, wash, onToneChange, onWashChange, showWash = true }: Props) {
  const activeToneLabel = WIDGET_TONES.find(t => t.id === tone)?.label ?? 'Paper';

  return (
    <>
      {showWash && (
        <div className="cc2-tone-row cc2-tone-row-spread">
          <span className="cc2-tone-mode-label">Widget color</span>
          <div className="cc2-tone-toggle">
            <button
              type="button"
              className={`cc2-flush-btn cc2-tone-toggle-btn${!wash ? ' active' : ''}`}
              onClick={() => onWashChange(false)}
            >
              Trim
            </button>
            <button
              type="button"
              className={`cc2-flush-btn cc2-tone-toggle-btn${wash ? ' active' : ''}`}
              onClick={() => onWashChange(true)}
            >
              Wash
            </button>
          </div>
        </div>
      )}

      <span className="cc2-tone-name">
        <b>{activeToneLabel}</b>{tone === 'paper' ? ' · default' : ''}
      </span>
      <div className="cc2-tone-swatches">
        {WIDGET_TONES.map(t => (
          <button
            key={t.id}
            type="button"
            className={`cc2-tone-swatch${tone === t.id ? ' selected' : ''}`}
            data-tone={t.id}
            title={t.label}
            onClick={() => onToneChange(t.id)}
          />
        ))}
      </div>
    </>
  );
}
