import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Menu } from 'obsidian';
import type { App } from 'obsidian';
import { readClassInfo, readClassTranscript, listClasses, watchClassesFolder } from '../../data-sources/class-info';
import type { ClassInfoFields, ClassTranscript } from '../../data-sources/class-info';
import { readProgress, setGradeOverride } from '../../data-sources/class-progress';
import type { ClassProgress } from '../../data-sources/class-progress';
import { readClassLayout, writeClassLayout } from '../../data-sources/class-layout';
import { readGradeCategories } from '../../data-sources/class-grade-categories';
import type { GradeCategory } from '../../data-sources/class-grade-categories';
import { mergeAssignments, computeGrade, computeGradeByCategory, letterFor } from '../class-page/assignment-utils';
import { GridPage } from '../../grid/GridPage';
import { WidgetLibraryModal } from '../../grid/WidgetLibraryModal';
import { WidgetSettingsModal } from '../../grid/WidgetSettingsModal';
import { widgetRegistry } from '../registry';
import { ClassSettingsModal } from './ClassSettingsModal';
import { useSyllabusImport } from './useSyllabusImport';
import type { SyllabusSource } from './useSyllabusImport';
import { SyllabusImportModal } from './SyllabusImportModal';
import { useAI } from '../../ai/AIContext';
import { AIPanel, useIsDark } from '../../ai/AIPanel';
import { BrandMark } from '../../ai/BrandMark';
import { getCC2Plugin } from '../../../main';
import type { LayoutItem, PageLayout, WidgetType } from '../../types';

interface Props {
  app:  App;
  slug: string;
  onSwitchClass: (slug: string) => void;
}

// Rendered directly by ClassPageView (a real Obsidian ItemView, see main.ts)
// into its own leaf — NOT a document.body portal anymore. Previously this
// was ClassFullscreen.tsx, a position:fixed overlay covering the entire
// window (hiding the file sidebar, and requiring a closeFullscreen hack
// before opening any note so it didn't open invisibly behind the overlay).
// A real leaf/tab gets the file sidebar and "still open when you come back
// from a note" for free — see the note-opening calls in the 5 class-page
// widgets, which now just open in a new tab instead of closing this view.
//
// Tone: the class's own color (info.color) is set ONCE on the root and left
// to cascade via CSS inheritance into the masthead and every embedded
// widget (each widget's own `data-tone={config?.tone}` only renders when a
// per-widget override is actually set) — no per-widget tone injection
// needed.
export function ClassPageContent({ app, slug, onSwitchClass }: Props) {
  const [info,        setInfo]        = useState<ClassInfoFields | null>(null);
  const [transcript,  setTranscript]  = useState<ClassTranscript | null>(null);
  const [progress,    setProgress]    = useState<ClassProgress | null>(null);
  const [layoutItems, setLayoutItems] = useState<LayoutItem[] | null>(null);
  const [allClasses,  setAllClasses]  = useState<ClassInfoFields[]>([]);
  const [categories,  setCategories]  = useState<GradeCategory[]>([]);

  const [editMode,     setEditMode]     = useState(false);
  const [libraryOpen,  setLibraryOpen]  = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<LayoutItem | null>(null);
  const [showGradeEdit, setShowGradeEdit] = useState(false);
  const [gradeDraft,    setGradeDraft]    = useState('');
  const [switcherOpen,  setSwitcherOpen]  = useState(false);
  const [showSyllabusPicker, setShowSyllabusPicker] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gaugeWrapRef = useRef<HTMLDivElement>(null);
  const switcherWrapRef = useRef<HTMLDivElement>(null);

  const { settings, panelOpen, setPanelOpen } = useAI();
  const isDark = useIsDark();
  const { handleImport: importSyllabus } = useSyllabusImport(app);
  const canImportWithAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';
  const alreadyImported = transcript?.source === 'AI import';

  const load = useCallback(async () => {
    const [i, t, p, all, cats] = await Promise.all([
      readClassInfo(app, slug), readClassTranscript(app, slug), readProgress(app, slug), listClasses(app),
      readGradeCategories(app, slug),
    ]);
    setInfo(i); setTranscript(t); setProgress(p); setAllClasses(all); setCategories(cats);
  }, [app, slug]);

  useEffect(() => { load(); return watchClassesFolder(app, load); }, [app, load]);

  // Switching classes re-renders this SAME component instance with a new
  // slug prop (it isn't remounted) — layoutItems otherwise keeps holding
  // the PREVIOUS class's items for one render, and <GridPage key={slug}>
  // remounts immediately on the slug change alone, so it would briefly
  // mount with the old class's stale items, register their ids, and then
  // treat every one of the new class's real items as "just added" once the
  // real fetch resolves — auto-positioning all of them below the stale
  // layout instead of at their saved coordinates. Resetting to null here,
  // synchronously before the fetch, keeps GridPage from rendering at all
  // (see the `!layoutItems` guard below) until the right class's data has
  // actually loaded.
  useEffect(() => {
    setLayoutItems(null);
    let cancelled = false;
    (async () => {
      const items = await readClassLayout(app, slug);
      if (!cancelled) setLayoutItems(items);
    })();
    return () => { cancelled = true; };
  }, [app, slug]);

  // Picks up a syllabus-import request stashed by MyClassesWidget's "Add a
  // Syllabus with AI" flow (see main.ts's CC2Plugin.pendingSyllabusImport)
  // and runs it through THIS page's own AIProvider/useSyllabusImport — that
  // widget's own instance lives on the main dashboard's separate AIProvider,
  // so firing sendMessage from there would run the request somewhere the
  // user, now looking at this page, would never see it land. Guarded by
  // slug match (not just presence) since this effect also re-fires on every
  // ordinary class switch, and a stale request queued for a different class
  // should never fire here.
  useEffect(() => {
    const plugin  = getCC2Plugin(app);
    const pending = plugin?.pendingSyllabusImport;
    if (!plugin || !pending || pending.slug !== slug) return;
    plugin.pendingSyllabusImport = null;
    importSyllabus(pending.slug, pending.classCode, pending.source);
  }, [app, slug, importSyllabus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showGradeEdit) setShowGradeEdit(false);
      else if (switcherOpen) setSwitcherOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showGradeEdit, switcherOpen]);

  // Mousedown-outside-closes, matching TonePickerPopover's own convention.
  useEffect(() => {
    if (!showGradeEdit && !switcherOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (showGradeEdit && !gaugeWrapRef.current?.contains(t)) setShowGradeEdit(false);
      if (switcherOpen && !switcherWrapRef.current?.contains(t)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showGradeEdit, switcherOpen]);

  const persistLayout = useCallback((items: LayoutItem[]) => {
    setLayoutItems(items);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeClassLayout(app, slug, items), 500);
  }, [app, slug]);

  const handleLayoutChange = useCallback((items: LayoutItem[]) => persistLayout(items), [persistLayout]);
  const handleRemoveWidget = useCallback((id: string) => {
    setLayoutItems(prev => {
      const next = (prev ?? []).filter(i => i.id !== id);
      persistLayout(next);
      return next;
    });
  }, [persistLayout]);
  // WidgetLibraryModal already runs its own WidgetSettingsModal ('create'
  // mode, tone/wash picker) before calling this — config arrives pre-filled,
  // same as the main dashboard's own handleAddWidget in app.tsx.
  const handleAddWidget = useCallback((type: WidgetType, config?: Record<string, unknown>) => {
    const def = widgetRegistry[type];
    if (!def) return;
    setLayoutItems(prev => {
      const newItem: LayoutItem = { id: `${type}-${Date.now()}`, type, x: 0, y: 0, w: def.defaultSize.w, h: def.defaultSize.h, config };
      const next = [...(prev ?? []), newItem];
      persistLayout(next);
      return next;
    });
    setLibraryOpen(false);
  }, [persistLayout]);
  const handleConfigChange = useCallback((id: string, patch: Record<string, unknown>) => {
    setLayoutItems(prev => {
      const next = (prev ?? []).map(i => i.id === id ? { ...i, config: { ...i.config, ...patch } } : i);
      persistLayout(next);
      return next;
    });
  }, [persistLayout]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const menu = new Menu();
    const widgetEl = (e.target as HTMLElement).closest('.grid-stack-item');
    const widgetId = widgetEl?.getAttribute('gs-id');
    const targetItem = widgetId ? (layoutItems ?? []).find(i => i.id === widgetId) : undefined;

    if (targetItem) {
      menu.addItem(item => item.setTitle('Edit Widget Settings…').setIcon('settings').onClick(() => setSettingsTarget(targetItem)));
      menu.addSeparator();
    }
    menu.addItem(item => item.setTitle(editMode ? 'Exit Edit Mode' : 'Edit Layout').setIcon(editMode ? 'lock' : 'pencil').onClick(() => setEditMode(em => !em)));
    if (editMode) {
      menu.addItem(item => item.setTitle('Add Widget…').setIcon('plus-circle').onClick(() => setLibraryOpen(true)));
    }
    menu.showAtMouseEvent(e.nativeEvent as MouseEvent);
  }, [editMode, layoutItems]);

  // Injects classSlug/classCode into every item's own config at render time
  // (never persisted verbatim as the "real" source of truth — Layout.json
  // only needs to know x/y/w/h/type; which class it belongs to is already
  // implied by living inside that class's own folder — handleConfigChange
  // only ever writes back layoutItems, the pre-injection version, so none of
  // this ever reaches Layout.json).
  const gridPage: PageLayout = useMemo(() => ({
    id: slug,
    label: info?.code ?? slug,
    items: (layoutItems ?? []).map(item => ({
      ...item,
      config: { ...item.config, classSlug: slug, classCode: info?.code ?? '' },
    })),
  }), [slug, info?.code, layoutItems]);

  const assignments = useMemo(() => mergeAssignments(transcript, progress), [transcript, progress]);
  const computed = useMemo(
    () => info?.gradeMode === 'category' ? computeGradeByCategory(assignments, categories) : computeGrade(assignments),
    [assignments, info?.gradeMode, categories],
  );
  const grade = progress?.gradeOverride != null ? parseFloat(progress.gradeOverride) : computed;
  const letter = grade != null && transcript?.gradeScale ? letterFor(grade, transcript.gradeScale) : null;
  const gaugeDash = grade != null ? (Math.min(grade, 100) / 100 * 150.8).toFixed(1) : '0';

  const openGradeEdit = () => {
    setGradeDraft(progress?.gradeOverride ?? '');
    setShowGradeEdit(o => !o);
  };
  const handleGradeSet = async () => {
    const v = parseFloat(gradeDraft.replace('%', ''));
    if (isNaN(v)) return;
    await setGradeOverride(app, slug, String(v));
    setShowGradeEdit(false);
    load();
  };
  const handleGradeAuto = async () => {
    await setGradeOverride(app, slug, null);
    setShowGradeEdit(false);
    load();
  };

  const otherClasses = allClasses.filter(c => c.slug !== slug);

  if (!info || !layoutItems) return null;

  return (
    <div className="cc2-cfs-backdrop" data-tone={info.color} onContextMenu={handleContextMenu}>
      <div className="cc2-cfs-shell">
        <div className="cc2-cfs-topbar">
          <div className="cc2-cfs-chip-wrap" ref={switcherWrapRef}>
            <button type="button" className="cc2-flush-btn cc2-cfs-chip" title="Switch class" onClick={() => setSwitcherOpen(o => !o)}>
              <span className="cc2-cfs-chip-dot" />
              {info.code}
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="cc2-cfs-chip-chevron">
                <path d="M3 5l4 4 4-4" />
              </svg>
            </button>
            {switcherOpen && (
              <div className="cc2-cfs-switcher-popover">
                <div className="cc2-cfs-switcher-label">Switch to</div>
                {otherClasses.length === 0 && <div className="cc2-cfs-switcher-empty">No other classes yet.</div>}
                {otherClasses.map(c => (
                  <button
                    key={c.slug}
                    type="button"
                    className="cc2-cfs-switcher-row"
                    data-tone={c.color}
                    onClick={() => { setSwitcherOpen(false); onSwitchClass(c.slug); }}
                  >
                    <span className="cc2-cfs-switcher-dot" />
                    <span className="cc2-cfs-switcher-code">{c.code}</span>
                    {c.name && <span className="cc2-cfs-switcher-name">{c.name}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="cc2-topbar-spacer" />
          <button
            type="button"
            className="cc2-flush-btn cc2-cfs-import-btn"
            title={canImportWithAI ? `${alreadyImported ? 'Update' : 'Import'} the syllabus with AI` : `Requires Claude CLI mode (currently ${settings.activeProvider})`}
            disabled={!canImportWithAI}
            onClick={() => setShowSyllabusPicker(true)}
          >
            <BrandMark provider={settings.activeProvider} size={13} isDark={isDark} />
            {alreadyImported ? 'Update Syllabus' : 'Import Syllabus'}
          </button>
          {showSyllabusPicker && (
            <SyllabusImportModal
              app={app}
              title={alreadyImported ? 'Update Syllabus' : 'Import Syllabus'}
              onClose={() => setShowSyllabusPicker(false)}
              onImport={(source: SyllabusSource) => {
                setShowSyllabusPicker(false);
                importSyllabus(slug, info?.code ?? '', source);
              }}
            />
          )}
          {editMode && (
            <button type="button" className="cc2-add-widget-btn" title="Add a widget to this page" onClick={() => setLibraryOpen(true)}>
              + Add Widget
            </button>
          )}
          <button
            type="button"
            className={`cc2-edit-toggle${editMode ? ' active' : ''}`}
            title={editMode ? 'Exit edit mode' : 'Edit page layout'}
            onClick={() => setEditMode(em => !em)}
          >
            {editMode ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
            )}
            <span>{editMode ? 'Done' : 'Edit'}</span>
          </button>
          {/* Gear, not a pencil — the Edit/Done toggle just left of this is
              already a pencil icon; a second pencil here read as a duplicate
              of it. Gear disambiguates "class settings" from "layout edit
              mode" at a glance, same shape Obsidian's own settings tab uses. */}
          <button type="button" className="cc2-flush-btn cc2-cfs-edit" title="Class settings" onClick={() => setShowSettings(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {/* The class page is its own independent React root/AIProvider (see
              main.ts's ClassPageView.render()) with no visible chat surface
              of its own until now — Import Syllabus's setPanelOpen(true) was
              silently opening a panel that literally wasn't rendered anywhere
              in this tree, so nothing ever appeared, on this page or the main
              dashboard's separate instance. Mirrors app.tsx's own
              AIToggleButton + AIPanelWrapper placement exactly, just scoped
              to this page's own AIProvider/conversation history instead. */}
          <button
            type="button"
            className={'cc2-flush-btn cc2-ai-toggle-btn' + (panelOpen ? ' active' : '')}
            title={panelOpen ? 'Close AI assistant' : 'Open AI assistant'}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <BrandMark provider={settings.activeProvider} size={16} isDark={isDark} />
          </button>
        </div>

        <div className="cc2-cfs-masthead">
          <div className="cc2-cfs-masthead-left">
            <h1 className="cc2-cfs-title">{info.name || info.code}</h1>
            <div className="cc2-cfs-subhead">
              {info.teacher && (
                <span className="cc2-cfs-subhead-item">
                  {info.teacherEmail ? <a href={`mailto:${info.teacherEmail}`}>{info.teacher}</a> : info.teacher}
                </span>
              )}
              {info.room && (<><span className="cc2-cfs-subhead-dot" /><span className="cc2-cfs-subhead-item">{info.room}</span></>)}
              {info.officeHours && (
                <>
                  <span className="cc2-cfs-subhead-dot" />
                  <span className="cc2-cfs-subhead-item">{info.officeHours}{info.officeLocation ? ` · ${info.officeLocation}` : ''}</span>
                </>
              )}
            </div>
          </div>

          <div className="cc2-cfs-gauge-wrap" ref={gaugeWrapRef}>
            <button type="button" className="cc2-flush-btn cc2-cfs-gauge-btn" title="Click to set your grade directly" onClick={openGradeEdit}>
              <span className="cc2-cfs-gauge-ring">
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="var(--cc2-border)" strokeWidth="4.5" />
                  <circle cx="28" cy="28" r="24" fill="none" stroke="var(--t, var(--cc2-muted))" strokeWidth="4.5" strokeLinecap="round"
                    strokeDasharray={`${gaugeDash} 150.8`} transform="rotate(-90 28 28)" />
                </svg>
                <span className="cc2-cfs-gauge-pct">{grade != null ? `${Math.round(grade)}%` : '—'}</span>
              </span>
              <span className="cc2-cfs-gauge-text">
                <span className="cc2-cfs-gauge-label">{progress?.gradeOverride != null ? 'Your grade — set by you' : 'Current grade'}</span>
                <span className="cc2-cfs-gauge-long">{grade != null ? `${grade.toFixed(1)}%${letter ? ` · ${letter}` : ''}` : 'No grades yet'}</span>
              </span>
            </button>
            {showGradeEdit && (
              <div className="cc2-cfs-gauge-popover">
                <div className="cc2-cfs-gauge-popover-label">Set grade directly</div>
                <input
                  type="text"
                  className="cc2-setup-input"
                  placeholder="e.g. 91%"
                  value={gradeDraft}
                  onChange={e => setGradeDraft(e.target.value)}
                />
                <div className="cc2-cfs-gauge-popover-actions">
                  <button type="button" className="cc2-setup-confirm" onClick={handleGradeSet}>Set</button>
                  <button type="button" className="cc2-setup-cancel" onClick={handleGradeAuto}>Use computed</button>
                </div>
                <div className="cc2-cfs-gauge-popover-hint">No per-assignment entry needed — this overrides the computed average.</div>
              </div>
            )}
          </div>
        </div>

        {editMode && (
          <div className="cc2-cfs-edit-banner">
            Drag to rearrange · Resize from bottom-right · ✕ to remove · "+ Add Widget" for more
          </div>
        )}

        <div className="cc2-cfs-grid-wrap">
          <GridPage
            key={slug}
            page={gridPage}
            editMode={editMode}
            app={app}
            onLayoutChange={handleLayoutChange}
            onRemoveWidget={handleRemoveWidget}
            onConfigChange={handleConfigChange}
            showNavSpacer={false}
          />
        </div>
      </div>

      {libraryOpen && (
        <WidgetLibraryModal app={app} scope="classPage" onAdd={handleAddWidget} onClose={() => setLibraryOpen(false)} />
      )}

      {settingsTarget && (
        <WidgetSettingsModal
          app={app}
          type={settingsTarget.type}
          mode="edit"
          existingConfig={settingsTarget.config}
          classSlug={slug}
          onConfirm={patch => { handleConfigChange(settingsTarget.id, patch); setSettingsTarget(null); }}
          onCancel={() => setSettingsTarget(null)}
        />
      )}

      {showSettings && (
        <ClassSettingsModal app={app} slug={slug} onClose={() => setShowSettings(false)} onChanged={load} />
      )}

      {/* Rendered unconditionally, like app.tsx's own AIPanelWrapper — AIPanel
          reads panelOpen itself and hides/shows accordingly, it isn't gated
          by a wrapping conditional here. */}
      <AIPanel app={app} />
    </div>
  );
}
