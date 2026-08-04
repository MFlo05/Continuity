import type { App } from 'obsidian';
import { resolveCommandCenterPath } from './vault-paths';

/**
 * Where grocery lists live. That's all that's left here.
 *
 * A grocery list turned out to be a checklist file in its flattest dialect —
 * no frontmatter, no `## ` buckets, just `- [ ]` lines — so its parser and
 * its whole CRUD surface (parseGroceryList / readGroceryList /
 * addGroceryItem / setItemDone / deleteItem / editItem / clearChecked) were
 * deleted in Phase 1 and the widget now speaks the checklist codec directly.
 * The codec puts a header-less file's items in the implicit root bucket.
 *
 * Quantity/unit parsing was never file-format work — it's how a line is
 * displayed — and stays in ingredient-line.ts, which the recipe suite shares.
 */

export function groceryFolder(app: App): string {
  return resolveCommandCenterPath(app, 'groceries');
}

export function groceryFilePath(app: App, listFile: string): string {
  return `${groceryFolder(app)}/${listFile}.md`;
}
