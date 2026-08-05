import React, { useState, useCallback, useRef, useEffect } from 'react';
import { App, Menu, FileSystemAdapter, Platform } from 'obsidian';
import type { PageLayout, LayoutItem, WidgetType, MITState } from './types';
import { widgetRegistry } from './widgets/registry';
import { GridPage } from './grid/GridPage';
import { WidgetLibraryModal } from './grid/WidgetLibraryModal';
import { WidgetSettingsModal } from './grid/WidgetSettingsModal';
import { DashboardProvider } from './context/DashboardContext';
import { BudgetMonthProvider } from './context/BudgetMonthContext';
import { CalendarProvider } from './calendar/CalendarContext';
import { AIProvider, useAI } from './ai/AIContext';
import { AIPanel, useIsDark } from './ai/AIPanel';
import { BrandMark } from './ai/BrandMark';
import { PROVIDER_CFG } from './ai/provider-config';
import type { TokenStore } from './calendar/google-oauth';
import type { AIDataStore } from './ai/AIContext';

interface AppProps {
  app:             App;
  initialPages:    PageLayout[];
  initialMitTasks: Record<string, MITState | null>;
  tokenStore:      TokenStore;
  aiDataStore:     AIDataStore;
  clientId:        string;
  clientSecret:    string;
  savePages:       (pages: PageLayout[]) => Promise<void>;
  saveMitTasks:    (tasks: Record<string, MITState | null>) => Promise<void>;
}

function AIPanelWrapper({ app }: { app: App }) {
  return <AIPanel app={app} />;
}

// Per-tab "⋯" menu (Rename Page / Delete Page) — same recipe as
// MyClassesWidget's per-card "⋯" menu: always visible in edit mode (never
// hover-gated), its own tap target separate from the tab's own select
// click, closes on an outside click. This is the app's established
// touch/iPad-safe convention for per-item actions, reused here instead of
// a tiny always-on corner ✕ so page management stays usable on mobile.
function PageTabMenu({ label, disableDelete, disableMoveLeft, disableMoveRight, onRename, onDelete, onMoveLeft, onMoveRight }: {
  label: string; disableDelete: boolean; disableMoveLeft: boolean; disableMoveRight: boolean;
  onRename: () => void; onDelete: () => void; onMoveLeft: () => void; onMoveRight: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="cc2-tab-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="cc2-flush-btn cc2-tab-menu-btn"
        title={`Page options for "${label}"`}
        aria-label={`Page options for ${label}`}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="19" cy="12" r="2.2" />
        </svg>
      </button>
      {open && (
        <div className="cc2-tab-menu">
          <button
            type="button"
            className="cc2-tab-menu-item"
            onClick={() => { setOpen(false); onRename(); }}
          >
            Rename Page
          </button>
          <button
            type="button"
            className="cc2-tab-menu-item"
            disabled={disableMoveLeft}
            onClick={() => { if (disableMoveLeft) return; setOpen(false); onMoveLeft(); }}
          >
            Move Left
          </button>
          <button
            type="button"
            className="cc2-tab-menu-item"
            disabled={disableMoveRight}
            onClick={() => { if (disableMoveRight) return; setOpen(false); onMoveRight(); }}
          >
            Move Right
          </button>
          <button
            type="button"
            className="cc2-tab-menu-item cc2-tab-menu-item-danger"
            disabled={disableDelete}
            onClick={() => { if (disableDelete) return; setOpen(false); onDelete(); }}
          >
            Delete Page
          </button>
        </div>
      )}
    </div>
  );
}

function AIToggleButton() {
  const { settings, panelOpen, setPanelOpen } = useAI();
  const cfg    = PROVIDER_CFG[settings.activeProvider];
  const isDark = useIsDark();
  return (
    <button
      className={'cc2-flush-btn cc2-ai-toggle-btn' + (panelOpen ? ' active' : '')}
      title={panelOpen ? 'Close AI assistant' : `Open ${cfg.name} assistant`}
      onClick={() => setPanelOpen(!panelOpen)}
    >
      <BrandMark provider={settings.activeProvider} size={20} isDark={isDark} />
    </button>
  );
}

export function App({ app, initialPages, initialMitTasks, tokenStore, aiDataStore, clientId, clientSecret, savePages, saveMitTasks }: AppProps) {
  const [pages,        setPages]        = useState<PageLayout[]>(initialPages);
  const [activePageId, setActivePageId] = useState<string>(initialPages[0]?.id ?? '');
  const [editMode,     setEditMode]     = useState<boolean>(false);
  const [libraryOpen,  setLibraryOpen]  = useState<boolean>(false);
  const [settingsModalTarget, setSettingsModalTarget] = useState<LayoutItem | null>(null);
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [renameValue,    setRenameValue]    = useState<string>('');
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Phone only: the floating top bar yields its space once you scroll into the
  // page. On a 390px-wide screen the 56px bar is real estate the content wants.
  const [topbarHidden, setTopbarHidden] = useState(false);

  const activePage = pages.find(p => p.id === activePageId) ?? pages[0];

  useEffect(() => {
    if (renamingPageId) { renameInputRef.current?.focus(); renameInputRef.current?.select(); }
  }, [renamingPageId]);

  // Hide-on-scroll-down, reveal-on-scroll-up.
  //
  // The scroll container is .cc2-grid-wrapper, which GridPage owns and rebuilds
  // per page, while the top bar lives here. Rather than thread a callback down
  // through a memoized component and re-subscribe on every page change, listen
  // on the stage in the CAPTURE phase — scroll events don't bubble, but they do
  // propagate downward through capture, so this catches whichever wrapper is
  // currently mounted.
  useEffect(() => {
    if (!Platform.isPhone) return;
    const stage = stageRef.current;
    if (!stage) return;

    let lastY = 0;

    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.classList?.contains('cc2-grid-wrapper')) return;

      const y = el.scrollTop;
      // Near the top the bar is always available, so the page never opens with
      // its own navigation hidden.
      if (y < 48) { setTopbarHidden(false); lastY = y; return; }

      // A threshold, not a raw comparison: iOS momentum scrolling jitters by a
      // pixel or two at the end of a fling, and an unguarded check turns that
      // into a visible flicker.
      const delta = y - lastY;
      if (Math.abs(delta) < 8) return;
      setTopbarHidden(delta > 0);
      lastY = y;
    };

    stage.addEventListener('scroll', onScroll, true);
    return () => stage.removeEventListener('scroll', onScroll, true);
  }, []);

  const persistPages = useCallback((updated: PageLayout[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePages(updated), 500);
  }, [savePages]);

  // GridPage always reports the geometry the live grid is holding. Where that
  // gets stored depends on which grid it is: a phone is arranging its own
  // 6-column layout, and writing those coordinates into `items` would collapse
  // the 12-column desktop dashboard into its left half the next time the vault
  // synced. Only placement is device-specific — the widget set and its config
  // stay single-sourced in `items` for every device.
  const handleLayoutChange = useCallback((items: LayoutItem[]) => {
    setPages(prev => {
      const next = prev.map(p => {
        if (p.id !== activePageId) return p;
        if (!Platform.isPhone) return { ...p, items };
        return {
          ...p,
          mobilePlacements: items.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        };
      });
      persistPages(next);
      return next;
    });
  }, [activePageId, persistPages]);

  const handleRemoveWidget = useCallback((id: string) => {
    setPages(prev => {
      const next = prev.map(p =>
        p.id === activePageId
          ? {
              ...p,
              items: p.items.filter(i => i.id !== id),
              // Drop the phone placement too. Harmless if left (resolveGeometry
              // only reads placements for items that still exist) but it would
              // accumulate in data.json for the life of the vault.
              mobilePlacements: p.mobilePlacements?.filter(m => m.id !== id),
            }
          : p
      );
      persistPages(next);
      return next;
    });
  }, [activePageId, persistPages]);

  const handleAddWidget = useCallback((type: WidgetType, extraConfig?: Record<string, unknown>) => {
    const def = widgetRegistry[type];
    if (!def) return;
    const newItem: LayoutItem = {
      id:     `${type}-${Date.now()}`,
      type,
      x: 0, y: 0,
      w: def.defaultSize.w,
      h: def.defaultSize.h,
      config: extraConfig,
    };
    setPages(prev => {
      const next = prev.map(p =>
        p.id === activePageId ? { ...p, items: [...p.items, newItem] } : p
      );
      persistPages(next);
      return next;
    });
    setLibraryOpen(false);
  }, [activePageId, persistPages]);

  const handleConfigChange = useCallback((id: string, patch: Record<string, unknown>) => {
    setPages(prev => {
      const next = prev.map(p => p.id === activePageId
        ? { ...p, items: p.items.map(i => i.id === id ? { ...i, config: { ...i.config, ...patch } } : i) }
        : p
      );
      persistPages(next);
      return next;
    });
  }, [activePageId, persistPages]);

  const startRenamePage = useCallback((p: PageLayout) => {
    setRenameValue(p.label);
    setRenamingPageId(p.id);
  }, []);

  const cancelRenamePage = useCallback(() => {
    setRenamingPageId(null);
  }, []);

  const commitRenamePage = useCallback(() => {
    const id = renamingPageId;
    const trimmed = renameValue.trim();
    setRenamingPageId(null);
    if (!id) return;
    const target = pages.find(p => p.id === id);
    if (!target || !trimmed || trimmed === target.label) return;
    const next = pages.map(p => p.id === id ? { ...p, label: trimmed } : p);
    setPages(next);
    persistPages(next);
  }, [renamingPageId, renameValue, pages, persistPages]);

  const handleAddPage = useCallback(() => {
    const existingLabels = new Set(pages.map(p => p.label.trim().toLowerCase()));
    let label = 'New Page';
    let n = 2;
    while (existingLabels.has(label.toLowerCase())) { label = `New Page ${n}`; n++; }
    const newPage: PageLayout = { id: `page-${Date.now()}`, label, items: [] };
    const next = [...pages, newPage];
    setPages(next);
    persistPages(next);
    setActivePageId(newPage.id);
    startRenamePage(newPage);
  }, [pages, persistPages, startRenamePage]);

  const handleDeletePage = useCallback((id: string) => {
    if (pages.length <= 1) return;
    const target = pages.find(p => p.id === id);
    if (!target) return;
    if (!window.confirm(`Delete "${target.label}"? This removes all of its widgets.`)) return;
    const next = pages.filter(p => p.id !== id);
    setPages(next);
    persistPages(next);
    if (activePageId === id) setActivePageId(next[0]?.id ?? '');
  }, [pages, activePageId, persistPages]);

  const handleReorderPage = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const from = pages.findIndex(p => p.id === draggedId);
    const to   = pages.findIndex(p => p.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPages(next);
    persistPages(next);
  }, [pages, persistPages]);

  const handleMovePage = useCallback((id: string, direction: -1 | 1) => {
    const from = pages.findIndex(p => p.id === id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= pages.length) return;
    const next = [...pages];
    [next[from], next[to]] = [next[to], next[from]];
    setPages(next);
    persistPages(next);
  }, [pages, persistPages]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const menu = new Menu();

    // Right-click on a specific widget ("Edit Widget Settings…") rather than
    // a gear icon on every card — each grid item's wrapper carries gs-id
    // (GridPage.tsx), so walk up from whatever was actually clicked to find
    // it. Falls through to just the generic items below when the click was
    // on empty canvas (no .grid-stack-item ancestor) — no behavior change
    // there from today. Every widget gets this now (not gated) — even ones
    // with nothing but color to configure still get that.
    const widgetEl = (e.target as HTMLElement).closest('.grid-stack-item');
    const widgetId = widgetEl?.getAttribute('gs-id');
    const targetItem = widgetId ? activePage?.items.find(i => i.id === widgetId) : undefined;

    if (targetItem) {
      menu.addItem(item =>
        item.setTitle('Edit Widget Settings…').setIcon('settings').onClick(() => setSettingsModalTarget(targetItem))
      );
      menu.addSeparator();
    }

    menu.addItem(item =>
      item
        .setTitle(editMode ? 'Exit Edit Mode' : 'Edit Layout')
        .setIcon(editMode ? 'lock' : 'pencil')
        .onClick(() => setEditMode(em => !em))
    );
    if (editMode) {
      menu.addItem(item =>
        item.setTitle('Add Widget…').setIcon('plus-circle').onClick(() => setLibraryOpen(true))
      );
    }
    menu.showAtMouseEvent(e.nativeEvent as MouseEvent);
  }, [editMode, activePage]);

  const vaultPath = app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter.getBasePath() : undefined;

  return (
    <AIProvider dataStore={aiDataStore} vaultPath={vaultPath}>
    <CalendarProvider
      tokenStore={tokenStore}
      clientId={clientId}
      clientSecret={clientSecret}
    >
    <DashboardProvider
      initialMitTasks={initialMitTasks}
      onMitChange={saveMitTasks}
    >
    <BudgetMonthProvider>
      {/* cc2-stage--phone rather than Obsidian's own .is-phone body class:
          the phone styles have to agree with the phone behaviour (6 columns,
          scroll-to-hide, separate placements), and both are decided by
          Platform.isPhone. Driving the CSS from the same call means they
          cannot drift apart. */}
      <div
        className={'cc2-stage' + (Platform.isPhone ? ' cc2-stage--phone' : '')}
        ref={stageRef}
        onContextMenu={handleContextMenu}
      >

        {/* ── Top bar ─────────────────────────────────────── */}
        <div className={'cc2-topbar' + (topbarHidden ? ' cc2-topbar--hidden' : '')}>
          <div className="cc2-tabs">
            {pages.map((p, i) => (
              <div
                key={p.id}
                className={[
                  'cc2-tab-wrap',
                  draggingPageId === p.id ? 'cc2-tab-wrap--dragging' : '',
                  dragOverPageId === p.id ? 'cc2-tab-wrap--drag-over' : '',
                ].filter(Boolean).join(' ')}
                draggable={editMode && renamingPageId !== p.id}
                onDragStart={e => {
                  e.dataTransfer.setData('cc2/page-id', p.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingPageId(p.id);
                }}
                onDragEnd={() => { setDraggingPageId(null); setDragOverPageId(null); }}
                onDragEnter={e => { if (e.dataTransfer.types.includes('cc2/page-id')) setDragOverPageId(p.id); }}
                onDragOver={e => { if (e.dataTransfer.types.includes('cc2/page-id')) e.preventDefault(); }}
                onDragLeave={e => {
                  const r = e.relatedTarget as Node | null;
                  if (!r || !e.currentTarget.contains(r)) setDragOverPageId(null);
                }}
                onDrop={e => {
                  e.preventDefault();
                  setDragOverPageId(null);
                  const draggedId = e.dataTransfer.getData('cc2/page-id');
                  if (draggedId) handleReorderPage(draggedId, p.id);
                }}
              >
                {renamingPageId === p.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="cc2-tab-rename-input"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  { e.preventDefault(); commitRenamePage(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRenamePage(); }
                    }}
                    onBlur={commitRenamePage}
                  />
                ) : (
                  <button
                    className={`cc2-tab${p.id === activePageId ? ' active' : ''}`}
                    onClick={() => setActivePageId(p.id)}
                  >
                    {p.label}
                  </button>
                )}
                {editMode && renamingPageId !== p.id && (
                  <PageTabMenu
                    label={p.label}
                    disableDelete={pages.length <= 1}
                    disableMoveLeft={i === 0}
                    disableMoveRight={i === pages.length - 1}
                    onRename={() => startRenamePage(p)}
                    onDelete={() => handleDeletePage(p.id)}
                    onMoveLeft={() => handleMovePage(p.id, -1)}
                    onMoveRight={() => handleMovePage(p.id, 1)}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="cc2-topbar-spacer" />

          <div className="cc2-topbar-actions">
            {editMode && (
              <button
                className="cc2-add-widget-btn"
                title="Add a new page"
                onClick={handleAddPage}
              >
                + Add Page
              </button>
            )}
            {editMode && (
              <button
                className="cc2-add-widget-btn"
                title="Add a widget to this page"
                onClick={() => setLibraryOpen(true)}
              >
                + Add Widget
              </button>
            )}
            <button
              className={`cc2-edit-toggle${editMode ? ' active' : ''}`}
              title={editMode ? 'Exit edit mode' : 'Edit layout'}
              onClick={() => setEditMode(em => !em)}
            >
              {editMode ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
              )}
              <span>{editMode ? 'Done' : 'Edit'}</span>
            </button>
            <AIToggleButton />
          </div>
        </div>

        {/* ── Edit mode banner ────────────────────────────── */}
        {editMode && (
          <div className="cc2-edit-banner">
            Drag to rearrange · Resize from bottom-right · ✕ to remove · "+ Add Widget" for more
          </div>
        )}

        {/* ── Grid ─────────────────────────────────────────── */}
        {activePage && (
          <GridPage
            key={activePage.id}
            page={activePage}
            editMode={editMode}
            app={app}
            onLayoutChange={handleLayoutChange}
            onRemoveWidget={handleRemoveWidget}
            onConfigChange={handleConfigChange}
          />
        )}

        {/* ── Widget Library Modal ──────────────────────────── */}
        {libraryOpen && (
          <WidgetLibraryModal
            app={app}
            onAdd={handleAddWidget}
            onClose={() => setLibraryOpen(false)}
          />
        )}

        {/* ── Widget Settings Modal (right-click "Edit Widget Settings…") ── */}
        {settingsModalTarget && (
          <WidgetSettingsModal
            app={app}
            type={settingsModalTarget.type}
            mode="edit"
            existingConfig={settingsModalTarget.config}
            onConfirm={patch => { handleConfigChange(settingsModalTarget.id, patch); setSettingsModalTarget(null); }}
            onCancel={() => setSettingsModalTarget(null)}
          />
        )}

        {/* ── AI Panel (overlay — doesn't affect grid layout) ── */}
        <AIPanelWrapper app={app} />

      </div>
    </BudgetMonthProvider>
    </DashboardProvider>
    </CalendarProvider>
    </AIProvider>
  );
}
