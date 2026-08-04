import type { App } from 'obsidian';
import { resolveCommandCenterPath } from './vault-paths';

/**
 * Where TODO files live. That's all that's left here.
 *
 * The parser, the CRUD (setTaskDone / moveTask / addTask / deleteTask /
 * editTaskText / addBucket / deleteBucket / setBucketActive / markTaskDone),
 * and the per-widget `watchVaultFile` wiring all moved to the checklist codec
 * (core/codecs/checklist.ts) in Phase 1 of the refactor — one parser for
 * every `- [ ]` file in the vault instead of one per widget family.
 *
 * Path resolution stays here because it's a folder convention, not a file
 * format: a grocery list is the same checklist format living somewhere else.
 */

export function todoFolder(app: App): string {
  return resolveCommandCenterPath(app, 'todos');
}

/**
 * `listFile` is normally a bare name resolved under the todos/ folder (Kanban,
 * Task Manager, free-form TODO List) — but a caller that already has a full
 * vault path (a class's own Education/Classes/<slug>/Tasks.md) can pass that
 * verbatim instead. A strict superset: no bare-name caller's path contains
 * "/", so this never changes behavior for them.
 */
export function todoFilePath(app: App, listFile: string): string {
  if (listFile.includes('/')) return listFile;
  return `${todoFolder(app)}/${listFile}.md`;
}
