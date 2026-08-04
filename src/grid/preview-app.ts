import type { App } from 'obsidian';

/**
 * grid/preview-app.ts — the App a library preview is allowed to see.
 *
 * The seeded source cache (core/preview-source.ts) already means a preview's
 * DATA never comes from the vault. This closes the other half: a few widgets
 * reach a codec directly instead of going through `mutate` — PresetHost's
 * onClearDone and columnOps, Kanban, TODO List and Task Manager all import
 * checklistCodec/mdTableCodec — and those calls take `app` and would write to
 * a path that doesn't exist.
 *
 * So a preview gets a deny-listed view of the real App rather than the App
 * itself. Not a mock: everything not named below passes straight through, so
 * widgets that read `app.workspace`, `app.metadataCache` or plugin state keep
 * working. What changes is that every mutating vault call becomes a no-op and
 * every read comes back empty, which means a preview CANNOT write to the vault
 * regardless of what the widget inside it does.
 *
 * `openLinkText` is stubbed for a different reason: it works fine, and that's
 * the problem — clicking a row in a preview would navigate the user out of the
 * library they're browsing.
 *
 * Reads return empty rather than throwing on purpose. A widget that asks for a
 * file it can't have should render its own empty branch, not crash the card;
 * its rows come from the seed regardless.
 */

const noopAsync = async () => { /* previews never write */ };

/** Vault methods a preview must not be able to reach. */
const VAULT_STUBS: Record<string, unknown> = {
  create:       noopAsync,
  createBinary: noopAsync,
  createFolder: noopAsync,
  modify:       noopAsync,
  modifyBinary: noopAsync,
  append:       noopAsync,
  process:      noopAsync,
  delete:       noopAsync,
  trash:        noopAsync,
  rename:       noopAsync,
  copy:         noopAsync,
  read:         async () => '',
  cachedRead:   async () => '',
  readBinary:   async () => new ArrayBuffer(0),
  getAbstractFileByPath: () => null,
  getFileByPath:         () => null,
  getFolderByPath:       () => null,
  getMarkdownFiles:      () => [],
  getAllLoadedFiles:     () => [],
  getFiles:              () => [],
  // A preview that registers a vault listener would keep firing after the
  // library closes. Hand back a ref that offref() accepts and ignores.
  on:     () => ({}),
  off:    () => { /* nothing was registered */ },
  offref: () => { /* nothing was registered */ },
};

function stubbed<T extends object>(target: T, stubs: Record<string, unknown>): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && prop in stubs) return stubs[prop];
      const value = Reflect.get(obj, prop, receiver);
      // Obsidian's API objects are class instances, so methods reached through
      // the proxy need their original `this` — bind rather than hand back a
      // free function that would lose it.
      return typeof value === 'function' ? value.bind(obj) : value;
    },
  });
}

/**
 * A read-only, navigation-free view of the App for one preview mount.
 *
 * Cheap enough to build per render, but callers should memoise it anyway: it's
 * passed as a prop, and a fresh identity every render would defeat the memo on
 * any widget that depends on `app`.
 */
export function previewApp(app: App): App {
  const vault     = stubbed(app.vault, VAULT_STUBS);
  const workspace = stubbed(app.workspace, {
    openLinkText: () => { /* a preview must not navigate out of the library */ },
    getLeaf:      () => null,
  });

  return stubbed(app, { vault, workspace });
}
