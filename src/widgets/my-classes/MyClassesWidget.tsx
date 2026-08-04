import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { App } from 'obsidian';
import {
  listClasses, createClass, archiveClass, writeClassInfo, watchClassesFolder,
} from '../../data-sources/class-info';
import type { ClassInfoFields } from '../../data-sources/class-info';
import type { WidgetProps } from '../registry';
import { TonePickerPopover } from '../shared/TonePickerPopover';
import { AddClassModal } from './AddClassModal';
import type { NewClassFields } from './AddClassModal';
import { ClassSettingsModal } from './ClassSettingsModal';
import type { SyllabusSource } from './useSyllabusImport';
import { getCC2Plugin } from '../../../main';
import { GradeGauge } from './GradeGauge';

function parseGradePercent(grade: string | undefined): number | null {
  if (!grade) return null;
  const n = parseFloat(grade.replace('%', ''));
  return isNaN(n) ? null : n;
}

// Per-card "⋯" menu — always visible (never hover-gated) and the color
// swatch/menu trigger are each their own tappable button, per this suite's
// touch/iPad baseline (no right-click-only affordances for new per-card
// actions — the app-wide right-click "Edit Widget Settings…" convention
// still covers widget-level tone/wash, reached via config below).
//
// The card body opens Class Fullscreen on click — the "⋯" menu (Settings/
// Color/Archive) is a separate tap target so the two never collide.
function ClassCard({ app, info, onChanged, onOpenSettings, onOpenFullscreen }: {
  app: App;
  info: ClassInfoFields;
  onChanged: () => void;
  onOpenSettings: (slug: string) => void;
  onOpenFullscreen: (slug: string) => void;
}) {
  const [menuOpen, setMenuOpen]   = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuBtnRef  = useRef<HTMLButtonElement>(null);
  const colorDotRef = useRef<HTMLSpanElement>(null);
  const tone = info.color;
  const gradePercent = parseGradePercent(info.grade);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuWrapRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const handleArchive = useCallback(async () => {
    setMenuOpen(false);
    const confirmed = window.confirm(
      `Archive ${info.code}? This moves it out of My Classes, the Scheduler, and My Teachers — ` +
      `find it later in Education/Archived.`,
    );
    if (!confirmed) return;
    await archiveClass(app, info.slug);
    onChanged();
  }, [app, info.code, info.slug, onChanged]);

  return (
    <div className="cc2-mc-card" data-tone={tone}>
      <div className="cc2-mc-card-body" onClick={() => onOpenFullscreen(info.slug)}>
        <div className="cc2-mc-card-top">
          {/* Static swatch, not a trigger — color is already reachable from
              the "…" menu's Color item below (same TonePickerPopover, same
              anchor). Sized to match the Kanban column dot (12px) rather
              than dominating the card header with a big tappable circle. */}
          <span ref={colorDotRef} className="cc2-mc-color-dot" data-tone={tone} />
          <span className="cc2-mc-code">{info.code}</span>
        </div>
        {info.name && <div className="cc2-mc-name">{info.name}</div>}

        {gradePercent != null && (
          <div className="cc2-mc-gauge-wrap">
            <GradeGauge percent={gradePercent} size={80} />
          </div>
        )}
      </div>

      {info.room && <span className="cc2-mc-room">{info.room}</span>}

      <div className="cc2-mc-menu-wrap" ref={menuWrapRef}>
        <button
          type="button"
          ref={menuBtnRef}
          className="cc2-flush-btn cc2-mc-menu-btn"
          title="Class options"
          aria-label="Class options"
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2.2" />
            <circle cx="12" cy="12" r="2.2" />
            <circle cx="19" cy="12" r="2.2" />
          </svg>
        </button>
        {menuOpen && (
          <div className="cc2-mc-menu">
            <button
              type="button"
              className="cc2-mc-menu-item"
              onClick={() => { setMenuOpen(false); onOpenSettings(info.slug); }}
            >
              Class Settings
            </button>
            <button
              type="button"
              className="cc2-mc-menu-item"
              onClick={() => { setMenuOpen(false); setColorOpen(true); }}
            >
              Color
            </button>
            <button
              type="button"
              className="cc2-mc-menu-item cc2-mc-menu-item-danger"
              onClick={handleArchive}
            >
              Archive Class
            </button>
          </div>
        )}
      </div>

      {colorOpen && (
        <TonePickerPopover
          anchorRef={colorDotRef}
          tone={tone ?? 'paper'}
          wash={false}
          // No explicit onChanged() call here — writeClassInfo's vault.process
          // fires a 'modify' event that watchClassesFolder (in the parent) is
          // already subscribed to, which calls load() once the write actually
          // lands. Calling onChanged() synchronously here would race the
          // (unawaited) write and re-read stale data.
          onToneChange={t => { writeClassInfo(app, info.slug, { color: t === 'paper' ? '' : t }); }}
          onWashChange={() => {}}
          onClose={() => setColorOpen(false)}
          showWash={false}
        />
      )}
    </div>
  );
}

export function MyClassesWidget({ app, config }: WidgetProps) {
  const [classes,      setClasses]      = useState<ClassInfoFields[]>([]);
  const [loading,       setLoading]      = useState(true);
  const [showAdd,       setShowAdd]      = useState(false);
  const [addError,      setAddError]     = useState<string | undefined>();
  const [settingsSlug,  setSettingsSlug] = useState<string | null>(null);

  // Opens the class page as a real Obsidian tab (see main.ts's ClassPageView/
  // activateClassView) rather than a local portal — one shared tab, reused
  // across every class.
  const openClassPage = useCallback((slug: string) => {
    getCC2Plugin(app)?.activateClassView(slug);
  }, [app]);

  // Per-widget accent (right-click "Edit Widget Settings…") — the board's
  // own trim/wash, independent of each card's own class color above (which
  // writes through writeClassInfo/Class-Info.md instead of widget config).
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const load = useCallback(async () => {
    setClasses(await listClasses(app));
    setLoading(false);
  }, [app]);

  useEffect(() => {
    load();
    return watchClassesFolder(app, load);
  }, [app, load]);

  // Shared by the plain "Add Class" path and the "Add a Syllabus with AI"
  // path below — both need to create the class folder and (optionally) seed
  // whatever fields the user already typed manually before either path
  // diverges (manual: done; AI: also kicks off the import).
  const createAndSeedClass = useCallback(async (fields: NewClassFields) => {
    const result = await createClass(app, fields.code, fields.name);
    if (!result.ok) return result;
    // Only writes the fields the user actually filled in — createClass
    // already seeded code/name, and writeClassInfo's merge-write leaves
    // teacher/teacherEmail alone (not blanked) when left empty here.
    if (fields.teacher || fields.teacherEmail || fields.room) {
      await writeClassInfo(app, result.slug, {
        teacher:      fields.teacher || undefined,
        teacherEmail: fields.teacherEmail || undefined,
        room:         fields.room || undefined,
      });
    }
    return result;
  }, [app]);

  const handleAddClass = useCallback(async (fields: NewClassFields) => {
    const result = await createAndSeedClass(fields);
    if (!result.ok) { setAddError(result.error); return; }
    setAddError(undefined);
    setShowAdd(false);
    load();
  }, [createAndSeedClass, load]);

  // The class doesn't exist yet at the moment "Add a Syllabus with AI" is
  // clicked (unlike every other Import Syllabus entry point) — create+seed
  // it first, then jump to the class page. Deliberately does NOT call
  // useSyllabusImport's sendMessage from HERE — this widget lives on the
  // main dashboard, wrapped in the main dashboard's own AIProvider instance,
  // which is a completely separate conversation history from the Class
  // Page's own independent AIProvider (see main.ts's ClassPageView — its own
  // React root, its own <AIProvider>). Firing sendMessage here would run the
  // request on the dashboard's hidden/backgrounded instance while the user
  // is staring at the class page's own empty panel wondering why nothing
  // happened — exactly the bug this replaced. Instead, stash the request on
  // the plugin (in-memory only) and let ClassPageContent itself pick it up
  // and run it through its OWN AIProvider once it mounts for this slug.
  const handleImportSyllabus = useCallback(async (fields: NewClassFields, source: SyllabusSource) => {
    const result = await createAndSeedClass(fields);
    if (!result.ok) { setAddError(result.error); return; }
    setAddError(undefined);
    setShowAdd(false);
    load();
    const plugin = getCC2Plugin(app);
    if (plugin) plugin.pendingSyllabusImport = { slug: result.slug, classCode: fields.code, source };
    plugin?.activateClassView(result.slug);
  }, [app, createAndSeedClass, load]);

  return (
    <div className="cc2-mc-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-mc-toolbar">
        <span className="cc2-mc-title">My Classes</span>
        <button
          type="button"
          className="cc2-flush-btn cc2-mc-add"
          title="Add class"
          onClick={() => setShowAdd(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="cc2-mc-list">
        {loading && <div className="cc2-mc-empty">Loading…</div>}
        {!loading && classes.length === 0 && (
          <div className="cc2-mc-empty">No classes yet. Hit + to add your first one.</div>
        )}
        {!loading && classes.map(cls => (
          <ClassCard
            key={cls.slug}
            app={app}
            info={cls}
            onChanged={load}
            onOpenSettings={setSettingsSlug}
            onOpenFullscreen={openClassPage}
          />
        ))}
      </div>

      {showAdd && (
        <AddClassModal
          app={app}
          error={addError}
          onCancel={() => { setShowAdd(false); setAddError(undefined); }}
          onConfirm={handleAddClass}
          onImportSyllabus={handleImportSyllabus}
        />
      )}

      {settingsSlug && (
        <ClassSettingsModal
          app={app}
          slug={settingsSlug}
          onClose={() => setSettingsSlug(null)}
          onChanged={load}
        />
      )}

    </div>
  );
}
