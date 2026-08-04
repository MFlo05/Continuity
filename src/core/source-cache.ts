import type { App } from 'obsidian';
import type { CodecRow, FieldDef, SourceRef } from './types';
import { sourceKey } from './types';
import { getCodec } from './codec-registry';
import { subscribeVault } from './vault-events';
import { isPreviewSource, previewSeed } from './preview-source';

/**
 * core/source-cache.ts — one parsed snapshot per source, shared by every
 * subscriber.
 *
 * Generalised out of data-sources/budgetStore.ts, which solved this for the
 * Finance suite alone: six widgets pointed at one ledger used to mean six
 * independent reads and six parses of the same file on every change. The
 * vault-event hub already deduped the *listeners*; this deduplicates the
 * *reads and parses* too, for every codec rather than just `line-table`.
 *
 * Ref-counted: the first subscriber for a source attaches its vault
 * subscription and kicks the initial load; the last one to leave tears the
 * subscription down and drops the entry. A subscriber joining an
 * already-loaded source gets the existing snapshot immediately, with no
 * second read.
 *
 * Snapshot identity is load-bearing. `getSourceSnapshot` must return the SAME
 * object when nothing has changed — useSyncExternalStore compares by identity
 * and would re-render forever otherwise. Every entry therefore holds one
 * frozen snapshot that is replaced wholesale, never mutated in place.
 *
 * Keyed by source + schema, not by App: Obsidian runs one vault per process,
 * and the dashboard and every Class Page leaf share that one App (same
 * assumption the vault-event hub and budgetStore both already made).
 *
 * PREVIEW SOURCES (core/preview-source.ts) are the one kind of entry that
 * never loads: the Widget Library seeds their snapshot up front, so they get
 * an entry with no watcher and no read. Three branches below implement that,
 * and they're what let the library render 17 real widget components without a
 * single vault operation.
 */

export interface SourceSnapshot<Row extends CodecRow = CodecRow, Meta = unknown> {
  rows:    Row[];
  meta:    Meta | null;
  loading: boolean;
  error:   string | null;
}

const NO_ROWS: never[] = [];

/** Returned for an unconfigured source, and shared so its identity is stable. */
const IDLE: SourceSnapshot<never, never> = Object.freeze({
  rows: NO_ROWS, meta: null, loading: false, error: null,
});

type RenameListener = (oldPath: string, newPath: string) => void;

interface Entry {
  src:       SourceRef;
  schema:    FieldDef[];
  /** Whatever the FIRST subscriber passed; ensure() is idempotent. */
  template:  string | undefined;
  snapshot:  SourceSnapshot<any, any>;
  listeners: Set<() => void>;
  /** Per-subscriber, not per-entry: each hook re-points its own source. */
  renames:   Set<RenameListener>;
  unwatch:   (() => void) | null;
  /** Bumped per load; a resolved read that isn't the newest is dropped. */
  seq:       number;
}

const entries = new Map<string, Entry>();

/** Schema participates in the key — two schemas over one file are two parses. */
function cacheKey(src: SourceRef, schema: FieldDef[]): string {
  return schema.length ? `${sourceKey(src)}#${JSON.stringify(schema)}` : sourceKey(src);
}

function publish(entry: Entry, next: SourceSnapshot<any, any>): void {
  entry.snapshot = Object.freeze(next);
  entry.listeners.forEach(l => l());
}

async function load(app: App, entry: Entry): Promise<void> {
  const codec = getCodec(entry.src.codec);
  if (!codec) {
    publish(entry, { rows: NO_ROWS, meta: null, loading: false, error: `No codec registered for "${entry.src.codec}".` });
    return;
  }

  const seq = ++entry.seq;
  publish(entry, { ...entry.snapshot, loading: true });

  try {
    if (entry.template !== undefined) await codec.ensure(app, entry.src, entry.template);

    // One pass when the codec offers it — otherwise read() and readMeta()
    // would each open and parse the same file.
    const { rows, meta } = codec.readAll
      ? await codec.readAll(app, entry.src, entry.schema)
      : await Promise.all([
          codec.read(app, entry.src, entry.schema),
          codec.readMeta?.(app, entry.src) ?? Promise.resolve(null),
        ]).then(([r, m]) => ({ rows: r, meta: m }));

    if (seq !== entry.seq) return;   // superseded by a newer load
    publish(entry, { rows, meta: meta ?? null, loading: false, error: null });
  } catch (e) {
    if (seq !== entry.seq) return;
    publish(entry, {
      rows: NO_ROWS, meta: null, loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface SubscribeSourceOptions {
  schema?:     FieldDef[];
  template?:   string;
  debounceMs?: number;
  onRename?:   RenameListener;
}

const EMPTY_SCHEMA: FieldDef[] = [];

/**
 * Subscribe to a source's shared snapshot. Returns the unsubscribe function.
 * Only the FIRST subscriber triggers a read — that's the deduplication.
 */
export function subscribeSource(
  app: App,
  src: SourceRef,
  options: SubscribeSourceOptions,
  onChange: () => void,
): () => void {
  const schema = options.schema ?? EMPTY_SCHEMA;
  const key    = cacheKey(src, schema);

  let entry = entries.get(key);
  const isFirst = !entry;
  // A preview entry is fully formed the moment it's created — its rows came
  // from the seed, so there is nothing to watch and nothing to read.
  const preview = isPreviewSource(src);

  if (!entry) {
    entry = {
      src, schema, template: options.template,
      snapshot: preview ? (previewSeed(src, schema) ?? IDLE) : IDLE,
      listeners: new Set(), renames: new Set(),
      unwatch: null, seq: 0,
    };
    entries.set(key, entry);

    if (!preview) {
      const codec   = getCodec(src.codec);
      const targets = codec?.watchTargets?.(app, src) ?? defaultTargets(src);
      const self    = entry;
      entry.unwatch = subscribeVault(app, {
        ...targets,
        debounceMs: options.debounceMs,
        onChange:  () => { void load(app, self); },
        onRename:  (oldPath, newPath) => self.renames.forEach(r => r(oldPath, newPath)),
      });
    }
  }

  entry.listeners.add(onChange);
  if (options.onRename) entry.renames.add(options.onRename);

  // Kick the load AFTER registering, so the first subscriber sees the
  // loading:true publish rather than missing it.
  if (isFirst && !preview) void load(app, entry);

  const self = entry;
  return () => {
    self.listeners.delete(onChange);
    if (options.onRename) self.renames.delete(options.onRename);
    if (self.listeners.size === 0) {
      self.unwatch?.();
      self.seq++;              // orphan any in-flight load
      entries.delete(key);
    }
  };
}

/** The current shared snapshot. Stable identity while nothing changes. */
export function getSourceSnapshot<Row extends CodecRow = CodecRow, Meta = unknown>(
  src: SourceRef | null,
  schema: FieldDef[] = EMPTY_SCHEMA,
): SourceSnapshot<Row, Meta> {
  if (!src) return IDLE as unknown as SourceSnapshot<Row, Meta>;
  const entry = entries.get(cacheKey(src, schema));
  if (entry) return entry.snapshot as SourceSnapshot<Row, Meta>;
  // useSyncExternalStore calls this once BEFORE subscribing. A real source has
  // nothing to show yet, but a preview's rows already exist — returning the
  // seed here is what stops every live preview flashing its empty state for
  // one frame on mount. The seed is frozen and stable, so identity holds.
  return (previewSeed<Row, Meta>(src, schema) ?? IDLE) as SourceSnapshot<Row, Meta>;
}

/**
 * Replace a preview entry's snapshot and notify its subscribers.
 *
 * The write path for fixture data: useVaultData's mutation binding calls this
 * instead of a codec when the source is a preview, which is what makes the
 * library's detail-pane previews actually respond to being clicked. No-op for
 * a real source — this must never become a back door around the codec layer.
 */
export function publishPreviewSnapshot<Row extends CodecRow = CodecRow>(
  src: SourceRef | null,
  schema: FieldDef[],
  next: { rows: Row[]; meta: unknown },
): void {
  if (!src || !isPreviewSource(src)) return;
  const entry = entries.get(cacheKey(src, schema));
  if (!entry) return;
  publish(entry, { rows: next.rows, meta: next.meta, loading: false, error: null });
}

/**
 * Force a re-read and notify every subscriber. Called after a mutation, so all
 * widgets on that source update together rather than only the one that wrote.
 */
export function invalidateSource(app: App, src: SourceRef | null, schema: FieldDef[] = EMPTY_SCHEMA): Promise<void> {
  if (!src || isPreviewSource(src)) return Promise.resolve();   // a seed has nothing to re-read
  const entry = entries.get(cacheKey(src, schema));
  if (!entry) return Promise.resolve();
  return load(app, entry);
}

function defaultTargets(src: SourceRef): { paths?: string[]; folders?: string[] } {
  const path = 'path' in src ? src.path : null;
  if (path) return { paths: [path] };
  return 'folder' in src ? { folders: [src.folder] } : {};
}

/** Live entry count — for debugging leaked subscriptions only. */
export function cachedSourceCount(): number {
  return entries.size;
}

/** Test helper. Never called in normal operation. */
export function clearSourceCache(): void {
  entries.forEach(e => e.unwatch?.());
  entries.clear();
}
