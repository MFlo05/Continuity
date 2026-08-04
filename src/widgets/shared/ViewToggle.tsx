import React, { useState, useEffect } from 'react';

export type ViewMode = 'list' | 'gallery';

/**
 * Persists the List/Gallery choice per widget-type + ledger via localStorage,
 * keyed so two instances of the same widget pointed at different ledgers
 * don't share a view preference. Not threaded through the real widget
 * `config`/data.json — WidgetProps has no config-write path today (config
 * flows one-way, widget -> read-only prop), and adding one would touch the
 * core grid-rendering path for every widget just for this. localStorage
 * already has precedent here (CalendarContext's hidden-calendars prefs).
 */
export function useViewMode(storageKey: string): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === 'gallery' ? 'gallery' : 'list';
    } catch {
      return 'list';
    }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, view); } catch { /* ignore */ }
  }, [storageKey, view]);

  return [view, setView];
}

export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <>
      <span className="cc2-toolbar-divider" />
      <div className="cc2-view-toggle">
        <button
          type="button"
          className={`cc2-flush-btn cc2-view-toggle-btn${view === 'list' ? ' active' : ''}`}
          title="List view"
          onClick={() => onChange('list')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          </svg>
        </button>
        <button
          type="button"
          className={`cc2-flush-btn cc2-view-toggle-btn${view === 'gallery' ? ' active' : ''}`}
          title="Gallery view"
          onClick={() => onChange('gallery')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="4" width="13" height="16" rx="2" />
            <path d="M4 7v11a2 2 0 0 0 2 2h1" />
          </svg>
        </button>
      </div>
    </>
  );
}
