import React, { useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { GridStack } from 'gridstack';
import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { LayoutItem, PageLayout } from '../types';
import { widgetRegistry, type WidgetDefinition } from '../widgets/registry';
import { resolveWidgetSource, sourcePath } from '../core';
import { WidgetShell } from './WidgetShell';

// Widget types that render their own source badge internally (context-dependent placement)
const SELF_BADGES = new Set(['task-manager']);

function badgeFor(app: App, path: string): { sourceLabel: string; onSourceClick: () => void } {
  const name = path.replace(/\.md$/i, '').split('/').pop() ?? path;
  return {
    sourceLabel:   name + '.md',
    onSourceClick: () => { app.workspace.openLinkText(path, ''); },
  };
}

function getSourceInfo(
  item: LayoutItem,
  app: App,
  def?: WidgetDefinition,
): { sourceLabel?: string; onSourceClick?: () => void } {
  if (SELF_BADGES.has(item.type)) return {};
  // Either kind of source setup can produce a badge. A folder-source widget
  // (Record Table today) still resolves to no badge below, since there's no
  // single file to open — but a future General renderer over a file source
  // shouldn't have to be added here to get one.
  if (!def?.requiresFileSetup && !def?.sourcePicker) return {};

  // Ask the source layer, not the legacy config key. This is what keeps the
  // badge honest for TODO List's class-linked mode: that widget reads one
  // Tasks.md per class, so it has no single source — resolveWidgetSource
  // returns null and it correctly gets no badge, where reading `listFile`
  // directly used to point at a todos/Class-Tasks.md it never touches. (The
  // key itself is deliberately left set — WidgetSettingsModal preserves it so
  // toggling class-linked back off restores the file you had.)
  const source = resolveWidgetSource(app, item.type, item.config);
  if (!source) return {};

  const path = sourcePath(source);
  if (path) return badgeFor(app, path);

  // Folder sources have no single file to point at — a Finance ledger is a
  // folder of per-year files, and the badge should link the one the widget
  // actually reads day to day. That choice still lives in the preset's
  // resolveLink; Phase 3's line-table codec can name its own primary file.
  // Optional-chained throughout: a sourcePicker widget reaches this line with
  // no requiresFileSetup at all, and folder sources simply get no badge.
  const setup = def.requiresFileSetup;
  const raw = setup ? (item.config?.[setup.configKey] as string | undefined) : undefined;
  const resolved = raw ? setup?.resolveLink?.(app, raw) : undefined;
  return resolved ? badgeFor(app, resolved) : {};
}

// A phone gets 6 columns, everything else 12. Read once at module load and
// never re-read: Platform.isPhone is a device fact, and holding the column
// count constant is exactly what makes rotation lossless. Switching to 12 in
// landscape would look identical (Gridstack scales coordinates proportionally)
// while costing a persisted rewrite and a rounding error on every rotation.
const IS_PHONE        = Platform.isPhone;
const DESKTOP_COLUMNS = 12;
const COLUMNS         = IS_PHONE ? 6 : DESKTOP_COLUMNS;
const COLUMN_SCALE    = COLUMNS / DESKTOP_COLUMNS;

/**
 * Scales a registry minSize.w into the active grid.
 *
 * Widget minimums are authored against 12 columns, so a widget declaring
 * minSize.w: 4 ("a third") would mean two-thirds of a 6-column phone grid and
 * could never be made small enough to sit beside anything.
 */
function scaleMinW(w: number): number {
  return Math.max(1, Math.round(w * COLUMN_SCALE));
}

/**
 * The geometry each widget should mount with.
 *
 * Desktop uses `items` as authored. A phone overlays `mobilePlacements`, and
 * seeds them on first visit by halving x and w — 12 to 6 is exactly
 * proportional, so a half-width widget stays half-width and any side-by-side
 * pair survives the trip. y and h carry over untouched; row height has nothing
 * to do with column count.
 *
 * Widgets added on desktop since the last phone visit have no placement yet and
 * fall through to the same halving, so they land somewhere sensible rather than
 * stacking at the origin.
 */
function resolveGeometry(page: PageLayout): LayoutItem[] {
  if (!IS_PHONE) return page.items;

  const placed = new Map((page.mobilePlacements ?? []).map(p => [p.id, p]));

  return page.items.map(item => {
    const p = placed.get(item.id);
    if (p) return { ...item, x: p.x, y: p.y, w: p.w, h: p.h };

    return {
      ...item,
      x: Math.min(COLUMNS - 1, Math.round(item.x * COLUMN_SCALE)),
      w: Math.max(1, Math.min(COLUMNS, Math.round(item.w * COLUMN_SCALE))),
    };
  });
}

interface GridPageProps {
  page: PageLayout;
  editMode: boolean;
  app: App;
  onLayoutChange: (items: LayoutItem[]) => void;
  onRemoveWidget: (id: string) => void;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  // The nav-spacer reserves row 0 for the main dashboard's floating topbar.
  // Class Fullscreen's own topbar/masthead are in-flow (not floating), so it
  // has nothing to reserve space for — default true keeps the main
  // dashboard's existing behavior untouched.
  showNavSpacer?: boolean;
}

// Memoized so React never touches .grid-stack-item wrappers after mount
// (Gridstack owns those elements for positioning).
// Re-renders only when editMode or the item's identity/config changes.
const GridItem = memo(function GridItem({
  item,
  editMode,
  app,
  onRemove,
  onConfigChange,
}: {
  item: LayoutItem;
  editMode: boolean;
  app: App;
  onRemove: () => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  const def  = widgetRegistry[item.type];
  const Comp = def?.component;
  const { sourceLabel, onSourceClick } = getSourceInfo(item, app, def);

  // Pass label/category into config so PlaceholderWidget can render them
  const resolvedConfig = {
    _label: def?.label,
    _category: def?.category,
    ...item.config,
  };

  return (
    <div
      className="grid-stack-item"
      gs-id={item.id}
      gs-x={String(item.x)}
      gs-y={String(item.y)}
      gs-w={String(item.w)}
      gs-h={String(item.h)}
      gs-min-w={String(scaleMinW(def?.minSize.w ?? 2))}
      gs-min-h={String(def?.minSize.h ?? 2)}
    >
      <div className="grid-stack-item-content">
        <WidgetShell
          label={def?.label ?? item.type}
          editMode={editMode}
          onRemove={onRemove}
          sourceLabel={sourceLabel}
          onSourceClick={onSourceClick}
        >
          {Comp && <Comp config={resolvedConfig} app={app} onConfigChange={onConfigChange} />}
        </WidgetShell>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.editMode      === next.editMode &&
  prev.item.id       === next.item.id  &&
  prev.item.w        === next.item.w   &&
  prev.item.h        === next.item.h   &&
  prev.item.config   === next.item.config  // config change covers sourceLabel update
);

export function GridPage({ page, editMode, app, onLayoutChange, onRemoveWidget, onConfigChange, showNavSpacer = true }: GridPageProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const gridRef       = useRef<GridStack | null>(null);
  // Track which item IDs Gridstack already owns (to detect newly added ones)
  const registeredIds = useRef(new Set<string>());

  // What each widget mounts with: `items` on desktop, mobilePlacements-over-items
  // on a phone. Everything downstream reads this rather than page.items, so the
  // two devices never see each other's coordinates.
  //
  // Memoized because the effects below key off its identity — an array rebuilt
  // every render would re-register widgets and re-fire compact() on each pass.
  const items = useMemo(
    () => resolveGeometry(page),
    [page.items, page.mobilePlacements],
  );

  // Stable ref so 'change' handler always sees current items without re-subscribing
  const itemsRef = useRef<LayoutItem[]>(items);

  // Keep itemsRef current — must run before the dynamic-registration effect below
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Init grid once per page — re-runs only when navigating between pages
  useEffect(() => {
    if (!containerRef.current) return;

    gridRef.current = GridStack.init(
      {
        column:        COLUMNS,
        cellHeight:    80,
        animate:       true,
        float:         false,
        disableDrag:   true,
        disableResize: true,
        draggable:     { handle: '.ws-drag-handle' },
        resizable:     { handles: 'se' },
      },
      containerRef.current,
    );

    // All items rendered by React on initial mount are now owned by Gridstack
    if (showNavSpacer) registeredIds.current.add('__nav-spacer__');
    itemsRef.current.forEach(item => registeredIds.current.add(item.id));

    // Belt-and-suspenders: a freshly-created class's default 7-widget layout
    // was observed rendering with the container's own measured height at
    // exactly 2x the real content height (e.g. 1920px / 80px cellHeight = 24
    // rows for a layout whose real max y+h is 12) — the widgets themselves
    // sitting in the BOTTOM half, with a full duplicate of empty space above
    // them that had to be dragged away by hand. That 24 = 12*2 relationship
    // points at the engine ending up with two overlapping placements of the
    // same widget set right at init. float:false already means there should
    // never be a real gap in normal use, so an explicit compact() here is a
    // no-op on an already-correct layout and a fix on a double-registered
    // one — cheap insurance either way.
    gridRef.current.compact();

    gridRef.current.on('change', () => {
      const grid = gridRef.current;
      if (!grid) return;
      const nodeMap = new Map(grid.engine.nodes.map(n => [String(n.id), n]));
      // Only emit items Gridstack still tracks (filters out just-removed widgets)
      const updated = itemsRef.current
        .filter(item => nodeMap.has(item.id))
        .map(item => {
          const n = nodeMap.get(item.id)!;
          return { ...item, x: n.x ?? item.x, y: n.y ?? item.y, w: n.w ?? item.w, h: n.h ?? item.h };
        });
      onLayoutChange(updated);
    });

    return () => {
      gridRef.current?.destroy(false);
      gridRef.current = null;
      registeredIds.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // When items are added from the Widget Library, React renders the new GridItem
  // first, then this effect fires and hands it to Gridstack for positioning.
  useEffect(() => {
    if (!gridRef.current || !containerRef.current) return;
    const newItems = items.filter(i => !registeredIds.current.has(i.id));
    if (newItems.length === 0) return;

    newItems.forEach(item => {
      const el = containerRef.current!.querySelector(`[gs-id="${item.id}"]`);
      if (!el) return;
      const def = widgetRegistry[item.type];
      gridRef.current!.makeWidget(el as HTMLElement, {
        id:           item.id,
        w:            item.w,
        h:            item.h,
        minW:         def ? scaleMinW(def.minSize.w) : undefined,
        minH:         def?.minSize.h,
        autoPosition: true, // let Gridstack find the best empty spot
      });
      registeredIds.current.add(item.id);
    });
    // Same defensive repack as the init effect above — autoPosition can only
    // ever place a widget after whatever the engine currently believes is
    // occupied, so if this path ever fires for items the engine already had
    // (see the init effect's own comment), this closes the gap it left.
    gridRef.current.compact();
  }, [items]);

  // Toggle drag/resize when editMode flips — no grid rebuild needed
  useEffect(() => {
    const g = gridRef.current;
    if (!g) return;
    if (editMode) {
      g.enableMove(true);
      g.enableResize(true);
    } else {
      g.enableMove(false);
      g.enableResize(false);
    }
  }, [editMode]);

  const handleRemove = useCallback((id: string) => {
    if (gridRef.current && containerRef.current) {
      const el = containerRef.current.querySelector(`[gs-id="${id}"]`);
      // removeWidget(el, false) removes from engine but leaves DOM for React to clean up
      if (el) gridRef.current.removeWidget(el as HTMLElement, false);
    }
    onRemoveWidget(id);
  }, [onRemoveWidget]);

  return (
    <div className={'cc2-grid-wrapper' + (editMode ? ' cc2-grid-wrapper-editing' : '')}>
      {items.length === 0 && (
        <div className="cc2-grid-empty-hint">Add a widget to get started</div>
      )}
      {/* cc2-grid--editing is what makes the resize handles visible. It has to
          live here, on an ancestor of .grid-stack-item: the handle is a direct
          child of .grid-stack-item and a SIBLING of .grid-stack-item-content,
          so the old .ws-shell.ws-editing selectors — ws-shell being *inside*
          that content div — described a descendant path that cannot exist and
          never matched anything. */}
      <div
        className={'grid-stack' + (editMode ? ' cc2-grid--editing' : '')}
        ref={containerRef}
      >
        {/* Locked, non-persisted spacer occupying row 0 — reserves real space for
            the floating topbar to breathe over instead of a CSS padding hack.
            Gridstack treats it as a real occupied node: autoPosition on new
            widgets skips it, and (with float:false) dragging can't overlap it.
            Never included in page.items, so it never reaches onLayoutChange.
            Skipped entirely when showNavSpacer is false (in-flow chrome, e.g.
            Class Fullscreen, has nothing floating to reserve space for). */}
        {showNavSpacer && (
          <div
            className="grid-stack-item cc2-grid-spacer"
            gs-id="__nav-spacer__"
            gs-x="0"
            gs-y="0"
            gs-w={String(COLUMNS)}
            gs-h="1"
            gs-no-move="true"
            gs-no-resize="true"
            gs-locked="true"
          >
            <div className="grid-stack-item-content cc2-grid-spacer-content" />
          </div>
        )}
        {items.map(item => (
          <GridItem
            key={item.id}
            item={item}
            editMode={editMode}
            app={app}
            onRemove={() => handleRemove(item.id)}
            onConfigChange={patch => onConfigChange(item.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}
