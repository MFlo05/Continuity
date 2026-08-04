import React from 'react';
import {
  GRAPHICS, ICONS, WIDGET_ART, graphicsById,
  type ArtGroup, type ArtInner, type ArtLeaf, type ArtRoot,
} from './preview-art';

/**
 * PreviewArt.tsx — draws a widget's preview graphic from the spec in
 * preview-art.ts. Nothing here is widget-specific; all of that is data.
 *
 *   <PreviewArt widget="kanban" size="card" />        // 268×148 library card
 *   <PreviewArt widget="kanban" size="hero" />        // 452×232 detail pane
 *
 * The graphic inherits `color` from whatever wraps it, so the CARD is what sets
 * the category tone:
 *
 *   <div className="cc2-lib-card-art" style={{ color: CATEGORY_COLORS[def.category] }}>
 *     <PreviewArt widget={type} />
 *   </div>
 *
 * Two things worth not "cleaning up" later:
 *
 * 1. A leaf carrying inner content (a tick in a checkbox, a person in an avatar,
 *    a value in a ring) tints with `color-mix` instead of `opacity`. Parent
 *    opacity multiplies into children, so an icon inside a 20%-opacity circle is
 *    invisible. That is why there are two tinting paths.
 * 2. Pixel values are scaled by `SCALE[size]` while percentages pass through, so
 *    one spec serves the card and the hero. Do not bake either size in.
 */

const MONO = 'var(--font-monospace)';

const SCALE = { card: 1, hero: 1.5 } as const;
export type ArtSize = keyof typeof SCALE;

export interface PreviewArtProps {
  /** Widget id, as keyed in registry.ts. */
  widget: string;
  /** Which surface it is drawn on. Defaults to the library card. */
  size?: ArtSize;
  /**
   * The tile background, needed only to punch the donut's centre hole. Defaults
   * to the art tint token; pass an explicit value if the tile is painted
   * something else.
   */
  tileBg?: string;
}

export function PreviewArt({ widget, size = 'card', tileBg }: PreviewArtProps) {
  const id = WIDGET_ART[widget];
  const graphic = id ? graphicsById[id] : undefined;
  if (!graphic) return null;

  const k = SCALE[size];
  const S = (v: number) => Math.round(v * k);
  const px = (v: string | number | undefined) =>
    typeof v === 'number' ? `${S(v)}px` : v;
  const mix = (o: number) =>
    `color-mix(in srgb, currentColor ${Math.round(o * 100)}%, transparent)`;
  const hole = tileBg ?? 'var(--cc2-art-bg)';

  const type = (o: number, sizePx: number, x?: Partial<ArtLeaf | ArtInner>): React.CSSProperties => ({
    fontSize:      `${S(sizePx)}px`,
    fontWeight:    (x as { b?: number })?.b ?? 500,
    letterSpacing: (x as { tr?: number })?.tr ? `${(x as { tr: number }).tr}em` : '0',
    textTransform: (x as { up?: boolean })?.up ? 'uppercase' : 'none',
    fontFamily:    (x as { mono?: boolean })?.mono ? MONO : 'inherit',
    lineHeight:    1,
    whiteSpace:    'nowrap',
    color:         mix(o),
  });

  const renderInner = (inner: ArtInner | undefined, holeSize?: number) => {
    if (!inner) return null;
    if (inner.ic) {
      const paths = ICONS[inner.ic as string] ?? [];
      return (
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1}
          strokeLinecap="round" strokeLinejoin="round"
          style={{ width: S(inner.s), height: S(inner.s), display: 'block', opacity: inner.o }}
        >
          {paths.map((d, i) => <path key={i} d={d} />)}
        </svg>
      );
    }
    const style: React.CSSProperties = type(inner.o, inner.s, inner);
    if (inner.hole && holeSize) {
      Object.assign(style, {
        width: holeSize, height: holeSize, borderRadius: '50%',
        background: hole, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      });
    }
    return <span style={style}>{inner.tx}</span>;
  };

  const renderLeaf = (leaf: ArtLeaf, key: number) => {
    // Pure text leaf: no box, just type.
    if (leaf.text !== undefined && leaf.ring === undefined) {
      return (
        <div
          key={key}
          style={{
            display: 'flex', alignItems: 'center', minWidth: 0,
            flex: leaf.flex ? String(leaf.flex) : '0 0 auto',
            width: leaf.w !== undefined ? px(leaf.w) : undefined,
            justifyContent: leaf.right ? 'flex-end' : 'flex-start',
          }}
        >
          <span style={type(leaf.o ?? 1, leaf.s ?? 10, leaf)}>{leaf.text}</span>
        </div>
      );
    }

    // Sliced donut: conic-gradient of one hue at stepped alphas, hole punched by
    // an inner disc so the centred value stays readable (a mask would clip it).
    if (leaf.pie !== undefined) {
      const d = S(leaf.pie);
      let acc = 0;
      const stops = (leaf.slices ?? []).map(sl => {
        const from = acc;
        acc += sl.p;
        return `${mix(sl.o)} ${from}% ${acc - 0.7}%`;
      });
      return (
        <div
          key={key}
          style={{
            width: d, height: d, borderRadius: '50%', flexShrink: 0,
            background: `conic-gradient(from -90deg, ${stops.join(', ')}, transparent 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {renderInner(leaf.inner, S(leaf.hole ?? 0))}
        </div>
      );
    }

    if (leaf.ring !== undefined) {
      const d = S(leaf.ring);
      return (
        <div
          key={key}
          style={{
            width: d, height: d, borderRadius: '50%', boxSizing: 'border-box',
            border: `${S(leaf.th ?? 6)}px solid ${leaf.inner ? mix(leaf.o ?? 1) : 'currentColor'}`,
            opacity: leaf.inner ? 1 : leaf.o,
            flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {renderInner(leaf.inner)}
        </div>
      );
    }

    return (
      <div
        key={key}
        style={{
          width: px(leaf.w), height: S(leaf.h ?? 0),
          borderRadius: (leaf.r ?? 3) >= 999 ? 999 : S(leaf.r ?? 3),
          background: leaf.inner ? mix(leaf.o ?? 1) : 'currentColor',
          opacity: leaf.inner ? 1 : leaf.o,
          flex: leaf.flex ? String(leaf.flex) : '0 0 auto', flexShrink: 0,
          display: leaf.inner ? 'flex' : 'block',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {renderInner(leaf.inner)}
      </div>
    );
  };

  const groupStyle = (g: ArtGroup): React.CSSProperties => ({
    display: 'flex',
    flexDirection: g.dir === 'col' ? 'column' : 'row',
    gap: S(g.gap),
    alignItems: g.a ?? 'flex-start',
    justifyContent: g.j ?? 'flex-start',
    flexWrap: g.wrap ? 'wrap' : 'nowrap',
    flex: g.flex ? String(g.flex) : '0 0 auto',
    width: g.w ?? (g.dir === 'row' ? '100%' : undefined),
    height: g.h,
    minWidth: 0,
    // A group can be a surface too — that is how the front recipe card is one
    // solid rectangle holding its own tag, title and meta.
    background: g.bg ? mix(g.bg) : undefined,
    borderRadius: g.r ? S(g.r) : undefined,
    padding: g.pad,
    boxSizing: g.pad ? 'border-box' : undefined,
  });

  const isGroup = (n: ArtLeaf | ArtGroup): n is ArtGroup =>
    Array.isArray((n as ArtGroup).kids);

  const renderGroup = (g: ArtGroup, key: number) => (
    <div key={key} style={groupStyle(g)}>
      {g.kids.map((kid, i) =>
        isGroup(kid) ? renderGroup(kid, i) : renderLeaf(kid, i))}
    </div>
  );

  const root: ArtRoot = graphic.root;
  return (
    <div
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        padding: size === 'hero' ? '30px 34px' : '20px 22px',
        display: 'flex',
        flexDirection: root.dir === 'col' ? 'column' : 'row',
        gap: S(root.gap),
        alignItems: 'stretch',
        justifyContent: 'center',
      }}
    >
      {root.groups.map((g, i) => renderGroup(g, i))}
    </div>
  );
}

/** Every graphic, for a dev-only gallery. Not used by the library itself. */
export const ALL_GRAPHICS = GRAPHICS;
