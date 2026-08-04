import type { App, EventRef, TAbstractFile } from 'obsidian';

/**
 * core/vault-events.ts — the ONE vault-event subscription service.
 *
 * Replaces the ~10 hand-rolled `app.vault.on('modify', …)` blocks scattered
 * across src/data-sources/ (todos.ts:381, budget.ts:340/487, recipes.ts:462,
 * class-info.ts:371, meetings.ts:296, meal-plan.ts:203, class-schedule.ts:252,
 * class-contacts.ts:73, recurring.ts:156). Each of those registers its own
 * pair of vault listeners per mounted widget, so a dashboard with 15 widgets
 * runs 15+ independent handlers over every single write in the vault.
 *
 * Here: exactly FOUR listeners per App for the whole plugin, attached lazily
 * on the first subscriber and detached again when the last one leaves. Each
 * subscriber declares the paths/folders it cares about and gets a debounced
 * callback, so a burst of writes (Obsidian fires 'modify' repeatedly while a
 * note is being typed in) collapses into one re-read.
 *
 * Rename handling is the other reason this is centralized: today a renamed
 * file silently stops updating its widget, because the widget is still
 * watching the dead path. Subscribers get onRename(oldPath, newPath) — for
 * the watched file itself AND for any ancestor folder rename that carries it
 * — so the caller can re-point its stored SourceRef instead of going quiet.
 *
 * Phase 0 note: nothing calls this yet except useVaultData. The legacy
 * watchers stay exactly as they are until their widget is ported.
 */

export interface VaultWatchTargets {
  /** Exact vault paths to watch. */
  paths?:   string[];
  /** Folder paths — any create/modify/delete/rename inside them counts. */
  folders?: string[];
}

export interface VaultSubscription extends VaultWatchTargets {
  onChange:    () => void;
  /** Fired when a watched path moves (direct rename, or an ancestor folder's). */
  onRename?:   (oldPath: string, newPath: string) => void;
  /** Coalescing window. 150ms matches how fast Obsidian re-fires 'modify'. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 150;

interface Entry {
  paths:      Set<string>;
  folders:    string[];
  onChange:   () => void;
  onRename?:  (oldPath: string, newPath: string) => void;
  debounceMs: number;
  timer:      ReturnType<typeof setTimeout> | null;
}

const isInside = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(`${folder}/`);

function entryTouched(entry: Entry, path: string): boolean {
  if (entry.paths.has(path)) return true;
  return entry.folders.some(f => isInside(path, f));
}

class VaultEventHub {
  private entries = new Set<Entry>();
  private refs: EventRef[] = [];

  constructor(private app: App) {}

  add(entry: Entry): void {
    this.entries.add(entry);
    if (this.refs.length === 0) this.attach();
  }

  remove(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    this.entries.delete(entry);
    if (this.entries.size === 0) this.detach();
  }

  private attach(): void {
    const touched = (file: TAbstractFile) => this.dispatch(file.path);
    this.refs = [
      this.app.vault.on('modify', touched),
      this.app.vault.on('create', touched),
      this.app.vault.on('delete', touched),
      this.app.vault.on('rename', (file, oldPath) => this.dispatchRename(oldPath, file.path)),
    ];
  }

  private detach(): void {
    this.refs.forEach(ref => this.app.vault.offref(ref));
    this.refs = [];
  }

  private dispatch(path: string): void {
    this.entries.forEach(entry => {
      if (entryTouched(entry, path)) this.schedule(entry);
    });
  }

  /**
   * A rename reaches a subscriber three ways, and all three have to notify:
   *   1. the watched file itself was renamed;
   *   2. a folder the watched file lives under was renamed (its path changed
   *      without any event ever naming it);
   *   3. a watched folder was renamed, or something moved into/out of one.
   * Cases 1 and 2 also fire onRename with the new path so the caller can
   * persist it — that's the whole point of centralizing this.
   */
  private dispatchRename(oldPath: string, newPath: string): void {
    this.entries.forEach(entry => {
      let notify = false;

      entry.paths.forEach(watched => {
        if (!isInside(watched, oldPath)) return;
        const moved = newPath + watched.slice(oldPath.length);
        entry.onRename?.(watched, moved);
        notify = true;
      });

      entry.folders.forEach(watched => {
        if (isInside(watched, oldPath)) {
          entry.onRename?.(watched, newPath + watched.slice(oldPath.length));
          notify = true;
        }
      });

      if (notify || entryTouched(entry, oldPath) || entryTouched(entry, newPath)) {
        this.schedule(entry);
      }
    });
  }

  private schedule(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.onChange();
    }, entry.debounceMs);
  }

  get size(): number { return this.entries.size; }
}

// Keyed by App rather than a module singleton: the dashboard leaf and each
// Class Page leaf are separate React roots, but they share one App — so they
// share one hub, which is exactly what we want. A WeakMap means nothing is
// retained if the App ever goes away (plugin reload / vault switch).
const hubs = new WeakMap<App, VaultEventHub>();

function hubFor(app: App): VaultEventHub {
  let hub = hubs.get(app);
  if (!hub) { hub = new VaultEventHub(app); hubs.set(app, hub); }
  return hub;
}

/**
 * Subscribe to vault changes for a set of paths/folders. Returns the
 * unsubscribe function — call it from a useEffect cleanup.
 */
export function subscribeVault(app: App, sub: VaultSubscription): () => void {
  const entry: Entry = {
    paths:      new Set((sub.paths ?? []).filter(Boolean)),
    folders:    (sub.folders ?? []).filter(Boolean),
    onChange:   sub.onChange,
    onRename:   sub.onRename,
    debounceMs: sub.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    timer:      null,
  };

  const hub = hubFor(app);
  hub.add(entry);
  return () => hub.remove(entry);
}

/** Live subscriber count — for debugging leaked subscriptions only. */
export function vaultSubscriberCount(app: App): number {
  return hubs.get(app)?.size ?? 0;
}
