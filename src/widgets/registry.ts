import { createElement, type ComponentType } from 'react';
import type { App } from 'obsidian';
import type { WidgetType } from '../types';
import type { Preset, SourcePickerConfig as CoreSourcePickerConfig } from '../core';
import { PRESETS } from './presets';
import { PresetHost } from './PresetHost';
import { PlaceholderWidget }      from './PlaceholderWidget';
import { TaskManagerWidget }      from './task-manager/TaskManagerWidget';
import { CalendarStripWidget }    from './calendar-strip/CalendarStripWidget';
import { MyDayWidget }            from './my-day/MyDayWidget';
import { KanbanWidget }           from './kanban/KanbanWidget';
import { RecipeBoxWidget }        from './recipe-box/RecipeBoxWidget';
import { MealPlannerWidget }      from './meal-planner/MealPlannerWidget';
import { IncomeExpenseTrackerWidget } from './income-expense/IncomeExpenseTrackerWidget';
import { MonthReviewWidget }      from './budget-review/MonthReviewWidget';
import { YearReviewWidget }       from './budget-review/YearReviewWidget';
import { ExpenseVsIncomeWidget }  from './budget-review/ExpenseVsIncomeWidget';
import { CategorizedPieChartWidget } from './budget-review/CategorizedPieChartWidget';
import { TimePeriodWidget }       from './budget-review/TimePeriodWidget';
import { RecurringItemsWidget }   from './recurring-items/RecurringItemsWidget';
import { MyClassesWidget }        from './my-classes/MyClassesWidget';
import { MyTeachersWidget }       from './my-teachers/MyTeachersWidget';
import { ClassSchedulerWidget }   from './class-scheduler/ClassSchedulerWidget';
import { TodoListWidget }         from './todo-list/TodoListWidget';
import { ClassNotesWidget }       from './class-page/ClassNotesWidget';
import { ClassAssignmentsWidget } from './class-page/ClassAssignmentsWidget';
import { ClassCalendarWidget }    from './class-page/ClassCalendarWidget';
import { ClassGradeWidget }       from './class-page/ClassGradeWidget';
import { ClassResourcesWidget }   from './class-page/ClassResourcesWidget';
import { ClassTodoWidget }        from './class-page/ClassTodoWidget';
import { ClassPoliciesWidget }    from './class-page/ClassPoliciesWidget';
import { yearFilePath } from '../data-sources/budget';
import { LEDGER_INDEX_TEMPLATE } from '../core/codecs/line-table';
import { resolveCommandCenterPath } from '../data-sources/vault-paths';
import { TODO_TEMPLATE } from '../core/codecs/checklist';

export interface WidgetProps {
  config?: Record<string, unknown>;
  app: App;
  // Merges a patch into this widget instance's own config and persists it —
  // same underlying handleConfigChange app.tsx already threads into
  // WidgetSettingsModal, now also reachable directly from inside a widget for
  // self-directed writes that don't go through that modal (e.g. Kanban's
  // per-bucket color popover). Optional since most widgets don't need it.
  onConfigChange?: (patch: Record<string, unknown>) => void;
}

// 'General' holds RAW RENDERERS rather than presets — a Record Table pointed
// at whatever folder the user picks, versus "Meeting Log" which is the same
// renderer bundled with a folder, columns and a create flow. Both exist on
// purpose: the preset is the curated path, General is the escape hatch.
//
// 'Nutrition' pulls the food widgets (Recipe Box, Recipe List, Meal Planner,
// Grocery List) out of Productivity, where they were four of its eleven
// entries and shared nothing with the other seven. Category is DERIVED, never
// persisted — a LayoutItem stores `type` — so recategorising costs nothing.
export type WidgetCategory =
  | 'General' | 'Productivity' | 'Nutrition' | 'Finance'
  | 'Learning' | 'Capture' | 'Education' | 'Class Page';

// ── Library metadata ──────────────────────────────────────────────────────
// What the Widget Library reads to describe a widget before it's been added.
// Lives on the definition rather than in a side table so a new widget can't be
// added without also answering "what is this and what does it need".

/** The tone a "Getting started" row is chipped with, and what it means. */
export type NeedKind =
  | 'setup'    // a step the user must take at add time
  | 'feature'  // something the widget can do
  | 'ai'       // optional AI capability — copy always starts "Optional — "
  | 'pairs'    // a dependency, or a better-together relationship
  | 'sync'     // an external service connection
  | 'soon';    // placeholder-backed, not built yet

export interface WidgetNeed { kind: NeedKind; text: string }

// A widget's preview graphic is NOT declared here. It's looked up by widget id
// in grid/preview-art.ts's WIDGET_ART, and whether the detail view can render
// the widget live is answered by whether it has a fixture
// (grid/library-fixtures.ts). Two facts, each with exactly one home — a
// `preview: { kind, art }` field on the definition duplicated both and could
// only ever drift out of agreement with them.

export interface FileSetupConfig {
  scanFolder: (app: App) => string;   // vault path to scan for existing files (or folders, see `mode`) — resolved live so renumbered command-center subfolders (see vault-paths.ts) still work
  label:      string;   // human label, e.g. "TODO list"
  configKey:  string;   // key written into widget config, e.g. "listFile"
  template:   string;   // default file content when creating new
  // Optional extra text field shown in the same setup modal (e.g. a display
  // name distinct from the underlying file), written into config[configKey].
  extraNameField?: { label: string; placeholder: string; configKey: string };
  // 'file' (default) scans scanFolder for .md files; 'folder' scans it for
  // subfolders instead — for widgets whose data unit is a folder of files
  // (e.g. one ledger = an index file + yearly ledgers) rather than one file.
  mode?: 'file' | 'folder';
  // Placeholder text for the "Create new" input. Defaults to the generic
  // "e.g. Work, Personal…" if omitted.
  newPlaceholder?: string;
  // For setups where config[configKey] is NOT itself a vault path (e.g.
  // BUDGET_SETUP's mode: 'folder', where it's just the ledger's name) —
  // resolves it to the actual file the widget's source badge should link to.
  // Omitted for setups where config[configKey] already is the file path.
  resolveLink?: (app: App, raw: string) => string;
}

// SourcePickerConfig now lives in core/types.ts — a preset declares its own
// picker, and presets are a core contract. Re-exported here because
// WidgetDefinition uses it and several call sites import it from this module.
export type { SourcePickerConfig } from '../core';

export interface WidgetDefinition {
  label:              string;
  category:           WidgetCategory;
  defaultSize:        { w: number; h: number };
  minSize:            { w: number; h: number };
  component:          ComponentType<WidgetProps>;
  /** One line, on the library card. Also what search matches against. */
  description?:       string;
  /** The paragraph in the library's detail pane. */
  about?:             string;
  /** The detail pane's "Getting started" list. */
  needs?:             WidgetNeed[];
  requiresFileSetup?: FileSetupConfig;
  sourcePicker?:      CoreSourcePickerConfig;
  // Only addable from Class Fullscreen's own restricted "+ Add Widget"
  // (WidgetLibraryModal's scope="classPage") — excluded from the main
  // dashboard's library entirely, never just hidden behind a category filter.
  classPageOnly?:     boolean;
}

const TODO_SETUP: FileSetupConfig = {
  scanFolder: app => resolveCommandCenterPath(app, 'todos'),
  label:      'TODO list',
  configKey:  'listFile',
  template:   TODO_TEMPLATE,
};

const KANBAN_SETUP: FileSetupConfig = {
  ...TODO_SETUP,
  extraNameField: { label: 'Board name', placeholder: 'e.g. Work Sprint', configKey: 'boardName' },
};

const TODO_LIST_SETUP: FileSetupConfig = {
  ...TODO_SETUP,
  extraNameField: { label: 'List name', placeholder: 'e.g. Homework, Groceries…', configKey: 'listName' },
};

// GROCERY_SETUP is gone: Grocery List is a preset now (widgets/presets.ts),
// and its picker is declared there. Legacy `listFile` configs still resolve
// through config-migration.ts's mapping table.

const BUDGET_SETUP: FileSetupConfig = {
  scanFolder:     app => resolveCommandCenterPath(app, 'Finance', 'Ledgers'),
  label:          'Ledger',
  configKey:      'budgetName',
  mode:           'folder',
  newPlaceholder: 'e.g. Work-Ledger',
  template:       LEDGER_INDEX_TEMPLATE,
  // The badge/link should point at the file these widgets actually read and
  // write day to day — the current year's ledger — not the ledger name itself.
  resolveLink:    (app, name) => yearFilePath(app, name, new Date().getFullYear()),
};

/**
 * Widgets backed by a COMPONENT — hero renderers (bespoke UI over a shared
 * codec) and the not-yet-migrated bespoke ones. Presets are merged in below.
 */
const componentWidgets: Record<string, WidgetDefinition> = {
  'task-manager':         { label: 'Task Manager',       category: 'Productivity', defaultSize: { w: 12, h: 6  }, minSize: { w: 6, h: 4 }, component: TaskManagerWidget, requiresFileSetup: TODO_SETUP },
  'calendar-strip':       { label: 'Calendar',           category: 'Productivity', defaultSize: { w: 5,  h: 4  }, minSize: { w: 5, h: 4 }, component: CalendarStripWidget },
  'my-day':               { label: 'My Day',             category: 'Productivity', defaultSize: { w: 5,  h: 6  }, minSize: { w: 3, h: 3 }, component: MyDayWidget },
  'kanban':               { label: 'Kanban Board',       category: 'Productivity', defaultSize: { w: 12, h: 4  }, minSize: { w: 4, h: 3 }, component: KanbanWidget,      requiresFileSetup: KANBAN_SETUP },
  'todo-list':            { label: 'TODO List',          category: 'Productivity', defaultSize: { w: 5,  h: 6  }, minSize: { w: 3, h: 4 }, component: TodoListWidget,    requiresFileSetup: TODO_LIST_SETUP },
  'recipe-box':           { label: 'Recipe Box',         category: 'Nutrition',    defaultSize: { w: 6,  h: 5  }, minSize: { w: 6, h: 5 }, component: RecipeBoxWidget },
  'meal-planner':         { label: 'Meal Planner',       category: 'Nutrition',    defaultSize: { w: 12, h: 4  }, minSize: { w: 8, h: 3 }, component: MealPlannerWidget },
  'process-notes':        { label: 'Process Notes',      category: 'Productivity', defaultSize: { w: 6,  h: 5  }, minSize: { w: 3, h: 3 }, component: PlaceholderWidget },
  'budget-stats-yearly':  { label: 'Year Review',        category: 'Finance',      defaultSize: { w: 12, h: 2  }, minSize: { w: 2, h: 2 }, component: YearReviewWidget,  requiresFileSetup: BUDGET_SETUP },
  'budget-stats-monthly': { label: 'Month Review',       category: 'Finance',      defaultSize: { w: 12, h: 2  }, minSize: { w: 2, h: 2 }, component: MonthReviewWidget, requiresFileSetup: BUDGET_SETUP },
  'expense-donut':        { label: 'Categorized Pie Chart', category: 'Finance',   defaultSize: { w: 6,  h: 6  }, minSize: { w: 3, h: 4 }, component: CategorizedPieChartWidget, requiresFileSetup: BUDGET_SETUP },
  'income-expense-bar':   { label: 'Expense Vs Income',  category: 'Finance',      defaultSize: { w: 8,  h: 4  }, minSize: { w: 4, h: 3 }, component: ExpenseVsIncomeWidget,     requiresFileSetup: BUDGET_SETUP },
  'time-period':          { label: 'Time Period',        category: 'Finance',      defaultSize: { w: 3,  h: 2  }, minSize: { w: 2, h: 2 }, component: TimePeriodWidget },
  'income-expense-tracker': { label: 'Income & Expense Tracker', category: 'Finance', defaultSize: { w: 5, h: 6 }, minSize: { w: 4, h: 4 }, component: IncomeExpenseTrackerWidget, requiresFileSetup: BUDGET_SETUP },
  'recurring-items':      { label: 'Recurring Items',     category: 'Finance',      defaultSize: { w: 6,  h: 6  }, minSize: { w: 4, h: 4 }, component: RecurringItemsWidget, requiresFileSetup: BUDGET_SETUP },
  'art-quote-hero':       { label: 'Art & Quote',        category: 'Learning',     defaultSize: { w: 12, h: 4  }, minSize: { w: 6, h: 3 }, component: PlaceholderWidget },
  'french-reading':       { label: 'French Reading',     category: 'Learning',     defaultSize: { w: 6,  h: 10 }, minSize: { w: 4, h: 5 }, component: PlaceholderWidget },
  'french-flashcards':    { label: 'French Flash Cards', category: 'Learning',     defaultSize: { w: 6,  h: 10 }, minSize: { w: 4, h: 5 }, component: PlaceholderWidget },
  'bookmark-revival':     { label: 'Bookmark Revival',   category: 'Learning',     defaultSize: { w: 6,  h: 5  }, minSize: { w: 3, h: 3 }, component: PlaceholderWidget },
  'brain-dump':           { label: 'Brain Dump',         category: 'Capture',      defaultSize: { w: 6,  h: 5  }, minSize: { w: 3, h: 3 }, component: PlaceholderWidget },
  'my-classes':           { label: 'My Classes',         category: 'Education',    defaultSize: { w: 8,  h: 4  }, minSize: { w: 3, h: 3 }, component: MyClassesWidget },
  'my-teachers':          { label: 'My Teachers',        category: 'Education',    defaultSize: { w: 5,  h: 5  }, minSize: { w: 3, h: 3 }, component: MyTeachersWidget },
  'class-scheduler':      { label: 'Class Scheduler',    category: 'Education',    defaultSize: { w: 12, h: 8  }, minSize: { w: 6, h: 5 }, component: ClassSchedulerWidget },
  'class-notes-widget':       { label: 'Recent Notes',        category: 'Class Page', defaultSize: { w: 7, h: 4 }, minSize: { w: 4, h: 3 }, component: ClassNotesWidget,       classPageOnly: true },
  'class-assignments-widget': { label: 'Assignments & Grades', category: 'Class Page', defaultSize: { w: 7, h: 5 }, minSize: { w: 5, h: 4 }, component: ClassAssignmentsWidget, classPageOnly: true },
  'class-calendar-widget':    { label: 'Class Calendar',      category: 'Class Page', defaultSize: { w: 5, h: 5 }, minSize: { w: 3, h: 4 }, component: ClassCalendarWidget,    classPageOnly: true },
  'class-grade-widget':       { label: 'Grade Breakdown',     category: 'Class Page', defaultSize: { w: 5, h: 3 }, minSize: { w: 3, h: 2 }, component: ClassGradeWidget,       classPageOnly: true },
  'class-resources-widget':   { label: 'Resources',           category: 'Class Page', defaultSize: { w: 5, h: 3 }, minSize: { w: 3, h: 2 }, component: ClassResourcesWidget,   classPageOnly: true },
  'class-todo-widget':        { label: 'Class Tasks',         category: 'Class Page', defaultSize: { w: 4, h: 5 }, minSize: { w: 3, h: 3 }, component: ClassTodoWidget,        classPageOnly: true },
  'class-policies-widget':    { label: 'Class Policies',      category: 'Class Page', defaultSize: { w: 5, h: 4 }, minSize: { w: 3, h: 3 }, component: ClassPoliciesWidget,    classPageOnly: true },
};

/**
 * Library copy for the component-backed widgets, merged into the table above.
 *
 * Kept as a SEPARATE table rather than four more fields per row, because the
 * table above earns its shape: one aligned line per widget is what makes
 * "which widgets are 12 wide", "which need file setup" and "which are still
 * PlaceholderWidget" answerable at a glance. Interleaving four prose fields
 * would cost that permanently, and prose is the thing you read one of at a
 * time anyway.
 *
 * Presets carry their copy inline instead (widgets/presets.ts) — those entries
 * are already multi-line objects, so there's no table to protect.
 *
 * Accuracy is part of the contract here. These strings are the only promise a
 * user gets before adding a widget, so a `feature` row that names something
 * the widget doesn't do is a bug, not a wording preference. See
 * WIDGET-COPY-NOTES.md for what was corrected against the code and why.
 */
type LibraryCopy = Pick<WidgetDefinition, 'description' | 'about' | 'needs'>;

const COPY: Record<string, LibraryCopy> = {
  'task-manager': {
    description: 'Your Focus widget. Pulls in TODO items and lets you prioritize tasks and set focus timers.',
    about: 'This widget helps you prioritize your TODO tasks. Get things off the back burner and start cooking. Adjust your focus timer, then get to work.',
    needs: [
      { kind: 'setup',   text: 'Pick or create the TODO notes it works from' },
      { kind: 'feature', text: 'Built-in focus timer tied to the active task' },
      { kind: 'feature', text: 'Only one task at a time in the active slot' },
    ],
  },
  'my-day': {
    description: 'Everything happening on one day — classes, due dates, reminders, meals, events and bills, in one list.',
    about: 'The only widget that reads across every other one. Classes, assignment due dates, reminders, planned meals, calendar events and upcoming bills all land in a single day view, in time order. Read-only on purpose: tap anything to open the widget or note that owns it.',
    needs: [
      { kind: 'setup',   text: 'Nothing to configure — it finds whatever you already have' },
      { kind: 'feature', text: 'Step back and forward a day at a time' },
      { kind: 'pairs',   text: 'Gets richer with Classes, Meal Planner and Recurring Items' },
      { kind: 'sync',    text: 'Includes Google events when Calendar is connected — optional' },
    ],
  },
  'calendar-strip': {
    description: 'Your week at a glance, with optional Google Calendar sync and full-screen day, week and month views.',
    about: 'Compact by default — a strip of days with what’s on them. Expand for day, week and month views. Connects to Google Calendar from its own settings screen, or stays local.',
    needs: [
      { kind: 'sync',    text: 'Connect Google Calendar from its settings — optional' },
      { kind: 'feature', text: 'Expands to full-screen day, week and month views' },
      { kind: 'feature', text: 'Works entirely offline if you never connect an account' },
    ],
  },
  'kanban': {
    description: 'Drag tasks between colored buckets. The whole board is one checklist note.',
    about: 'Buckets carry their own color, chosen in place from the card itself — no board-wide picker. Everything persists as plain markdown, so the board reads fine as a note.',
    needs: [
      { kind: 'setup',   text: 'Pick or create the checklist note behind the board' },
      { kind: 'feature', text: 'Drag cards between buckets' },
      { kind: 'feature', text: 'Each bucket gets its own color, set right on the board' },
      { kind: 'pairs',   text: 'Mark a bucket "Include in Task Manager" and its tasks feed Focus' },
    ],
  },
  'todo-list': {
    description: 'Your Kanban board shrunk down into a tabbed TODO list. Add tabs to organize your tasks.',
    about: 'Organize your TODOs into tabs and visualize your tasks. Each tab is its own checklist note, so the whole thing still reads as plain markdown.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a note for the first tab' },
      { kind: 'feature', text: 'Add more tabs any time' },
      { kind: 'feature', text: 'Move any task to another tab from its own row menu' },
    ],
  },
  'recipe-box': {
    description: 'A peelable stack of recipe cards with photos. Flip through and open one full-screen.',
    about: 'Physical card-stack behavior — flip through your recipes just like Grandma’s recipe box. Add new recipes here, or import from a URL and have your favorites formatted in minutes. Click a recipe to open a full-screen view when it’s time to cook.',
    needs: [
      { kind: 'feature', text: 'No setup — reads your Recipes folder directly' },
      { kind: 'ai',      text: 'Optional — paste a recipe URL and AI imports it, formatted' },
      { kind: 'pairs',   text: 'Feeds Meal Planner and Recipe List' },
    ],
  },
  'meal-planner': {
    description: 'Seven days, breakfast, lunch, dinner and even snack time. Drag recipes out of the box and into the week.',
    about: 'A week grid that pulls from the same Recipes folder as the Recipe Box, or add meals and snacks you don’t have recipes for. Meals can be extended into following days, duplicated, and moved.',
    needs: [
      { kind: 'pairs',   text: 'Works best when you have recipes in the Recipe Box' },
      { kind: 'feature', text: 'Drag a recipe onto any day and slot' },
      { kind: 'feature', text: 'Extend a meal across days, duplicate it, or move it' },
    ],
  },
  'process-notes': {
    description: 'Note taking curated for industry workers and troubleshooters.',
    about: 'Currently a placeholder — the slot exists, the renderer doesn’t. Adding it drops a stub card you can size and position now and fill in later.',
    needs: [{ kind: 'soon', text: 'Not built yet — adding it drops a placeholder you can size now' }],
  },
  'budget-stats-yearly': {
    description: 'Income, expenses and savings rate for the whole year, in one strip.',
    about: 'A full-width stat band. The savings rate carries its own color — sage above 20%, terracotta from 10 to 19, rust below — so the year reads before the numbers do.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a ledger' },
      { kind: 'pairs',   text: 'Shares one ledger with the whole Finance suite' },
      { kind: 'feature', text: 'Savings rate changes color as the year gets healthier' },
    ],
  },
  'budget-stats-monthly': {
    description: 'This month’s totals and savings rate, colored by how healthy the month is.',
    about: 'Same band as Year Review, scoped to one month. Pairs with Time Period if you want it following a month other than the current one.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a ledger' },
      { kind: 'pairs',   text: 'Time Period drives which month it shows' },
      { kind: 'feature', text: 'Savings rate is color-coded, same scale as Year Review' },
    ],
  },
  'expense-donut': {
    description: 'Where your money went, by category, as a donut with a legend.',
    about: 'Breaks your spending into categories so you can see where it actually goes. Toggle between the selected month and the whole year without adding a second widget.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a ledger' },
      { kind: 'feature', text: 'Toggle between month and year without a second widget' },
      { kind: 'feature', text: 'Category colors are assigned for you — no picker to fiddle with' },
      { kind: 'pairs',   text: 'Reads the same transactions the Tracker writes' },
    ],
  },
  'income-expense-bar': {
    description: 'Side-by-side bars for money in and money out, month by month.',
    about: 'Money in vs money out — probably the most important metric in your household or your business. Visualize it with the Expense Vs Income widget.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a ledger' },
      { kind: 'feature', text: 'Green in, red out — fixed, so every Finance widget reads alike' },
      { kind: 'feature', text: 'Always charts the last six months — nothing to configure' },
    ],
  },
  'time-period': {
    description: 'A small month selector the Finance reviews read from.',
    about: 'The one widget in the suite that shows no data. Drop it next to the others and it becomes the shared month for Month Review, Year Review and the Categorized Pie Chart.',
    needs: [
      { kind: 'feature', text: 'No setup and no data of its own' },
      { kind: 'pairs',   text: 'Sets the month Month Review, Year Review and the Pie Chart follow' },
    ],
  },
  'income-expense-tracker': {
    description: 'Log a transaction in two taps. Reads and writes the same year ledger.',
    about: 'The entry point for the whole suite — every other Finance widget is a view over what this one writes. A detailed modal is one tap away when a row needs a category or a note.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a ledger' },
      { kind: 'feature', text: 'Two taps to log; a detail view when you need category and notes' },
      { kind: 'ai',      text: 'Optional — AI reads your quick entries and categorizes them for you' },
      { kind: 'pairs',   text: 'Everything the other Finance widgets show starts here' },
    ],
  },
  'recurring-items': {
    description: 'Subscriptions and standing bills, with what’s due next.',
    about: 'Tracks the money that leaves without asking. Each row shows its cadence and next date, colored by category the same way the donut is.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a ledger' },
      { kind: 'feature', text: 'Shows cadence and the next date due for each item' },
      { kind: 'pairs',   text: 'Lives in the same ledger the Tracker and reviews read' },
    ],
  },
  'art-quote-hero': {
    description: 'A rotating artwork and a line worth rereading. Save your favorite quotes and see them here.',
    about: 'Currently a placeholder. Intended as a full-width banner that changes daily — the one decorative slot in an otherwise working dashboard.',
    needs: [{ kind: 'soon', text: 'Not built yet — a full-width banner that changes daily' }],
  },
  'french-reading': {
    description: 'A passage a day, sized to be finished rather than started.',
    about: 'Currently a placeholder. Tall by default because reading widgets that need scrolling never get read.',
    needs: [{ kind: 'soon', text: 'Not built yet — a daily passage with inline glosses' }],
  },
  'french-flashcards': {
    description: 'Spaced-repetition cards for the vocabulary you keep missing.',
    about: 'Currently a placeholder. Same footprint as French Reading so the two stack cleanly in a column.',
    needs: [{ kind: 'soon', text: 'Not built yet — spaced repetition over your own vocab notes' }],
  },
  'bookmark-revival': {
    description: 'Resurfaces one saved link you never went back to.',
    about: 'Currently a placeholder. The premise: a read-later list only works if something pulls from it.',
    needs: [{ kind: 'soon', text: 'Not built yet — resurfaces one saved link at a time' }],
  },
  'brain-dump': {
    description: 'A fast, unstructured scratchpad that files itself later.',
    about: 'Currently a placeholder. Capture first, categorize never — the note it writes is meant to be triaged elsewhere.',
    needs: [{ kind: 'soon', text: 'Not built yet — a scratchpad that files what you dump into it' }],
  },
  'my-classes': {
    description: 'Every class with its current grade, at a glance. Unlocks the dedicated education widgets.',
    about: 'The entry point for the whole suite. Each class opens its own full-screen page with its own education-focused widgets — study notes, assignments, grades, resources, class calendar and more. Take control of your semester and get organized.',
    needs: [
      { kind: 'setup',   text: 'Add your first class to get started' },
      { kind: 'ai',      text: 'Optional — import a syllabus and AI fills in assignments and dates' },
      { kind: 'feature', text: 'Each class opens its own page with its own widgets' },
      { kind: 'feature', text: 'Grades update as assignments get marked off' },
    ],
  },
  'my-teachers': {
    description: 'Names, emails and office hours for the people you need to email.',
    about: 'A plain contact list scoped to the current term. Rows link out to the class page they belong to. When you archive a class its teachers disappear, so this list always stays current.',
    needs: [
      { kind: 'pairs',   text: 'Works best alongside My Classes — contacts link to their class' },
      { kind: 'feature', text: 'Add contacts right in the widget, no setup first' },
      { kind: 'feature', text: 'Email and office hours in one tap' },
    ],
  },
  'class-scheduler': {
    description: 'Your weekly class schedule, with room for one-off events and study blocks.',
    about: 'Recurring blocks laid over a week grid. A single session can be moved or cancelled without touching the series, and the whole grid locks once the term settles. Schedule study blocks and one-off events alongside your class schedule.',
    needs: [
      { kind: 'pairs',   text: 'Reads the classes you added in My Classes' },
      { kind: 'feature', text: 'Move or cancel one session without changing the series' },
      { kind: 'feature', text: 'Lock the grid once your term settles' },
    ],
  },

  // ── Class Page ────────────────────────────────────────────────────────────
  // Only ever listed by Class Fullscreen's own picker (scope="classPage").
  // None of them carry a `setup` row: the class IS the setup — every one of
  // these reads the slug the class page injects, so there is nothing to pick.
  'class-notes-widget': {
    description: 'Every note you’ve written for this class, newest first.',
    about: 'A searchable grid of note cards, each showing when you last touched it. Notes linked to an assignment carry a badge saying which one, so you can see what you actually prepared for. Start a new note without leaving the page.',
    needs: [
      { kind: 'feature', text: 'Search titles and note text as you type' },
      { kind: 'feature', text: 'One button starts a new note, already filed under this class' },
      { kind: 'pairs',   text: 'Notes linked from Assignments & Grades show what they belong to' },
    ],
  },
  'class-calendar-widget': {
    description: 'This class on a timeline — sessions, topics, due dates and your own reminders.',
    about: 'One dated list rather than a week grid, because it merges four things: the sessions from your Class Scheduler, the topics from your syllabus, assignment due dates, and reminders you add yourself. A reminder can hang off any day, including one with nothing else on it.',
    needs: [
      { kind: 'feature', text: 'Add a reminder to any day; double-click to edit it' },
      { kind: 'pairs',   text: 'Sessions come from Class Scheduler, due dates from Assignments' },
      { kind: 'feature', text: 'Days with nothing on them stay out of the way' },
    ],
  },
  'class-assignments-widget': {
    description: 'Every assignment with its status, weight and score. The engine behind your grade.',
    about: 'Add assignments by hand or import them from a syllabus. Tap the status pill to cycle it, type a score when it comes back, and link the notes and resources you used to each one. What you enter here is what Grade Breakdown reads.',
    needs: [
      { kind: 'feature', text: 'Tap the status pill to cycle it — no dropdown to open' },
      { kind: 'ai',      text: 'Optional — import a syllabus and AI fills in the assignments' },
      { kind: 'feature', text: 'Link notes and resources to the assignment they belong to' },
      { kind: 'pairs',   text: 'Grade Breakdown is a view over what you enter here' },
    ],
  },
  'class-todo-widget': {
    description: 'A flat task list scoped to this class. No tabs, no setup.',
    about: 'The stripped-down sibling of TODO List: one list, always this class’s own Tasks.md. It’s the same file TODO List’s class-linked mode reads, so the two stay in sync and you can work from whichever is in front of you.',
    needs: [
      { kind: 'feature', text: 'No setup — it already knows which class it belongs to' },
      { kind: 'feature', text: 'Add a #tag at the end of a task to categorise it' },
      { kind: 'pairs',   text: 'Same file as TODO List’s class-linked mode — always in sync' },
    ],
  },
  'class-resources-widget': {
    description: 'Links and files for this class, in one list.',
    about: 'Paste a URL or drop in a file and it lands here. Each row says whether you added it or whether it came in with the syllabus, so an imported reading list stays distinguishable from your own bookmarks.',
    needs: [
      { kind: 'feature', text: 'Add a link or upload a file — both live in one list' },
      { kind: 'feature', text: 'Rows show whether you added it or the syllabus did' },
      { kind: 'feature', text: 'Click any row to open it' },
    ],
  },
  'class-policies-widget': {
    description: 'The rules that bite — late work, attendance, participation.',
    about: 'A numbered list of the things a teacher said once and expects you to remember. Deliberately plain: no dates, no status, nothing to maintain. Double-click a line to edit it.',
    needs: [
      { kind: 'feature', text: 'Double-click any line to edit it in place' },
      { kind: 'feature', text: 'Numbered by position — deleting one renumbers the rest' },
      { kind: 'feature', text: 'No dates, no tracking. It’s a list you read, not one you tend' },
    ],
  },
  'class-grade-widget': {
    description: 'Where your grade is actually coming from, weight by weight.',
    about: 'A read-only bar per row, heaviest first. Two modes, set in this widget’s own settings: per assignment, for a syllabus that weights every item, or per category, which averages each category’s scores and applies the category weight — the shape most syllabi actually use. Ungraded rows still show, so nothing hides.',
    needs: [
      { kind: 'setup',   text: 'Choose per-assignment or per-category in its settings' },
      { kind: 'pairs',   text: 'Reads the scores you enter in Assignments & Grades' },
      { kind: 'feature', text: 'Ungraded rows stay visible instead of quietly vanishing' },
    ],
  },
};

/**
 * Turns a preset (data) into the same WidgetDefinition shape a component-backed
 * widget has, so the library, the grid and the settings modal need to know
 * nothing about presets at all — they keep reading one registry.
 *
 * The component is always PresetHost, bound to this preset.
 */
// createElement rather than JSX: this file is .ts, and it's imported by ~30
// others, so keeping the extension beats a rename for one element.
function presetDefinition(preset: Preset): WidgetDefinition {
  const Bound = (props: WidgetProps) => createElement(PresetHost, { ...props, preset });
  Bound.displayName = `Preset(${preset.id})`;

  return {
    label:         preset.label,
    category:      preset.category,
    defaultSize:   preset.defaults.size,
    minSize:       preset.defaults.minSize,
    component:     Bound,
    classPageOnly: preset.classPageOnly,
    // Forwarded exactly the way label/category are, so the library keeps
    // reading one registry and still knows nothing about presets.
    description:   preset.description,
    about:         preset.about,
    needs:         preset.needs,
    // Each preset declares its own picker; a fixed-folder preset has none
    // because it already knows where its data lives.
    sourcePicker:  preset.picker,
  };
}

/**
 * The one lookup the rest of the app uses. Presets first so a component-backed
 * widget with a colliding id would win and be obvious in review, rather than a
 * preset silently shadowing a real component.
 */
export const widgetRegistry: Record<WidgetType, WidgetDefinition> = {
  ...Object.fromEntries(PRESETS.map(p => [p.id, presetDefinition(p)])),
  ...Object.fromEntries(
    Object.entries(componentWidgets).map(([id, def]) => [id, { ...def, ...COPY[id] }]),
  ),
};

// 'Class Page' deliberately never appears here — Class Fullscreen's own
// restricted WidgetLibraryModal (scope="classPage") lists those 5 widgets
// directly rather than through the category-pill mechanism the main
// dashboard's library uses, so this list staying untouched is what actually
// keeps them out of the main dashboard's "All"/category browsing.
// 'General' leads: raw renderers are the "build your own" entry point, so they
// read better before the curated presets than buried after them.
export const CATEGORY_ORDER: WidgetCategory[] = ['General', 'Productivity', 'Nutrition', 'Finance', 'Learning', 'Capture', 'Education'];

/**
 * Each category pinned to one of the ten curated tones, INTERLEAVED so
 * neighbouring categories never share a hue family — the same principle as
 * categoryColor() in data-sources/budget.ts.
 *
 * These are `var()` strings, not hexes, and that's the point: the tone tokens
 * are declared per theme, so a category dot gets its light ink and its dark
 * glow for free. The six hexes these replaced were one flat value in both
 * themes and off-palette in either.
 *
 * They resolve inside the portaled library only because `.cc2-lib-fs-backdrop`
 * is in the token bridge — see UI-PATTERNS.md gotcha #4.
 */
export const CATEGORY_COLORS: Record<WidgetCategory, string> = {
  General:      'var(--cc2-tone-slate)',
  Productivity: 'var(--cc2-tone-indigo)',
  Nutrition:    'var(--cc2-tone-moss)',
  Finance:      'var(--cc2-tone-sage)',
  Learning:     'var(--cc2-tone-ochre)',
  Capture:      'var(--cc2-tone-plum)',
  Education:    'var(--cc2-tone-terracotta)',
  // Rose, not faint. The card sets `color` and the preview graphic inherits it,
  // so leaving this grey rendered all seven Class Page graphics in dead neutral.
  // Rose sits close to the salmon accent the class page already uses and stays
  // clear of Education's terracotta next door.
  'Class Page': 'var(--cc2-tone-rose)',
};

/** Section subhead shown beside each sticky category header in the library. */
export const CATEGORY_BLURB: Record<WidgetCategory, string> = {
  General:      'Raw renderers — you point them at a folder, note or table.',
  Productivity: 'The curated day-to-day set: tasks, time and meetings.',
  Nutrition:    'Recipes, the week they land in, and the shopping that follows.',
  Finance:      'One ledger, seven views. Colors are semantic, not decorative.',
  Learning:     'Slow-burn widgets that resurface things worth revisiting.',
  Capture:      'Get it out of your head first, file it later.',
  Education:    'Classes, teachers and the weekly schedule around them.',
  'Class Page': 'Widgets that only exist inside a class.',
};

/** Chip label and tone for each need kind, as rendered in the detail pane. */
export const NEED_CHIP: Record<NeedKind, { label: string; tone: string }> = {
  setup:   { label: 'Setup',       tone: 'slate'  },
  feature: { label: 'Feature',     tone: 'spruce' },
  ai:      { label: 'AI',          tone: 'plum'   },
  pairs:   { label: 'Pairs with',  tone: 'indigo' },
  sync:    { label: 'Sync',        tone: 'spruce' },
  soon:    { label: 'Coming soon', tone: 'ochre'  },
};
