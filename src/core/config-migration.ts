import type { App } from 'obsidian';
import type { LayoutItem, PageLayout, WidgetType } from '../types';
import type { SourceRef } from './types';
import { asSourceRef } from './types';
import { todoFilePath }    from '../data-sources/todos';
import { groceryFilePath } from '../data-sources/groceries';
import { budgetFolderPath } from '../data-sources/budget';

/**
 * core/config-migration.ts — legacy widget config → SourceRef.
 *
 * Widget config is `Record<string, unknown>` with a different ad-hoc key per
 * widget family (`listFile`, `budgetName`, `boardName`, `classLinked`). This
 * maps those to the one typed `config.source` descriptor, once, on load.
 *
 * STRICTLY ADDITIVE. It writes `config.source` and touches nothing else —
 * every legacy key stays exactly where it is, so today's widgets keep reading
 * exactly what they read now and Phase 0 changes zero behavior. The legacy
 * keys get dropped per-family as each family is ported (Phases 1-3), not
 * here; until then both shapes are live and must agree.
 *
 * Idempotent: an item that already has a valid `config.source` is skipped, so
 * this can run on every load without churning data.json.
 */

export const SOURCE_KEY = 'source';

type LegacyMapper = (app: App, config: Record<string, unknown>) => SourceRef | null;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// `listFile` is a bare basename resolved under command-center/todos/, EXCEPT
// when it already contains a "/" — TodoListWidget's class-linked mode passes
// a full path (todos.ts:99 documents this escape hatch). todoFilePath()
// handles both, so the mapper doesn't have to.
const checklistFromListFile: LegacyMapper = (app, config) => {
  const listFile = str(config.listFile);
  if (!listFile) return null;
  return { codec: 'checklist', path: todoFilePath(app, listFile) };
};

// Same shape on disk (`- [ ] item` lines), different folder and no buckets —
// which is why groceries.ts's parser gets deleted in Phase 1 rather than
// becoming a fourth codec.
const checklistFromGroceryFile: LegacyMapper = (app, config) => {
  const listFile = str(config.listFile);
  if (!listFile) return null;
  return { codec: 'checklist', path: groceryFilePath(app, listFile) };
};

// A ledger is a FOLDER (index + one file per year, see budget.ts's header),
// not a file — `budgetName` is the folder's name, never a path. This is the
// case the folder variant of the line-table SourceRef exists for; the codec
// (Phase 3) resolves which year file to read. On-disk format is untouched.
const ledgerFromBudgetName: LegacyMapper = (app, config) => {
  const budgetName = str(config.budgetName);
  if (!budgetName) return null;
  return { codec: 'line-table', folder: budgetFolderPath(app, budgetName) };
};

/**
 * Which legacy key each widget type's source lives in.
 *
 * Deliberately absent, and why:
 *
 * - Every class-page widget (`class-*-widget`). Their source is derived from
 *   `classSlug`, which ClassPageContent.tsx:207 injects at RENDER time and
 *   never persists — Layout.json only stores x/y/w/h/type. There is nothing
 *   in the stored config to migrate; those widgets get their SourceRef handed
 *   down by the class-page context instead (handoff §Phase 1).
 *
 * - `todo-list` in class-linked mode (`config.classLinked === true`). That is
 *   one widget over N sources (one Tasks.md per active class, enumerated live
 *   from listClasses()), which a single SourceRef can't express. Handled below
 *   by leaving it unmigrated; Phase 1 gives it a source list, not a source.
 *
 * - Widgets with no file source at all: calendar-strip, time-period,
 *   my-classes, my-teachers, class-scheduler, meeting-log, recipe-box,
 *   meal-planner, and the PlaceholderWidget entries. Several of those DO read
 *   the vault, but through fixed well-known paths rather than a configured
 *   one — they become presets with a scaffolded source in Phase 2/4.
 */
const LEGACY_SOURCE: Partial<Record<WidgetType, LegacyMapper>> = {
  'task-manager':           checklistFromListFile,
  'kanban':                 checklistFromListFile,
  'todo-list':              checklistFromListFile,
  'grocery-list':           checklistFromGroceryFile,
  'income-expense-tracker': ledgerFromBudgetName,
  'budget-stats-yearly':    ledgerFromBudgetName,
  'budget-stats-monthly':   ledgerFromBudgetName,
  'income-expense-bar':     ledgerFromBudgetName,
  'expense-donut':          ledgerFromBudgetName,
  'recurring-items':        ledgerFromBudgetName,
};

/**
 * Returns the migrated config, or null when there's nothing to change.
 * Never mutates the config it's given.
 */
export function migrateWidgetConfig(
  app: App,
  type: WidgetType,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!config) return null;
  if (asSourceRef(config[SOURCE_KEY])) return null;          // already migrated
  if (type === 'todo-list' && config.classLinked) return null; // multi-source, see above

  const source = LEGACY_SOURCE[type]?.(app, config);
  if (!source) return null;

  return { ...config, [SOURCE_KEY]: source };
}

/**
 * What a widget actually calls at render time to find its own source.
 *
 * Prefers the migrated `config.source`, and falls back to deriving one from
 * the legacy key — so a widget works identically whether or not the shim has
 * run yet (a freshly added widget, a config the user hand-edited, a Class
 * Page's render-time-injected config that is never persisted at all).
 */
export function resolveWidgetSource(
  app: App,
  type: WidgetType,
  config: Record<string, unknown> | undefined,
): SourceRef | null {
  const existing = asSourceRef(config?.[SOURCE_KEY]);
  if (existing) return existing;

  const migrated = migrateWidgetConfig(app, type, config);
  return migrated ? asSourceRef(migrated[SOURCE_KEY]) : null;
}

export function migrateLayoutItems(
  app: App,
  items: LayoutItem[],
): { items: LayoutItem[]; changed: boolean } {
  let changed = false;
  const next = items.map(item => {
    const config = migrateWidgetConfig(app, item.type, item.config);
    if (!config) return item;
    changed = true;
    return { ...item, config };
  });
  return { items: changed ? next : items, changed };
}

/**
 * Entry point for main.ts. Runs over every page of the persisted dashboard
 * layout; the caller persists only when `changed` is true, so a fully
 * migrated data.json is never rewritten.
 *
 * Per-class Layout.json files (class-layout.ts) need no equivalent pass —
 * see the class-page note on LEGACY_SOURCE above.
 */
export function migratePages(
  app: App,
  pages: PageLayout[],
): { pages: PageLayout[]; changed: boolean } {
  let changed = false;
  const next = pages.map(page => {
    const result = migrateLayoutItems(app, page.items);
    if (!result.changed) return page;
    changed = true;
    return { ...page, items: result.items };
  });
  return { pages: changed ? next : pages, changed };
}
