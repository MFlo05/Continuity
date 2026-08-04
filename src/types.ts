/**
 * A widget id — either a preset id (widgets/presets.ts) or a component-backed
 * widget id (widgets/registry.ts).
 *
 * OPEN by design, as of Phase 4. This used to be a closed union of 32
 * literals, which meant adding any widget touched three files and made
 * data-driven presets impossible to express. `widgetRegistry` is now the one
 * source of truth for which ids exist; an unknown id renders as an empty shell
 * rather than failing to compile.
 *
 * The trade is deliberate: a typo in a widget id is no longer a compile error.
 * In exchange, a new preset is one array entry.
 */
export type WidgetType = string;

/** The ids that ship today, for reference — NOT exhaustive at runtime. */
export type KnownWidgetType =
  // ── General: raw renderers. The user picks the source and the columns at
  // setup time instead of getting a curated bundle. ──
  | 'record-table'
  | 'task-manager'
  | 'calendar-strip'
  | 'kanban'
  | 'meeting-log'
  | 'grocery-list'
  | 'recipe-box'
  | 'meal-planner'
  | 'process-notes'
  | 'budget-stats-yearly'
  | 'budget-stats-monthly'
  | 'expense-donut'
  | 'income-expense-bar'
  | 'income-expense-tracker'
  | 'time-period'
  | 'recurring-items'
  | 'art-quote-hero'
  | 'french-reading'
  | 'french-flashcards'
  | 'bookmark-revival'
  | 'brain-dump'
  | 'my-classes'
  | 'my-teachers'
  | 'class-scheduler'
  | 'todo-list'
  | 'class-notes-widget'
  | 'class-assignments-widget'
  | 'class-calendar-widget'
  | 'class-grade-widget'
  | 'class-resources-widget'
  | 'class-todo-widget'
  | 'class-policies-widget';

export interface LayoutItem {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

export interface PageLayout {
  id: string;
  label: string;
  items: LayoutItem[];
}

export interface MITState {
  task:            string;
  project?:        string;   // manual override; tag-derived shown separately
  estimateSecs:    number;
  startedAt:       number;   // unix ms — used to compute remaining live
  isPaused:        boolean;
  pausedRemaining: number;   // seconds remaining at pause moment
}
