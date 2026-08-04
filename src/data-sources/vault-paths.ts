import { App, TFolder } from 'obsidian';
import { normalizePath } from 'obsidian';

export const DEFAULT_COMMAND_CENTER_ROOT = 'command-center';

// Module-level cache (same shape as ai/asset-utils.ts's assetUrl registry) —
// lets plain, non-React data-source functions read the configured root
// synchronously without prop-drilling a settings object through every call.
// Set once from main.ts's onload() after loadData() resolves, and again
// whenever the user edits it in the settings tab.
let _commandCenterRoot = DEFAULT_COMMAND_CENTER_ROOT;

export function setCommandCenterRoot(root: string): void {
  _commandCenterRoot = root.trim() || DEFAULT_COMMAND_CENTER_ROOT;
}

export function getCommandCenterRoot(): string {
  return _commandCenterRoot;
}

const NUMERIC_PREFIX = /^\d+[-_.\s]+/;
const stripPrefix = (name: string) => name.replace(NUMERIC_PREFIX, '').toLowerCase();

/**
 * Resolves a path under the vault by matching each segment against the
 * *live* folder tree with any leading organizational number prefix stripped
 * (e.g. "Skills", "01-Skills", "99-Skills" all match each other) — so a user
 * can freely renumber folders inside command-center/ for their own sorting
 * without breaking any widget's read/write path. A segment with no live
 * match yet is joined verbatim (unprefixed), so folder/file creation still
 * lands on the canonical name.
 *
 * Only pass fixed organizational segments through this (e.g. 'command-center',
 * 'Skills', 'Finance', 'Ledgers') — user-content leaf names (a specific
 * ledger/meeting/recipe name) should be appended literally by the caller
 * after resolving the fixed prefix, since those aren't reorganized this way.
 */
export function resolveVaultPath(app: App, ...segments: string[]): string {
  let currentPath = '';
  let currentFolder: TFolder | null = app.vault.getRoot();
  for (const segment of segments) {
    const match = currentFolder?.children.find(c => stripPrefix(c.name) === stripPrefix(segment));
    if (match) {
      currentPath = match.path;
      currentFolder = match instanceof TFolder ? match : null;
    } else {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      currentFolder = null;
    }
  }
  return normalizePath(currentPath);
}

/**
 * Same as resolveVaultPath, but always anchored at the user-configurable
 * Command Center root (settings tab: "Command Center root folder") instead of
 * a hardcoded 'command-center' literal — the one place every data-source
 * should call through, so renaming the root folder is a single setting, not
 * a find-and-replace across the codebase.
 */
export function resolveCommandCenterPath(app: App, ...segments: string[]): string {
  return resolveVaultPath(app, _commandCenterRoot, ...segments);
}
