import type { CodecRow, FieldDef, SourceRef } from './types';
import { sourceKey } from './types';
import type { SourceSnapshot } from './source-cache';

/**
 * core/preview-source.ts — a source that never touches the vault.
 *
 * The Widget Library renders real widget components with sample data. Those
 * components read through useVaultData like everything else, so rather than
 * mocking React or forking a "preview mode" into 17 widgets, we give them a
 * source whose snapshot is SEEDED rather than read.
 *
 * A preview source is an ordinary SourceRef whose path/folder sits under
 * PREVIEW_ROOT. source-cache.ts recognises that and skips both the codec read
 * and the vault subscription entirely — so `CLAUDE.md` non-negotiable #3 holds
 * by construction, not by discipline: the codec layer is never invoked, so
 * there is no I/O to accidentally leave in.
 *
 * The reserved root is a leading-dot folder that Obsidian hides and that the
 * plugin never writes to. It exists purely as a key namespace; no file or
 * folder of this name is ever created.
 */

export const PREVIEW_ROOT = '.cc2-preview';

/**
 * True when this source is a library fixture rather than real vault data.
 *
 * Matches on any PATH SEGMENT starting with the reserved root, not just the
 * first one. That's not laxness — it's what the Finance suite needs. Those
 * widgets don't take a source at all; they take a ledger NAME and derive a
 * path from it (budget.ts's ledgerYearSource / indexFilePath), so the only
 * place a preview marker can be injected is the ledger name itself, which
 * lands mid-path: `…/Finance/Ledgers/.cc2-preview-ledger/2026-….md`.
 *
 * Segment-aware rather than a bare `includes()` so a real note that merely has
 * the string in its filename can't be mistaken for a fixture.
 */
export function isPreviewSource(src: SourceRef | null): boolean {
  if (!src) return false;
  const location = 'path' in src ? src.path : src.folder;
  return location.split('/').some(segment => segment.startsWith(PREVIEW_ROOT));
}

/**
 * Seeded snapshots, keyed the same way the source cache keys its entries.
 * Schema participates for the same reason it does there — two schemas over one
 * location are two different row sets.
 */
const seeds = new Map<string, SourceSnapshot<any, any>>();

function seedKey(src: SourceRef, schema: FieldDef[]): string {
  return schema.length ? `${sourceKey(src)}#${JSON.stringify(schema)}` : sourceKey(src);
}

/**
 * Register the rows a preview source hands out. Idempotent and safe to call on
 * every library open — re-seeding replaces the payload rather than stacking.
 *
 * Frozen on the way in: the source cache compares snapshots by identity
 * (useSyncExternalStore re-renders forever otherwise), so a preview snapshot
 * must be replaced wholesale, never mutated in place. Same contract as a real
 * entry's snapshot.
 */
export function seedPreviewSource<Row extends CodecRow = CodecRow>(
  src: SourceRef,
  rows: Row[],
  meta: unknown = null,
  schema: FieldDef[] = [],
): void {
  seeds.set(seedKey(src, schema), Object.freeze({ rows, meta, loading: false, error: null }));
}

/** The seeded snapshot for a source, or null when nothing was registered. */
export function previewSeed<Row extends CodecRow = CodecRow, Meta = unknown>(
  src: SourceRef,
  schema: FieldDef[] = [],
): SourceSnapshot<Row, Meta> | null {
  return (seeds.get(seedKey(src, schema)) as SourceSnapshot<Row, Meta> | undefined) ?? null;
}

/** Test helper. Never called in normal operation. */
export function clearPreviewSeeds(): void {
  seeds.clear();
}
