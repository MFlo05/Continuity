import { App, TFile } from 'obsidian';
import type { LayoutItem } from '../types';
import { classFolderPath } from './class-info';
import { DEFAULT_CLASS_LAYOUT } from '../widgets/class-page/defaults';

// Per-class grid layout — its own vault file inside the class's own folder,
// NOT plugin-settings (unlike the main dashboard's PageLayout[], threaded
// from main.ts -> <App> as a prop). ClassPageContent is opened from inside a
// widget instance, which only ever receives WidgetProps (app/config/
// onConfigChange) — there's no path from there back to main.ts's
// PluginData/saveData(). A vault file needs no such path: any component with
// `app` can read/write it directly, exactly like Class-Info.md/Progress.md/
// Resources.md/Tasks.md — and it gets the same "archiving the class carries
// everything with it" cascade those files already get for free.
export function classLayoutPath(app: App, slug: string): string {
  return `${classFolderPath(app, slug)}/Layout.json`;
}

// Seeds the default layout on first read (file missing) rather than at
// class-creation time — so a class created before this feature existed
// still gets a sensible layout the first time its Fullscreen is opened,
// with no migration step.
export async function readClassLayout(app: App, slug: string): Promise<LayoutItem[]> {
  const file = app.vault.getAbstractFileByPath(classLayoutPath(app, slug));
  if (!(file instanceof TFile)) return DEFAULT_CLASS_LAYOUT();

  try {
    const parsed = JSON.parse(await app.vault.read(file));
    if (Array.isArray(parsed)) return parsed as LayoutItem[];
  } catch {
    // Malformed/hand-edited file — fall back to the default rather than
    // throwing and leaving the page blank.
  }
  return DEFAULT_CLASS_LAYOUT();
}

export async function writeClassLayout(app: App, slug: string, items: LayoutItem[]): Promise<void> {
  const path = classLayoutPath(app, slug);
  const content = JSON.stringify(items, null, 2);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}
