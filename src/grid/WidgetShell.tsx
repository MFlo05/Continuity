import React from 'react';

interface Props {
  label:           string;
  editMode:        boolean;
  onRemove:        () => void;
  children:        React.ReactNode;
  sourceLabel?:    string;
  onSourceClick?:  () => void;
}

export function WidgetShell({ label, editMode, onRemove, children, sourceLabel, onSourceClick }: Props) {
  return (
    <div className={`ws-shell${editMode ? ' ws-editing' : ''}`}>
      {editMode && (
        <div className="ws-toolbar ws-drag-handle">
          <span className="ws-label">{label}</span>
          <div className="ws-actions">
            <button
              className="ws-btn ws-remove"
              title="Remove widget"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="ws-content">
        {children}
      </div>
      {sourceLabel && (
        <div
          className={`ws-source-badge${onSourceClick ? ' ws-source-badge-link' : ''}`}
          onClick={onSourceClick}
          title={onSourceClick ? `Open ${sourceLabel}` : sourceLabel}
          role={onSourceClick ? 'button' : undefined}
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
            <rect x="1.5" y="0.5" width="7" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M3.5 4h5M3.5 6h5M3.5 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          {sourceLabel}
        </div>
      )}
    </div>
  );
}
