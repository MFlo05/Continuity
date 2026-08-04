import type { Codec, CodecId, CodecRow } from './types';

/**
 * core/codec-registry.ts — codec id → implementation lookup.
 *
 * useVaultData resolves a codec from `SourceRef.codec` alone, which is what
 * makes a renderer swap ("View as…") free: two renderers over the same source
 * hit the same codec instance with no wiring between them.
 *
 * PHASE 0 REGISTERS NOTHING. The three codecs land as their families are
 * ported — checklist in Phase 1 (promoted from todos.ts), record-folder in
 * Phase 2, line-table in Phase 3 (wrapping budget.ts's ledger format). Until
 * then getCodec() returns null and useVaultData surfaces that as an error
 * state rather than throwing, so a half-migrated build never blanks a page.
 */

const codecs = new Map<CodecId, Codec<any>>();

export function registerCodec<Row extends CodecRow>(codec: Codec<Row>): void {
  if (codecs.has(codec.id)) {
    // Two implementations claiming one id means someone forked a codec
    // instead of extending it — the discipline rule this refactor exists to
    // enforce (REFACTOR-HANDOFF.md §1.3). Loud, but non-fatal.
    console.warn(`[cc2] codec "${codec.id}" registered twice — keeping the first.`);
    return;
  }
  codecs.set(codec.id, codec);
}

export function getCodec<Row extends CodecRow>(id: CodecId): Codec<Row> | null {
  return (codecs.get(id) as Codec<Row> | undefined) ?? null;
}

export function registeredCodecIds(): CodecId[] {
  return [...codecs.keys()];
}

/** Test/reload helper — never called in normal operation. */
export function clearCodecs(): void {
  codecs.clear();
}
