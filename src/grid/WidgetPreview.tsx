import React, { Component, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { App } from 'obsidian';
import type { WidgetType } from '../types';
import { widgetRegistry } from '../widgets/registry';
import { fixtureConfig, hasFixture, previewComponent } from './library-fixtures';
import { previewApp } from './preview-app';
import { PreviewArt } from './PreviewArt';

/**
 * grid/WidgetPreview.tsx — the real widget, running on fixture data.
 *
 * Used by the DETAIL VIEW only, and only ever one at a time. Cards render
 * PreviewArt instead: a widget shrunk into a 148px card was never going to be
 * legible, and trying to make it work cost a concurrency cap, an
 * IntersectionObserver and a slot allocator for a result nobody could read.
 * One preview, given real room, at a size the widget was designed for.
 *
 * Because it's one deliberate, user-initiated mount, it is also fully
 * INTERACTIVE — check a box, drag a card, switch a tab. Nothing it does can
 * reach the vault: the data is a seeded snapshot (core/preview-source.ts) and
 * the App it receives is sandboxed (grid/preview-app.ts).
 *
 * Falls back to PreviewArt when a live render isn't possible: no fixture for
 * this type, on mobile, or the render threw. Art is the floor.
 */

/**
 * The synthetic grid a preview is laid out against. `ROW_PX` matches
 * GridPage's real `cellHeight: 80`; `COL_PX` is a stand-in for the dashboard's
 * own column width, picked so a 12-wide widget comes out at a believable
 * 1152px rather than at whatever the user's window happens to be.
 */
const COL_PX = 96;
const ROW_PX = 80;

// ── Error boundary ────────────────────────────────────────────────────────

/**
 * A widget that throws inside a preview must degrade to art, not take the
 * library down with it. Fixture data is plausible but it isn't real, and a
 * widget is entitled to assume things about its own vault that a fixture
 * doesn't satisfy — that's a preview problem, not a bug in the widget.
 */
class PreviewBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) {
    console.warn('[cc2] widget preview failed, falling back to art:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── Live mount ────────────────────────────────────────────────────────────

function LiveWidget({ type, app, availW, availH }: {
  type: WidgetType; app: App; availW: number; availH: number;
}) {
  const def  = widgetRegistry[type];
  const Comp = useMemo(() => previewComponent(type), [type]);

  // Memoised: it's a prop, and a fresh App identity every render would defeat
  // the memo on any widget that keys work off `app`.
  const sandbox = useMemo(() => previewApp(app), [app]);
  const config  = useMemo(() => fixtureConfig(type), [type]);

  if (!Comp || !def) return null;

  const naturalW = def.defaultSize.w * COL_PX;
  const naturalH = def.defaultSize.h * ROW_PX;

  // Contain: the whole widget, as close to native size as the space allows,
  // capped at 1 so a small widget renders pixel-true rather than blown up.
  // Centered and never cropped — this is the one place the widget is meant to
  // be judged, so showing all of it matters more than filling the frame.
  const scale = Math.min(1, availW / naturalW, availH / naturalH);
  const style: React.CSSProperties = {
    width: naturalW,
    height: naturalH,
    top: '50%',
    left: '50%',
    transform: `translate(-50%, -50%) scale(${scale})`,
    transformOrigin: 'center',
  };

  return (
    // `cc2-root` is load-bearing, not decoration. UI-PATTERNS.md gotcha #4:
    // the library is portaled to <body>, and rules written as
    // `.cc2-root .glass` / `.cc2-root .label` need a literal .cc2-root
    // ANCESTOR — no variable bridge fixes DOM ancestry. Without this the
    // Finance stat cards lose their glass and every micro-label loses its
    // tracking, silently. It also hands the widget the flex column and
    // height:100% it expects from WidgetShell.
    //
    // The inner div wears `glass`: on the dashboard a widget renders inside
    // WidgetShell's glass card and its own surfaces assume that backdrop, so
    // the preview reproduces it. It sits directly on the detail view's own
    // surface now — there is no framing container behind it, which is what
    // makes it read as the widget rather than as a picture of one.
    <div className="cc2-lib-preview-stage cc2-root" style={style}>
      <div className="glass cc2-lib-preview-shell">
        <Comp config={config} app={sandbox} onConfigChange={() => { /* previews don't persist */ }} />
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────

export interface WidgetPreviewProps {
  type: WidgetType;
  app:  App;
  /** Forces art regardless — set on mobile, where a live React tree hurts. */
  forceArt?: boolean;
}

export function WidgetPreview({ type, app, forceArt = false }: WidgetPreviewProps) {
  // Having a fixture IS the definition of "can render live" — there's no
  // separate flag to disagree with it. See grid/library-fixtures.ts.
  const wantsLive = !forceArt && hasFixture(type);

  const hostRef = useRef<HTMLDivElement>(null);

  /**
   * The box is measured, not passed: the detail view's preview area flexes
   * with the window, and contain-fit needs the real number to decide how close
   * to native size it can get.
   *
   * useLayoutEffect, and measured once by hand BEFORE the observer attaches —
   * a ResizeObserver's first callback lands after paint, so gating the live
   * render on it alone guaranteed a visible frame of art on every open.
   */
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      setAvail(prev =>
        prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
          ? prev
          : { w: width, h: height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hero scale: the same spec at 1.5×, so a widget that can't render live
  // still gets a graphic sized for this surface rather than a card-sized one
  // floating in it.
  const fallback = <PreviewArt widget={type} size="hero" tileBg="var(--cc2-bg-raised)" />;
  const live = wantsLive && !!avail;

  return (
    <div ref={hostRef} className="cc2-lib-preview" data-live={live || undefined}>
      {live
        ? <PreviewBoundary fallback={fallback}>
            <LiveWidget type={type} app={app} availW={avail!.w} availH={avail!.h} />
          </PreviewBoundary>
        : fallback}
    </div>
  );
}
