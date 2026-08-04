import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { App, Platform } from 'obsidian';
import {
  widgetRegistry,
  CATEGORY_ORDER,
  CATEGORY_COLORS,
  CATEGORY_BLURB,
  NEED_CHIP,
} from '../widgets/registry';
import type { WidgetType } from '../types';
import type { WidgetCategory, WidgetDefinition } from '../widgets/registry';
import { WidgetSettingsModal } from './WidgetSettingsModal';
import { WidgetPreview } from './WidgetPreview';
import { PreviewArt } from './PreviewArt';
import { hasFixture, registerLibraryFixtures } from './library-fixtures';

/**
 * grid/WidgetLibraryModal.tsx — browse, understand, then add.
 *
 * Replaces a 580px modal that listed 28 widgets as a label and a `6×5` chip.
 * Nothing in it said what "Record Table" was, that Meal Planner wants recipes
 * to exist first, or that Time Period shows no data of its own. This is the
 * same add flow with the deciding put back in: a preview of the real widget, a
 * paragraph, its sizes, and an honest "what this needs" list.
 *
 * The name, the props and the WidgetSettingsModal (mode="create") handoff are
 * all unchanged — app.tsx and ClassPageContent.tsx needed no edits.
 *
 * Three behaviours worth knowing before changing anything:
 *
 * - THE RAIL SCROLLS, IT DOESN'T FILTER. Clicking a category jumps to its
 *   section; every other section is still below it. That's the point of
 *   sections over pills — you can keep going past the one you clicked.
 * - CLICKING A CARD SELECTS, IT DOESN'T ADD. Only "Add {Widget}" sets
 *   pendingType. The detail pane is a step BEFORE the settings modal, not a
 *   replacement for it.
 * - THE DETAIL VIEW COVERS THE WHOLE STAGE (everything right of the rail),
 *   as an OVERLAY over the still-mounted card grid — not by unmounting it.
 *   That keeps the grid's scroll position and its lazy-preview state alive,
 *   so ✕/Cancel drops you back exactly where you were browsing. The width is
 *   what buys the preview room to render at (or near) native widget size.
 */

interface Props {
  app:     App;
  onAdd:   (type: WidgetType, config?: Record<string, unknown>) => void;
  onClose: () => void;
  // 'main' (default): the full registry minus classPageOnly widgets, browsed
  // by category. 'classPage': ONLY classPageOnly widgets, with the rail and
  // sectioning off (there's only ever one category in that set).
  // Two disjoint views of the same registry, not an allow-list layered on
  // top of the category filter — a widget is in exactly one or the other.
  scope?: 'main' | 'classPage';
}

type Entry = [WidgetType, WidgetDefinition];

// ── Icons — canonical paths only (DESIGN_SYSTEM.md Iconography) ───────────

const Svg = ({ size, width, children }: { size: number; width: number; children: React.ReactNode }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
  >
    {children}
  </svg>
);

const BackIcon   = ({ size = 12 }: { size?: number }) => <Svg size={size} width={2.2}><path d="M15 18l-6-6 6-6" /></Svg>;
const AddIcon    = ({ size = 13 }: { size?: number }) => <Svg size={size} width={2.4}><path d="M12 5v14M5 12h14" /></Svg>;
const SearchIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size} width={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>
);

// ── Component ─────────────────────────────────────────────────────────────

export function WidgetLibraryModal({ app, onAdd, onClose, scope = 'main' }: Props) {
  const [search,      setSearch]      = useState('');
  const [selected,    setSelected]    = useState<WidgetType | null>(null);
  const [activeCat,   setActiveCat]   = useState<WidgetCategory | null>(null);
  const [pendingType, setPendingType] = useState<WidgetType | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<WidgetCategory, HTMLElement>());

  // Obsidian mobile is where six live React trees actually hurt, and the
  // detail pane is a pushed screen there rather than a side panel.
  const isMobile = Platform.isMobile;

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Seeding is idempotent and cheap; doing it on open rather than at module
  // load keeps the fixtures out of the plugin's startup path entirely.
  useEffect(() => { registerLibraryFixtures(app); }, [app]);

  // Escape unwinds one layer at a time: settings modal (its own handler), then
  // the detail pane, then the library.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pendingType) return;
      if (selected) { setSelected(null); return; }
      onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, pendingType, selected]);

  // ── Data ────────────────────────────────────────────────────────────────

  const entries = useMemo(() => {
    const all = Object.entries(widgetRegistry) as Entry[];
    return all.filter(([, def]) => (scope === 'classPage') === !!def.classPageOnly);
  }, [scope]);

  // Search spans label AND description, so "money" surfaces the Finance suite
  // even though no widget is called that.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([, def]) =>
      def.label.toLowerCase().includes(q) || (def.description ?? '').toLowerCase().includes(q));
  }, [entries, search]);

  // Filtering happens BEFORE sectioning, so a section with no surviving
  // matches disappears rather than rendering an empty header.
  const sections = useMemo(() => {
    if (scope === 'classPage') return [];
    return CATEGORY_ORDER
      .map(cat => ({ cat, items: visible.filter(([, def]) => def.category === cat) }))
      .filter(s => s.items.length > 0);
  }, [visible, scope]);

  // Counts are derived, never constants — a new widget can't make them lie.
  const railCounts = useMemo(() => {
    const counts = new Map<WidgetCategory, number>();
    for (const [, def] of entries) counts.set(def.category, (counts.get(def.category) ?? 0) + 1);
    return counts;
  }, [entries]);

  const categoryCount = useMemo(
    () => CATEGORY_ORDER.filter(c => railCounts.has(c)).length,
    [railCounts],
  );

  const def = selected ? widgetRegistry[selected] : null;

  // ── Scroll spy ──────────────────────────────────────────────────────────
  // The active rail item follows the SCROLL, not the last click — otherwise it
  // lies the moment you keep scrolling past the section you jumped to.

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || sections.length === 0) return;

    const observer = new IntersectionObserver(
      obs => {
        const onScreen = obs
          .filter(o => o.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (onScreen) setActiveCat(onScreen.target.getAttribute('data-cat') as WidgetCategory);
      },
      // The top band only: a section counts as "current" once its header is at
      // or above the sticky position, which is what makes the highlight match
      // the header the reader can actually see.
      { root, rootMargin: '0px 0px -78% 0px', threshold: 0 },
    );

    sectionRefs.current.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const scrollToCategory = useCallback((cat: WidgetCategory | null) => {
    // The rail is a browsing control — using it while a detail view is open
    // means "back to browsing", so it dismisses the overlay. The grid stayed
    // mounted underneath, so the scroll target exists immediately.
    setSelected(null);
    const root = scrollRef.current;
    if (!root) return;
    if (!cat) { root.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const el = sectionRefs.current.get(cat);
    if (el) root.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' });
  }, []);

  // ── Add flow — unchanged ────────────────────────────────────────────────

  const handleSettingsConfirm = (config: Record<string, unknown>) => {
    if (!pendingType) return;
    onAdd(pendingType, config);
    setPendingType(null);
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderCard = ([type, d]: Entry) => {
    const color = CATEGORY_COLORS[d.category];
    return (
      <button
        key={type}
        type="button"
        className={'cc2-lib-card' + (selected === type ? ' selected' : '')}
        style={{ ['--cat' as string]: color }}
        onClick={() => setSelected(type)}
        title={d.label}
      >
        {/* Cards are ART, deliberately — the live render lives in the detail
            view, where there's room for it to be legible and interactive.
            A widget shrunk into a 148px card was never going to read.
            The CARD sets `color`; the graphic inherits it, which is how one
            spec covers seven categories and both themes with no per-theme
            duplicates. */}
        <span className="cc2-lib-card-preview" style={{ color }}>
          <PreviewArt widget={type} />
        </span>

        <span className="cc2-lib-card-body">
          <span className="cc2-lib-card-name">
            <span className="cc2-lib-dot" style={{ background: color }} />
            {d.label}
          </span>
          <span className="cc2-lib-card-desc">{d.description}</span>
          <span className="cc2-lib-card-meta">
            <span className="cc2-lib-size">{d.defaultSize.w} × {d.defaultSize.h}</span>
            {d.requiresFileSetup && <span className="cc2-lib-setup-tag">Setup</span>}
          </span>
        </span>
      </button>
    );
  };

  const detail = def && selected && (
    <aside className="cc2-lib-detail">
      <div className="cc2-lib-detail-top">
        <span className="cc2-lib-dot cc2-lib-dot-lg" style={{ background: CATEGORY_COLORS[def.category] }} />
        <span className="cc2-lib-detail-catname" style={{ color: CATEGORY_COLORS[def.category] }}>
          {def.category}
        </span>
        <span className="cc2-lib-spacer" />
        <button type="button" className="cc2-modal-close" onClick={() => setSelected(null)} title="Back to library">✕</button>
      </div>

      {/* A widget wider than half the grid can't share a row with the copy
          without being squeezed into something it never looks like on the
          dashboard. Past that width it takes the full stage and the copy
          moves underneath it. 6 is the natural line: that IS half of the
          12-column grid. */}
      <div className="cc2-lib-detail-split" data-wide={def.defaultSize.w > 6 || undefined}>
        <div className="cc2-lib-hero" style={{ ['--cat' as string]: CATEGORY_COLORS[def.category] }}>
          {/* Keyed on the type so switching widgets remounts rather than
              feeding a new fixture into the previous widget's state.
              Contain-fit against the measured box means it renders at native
              size whenever the stage is big enough, and scales down whole —
              never cropped — when it isn't. */}
          <WidgetPreview key={selected} type={selected} app={app} forceArt={isMobile} />
          {hasFixture(selected) && !isMobile && (
            <span className="cc2-lib-live-badge cc2-lib-live-badge-lg">
              <span className="cc2-lib-live-dot" />Live preview
            </span>
          )}
        </div>

        <div className="cc2-lib-detail-info">
          <h2 className="cc2-lib-detail-title">{def.label}</h2>
          <p className="cc2-lib-detail-about">{def.about ?? def.description}</p>

          <div className="cc2-lib-sizes">
            <div className="cc2-lib-size-box">
              <span className="label">Default</span>
              <span className="cc2-lib-size-val">{def.defaultSize.w} × {def.defaultSize.h}</span>
            </div>
            <div className="cc2-lib-size-box">
              <span className="label">Minimum</span>
              <span className="cc2-lib-size-val">{def.minSize.w} × {def.minSize.h}</span>
            </div>
          </div>

          {!!def.needs?.length && (
            <>
              <div className="label cc2-lib-needs-head">Getting started</div>
              <div className="cc2-lib-needs">
                {def.needs.map((need, i) => (
                  <div key={i} className="cc2-lib-need">
                    <span className="cc2-lib-need-chip" data-tone={NEED_CHIP[need.kind].tone}>
                      {NEED_CHIP[need.kind].label}
                    </span>
                    <span className="cc2-lib-need-text">{need.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="cc2-lib-detail-footer">
        <button type="button" className="cc2-flush-btn cc2-lib-cancel" onClick={() => setSelected(null)}>
          Cancel
        </button>
        <button type="button" className="cc2-lib-add" onClick={() => setPendingType(selected)}>
          <AddIcon />
          Add {def.label}
        </button>
      </div>
    </aside>
  );

  // ── Shell ───────────────────────────────────────────────────────────────

  return createPortal(
    <>
      <div className="cc2-lib-fs-backdrop" data-detail={selected ? '' : undefined}>
        <div className="cc2-lib-topbar">
          <button type="button" className="cc2-flush-btn cc2-lib-back" onClick={onClose}>
            <BackIcon size={isMobile ? 18 : 12} />
            {!isMobile && 'Dashboard'}
          </button>
          <span className="cc2-lib-title">Widget Library</span>
          {scope === 'main' && (
            <span className="label cc2-lib-count">
              {entries.length} widgets · {categoryCount} categories
            </span>
          )}

          <span className="cc2-lib-spacer" />

          <span className="cc2-lib-search-wrap">
            <span className="cc2-lib-search-icon"><SearchIcon size={isMobile ? 14 : 13} /></span>
            <input
              ref={searchRef}
              className="cc2-lib-search"
              placeholder="Search widgets…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </span>

          <button type="button" className="cc2-modal-close cc2-lib-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="cc2-lib-main">
          {scope === 'main' && (
            <nav className="cc2-lib-rail">
              <div className="label cc2-lib-rail-head">Browse</div>

              <button
                type="button"
                className="cc2-flush-btn cc2-lib-rail-item"
                onClick={() => scrollToCategory(null)}
              >
                <span className="cc2-lib-dot" style={{ background: 'var(--cc2-faint)' }} />
                <span className="cc2-lib-rail-name">All widgets</span>
                <span className="cc2-lib-rail-count">{entries.length}</span>
              </button>

              {CATEGORY_ORDER.filter(cat => railCounts.has(cat)).map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={'cc2-flush-btn cc2-lib-rail-item' + (activeCat === cat ? ' active' : '')}
                  onClick={() => scrollToCategory(cat)}
                >
                  <span className="cc2-lib-dot" style={{ background: CATEGORY_COLORS[cat] }} />
                  <span className="cc2-lib-rail-name">{cat}</span>
                  <span className="cc2-lib-rail-count">{railCounts.get(cat)}</span>
                </button>
              ))}

              <div className="cc2-lib-rail-foot">
                Widgets drop onto the page at their default size. You can resize
                anything after it lands.
              </div>
            </nav>
          )}

          {/* The stage: everything right of the rail. The detail view overlays
              it absolutely, so the grid keeps its scroll position and preview
              state while a widget is being inspected. */}
          <div className="cc2-lib-stage">
          <div className="cc2-lib-scroll" ref={scrollRef}>
            <div className="cc2-lib-scroll-inner">
              {visible.length === 0 && (
                <div className="cc2-lib-empty">
                  <div className="cc2-lib-empty-head">No widgets match &ldquo;{search}&rdquo;</div>
                  <div className="cc2-lib-empty-sub">
                    Try a category, or search by what the widget does — &ldquo;grades&rdquo;,
                    &ldquo;money&rdquo;, &ldquo;recipes&rdquo;.
                  </div>
                </div>
              )}

              {/* classPage has exactly one category, so it gets the cards
                  without the sectioning ceremony. */}
              {scope === 'classPage' ? (
                <div className="cc2-lib-grid cc2-lib-grid-flush">{visible.map(renderCard)}</div>
              ) : (
                sections.map(({ cat, items }) => (
                  <section key={cat} className="cc2-lib-section">
                    <header
                      className="cc2-lib-section-head"
                      data-cat={cat}
                      ref={el => { if (el) sectionRefs.current.set(cat, el); else sectionRefs.current.delete(cat); }}
                    >
                      <span className="cc2-lib-dot" style={{ background: CATEGORY_COLORS[cat] }} />
                      <span className="label cc2-lib-section-name">{cat}</span>
                      <span className="label cc2-lib-section-count">{items.length}</span>
                      <span className="cc2-lib-rule" />
                      <span className="cc2-lib-section-blurb">{CATEGORY_BLURB[cat]}</span>
                    </header>
                    <div className="cc2-lib-grid">{items.map(renderCard)}</div>
                  </section>
                ))
              )}
            </div>
          </div>

          {detail}
          </div>
        </div>
      </div>

      {pendingType && (
        <WidgetSettingsModal
          app={app}
          type={pendingType}
          mode="create"
          onConfirm={handleSettingsConfirm}
          onCancel={() => setPendingType(null)}
        />
      )}
    </>,
    document.body,
  );
}
