/**
 * preview-art.ts — the Widget Library preview-art spec. DATA, no JSX.
 *
 * One entry per graphic; PreviewArt.tsx walks it and emits divs. There are no
 * images, no SVG art files and no per-theme duplicates: every shape is a CSS
 * box filled with currentColor at a set alpha, and the card sets `color` to the
 * widget's category tone. That is the whole reason this covers seven categories
 * and both themes for free.
 *
 * SHAPE OF THE TREE — shallow on purpose:
 *
 *   root  → groups → leaves
 *                  → one nested group → leaves      (one level of nesting, max)
 *
 * The ceiling is deliberate. It keeps the renderer small and, more importantly,
 * keeps each graphic legible as data you can tune by changing numbers rather
 * than by restructuring code. If a composition seems to need a deeper tree,
 * flatten it instead — every graphic here already did.
 *
 * AUTHORING NOTES
 *
 * - Widths are percentages (strings) or pixels (numbers); heights are always
 *   pixels. The renderer scales pixel values, so one spec fills both the 268×148
 *   card and the 452×232 detail hero.
 * - A leaf carrying inner content (a tick in a checkbox, a person in an avatar,
 *   a value in a ring) tints with color-mix instead of opacity. Parent opacity
 *   multiplies into children, which would make every icon invisible inside its
 *   own shape. Do not "simplify" that back to opacity.
 * - Text is structural, never plausible user data: MON/TUE, TODO/DOING/DONE,
 *   INCOME/SPENT, 20 min, 25:00. It is there to make the shape legible as that
 *   widget. Anything that reads like a real record belongs in a live preview.
 * - Icons are five 24×24 stroked paths reusing the app's icon canon
 *   (DESIGN_SYSTEM.md). Add to ICONS rather than inlining a new silhouette.
 */

export type ArtId =
  | 'tableRecords'
  | 'tableGrid'
  | 'checkRows'
  | 'groceryQty'
  | 'tableChips'
  | 'cardPeel'
  | 'weekSlots'
  | 'focusHero'
  | 'dayStrip'
  | 'agendaDay'
  | 'buckets'
  | 'tabbedList'
  | 'stepList'
  | 'statBand'
  | 'donutLegend'
  | 'pairedBars'
  | 'dateRange'
  | 'ledgerEntry'
  | 'recurringRows'
  | 'artBanner'
  | 'passage'
  | 'flashCard'
  | 'linkCard'
  | 'scratchPad'
  | 'gradeGauges'
  | 'contactRows'
  | 'scheduleGrid'
  // ── Class Page ──────────────────────────────────────────────────────────
  | 'noteCards'
  | 'classCalendar'
  | 'assignmentRows'
  | 'taskCard'
  | 'resourceList'
  | 'policyList'
  | 'gradeBreakdown';

/** Inner content a block or ring may carry — exactly one, never both. */
export interface ArtInner {
  /** Text content. */
  tx?:   string;
  /** Icon name from ICONS. */
  ic?:   keyof typeof ICONS;
  /** Font size (text) or box size (icon), px at card scale. */
  s:     number;
  /** Alpha 0–1. Applied as a color, not as opacity. */
  o:     number;
  /** Font weight. */
  b?:    number;
  /** Render as monospace (numbers, times, money). */
  mono?: boolean | 1;
  /** Paint a filled disc behind the text — the donut's punched hole. */
  hole?: boolean | number;
  tr?:   number;
  up?:   boolean | 1;
}

export interface ArtLeaf {
  /** Block width: '30%' or px. */
  w?:      string | number;
  /** Block height in px. */
  h?:      number;
  /** Alpha 0–1. */
  o?:      number;
  /** Corner radius px; 999 for a pill. */
  r?:      number;
  inner?:  ArtInner;
  flex?:   number;
  /** Ring outer diameter px. */
  ring?:   number;
  /** Ring / donut stroke thickness px. */
  th?:     number;
  /** Donut outer diameter px. */
  pie?:    number;
  /** Donut hole diameter px. */
  hole?:   number;
  /** Donut slices: p = percent of the circle, o = alpha. */
  slices?: Array<{ p: number; o: number }>;
  /** Text leaf content. */
  text?:   string;
  /** Text size px. */
  s?:      number;
  /** Font weight. */
  b?:      number;
  /** Letter spacing em. */
  tr?:     number;
  // Written as `up: 1` throughout, matching ArtGroup's `wrap?: 1` — the specs
  // are dense enough that a one-character flag earns its keep. Typed to accept
  // either spelling; the renderer only ever tests truthiness.
  up?:     boolean | 1;
  mono?:   boolean | 1;
  /** Right-align the text inside its width. */
  right?:  boolean | 1;
}

export interface ArtGroup {
  dir:   'row' | 'col';
  gap:   number;
  kids:  Array<ArtLeaf | ArtGroup>;
  flex?: number;
  w?:    string;
  h?:    string;
  /** align-items */
  a?:    string;
  /** justify-content */
  j?:    string;
  wrap?: 1;
  /** Alpha of a background fill — makes the group a surface (the recipe card). */
  bg?:   number;
  /** Radius px, with bg. */
  r?:    number;
  /** CSS padding shorthand, with bg. */
  pad?:  string;
}

export interface ArtRoot { dir: 'row' | 'col'; gap: number; groups: ArtGroup[] }

export interface Graphic {
  id:      ArtId;
  /** Category the graphic was tuned against — informational. */
  cat:     string;
  /** Widget labels using it — informational; WIDGET_ART is the real mapping. */
  widgets: string[];
  root:    ArtRoot;
}

const b = (w?: string | number, h?: number, o?: number, r?: number, inner?: ArtInner, flex?: number): ArtLeaf => ({ w, h, o, r: r === undefined ? 3 : r, inner, flex });
const ring = (size: number, th: number, o: number, inner?: ArtInner): ArtLeaf => ({ ring: size, th, o, inner });
// A real sliced donut: conic-gradient of one hue at stepped alphas, with a
// punched hole (an inner disc painted the tile colour) rather than a mask, so
// the centred value stays visible.
const pie = (size: number, hole: number, slices: Array<{ p: number; o: number }>, inner?: ArtInner): ArtLeaf => ({ pie: size, hole, slices, inner });
const t = (text: string, size: number, o: number, x?: Partial<ArtLeaf>): ArtLeaf => Object.assign({ text: text, s: size, o }, x || {}) as ArtLeaf;
const G = (dir: 'row' | 'col', gap: number, kids: Array<ArtLeaf | ArtGroup>, x?: Partial<ArtGroup>): ArtGroup => Object.assign({ dir, gap, kids }, x || {}) as ArtGroup;
const R = (dir: 'row' | 'col', gap: number, groups: ArtGroup[]): ArtRoot => ({ dir, gap, groups });
const cells = (n: number, w: string, h: number, ops: number[], r?: number): ArtLeaf[] => {
  const out: ArtLeaf[] = [];
  for (let i = 0; i < n; i++) out.push(b(w, h, ops[i % ops.length], r));
  return out;
};

// Icon paths reuse the app's canon where one exists (plus, check); the rest are
// the same 24×24 stroked vocabulary so nothing looks foreign next to them.
export const ICONS: Record<string, string[]> = {
  person:   ['M12 11.4a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2', 'M4.9 20.4c0-3.6 3.2-5.9 7.1-5.9s7.1 2.3 7.1 5.9'],
  check:    ['M5 12.5l4.6 4.5L19.6 6.6'],
  plus:     ['M12 5v14M5 12h14'],
  clock:    ['M12 21a9 9 0 100-18 9 9 0 000 18', 'M12 7.4v5l3.2 2'],
  bookmark: ['M6.6 3.6h10.8v16.8L12 16.4l-5.4 4z'],
  file:     ['M14 3.6H7.2a1.8 1.8 0 00-1.8 1.8v13.2a1.8 1.8 0 001.8 1.8h9.6a1.8 1.8 0 001.8-1.8V8.4z', 'M14 3.6v4.8h4.6'],
  link:     ['M9.6 14.4l4.8-4.8', 'M12.9 7.1l1.5-1.5a3.6 3.6 0 015.1 5.1l-1.5 1.5', 'M11.1 16.9l-1.5 1.5a3.6 3.6 0 01-5.1-5.1l1.5-1.5'],
};

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const GRAPHICS: Graphic[] = [
  // ── General ───────────────────────────────────────────────────────────────
  {
    id: 'tableRecords', cat: 'General', widgets: ['Record Table'],
    root: R('col', 5, [
      G('row', 5, [t('TITLE', 7, .40, { b: 700, tr: .12, up: 1, w: '30%' }), t('STATUS', 7, .40, { b: 700, tr: .12, up: 1, w: '34%' }), t('UPDATED', 7, .40, { b: 700, tr: .12, up: 1, w: '26%' })], { a: 'center' }),
      G('row', 5, [b('30%', 7, .16), b('34%', 7, .10), b('26%', 7, .10)]),
      G('row', 5, [b('30%', 7, .16), b('34%', 7, .10), b('26%', 7, .10)]),
      G('row', 5, [b('30%', 7, .16), b('34%', 7, .10), b('26%', 7, .10)]),
      G('row', 5, [b('30%', 7, .16), b('34%', 7, .10), b('26%', 7, .10)]),
    ]),
  },
  {
    id: 'tableGrid', cat: 'General', widgets: ['Data Table'],
    root: R('col', 4, [
      G('row', 4, [b('8%', 8, .28), b('26%', 8, .28), b('30%', 8, .28), b('22%', 8, .28)]),
      G('row', 4, [b('8%', 7, .10), b('26%', 7, .13), b('30%', 7, .10), b('22%', 7, .10)]),
      G('row', 4, [b('8%', 7, .10), b('26%', 7, .13), b('30%', 7, .10), b('22%', 7, .10)]),
      G('row', 4, [b('8%', 7, .10), b('26%', 7, .13), b('30%', 7, .10), b('22%', 7, .10)]),
      G('row', 4, [b('8%', 7, .05), b('26%', 7, .06), b('30%', 7, .05), b('22%', 7, .05)]),
    ]),
  },
  {
    id: 'checkRows', cat: 'General', widgets: ['Checklist'],
    root: R('col', 7, [
      G('row', 8, [b(12, 12, .42, 3, { ic: 'check', s: 8, o: .9 }), b('72%', 8, .09)], { a: 'center' }),
      G('row', 8, [b(12, 12, .42, 3, { ic: 'check', s: 8, o: .9 }), b('60%', 8, .09)], { a: 'center' }),
      G('row', 8, [b(12, 12, .16, 3), b('80%', 8, .15)], { a: 'center' }),
      G('row', 8, [b(12, 12, .16, 3), b('68%', 8, .15)], { a: 'center' }),
      G('row', 8, [b(12, 12, .16, 3), b('76%', 8, .15)], { a: 'center' }),
    ]),
  },

  // ── Nutrition ─────────────────────────────────────────────────────────────
  {
    id: 'groceryQty', cat: 'Nutrition', widgets: ['Grocery List'],
    root: R('col', 7, [
      G('row', 7, [b(12, 12, .16, 3), t('2 lbs', 8, .42, { b: 700 }), b('48%', 8, .15)], { a: 'center' }),
      G('row', 7, [b(12, 12, .16, 3), t('1 cup', 8, .42, { b: 700 }), b('40%', 8, .15)], { a: 'center' }),
      G('row', 7, [b(12, 12, .42, 3, { ic: 'check', s: 8, o: .9 }), t('3 ea', 8, .20, { b: 700 }), b('34%', 8, .09)], { a: 'center' }),
      G('row', 7, [b(12, 12, .16, 3), t('500 g', 8, .42, { b: 700 }), b('52%', 8, .15)], { a: 'center' }),
      G('row', 7, [b(12, 12, .16, 3), t('2 tbsp', 8, .42, { b: 700 }), b('34%', 8, .15)], { a: 'center' }),
    ]),
  },
  {
    id: 'tableChips', cat: 'Nutrition', widgets: ['Recipe List', 'Meeting Log'],
    root: R('col', 6, [
      G('row', 6, [b('36%', 8, .30), b('22%', 8, .30), b('26%', 8, .30)]),
      G('row', 6, [b('36%', 7, .16), b('20%', 9, .22, 999), b('16%', 9, .14, 999)], { a: 'center' }),
      G('row', 6, [b('30%', 7, .16), b('22%', 9, .22, 999), b('18%', 9, .14, 999)], { a: 'center' }),
      G('row', 6, [b('34%', 7, .16), b('18%', 9, .22, 999), b('14%', 9, .14, 999)], { a: 'center' }),
      G('row', 6, [b('28%', 7, .16), b('21%', 9, .22, 999), b('17%', 9, .14, 999)], { a: 'center' }),
    ]),
  },
  {
    id: 'cardPeel', cat: 'Nutrition', widgets: ['Recipe Box'],
    root: R('col', 3, [
      G('row', 0, [b('74%', 6, .08, 6)], { j: 'center' }),
      G('row', 0, [b('87%', 6, .13, 6)], { j: 'center' }),
      G('col', 0, [
        G('col', 5, [
          b('38%', 12, .30, 999, { tx: 'BREAKFAST', s: 6, o: .95, b: 700, tr: .1, up: 1 }),
          t('Crepes', 15, .82, { b: 700, tr: -.02 }),
        ], { a: 'flex-start', w: '100%' }),
        t('20 min', 7, .46, { b: 600 }),
      ], { flex: 1, h: '100%', j: 'space-between', a: 'flex-start', bg: .17, r: 8, pad: '9px 10px' }),
    ]),
  },
  {
    id: 'weekSlots', cat: 'Nutrition', widgets: ['Meal Planner'],
    root: R('col', 5, [
      G('row', 4, DAYS.map((d, i) => t(d, 8, i > 4 ? .22 : .40, { b: 700, tr: .1, flex: 1 })), { a: 'center' }),
      G('row', 4, [b('13%', 19, .30, 4), b('13%', 19, .10, 4), b('13%', 19, .30, 4), b('13%', 19, .10, 4), b('13%', 19, .10, 4), b('13%', 19, .30, 4), b('13%', 19, .08, 4)]),
      G('row', 4, [b('13%', 19, .10, 4), b('13%', 19, .30, 4), b('13%', 19, .10, 4), b('13%', 19, .30, 4), b('13%', 19, .10, 4), b('13%', 19, .08, 4), b('13%', 19, .08, 4)]),
      G('row', 4, [b('13%', 19, .30, 4), b('13%', 19, .10, 4), b('13%', 19, .10, 4), b('13%', 19, .10, 4), b('13%', 19, .30, 4), b('13%', 19, .08, 4), b('13%', 19, .08, 4)]),
    ]),
  },

  // ── Productivity ──────────────────────────────────────────────────────────
  {
    id: 'focusHero', cat: 'Productivity', widgets: ['Task Manager'],
    root: R('row', 14, [
      G('col', 0, [ring(62, 8, .30, { tx: '25:00', s: 12, o: .62, b: 700, mono: 1 })], { w: '34%', a: 'center', j: 'center' }),
      G('col', 7, [t('TASK MANAGER', 7, .40, { b: 700, tr: .14, up: 1 }), b('80%', 13, .32, 4), b('96%', 7, .12), b('68%', 7, .12)], { flex: 1, j: 'center' }),
    ]),
  },
  {
    // A time gutter, a coloured origin dot, then the event — the three columns
    // My Day actually renders, with the all-day group under its own rule.
    id: 'agendaDay', cat: 'Productivity', widgets: ['My Day'],
    root: R('col', 6, [
      G('row', 7, [t('9:00', 8, .30, { b: 600 }), b('8px', 8, .55, 4), b('100%', 9, .26, 3)], { a: 'center' }),
      G('row', 7, [t('11:30', 8, .30, { b: 600 }), b('8px', 8, .40, 4), b('82%', 9, .20, 3)], { a: 'center' }),
      G('row', 7, [t('2:00', 8, .30, { b: 600 }), b('8px', 8, .48, 4), b('94%', 9, .22, 3)], { a: 'center' }),
      G('row', 0, [b('100%', 1, .10)]),
      G('row', 7, [t('Due', 8, .22, { b: 600 }), b('8px', 8, .34, 4), b('70%', 9, .16, 3)], { a: 'center' }),
      G('row', 7, [t('Meal', 8, .22, { b: 600 }), b('8px', 8, .30, 4), b('60%', 9, .14, 3)], { a: 'center' }),
    ]),
  },
  {
    id: 'dayStrip', cat: 'Productivity', widgets: ['Calendar'],
    root: R('row', 5, [
      G('col', 4, [t('M', 8, .34, { b: 700 }), t('12', 11, .44, { b: 600 }), b('100%', 11, .10, 3), b('80%', 8, .07, 3)], { flex: 1, a: 'stretch' }),
      G('col', 4, [t('T', 8, .34, { b: 700 }), t('13', 11, .44, { b: 600 }), b('100%', 11, .10, 3), b('60%', 8, .07, 3)], { flex: 1, a: 'stretch' }),
      G('col', 4, [t('W', 8, .52, { b: 700 }), t('14', 11, .72, { b: 700 }), b('100%', 11, .30, 3), b('90%', 8, .16, 3)], { flex: 1, a: 'stretch' }),
      G('col', 4, [t('T', 8, .34, { b: 700 }), t('15', 11, .44, { b: 600 }), b('100%', 11, .10, 3), b('70%', 8, .07, 3)], { flex: 1, a: 'stretch' }),
      G('col', 4, [t('F', 8, .34, { b: 700 }), t('16', 11, .44, { b: 600 }), b('100%', 11, .10, 3), b('50%', 8, .07, 3)], { flex: 1, a: 'stretch' }),
      G('col', 4, [t('S', 8, .20, { b: 700 }), t('17', 11, .24, { b: 600 }), b('100%', 11, .07, 3)], { flex: 1, a: 'stretch' }),
      G('col', 4, [t('S', 8, .20, { b: 700 }), t('18', 11, .24, { b: 600 }), b('100%', 11, .07, 3)], { flex: 1, a: 'stretch' }),
    ]),
  },
  {
    id: 'buckets', cat: 'Productivity', widgets: ['Kanban Board'],
    root: R('row', 7, [
      G('col', 5, [t('TODO', 7, .48, { b: 700, tr: .12, up: 1 }), b('100%', 21, .15, 6), b('100%', 21, .11, 6), b('100%', 15, .08, 6)], { flex: 1, a: 'stretch' }),
      G('col', 5, [t('DOING', 7, .38, { b: 700, tr: .12, up: 1 }), b('100%', 21, .13, 6), b('100%', 15, .09, 6)], { flex: 1, a: 'stretch' }),
      G('col', 5, [t('DONE', 7, .28, { b: 700, tr: .12, up: 1 }), b('100%', 21, .11, 6), b('100%', 21, .08, 6), b('100%', 15, .06, 6)], { flex: 1, a: 'stretch' }),
    ]),
  },
  {
    id: 'tabbedList', cat: 'Productivity', widgets: ['TODO List'],
    root: R('col', 8, [
      G('row', 5, [
        b('30%', 14, .30, 4, { tx: 'TODO', s: 6, o: .95, b: 700, tr: .12, up: 1 }),
        b('30%', 14, .12, 4, { tx: 'DOING', s: 6, o: .8, b: 700, tr: .12, up: 1 }),
        b('28%', 14, .10, 4, { tx: 'DONE', s: 6, o: .7, b: 700, tr: .12, up: 1 }),
      ]),
      G('row', 8, [b(11, 11, .40, 3, { ic: 'check', s: 7, o: .9 }), b('66%', 8, .09)], { a: 'center' }),
      G('row', 8, [b(11, 11, .16, 3), b('76%', 8, .15)], { a: 'center' }),
      G('row', 8, [b(11, 11, .16, 3), b('62%', 8, .15)], { a: 'center' }),
      G('row', 8, [b(11, 11, .16, 3), b('70%', 8, .15)], { a: 'center' }),
    ]),
  },
  {
    id: 'stepList', cat: 'Productivity', widgets: ['Process Notes'],
    root: R('col', 7, [
      G('row', 0, [b('50%', 10, .30)]),
      G('row', 9, [b(14, 14, .26, 999, { tx: '1', s: 8, o: .85, b: 700 }), b('66%', 7, .14)], { a: 'center' }),
      G('row', 9, [b(14, 14, .20, 999, { tx: '2', s: 8, o: .8, b: 700 }), b('58%', 7, .12)], { a: 'center' }),
      G('row', 9, [b(14, 14, .16, 999, { tx: '3', s: 8, o: .75, b: 700 }), b('70%', 7, .12)], { a: 'center' }),
      G('row', 9, [b(14, 14, .12, 999, { tx: '4', s: 8, o: .7, b: 700 }), b('50%', 7, .10)], { a: 'center' }),
    ]),
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    id: 'statBand', cat: 'Finance', widgets: ['Year Review', 'Month Review'],
    root: R('row', 9, [
      G('col', 6, [t('INCOME', 7, .40, { b: 700, tr: .12, up: 1 }), b('88%', 19, .30, 4)], { flex: 1, j: 'center', a: 'stretch' }),
      G('col', 6, [t('SPENT', 7, .40, { b: 700, tr: .12, up: 1 }), b('80%', 19, .24, 4)], { flex: 1, j: 'center', a: 'stretch' }),
      G('col', 6, [t('SAVED', 7, .40, { b: 700, tr: .12, up: 1 }), b('92%', 19, .30, 4)], { flex: 1, j: 'center', a: 'stretch' }),
      G('col', 6, [t('RATE', 7, .40, { b: 700, tr: .12, up: 1 }), t('24%', 17, .60, { b: 700, mono: 1 })], { flex: 1, j: 'center', a: 'stretch' }),
    ]),
  },
  {
    id: 'donutLegend', cat: 'Finance', widgets: ['Categorized Pie Chart'],
    root: R('row', 10, [
      G('col', 0, [pie(84, 46, [
        { p: 31, o: .46 }, { p: 23, o: .34 }, { p: 17, o: .25 },
        { p: 13, o: .17 }, { p: 9, o: .11 }, { p: 7, o: .07 },
      ], { tx: '$4.2k', s: 11, o: .60, b: 700, mono: 1, hole: 1 })], { w: '40%', a: 'center', j: 'center' }),
      G('col', 9, [
        G('row', 6, [b(13, 2, .40), b(7, 7, .46, 999), b('58%', 7, .18)], { a: 'center' }),
        G('row', 6, [b(11, 2, .30), b(7, 7, .34, 999), b('46%', 7, .15)], { a: 'center' }),
        G('row', 6, [b(13, 2, .22), b(7, 7, .25, 999), b('52%', 7, .13)], { a: 'center' }),
        G('row', 6, [b(11, 2, .15), b(7, 7, .17, 999), b('38%', 7, .11)], { a: 'center' }),
      ], { flex: 1, j: 'center', a: 'stretch' }),
    ]),
  },
  {
    id: 'pairedBars', cat: 'Finance', widgets: ['Expense Vs Income'],
    root: R('col', 6, [
      G('row', 5, [b('7%', 32, .30, 4), b('7%', 46, .13, 4), b('7%', 22, .30, 4), b('7%', 58, .13, 4), b('7%', 44, .30, 4), b('7%', 30, .13, 4), b('7%', 52, .30, 4), b('7%', 26, .13, 4), b('7%', 38, .30, 4), b('7%', 48, .13, 4)], { a: 'flex-end', flex: 1, h: '100%' }),
      G('row', 12, [t('IN', 7, .38, { b: 700, tr: .14, up: 1 }), t('OUT', 7, .22, { b: 700, tr: .14, up: 1 })], { a: 'center' }),
    ]),
  },
  {
    id: 'dateRange', cat: 'Finance', widgets: ['Time Period'],
    root: R('col', 8, [
      G('row', 0, [t('TIME PERIOD', 7, .38, { b: 700, tr: .16, up: 1 })], { j: 'center' }),
      G('row', 9, [t('‹', 9, .30, { b: 600 }), t('2026', 11, .52, { b: 600 }), t('›', 9, .30, { b: 600 })], { a: 'center', j: 'center' }),
      G('row', 9, [
        t('‹', 10, .34, { b: 600 }),
        G('row', 2, [t('AUGUST', 18, .78, { b: 700, tr: -.01 }), b(4, 4, .95, 999)], { a: 'flex-end', w: 'auto' }),
        t('›', 10, .34, { b: 600 }),
      ], { a: 'center', j: 'center' }),
    ]),
  },
  {
    id: 'ledgerEntry', cat: 'Finance', widgets: ['Income & Expense Tracker'],
    root: R('col', 6, [
      G('row', 5, [b('100%', 16, .10, 4, undefined, 1), b(16, 16, .30, 4, { ic: 'plus', s: 10, o: .9 })], { a: 'center' }),
      G('row', 7, [t('MAR 4', 7, .34, { b: 700, tr: .1, up: 1, w: '19%' }), b('34%', 7, .13, 3, undefined, 1), t('+$820', 9, .58, { b: 700, mono: 1, w: '26%', right: 1 })], { a: 'center' }),
      G('row', 7, [t('MAR 3', 7, .26, { b: 700, tr: .1, up: 1, w: '19%' }), b('30%', 7, .13, 3, undefined, 1), t('−$14.20', 9, .40, { b: 700, mono: 1, w: '26%', right: 1 })], { a: 'center' }),
      G('row', 7, [t('MAR 1', 7, .34, { b: 700, tr: .1, up: 1, w: '19%' }), b('38%', 7, .13, 3, undefined, 1), t('−$62.50', 9, .40, { b: 700, mono: 1, w: '26%', right: 1 })], { a: 'center' }),
      G('row', 7, [t('FEB 28', 7, .26, { b: 700, tr: .1, up: 1, w: '19%' }), b('26%', 7, .13, 3, undefined, 1), t('−$9.99', 9, .40, { b: 700, mono: 1, w: '26%', right: 1 })], { a: 'center' }),
    ]),
  },
  {
    id: 'recurringRows', cat: 'Finance', widgets: ['Recurring Items'],
    root: R('col', 8, [
      G('row', 8, [b(8, 8, .30, 999), b('30%', 7, .16), t('MONTHLY', 7, .32, { b: 700, tr: .1, up: 1, flex: 1 }), t('$14.99', 9, .52, { b: 700, mono: 1, w: '24%', right: 1 })], { a: 'center' }),
      G('row', 8, [b(8, 8, .24, 999), b('24%', 7, .16), t('WEEKLY', 7, .26, { b: 700, tr: .1, up: 1, flex: 1 }), t('$8.50', 9, .42, { b: 700, mono: 1, w: '24%', right: 1 })], { a: 'center' }),
      G('row', 8, [b(8, 8, .20, 999), b('32%', 7, .16), t('YEARLY', 7, .26, { b: 700, tr: .1, up: 1, flex: 1 }), t('$120', 9, .42, { b: 700, mono: 1, w: '24%', right: 1 })], { a: 'center' }),
      G('row', 8, [b(8, 8, .16, 999), b('26%', 7, .16), t('MONTHLY', 7, .22, { b: 700, tr: .1, up: 1, flex: 1 }), t('$32.00', 9, .38, { b: 700, mono: 1, w: '24%', right: 1 })], { a: 'center' }),
    ]),
  },

  // ── Learning ──────────────────────────────────────────────────────────────
  {
    id: 'artBanner', cat: 'Learning', widgets: ['Art & Quote'],
    root: R('row', 14, [
      G('col', 0, [b('100%', 84, .26, 10)], { w: '38%' }),
      G('col', 7, [b('94%', 9, .26), b('86%', 9, .16), b('90%', 9, .16), t('— ATTRIBUTION', 7, .34, { b: 700, tr: .12, up: 1 })], { flex: 1, j: 'center', a: 'stretch' }),
    ]),
  },
  {
    id: 'passage', cat: 'Learning', widgets: ['French Reading'],
    root: R('col', 7, [
      G('row', 0, [t('LECTURE DU JOUR', 7, .44, { b: 700, tr: .14, up: 1 })]),
      G('row', 0, [b('96%', 7, .13)]),
      G('row', 0, [b('90%', 7, .13)]),
      G('row', 0, [b('94%', 7, .13)]),
      G('row', 0, [b('72%', 7, .13)]),
      G('row', 0, [b('88%', 7, .13)]),
      G('row', 0, [b('40%', 7, .13)]),
    ]),
  },
  {
    id: 'flashCard', cat: 'Learning', widgets: ['French Flash Cards'],
    root: R('col', 9, [
      G('row', 0, [b('74%', 58, .18, 10, { tx: 'le mot', s: 13, o: .55, b: 600 })], { j: 'center' }),
      G('row', 8, [t('AGAIN', 7, .30, { b: 700, tr: .12, up: 1 }), t('GOOD', 7, .48, { b: 700, tr: .12, up: 1 })], { j: 'center', a: 'center' }),
    ]),
  },
  {
    id: 'linkCard', cat: 'Learning', widgets: ['Bookmark Revival'],
    root: R('row', 12, [
      G('col', 0, [b('100%', 50, .18, 6, { ic: 'bookmark', s: 20, o: .55 })], { w: '24%', j: 'center' }),
      G('col', 7, [b('86%', 9, .28), b('64%', 7, .13), t('SAVED 8 MO AGO', 7, .32, { b: 700, tr: .1, up: 1 })], { flex: 1, j: 'center', a: 'stretch' }),
    ]),
  },

  // ── Capture ───────────────────────────────────────────────────────────────
  {
    id: 'scratchPad', cat: 'Capture', widgets: ['Brain Dump'],
    root: R('col', 8, [
      G('row', 0, [b('100%', 18, .11, 4)]),
      G('row', 0, [b('82%', 7, .14)]),
      G('row', 0, [b('58%', 7, .14)]),
      G('row', 0, [b('92%', 7, .14)]),
      G('row', 0, [b('44%', 7, .14)]),
      G('row', 0, [b('70%', 7, .14)]),
    ]),
  },

  // ── Education ─────────────────────────────────────────────────────────────
  {
    id: 'gradeGauges', cat: 'Education', widgets: ['My Classes'],
    root: R('row', 10, [
      G('col', 6, [b('90%', 11, .20, 999, { tx: 'BIO 201', s: 6, o: .95, b: 700, tr: .08, up: 1 }), ring(38, 6, .32, { tx: '92', s: 11, o: .62, b: 700, mono: 1 }), b('76%', 6, .16)], { flex: 1, a: 'center' }),
      G('col', 6, [b('90%', 11, .16, 999, { tx: 'MATH 140', s: 6, o: .9, b: 700, tr: .08, up: 1 }), ring(38, 6, .24, { tx: '84', s: 11, o: .52, b: 700, mono: 1 }), b('66%', 6, .13)], { flex: 1, a: 'center' }),
      G('col', 6, [b('90%', 11, .13, 999, { tx: 'HIST 210', s: 6, o: .85, b: 700, tr: .08, up: 1 }), ring(38, 6, .18, { tx: '71', s: 11, o: .44, b: 700, mono: 1 }), b('72%', 6, .11)], { flex: 1, a: 'center' }),
    ]),
  },
  {
    id: 'contactRows', cat: 'Education', widgets: ['My Teachers'],
    root: R('col', 10, [
      G('row', 10, [b(24, 24, .20, 999, { ic: 'person', s: 15, o: .6 }), b('38%', 8, .26), b('22%', 7, .12)], { a: 'center' }),
      G('row', 10, [b(24, 24, .16, 999, { ic: 'person', s: 15, o: .5 }), b('32%', 8, .22), b('26%', 7, .12)], { a: 'center' }),
      G('row', 10, [b(24, 24, .13, 999, { ic: 'person', s: 15, o: .45 }), b('42%', 8, .18), b('18%', 7, .12)], { a: 'center' }),
    ]),
  },
  {
    id: 'scheduleGrid', cat: 'Education', widgets: ['Class Scheduler'],
    root: R('col', 5, [
      G('row', 4, ['M', 'T', 'W', 'T', 'F'].map(d => t(d, 8, .40, { b: 700, tr: .1, flex: 1 })), { a: 'center' }),
      G('row', 4, [b('19%', 16, 0), b('19%', 16, .30, 4), b('19%', 16, 0), b('19%', 16, .14, 4), b('19%', 16, 0)]),
      G('row', 4, [b('19%', 16, .22, 4), b('19%', 16, 0), b('19%', 16, .30, 4), b('19%', 16, 0), b('19%', 16, .14, 4)]),
      G('row', 4, [b('19%', 16, 0), b('19%', 16, .14, 4), b('19%', 16, 0), b('19%', 16, .30, 4), b('19%', 16, .22, 4)]),
    ]),
  },

  // ── Class Page ────────────────────────────────────────────────────────────
  // These seven never appear in the main library — CATEGORY_ORDER excludes
  // 'Class Page', and that exclusion is what keeps them out. Class Fullscreen's
  // own picker lists them, using the same cards with sectioning off.
  {
    id: 'noteCards', cat: 'Class Page', widgets: ['Recent Notes'],
    root: R('col', 7, [
      G('row', 7, [b('100%', 12, .09, 4, undefined, 1), b(12, 12, .24, 4, { ic: 'plus', s: 8, o: .9 })], { a: 'center' }),
      G('row', 6, [
        G('col', 0, [b('74%', 7, .30), t('Today', 6, .24, { b: 600 })], { flex: 1, h: '100%', j: 'space-between', bg: .14, r: 6, pad: '7px 8px' }),
        G('col', 0, [b('62%', 7, .24), t('Yesterday', 6, .20, { b: 600 })], { flex: 1, h: '100%', j: 'space-between', bg: .11, r: 6, pad: '7px 8px' }),
      ], { flex: 1, h: '100%' }),
      G('row', 6, [
        G('col', 0, [b('68%', 7, .20), t('Last week', 6, .16, { b: 600 })], { flex: 1, h: '100%', j: 'space-between', bg: .09, r: 6, pad: '7px 8px' }),
        G('col', 0, [b('56%', 7, .20), t('Last week', 6, .16, { b: 600 })], { flex: 1, h: '100%', j: 'space-between', bg: .09, r: 6, pad: '7px 8px' }),
      ], { flex: 1, h: '100%' }),
    ]),
  },
  {
    // A LIST, not a week grid, on purpose: this widget mixes classes, reminders
    // and exam dates, so it must not read like scheduleGrid.
    id: 'classCalendar', cat: 'Class Page', widgets: ['Class Calendar'],
    root: R('col', 9, [
      G('row', 8, [
        G('col', 1, [t('MON', 6, .24, { b: 700, tr: .08 }), t('3', 10, .42, { b: 700 })], { w: '13%', a: 'flex-end' }),
        b(6, 6, .52, 999),
        G('col', 3, [t('BIO-201', 8, .44, { b: 700 }), b('40%', 6, .16)], { flex: 1 }),
      ], { a: 'center' }),
      G('row', 8, [
        G('col', 1, [t('WED', 6, .20, { b: 700, tr: .08 }), t('5', 10, .36, { b: 700 })], { w: '13%', a: 'flex-end' }),
        b(6, 6, .40, 999),
        G('col', 3, [t('MATH-140', 8, .40, { b: 700 }), b('34%', 6, .14)], { flex: 1 }),
      ], { a: 'center' }),
      G('row', 8, [
        G('col', 1, [t('FRI', 6, .18, { b: 700, tr: .08 }), t('7', 10, .30, { b: 700 })], { w: '13%', a: 'flex-end' }),
        b(6, 6, .30, 999),
        G('col', 3, [t('BIO-201', 8, .32, { b: 700 }), b('34%', 6, .12)], { flex: 1 }),
      ], { a: 'center' }),
      G('row', 8, [
        G('col', 1, [t('MON', 6, .14, { b: 700, tr: .08 }), t('10', 10, .24, { b: 700 })], { w: '13%', a: 'flex-end' }),
        b(6, 6, .22, 999),
        G('col', 3, [t('BIO-201', 8, .24, { b: 700 }), b('30%', 6, .10)], { flex: 1 }),
      ], { a: 'center' }),
    ]),
  },
  {
    id: 'assignmentRows', cat: 'Class Page', widgets: ['Assignments & Grades'],
    root: R('col', 8, [
      G('row', 7, [
        b('26%', 13, .15, 999, { tx: 'NOT STARTED', s: 5, o: .8, b: 700, tr: .06, up: 1 }),
        G('col', 3, [b('82%', 7, .26), t('worth 30%', 6, .24, { b: 600 })], { flex: 1 }),
        b('15%', 13, .09, 4),
      ], { a: 'center' }),
      G('row', 7, [
        b('26%', 13, .12, 999, { tx: 'COMPLETED', s: 5, o: .72, b: 700, tr: .06, up: 1 }),
        G('col', 3, [b('68%', 7, .20), t('worth 20%', 6, .20, { b: 600 })], { flex: 1 }),
        b('15%', 13, .09, 4),
      ], { a: 'center' }),
      G('row', 7, [
        b('26%', 13, .10, 999, { tx: 'NOT STARTED', s: 5, o: .66, b: 700, tr: .06, up: 1 }),
        G('col', 3, [b('54%', 7, .16), t('worth 30%', 6, .18, { b: 600 })], { flex: 1 }),
        b('15%', 13, .09, 4),
      ], { a: 'center' }),
    ]),
  },
  {
    // Deliberately distinct from tabbedList — no tabs. A class already scopes it.
    id: 'taskCard', cat: 'Class Page', widgets: ['Class Tasks'],
    root: R('col', 9, [
      G('row', 8, [b(12, 12, .40, 3, { ic: 'check', s: 8, o: .9 }), b('62%', 7, .22)], { a: 'center', bg: .07, r: 5, pad: '8px 9px' }),
      G('row', 8, [b(12, 12, .16, 3), b('48%', 7, .18)], { a: 'center', bg: .07, r: 5, pad: '8px 9px' }),
      G('row', 8, [b(12, 12, .16, 3), b('56%', 7, .14)], { a: 'center', bg: .07, r: 5, pad: '8px 9px' }),
      G('row', 0, [t('+ Add task', 8, .40, { b: 700 })], { j: 'center' }),
    ]),
  },
  {
    id: 'resourceList', cat: 'Class Page', widgets: ['Resources'],
    root: R('col', 7, [
      G('row', 8, [
        b(17, 17, .20, 4, { ic: 'file', s: 10, o: .6 }),
        G('col', 3, [b('44%', 7, .30), b('26%', 6, .14)], { flex: 1 }),
      ], { a: 'center', bg: .10, r: 5, pad: '7px 8px' }),
      G('row', 8, [
        b(17, 17, .15, 4, { ic: 'link', s: 10, o: .5 }),
        G('col', 3, [b('62%', 7, .22), b('30%', 6, .10)], { flex: 1 }),
      ], { a: 'center', pad: '7px 8px' }),
      G('row', 8, [
        b(17, 17, .12, 4, { ic: 'file', s: 10, o: .45 }),
        G('col', 3, [b('52%', 7, .18), b('30%', 6, .09)], { flex: 1 }),
      ], { a: 'center', pad: '7px 8px' }),
    ]),
  },
  {
    id: 'policyList', cat: 'Class Page', widgets: ['Class Policies'],
    root: R('col', 10, [
      G('row', 9, [
        t('1', 9, .48, { b: 700, w: '5%' }),
        G('col', 4, [b('100%', 7, .20), b('92%', 7, .20), b('58%', 7, .20)], { flex: 1 }),
      ], { a: 'flex-start' }),
      G('row', 9, [
        t('2', 9, .34, { b: 700, w: '5%' }),
        G('col', 4, [b('100%', 7, .14), b('86%', 7, .14), b('44%', 7, .14)], { flex: 1 }),
      ], { a: 'flex-start' }),
    ]),
  },
  {
    id: 'gradeBreakdown', cat: 'Class Page', widgets: ['Grade Breakdown'],
    root: R('col', 6, [
      G('row', 7, [b('56%', 7, .28, 3, undefined, 1), t('worth 30%', 6, .34, { b: 600, w: '26%', right: 1 })], { a: 'center' }),
      G('row', 0, [b('100%', 1, .10)]),
      G('row', 7, [b('40%', 7, .22, 3, undefined, 1), t('worth 30%', 6, .28, { b: 600, w: '26%', right: 1 })], { a: 'center' }),
      G('row', 0, [b('100%', 1, .10)]),
      G('row', 7, [b('62%', 7, .18, 3, undefined, 1), t('worth 20%', 6, .24, { b: 600, w: '26%', right: 1 })], { a: 'center' }),
      G('row', 0, [b('100%', 1, .10)]),
      G('row', 7, [b('48%', 7, .14, 3, undefined, 1), t('worth 20%', 6, .20, { b: 600, w: '26%', right: 1 })], { a: 'center' }),
    ]),
  },
];

export const graphicsById: Record<string, Graphic> =
  Object.fromEntries(GRAPHICS.map(g => [g.id, g])) as Record<string, Graphic>;

/**
 * widget id → graphic id. This is the mapping registry.ts should read; the
 * `widgets` label list on each graphic is documentation, not lookup.
 *
 * Two graphics are shared on purpose: tableChips (Recipe List + Meeting Log)
 * and statBand (Year Review + Month Review), because those pairs genuinely are
 * the same shape. Everything else is 1:1.
 *
 * The seven Class Page entries never surface in the MAIN library —
 * CATEGORY_ORDER excludes 'Class Page' — but Class Fullscreen's own picker
 * renders the same cards, so they need graphics just the same.
 */
export const WIDGET_ART: Record<string, ArtId> = {
  'record-table':             'tableRecords',
  'data-table':               'tableGrid',
  'checklist':                'checkRows',
  'grocery-list':             'groceryQty',
  'recipe-list':              'tableChips',
  'meeting-log':              'tableChips',
  'recipe-box':               'cardPeel',
  'meal-planner':             'weekSlots',
  'task-manager':             'focusHero',
  'calendar-strip':           'dayStrip',
  'my-day':                   'agendaDay',
  'kanban':                   'buckets',
  'todo-list':                'tabbedList',
  'process-notes':            'stepList',
  'budget-stats-yearly':      'statBand',
  'budget-stats-monthly':     'statBand',
  'expense-donut':            'donutLegend',
  'income-expense-bar':       'pairedBars',
  'time-period':              'dateRange',
  'income-expense-tracker':   'ledgerEntry',
  'recurring-items':          'recurringRows',
  'art-quote-hero':           'artBanner',
  'french-reading':           'passage',
  'french-flashcards':        'flashCard',
  'bookmark-revival':         'linkCard',
  'brain-dump':               'scratchPad',
  'my-classes':               'gradeGauges',
  'my-teachers':              'contactRows',
  'class-scheduler':          'scheduleGrid',

  // Class Page — listed only by Class Fullscreen's own picker.
  'class-notes-widget':       'noteCards',
  'class-calendar-widget':    'classCalendar',
  'class-assignments-widget': 'assignmentRows',
  'class-todo-widget':        'taskCard',
  'class-resources-widget':   'resourceList',
  'class-policies-widget':    'policyList',
  'class-grade-widget':       'gradeBreakdown',
};
