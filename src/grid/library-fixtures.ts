import { createElement, type ComponentType } from 'react';
import type { App } from 'obsidian';
import type { WidgetType } from '../types';
import type {
  ChecklistMeta, ChecklistRow, LedgerRow, MdTableMeta, MdTableRow,
  RecordFolderMeta, RecordRow, SourceRef,
} from '../core';
import { PREVIEW_ROOT, seedPreviewSource } from '../core';
import { localISO } from '../core/dates';
import { ledgerYearSource } from '../data-sources/budget';
import { recurringSource } from '../data-sources/recurring';
import { presetsById } from '../widgets/presets';
import { PresetHost } from '../widgets/PresetHost';
import { widgetRegistry, type WidgetProps } from '../widgets/registry';

/**
 * grid/library-fixtures.ts — the sample data the Widget Library's previews run on.
 *
 * The library renders REAL widget components so a card shows what a widget
 * actually looks like, in the reader's own theme, without anyone maintaining
 * two screenshots per widget. The data those components read comes from here.
 *
 * Nothing in this file touches the vault, and it cannot: every source it
 * builds lives under PREVIEW_ROOT, which core/source-cache.ts recognises and
 * serves from a seeded snapshot instead of a codec read (see
 * core/preview-source.ts). `CLAUDE.md` non-negotiable #3 therefore holds by
 * construction — there is no I/O path to leave in by accident.
 *
 * Three shapes of widget have to be reached three different ways:
 *
 *   1. Widgets that resolve `config.source` (presets with a 'config' source,
 *      plus Kanban / TODO List / Task Manager via the legacy-key shim). Point
 *      `config.source` at a preview SourceRef and they follow it.
 *   2. Presets with a FIXED folder (Recipe List, Meeting Log). Their source is
 *      hardcoded in the preset, so config can't redirect them — previewHost()
 *      renders PresetHost against a clone whose source is 'config' instead.
 *   3. The Finance suite. These take a ledger NAME, not a source, and derive
 *      the path themselves — so the marker goes in the name (PREVIEW_LEDGER)
 *      and the seed is registered at whatever path budget.ts derives from it.
 *
 * Fixture content is deliberately specific rather than "Item 1 / Item 2". A
 * preview is the pitch for the widget; generic filler undersells every one of
 * them.
 */

/** Ledger name whose derived paths read as preview sources. See PREVIEW_ROOT. */
const PREVIEW_LEDGER = `${PREVIEW_ROOT}-ledger`;

const p = (name: string) => `${PREVIEW_ROOT}/${name}`;

// ── Sources ───────────────────────────────────────────────────────────────

/**
 * Basenames are title-cased because they're VISIBLE: several widgets render a
 * source badge from `sourcePath(...).split('/').pop()`, so a preview would
 * otherwise advertise "focus.md" where a real one says "Front Burner.md".
 */
const SRC = {
  records:   { codec: 'record-folder', folder: p('Field Notes') } as SourceRef,
  recipes:   { codec: 'record-folder', folder: p('Recipes')     } as SourceRef,
  meetings:  { codec: 'record-folder', folder: p('Meetings')    } as SourceRef,
  table:     { codec: 'md-table',      path:   p('Gear.md')      } as SourceRef,
  checklist: { codec: 'checklist',     path:   p('Trip Prep.md') } as SourceRef,
  grocery:   { codec: 'checklist',     path:   p('Weekly Shop.md') } as SourceRef,
  todos:     { codec: 'checklist',     path:   p('This Week.md')   } as SourceRef,
  board:     { codec: 'checklist',     path:   p('Kitchen Remodel.md') } as SourceRef,
  focus:     { codec: 'checklist',     path:   p('Front Burner.md')    } as SourceRef,
  // NOTE: Recurring Items is NOT here. Like the rest of the Finance suite it
  // derives its own source from the ledger NAME (recurring.ts's
  // recurringSource), so the seed has to be registered at whatever path that
  // helper produces — a hand-written path here would simply never be asked
  // for, which is exactly the bug that left the widget's preview empty.
};

// ── Row builders ──────────────────────────────────────────────────────────

let seq = 0;
const rowId = () => `preview-${++seq}`;

function record(title: string, fields: Record<string, string>, daysAgo = 0): RecordRow {
  const when = new Date(Date.now() - daysAgo * 86400000);
  const date = localISO(when);
  return {
    id:    rowId(),
    path:  `${p('Field Notes')}/${title}.md`,
    name:  title,
    title,
    date,
    fields: { date, ...fields },
    mtime: when.getTime(),
    // RecordTable reads columns off the row by key, so the fields have to be
    // present at the top level too — that's how the codec returns them.
    ...fields,
  } as RecordRow;
}

function check(text: string, done: boolean, bucket = ''): ChecklistRow {
  return {
    id: rowId(), text, done, bucket,
    bucketActive: true,
    displayText: text,
    project: null,
    fields: {},
  };
}

function buckets(names: string[], rows: ChecklistRow[]): ChecklistMeta {
  return {
    buckets: names.map(name => ({
      name,
      active:    true,
      count:     rows.filter(r => r.bucket === name).length,
      doneCount: rows.filter(r => r.bucket === name && r.done).length,
    })),
    activeBucketNames: names,
    flat: names.length === 0,
  };
}

/**
 * One ledger entry, placed `monthsAgo` months back on `day`.
 *
 * Anchored to the CURRENT month rather than to absolute dates, and that's
 * deliberate rather than lazy: Expense Vs Income charts `getRecentMonths(6)`,
 * which is computed from today. Fixed calendar dates would look right the week
 * they were written and then slide out of the window until the widget previewed
 * as empty. The amounts, categories and spread are all fixed, so the preview is
 * the same picture every time you open it — only the month labels move.
 */
function ledger(
  monthsAgo: number, day: number,
  amount: number, description: string, category: string, kind: 'income' | 'expense',
): LedgerRow {
  const now = new Date();
  const when = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day);
  const iso = localISO(when);
  return {
    id:   rowId(),
    time: '09:24',
    date: iso,
    amount, description, category, kind,
    year: when.getFullYear(),
  };
}

function tableMeta(labels: string[], heading: string | null = null): MdTableMeta {
  return {
    columns:   labels.map(label => ({ key: label, label })),
    fieldKeys: labels,
    heading,
    found:     true,
  };
}

function tableRow(cells: Record<string, string>): MdTableRow {
  return { id: rowId(), ...cells };
}

// ── Fixture payloads ──────────────────────────────────────────────────────

/**
 * `config` is what the widget component receives. Every entry that resolves a
 * source sets `config.source`; the Finance ones set `config.budgetName`
 * instead, because that's the key those widgets actually read.
 */
export interface WidgetFixture {
  config: Record<string, unknown>;
}

const FIXTURES: Partial<Record<WidgetType, WidgetFixture>> = {
  'record-table': { config: { source: SRC.records,   title: 'Field Notes' } },
  'data-table':   { config: { source: SRC.table,     title: 'Gear' } },
  'checklist':    { config: { source: SRC.checklist, title: 'Trip Prep' } },
  'grocery-list': { config: { source: SRC.grocery,   title: 'Weekly Shop' } },
  'recipe-list':  { config: { source: SRC.recipes } },
  'meeting-log':  { config: { source: SRC.meetings } },

  'task-manager': { config: { source: SRC.focus } },
  'kanban':       { config: { source: SRC.board, boardName: 'Kitchen Remodel' } },
  'todo-list':    { config: { source: SRC.todos, listName: 'This Week' } },

  'budget-stats-yearly':    { config: { budgetName: PREVIEW_LEDGER } },
  'budget-stats-monthly':   { config: { budgetName: PREVIEW_LEDGER } },
  'expense-donut':          { config: { budgetName: PREVIEW_LEDGER } },
  'income-expense-bar':     { config: { budgetName: PREVIEW_LEDGER } },
  'income-expense-tracker': { config: { budgetName: PREVIEW_LEDGER } },
  'recurring-items':        { config: { budgetName: PREVIEW_LEDGER } },

  // Reads no file at all — it only writes BudgetMonthContext.
  'time-period': { config: {} },
};

/** Whether this widget can be shown as a real render rather than skeleton art. */
export function hasFixture(type: WidgetType): boolean {
  return type in FIXTURES;
}

export function fixtureConfig(type: WidgetType): Record<string, unknown> {
  return FIXTURES[type]?.config ?? {};
}

// ── Seeding ───────────────────────────────────────────────────────────────

let seeded = false;

/**
 * Register every fixture's snapshot. Called once when the library first opens;
 * cheap enough that the guard is about avoiding pointless churn, not cost.
 *
 * Takes `app` only to derive the Finance suite's ledger paths through the same
 * helper the widgets use — computing them here by hand is exactly the kind of
 * duplicate that silently rots when the folder layout moves.
 */
export function registerLibraryFixtures(app: App): void {
  if (seeded) return;
  seeded = true;

  // ── record-folder sources ───────────────────────────────────────────────
  const records = [
    record('Anodizing bath temps', { status: 'Verified', owner: 'Bench 3' }, 2),
    record('Cutting fluid swap',   { status: 'Testing',  owner: 'Line B'  }, 5),
    record('Fixture wear log',     { status: 'Open',     owner: 'Bench 1' }, 9),
    record('Tolerance drift — Q3', { status: 'Verified', owner: 'QA'      }, 14),
    record('Coolant filtration',   { status: 'Open',     owner: 'Line A'  }, 21),
  ];
  seedPreviewSource<RecordRow>(SRC.records, records, {
    fieldKeys: ['date', 'status', 'owner'], count: records.length,
  } as RecordFolderMeta);

  const recipes = [
    record('Brown Butter Gnocchi', { servings: '4', categories: 'Pasta, Weeknight' }, 3),
    record('Miso Roast Chicken',   { servings: '6', categories: 'Roast, Sunday'    }, 8),
    record('Charred Cabbage',      { servings: '2', categories: 'Side, Fast'       }, 12),
    record('Cardamom Buns',        { servings: '8', categories: 'Baking'           }, 20),
    record('Green Chile Stew',     { servings: '6', categories: 'Braise, Freezer'  }, 28),
  ];
  seedPreviewSource<RecordRow>(SRC.recipes, recipes, {
    fieldKeys: ['date', 'servings', 'categories'], count: recipes.length,
  } as RecordFolderMeta);

  const meetings = [
    record('Vendor tooling review', { title: 'Vendor tooling review', attendees: 'Dana, Priya, Sam' }, 1),
    record('Q3 retro',              { title: 'Q3 retro',              attendees: 'Whole team'       }, 4),
    record('Safety walkthrough',    { title: 'Safety walkthrough',    attendees: 'Ops, Jordan'      }, 11),
    record('Budget check-in',       { title: 'Budget check-in',       attendees: 'Dana, Finance'    }, 18),
  ];
  seedPreviewSource<RecordRow>(SRC.meetings, meetings, {
    fieldKeys: ['date', 'title', 'attendees'], count: meetings.length,
  } as RecordFolderMeta);

  // ── md-table sources ────────────────────────────────────────────────────
  seedPreviewSource<MdTableRow>(
    SRC.table,
    [
      tableRow({ Item: 'Sleeping bag',  Weight: '840 g',  Status: 'Packed'  }),
      tableRow({ Item: 'Stove + fuel',  Weight: '310 g',  Status: 'Packed'  }),
      tableRow({ Item: 'Rain shell',    Weight: '265 g',  Status: 'Ordered' }),
      tableRow({ Item: 'Water filter',  Weight: '92 g',   Status: 'Packed'  }),
      tableRow({ Item: 'Trekking poles', Weight: '480 g', Status: 'Missing' }),
    ],
    tableMeta(['Item', 'Weight', 'Status']),
  );

  // Registered at the path recurringSource() derives from the ledger name —
  // see the note in SRC.
  seedPreviewSource<MdTableRow>(
    recurringSource(app, PREVIEW_LEDGER),
    [
      tableRow({ Amount: '$1,870.93', Description: 'Mortgage',        Category: 'Housing',   Section: 'Expenses', Schedule: '1st of each month'  }),
      tableRow({ Amount: '$142.00',   Description: 'Car insurance',   Category: 'Auto',      Section: 'Expenses', Schedule: '12th of each month' }),
      tableRow({ Amount: '$96.40',    Description: 'House insurance', Category: 'Housing',   Section: 'Expenses', Schedule: '5th of each month'  }),
      tableRow({ Amount: '$78.00',    Description: 'Phone bill',      Category: 'Utilities', Section: 'Expenses', Schedule: '18th of each month' }),
      tableRow({ Amount: '$64.99',    Description: 'Wifi bill',       Category: 'Utilities', Section: 'Expenses', Schedule: '22nd of each month' }),
      tableRow({ Amount: '$28.00',    Description: 'Claude AI',       Category: 'Software',  Section: 'Expenses', Schedule: '3rd of each month'  }),
      tableRow({ Amount: '$64.50',    Description: 'Gym',             Category: 'Health',    Section: 'Expenses', Schedule: 'Every 28 days from 2026-01-06' }),
      tableRow({ Amount: '$3,410.00', Description: 'Salary',          Category: 'Salary',    Section: 'Income',   Schedule: '15th of each month' }),
    ],
    tableMeta(['Amount', 'Description', 'Category', 'Section', 'Schedule'], 'Recurring Items'),
  );

  // ── checklist sources ───────────────────────────────────────────────────
  const trip = [
    check('Passport + boarding passes', true),
    check('Charge camera batteries', true),
    check('Swap out hiking socks', false),
    check('Refill prescriptions', false),
    check('Hold the mail', false),
    check('Download offline maps', false),
  ];
  seedPreviewSource<ChecklistRow>(SRC.checklist, trip, buckets([], trip));

  const shop = [
    check('2 lbs chicken thighs', false),
    check('1 bunch cilantro', true),
    check('3 cans black beans', false),
    check('12 oz sharp cheddar', false),
    check('1 lb brown rice', true),
    check('2 limes', false),
  ];
  seedPreviewSource<ChecklistRow>(SRC.grocery, shop, buckets([], shop));

  const focus = [
    check('Draft the Q3 retro deck', false),
    check('Reply to the vendor quote', false),
    check('Fix the coolant sensor alarm', true),
    check('Book the safety walkthrough', false),
  ];
  seedPreviewSource<ChecklistRow>(SRC.focus, focus, buckets([], focus));

  const board = [
    check('Pick tile for the backsplash', false, 'To do'),
    check('Get a second cabinet quote',   false, 'To do'),
    check('Measure the range gap',        false, 'To do'),
    check('Order the sink',               false, 'In progress'),
    check('Schedule the electrician',     false, 'In progress'),
    check('Cabinet delivery — 3 weeks',   false, 'Blocked'),
    check('Permit approval',              false, 'Blocked'),
    check('Demo the old counters',        true,  'Done'),
    check('Shut off the water line',      true,  'Done'),
  ];
  seedPreviewSource<ChecklistRow>(
    SRC.board, board, buckets(['To do', 'In progress', 'Blocked', 'Done'], board),
  );

  const todos = [
    check('Renew the shop license',    false, 'This week'),
    check('Send Dana the drawings',    true,  'This week'),
    check('Reconcile August receipts', false, 'This week'),
    check('Replace bench lighting',    false, 'Someday'),
    check('Rebuild the jig cart',      false, 'Someday'),
  ];
  seedPreviewSource<ChecklistRow>(SRC.todos, todos, buckets(['This week', 'Someday'], todos));

  // ── Finance ledger ──────────────────────────────────────────────────────
  // SIX months deep, because Expense Vs Income charts the last six and a
  // shallower set previewed as two lonely bars. Each month carries the same
  // skeleton — salary in, mortgage/insurance/groceries out — with the
  // discretionary lines varied so the bars aren't six identical pairs.
  const monthly: Array<[number, number, string, string, 'income' | 'expense']> = [
    [1,  3410.00, 'Salary',        'Salary',    'income'],
    [2,  1870.93, 'Mortgage',      'Housing',   'expense'],
    [5,    96.40, 'House insurance', 'Housing', 'expense'],
    [12,  142.00, 'Car insurance', 'Auto',      'expense'],
    [18,   78.00, 'Phone bill',    'Utilities', 'expense'],
    [22,   64.99, 'Wifi bill',     'Utilities', 'expense'],
    [3,    28.00, 'Claude AI',     'Software',  'expense'],
    [6,    64.50, 'Gym',           'Health',    'expense'],
  ];
  /** Per-month discretionary spend, so no two bars are identical. */
  const variable: Array<Array<[number, number, string, string, 'income' | 'expense']>> = [
    [[8, 248.17, 'Groceries', 'Food', 'expense'], [19, 92.30, 'Fuel', 'Auto', 'expense']],
    [[7, 274.60, 'Groceries', 'Food', 'expense'], [14, 310.00, 'Dining out', 'Food', 'expense'], [21, 420.00, 'Freelance invoice', 'Freelance', 'income']],
    [[9, 231.05, 'Groceries', 'Food', 'expense'], [16, 155.00, 'Hardware store', 'Home', 'expense']],
    [[8, 288.40, 'Groceries', 'Food', 'expense'], [20, 210.00, 'Travel', 'Travel', 'expense'], [11, 640.00, 'Freelance invoice', 'Freelance', 'income']],
    [[10, 262.75, 'Groceries', 'Food', 'expense'], [17, 128.90, 'Self Care', 'Self Care', 'expense']],
    [[9, 244.30, 'Groceries', 'Food', 'expense'], [23, 186.40, 'Utilities', 'Housing', 'expense']],
  ];

  const entries: LedgerRow[] = [];
  for (let m = 0; m < 6; m++) {
    for (const [day, amt, desc, cat, kind] of monthly) entries.push(ledger(m, day, amt, desc, cat, kind));
    for (const [day, amt, desc, cat, kind] of variable[m]) entries.push(ledger(m, day, amt, desc, cat, kind));
  }

  // Seeded per YEAR because that's the granularity budgetStore keys on. The
  // six-month window crosses a year boundary for half the calendar, so entries
  // are filed under the year they actually fall in and both years get a seed.
  const thisYear = new Date().getFullYear();
  for (const year of [thisYear, thisYear - 1]) {
    seedPreviewSource<LedgerRow>(
      ledgerYearSource(app, PREVIEW_LEDGER, year),
      entries.filter(e => e.year === year),
    );
  }
}

// ── Choosing what to mount ────────────────────────────────────────────────

/**
 * The component a preview should mount for this widget type.
 *
 * Almost always just the registry's own component — that's the point, the
 * preview is the real widget. The exception is a preset with a FIXED folder
 * source (Recipe List, Meeting Log): PresetHost resolves those against the
 * vault and ignores config entirely, so the preview binds PresetHost to a
 * clone whose source is 'config' and hands it the fixture source. Same
 * component, same renderer, same options — only where the rows come from
 * changes, which is exactly the seam a preview should use.
 */
export function previewComponent(type: WidgetType): ComponentType<WidgetProps> | null {
  const preset = presetsById[type];
  if (preset && preset.source.kind === 'fixed-folder') {
    const previewPreset = { ...preset, source: { kind: 'config' as const } };
    const Bound = (props: WidgetProps) => createElement(PresetHost, { ...props, preset: previewPreset });
    Bound.displayName = `Preview(${type})`;
    return Bound;
  }
  return widgetRegistry[type]?.component ?? null;
}
