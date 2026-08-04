import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { App } from 'obsidian';
import type { BoundMutations, CodecRow, FieldDef, RowId, SourceRef } from './types';
import { sourceKey, withSourceLocation } from './types';
import { getCodec } from './codec-registry';
import {
  getSourceSnapshot, invalidateSource, publishPreviewSnapshot, subscribeSource,
  type SourceSnapshot,
} from './source-cache';
import { isPreviewSource } from './preview-source';

/**
 * core/useVaultData.ts — the single hook every renderer reads data through.
 *
 * Collapses the load/watch/reload triangle every widget used to hand-write
 * (a useCallback loader, a useEffect that calls it then registers a watcher,
 * and a manual re-call after every mutation) into one call:
 *
 *   const { rows, meta, loading, mutate } = useVaultData(app, src);
 *
 * What it owns, so no renderer has to:
 *   - resolving the codec from src.codec
 *   - ensure() scaffolding on first load (plug-and-play stays — handoff §1.1)
 *   - ONE shared read/parse per source across every widget pointed at it
 *     (core/source-cache.ts), on ONE debounced vault subscription
 *     (core/vault-events.ts)
 *   - rename following: a renamed source keeps updating, and onSourceMoved
 *     lets the widget persist the new path back into its config
 *
 * The hook itself is now a thin useSyncExternalStore view over the shared
 * cache. Six widgets on one ledger means one parse, not six — which is what
 * let data-sources/budgetStore.ts stop being a bespoke cache.
 *
 * Renderers must never import obsidian vault APIs for I/O — everything goes
 * through here (REFACTOR-HANDOFF.md §5).
 */

export interface UseVaultDataOptions {
  /** Field definitions handed to the codec's parser (from the preset). */
  schema?: FieldDef[];
  /** When set, the source is ensure()'d with this template before first read. */
  template?: string;
  /** Coalescing window for vault events; defaults to the hub's 150ms. */
  debounceMs?: number;
  /**
   * Called when the underlying file/folder is renamed or moved. The hook
   * already re-points itself at the new location; this is how the widget
   * persists that (onConfigChange({ source: next })) so it survives a reload.
   */
  onSourceMoved?: (next: SourceRef) => void;
}

export interface VaultData<Row extends CodecRow, Meta = unknown> {
  rows:    Row[];
  /** Codec-specific file-level state (checklist: buckets). Null until loaded. */
  meta:    Meta | null;
  loading: boolean;
  /** Set when no codec is registered for this source, or a read threw. */
  error:   string | null;
  mutate:  BoundMutations<Row>;
  /** The source actually in use — differs from the passed one after a rename. */
  source:  SourceRef | null;
}

const EMPTY_SCHEMA: FieldDef[] = [];

export function useVaultData<Row extends CodecRow = CodecRow, Meta = unknown>(
  app: App,
  src: SourceRef | null,
  options: UseVaultDataOptions = {},
): VaultData<Row, Meta> {
  const { schema = EMPTY_SCHEMA, template, debounceMs, onSourceMoved } = options;

  // The live source. Seeded from the caller's src, then re-pointed in place
  // when the watcher reports a rename — the config write-back is async (and
  // may never happen, e.g. on a Class Page's injected config), so the hook
  // can't wait on the prop coming back changed.
  const [live, setLive] = useState<SourceRef | null>(src);
  const passedKey = sourceKey(src);
  useEffect(() => { setLive(src); }, [passedKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const movedRef = useRef(onSourceMoved);
  movedRef.current = onSourceMoved;

  const liveKey   = sourceKey(live);
  // Schemas are usually fresh array literals; the serialized form is what
  // actually decides whether anything changed.
  const schemaKey = schema.length ? JSON.stringify(schema) : '';

  // Both callbacks must be referentially stable while the source is unchanged
  // — useSyncExternalStore re-subscribes whenever `subscribe` changes identity,
  // and re-renders forever if `getSnapshot` returns a fresh object each call.
  const subscribe = useCallback((onChange: () => void) => {
    if (!live) return () => { /* unconfigured — nothing to watch */ };
    return subscribeSource(app, live, {
      schema, template, debounceMs,
      onRename: (_oldPath, newPath) => {
        const next = withSourceLocation(live, newPath);
        setLive(next);
        movedRef.current?.(next);
      },
    }, onChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, liveKey, schemaKey, template, debounceMs]);

  const getSnapshot = useCallback(
    (): SourceSnapshot<Row, Meta> => getSourceSnapshot<Row, Meta>(live, schema),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveKey, schemaKey],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const mutate = useMemo<BoundMutations<Row>>(
    () => (isPreviewSource(live)
      ? bindPreviewMutations<Row>(live!, schema)
      : bindMutations<Row>(app, live, () => invalidateSource(app, live, schema))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, liveKey, schemaKey],
  );

  return {
    rows:    snapshot.rows,
    meta:    snapshot.meta,
    loading: snapshot.loading,
    error:   snapshot.error,
    mutate,
    source:  live,
  };
}

/**
 * Binds a codec's CRUD to one source, so a renderer never sees either.
 *
 * Each mutation invalidates the shared snapshot rather than reloading one
 * hook's private copy — so every widget on that source updates together, not
 * just the one that happened to do the writing. The debounced vault event
 * fires too and reloads again; both reads hit the same file, so the second is
 * a no-op the user never sees.
 */
function bindMutations<Row extends CodecRow>(
  app: App,
  src: SourceRef | null,
  reload: () => Promise<void>,
): BoundMutations<Row> {
  const codec = src ? getCodec<Row>(src.codec) : null;
  const noop  = async () => { /* unconfigured source — nothing to write to */ };
  if (!src || !codec) return { add: noop, update: noop, remove: noop, reload: noop };

  const run = async (fn: () => Promise<void>): Promise<void> => { await fn(); await reload(); };
  return {
    add:    (row: Partial<Row>)              => run(() => codec.add(app, src, row)),
    update: (id: RowId, patch: Partial<Row>) => run(() => codec.update(app, src, id, patch)),
    remove: (id: RowId)                      => run(() => codec.remove(app, src, id)),
    reload: () => reload(),
  };
}

/**
 * The same CRUD contract over a SEEDED snapshot instead of a file — what the
 * Widget Library's interactive previews write through.
 *
 * Generic on purpose: every codec's rows carry a stable `id` (core/types.ts's
 * CodecRow), and add/update/remove are all id-addressed, so this needs no
 * per-codec knowledge. A preview that checks a box, drags a card between
 * buckets or adds a row goes through here and re-publishes; nothing reaches
 * disk, and the state resets when the preview unmounts.
 *
 * Deliberately NOT a general escape hatch — publishPreviewSnapshot ignores any
 * source that isn't under PREVIEW_ROOT, so this can't be pointed at real data.
 */
function bindPreviewMutations<Row extends CodecRow>(
  src: SourceRef,
  schema: FieldDef[],
): BoundMutations<Row> {
  const current = () => getSourceSnapshot<Row>(src, schema);
  const write = (rows: Row[]) => {
    publishPreviewSnapshot<Row>(src, schema, { rows, meta: current().meta });
    return Promise.resolve();
  };

  return {
    add: (row: Partial<Row>) =>
      write([...current().rows, { id: `preview-${Date.now()}`, ...row } as Row]),
    update: (id: RowId, patch: Partial<Row>) =>
      write(current().rows.map(r => (r.id === id ? { ...r, ...patch } : r))),
    remove: (id: RowId) =>
      write(current().rows.filter(r => r.id !== id)),
    reload: async () => { /* a seed has nothing to re-read */ },
  };
}

// ── Multi-source variant ──────────────────────────────────────────────────

export interface VaultDataMulti<Row extends CodecRow, Meta = unknown> {
  /** Keyed by sourceKey(src). */
  bySource: Map<string, { rows: Row[]; meta: Meta | null }>;
  loading:  boolean;
  error:    string | null;
  rowsFor(src: SourceRef | null): Row[];
  metaFor(src: SourceRef | null): Meta | null;
  mutateFor(src: SourceRef | null): BoundMutations<Row>;
  reload(): Promise<void>;
}

/**
 * One widget over N sources — TODO List's class-linked mode, where the tabs
 * are classes and each class's own Tasks.md is a separate checklist file, and
 * every tab's unread count has to be live at once (so lazy per-tab loading
 * isn't an option).
 *
 * Hooks can't be called in a loop, so this is a sibling of useVaultData rather
 * than something a renderer assembles. It subscribes each source through the
 * same shared cache, so a source also shown by a single-source widget
 * elsewhere on the page is still only read once.
 */
export function useVaultDataMulti<Row extends CodecRow = CodecRow, Meta = unknown>(
  app: App,
  sources: SourceRef[],
  options: Omit<UseVaultDataOptions, 'onSourceMoved'> = {},
): VaultDataMulti<Row, Meta> {
  const { schema = EMPTY_SCHEMA, template, debounceMs } = options;

  // Sources arrive as a fresh array every render; the joined key is what
  // actually decides whether anything changed.
  const sourcesKey = sources.map(sourceKey).join(' ');
  const schemaKey  = schema.length ? JSON.stringify(schema) : '';

  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Bumped whenever any subscribed source publishes, to pull fresh snapshots.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const srcs = sourcesRef.current;
    if (srcs.length === 0) return;

    const bump = () => setVersion(v => v + 1);
    const unsubs = srcs.map(src =>
      subscribeSource(app, src, { schema, template, debounceMs }, bump),
    );
    return () => unsubs.forEach(u => u());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, sourcesKey, schemaKey, template, debounceMs]);

  return useMemo(() => {
    const srcs = sourcesRef.current;
    const bySource = new Map<string, { rows: Row[]; meta: Meta | null }>();
    let loading = false;
    let error: string | null = null;

    for (const src of srcs) {
      const snap = getSourceSnapshot<Row, Meta>(src, schema);
      bySource.set(sourceKey(src), { rows: snap.rows, meta: snap.meta });
      if (snap.loading) loading = true;
      if (snap.error && !error) error = snap.error;
    }

    return {
      bySource,
      loading,
      error,
      rowsFor: (src: SourceRef | null) => (src ? bySource.get(sourceKey(src))?.rows ?? [] : []),
      metaFor: (src: SourceRef | null) => (src ? bySource.get(sourceKey(src))?.meta ?? null : null),
      mutateFor: (src: SourceRef | null) =>
        bindMutations<Row>(app, src, () => invalidateSource(app, src, schema)),
      reload: async () => {
        await Promise.all(sourcesRef.current.map(s => invalidateSource(app, s, schema)));
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, sourcesKey, schemaKey, version]);
}
