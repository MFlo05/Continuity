import React, { useCallback, useMemo, useState } from 'react';
import type { App } from 'obsidian';
import { useVaultData, asSourceRef, sourceFolder, checklistCodec, mdTableCodec } from '../core';
import type { CodecRow, Preset, SourceRef } from '../core';
import { resolveCommandCenterPath } from '../data-sources/vault-paths';
import { TFile } from 'obsidian';
import { getRenderer } from '../renderers/registry';
import { getAuthoring } from './authoring';
import { getDetailView } from './detail-views';
import type { WidgetProps } from './registry';

/**
 * widgets/PresetHost.tsx — renders a preset.
 *
 * This is the piece that makes presets work as data. It resolves the preset's
 * source, subscribes through the shared cache, looks up the renderer by id,
 * and wires the optional authoring flow. Every preset in widgets/presets.ts
 * goes through this one component — which is why adding a preset needs no new
 * component file.
 *
 * A preset therefore costs one array entry. A hero renderer still costs a
 * component, and that's the intended trade: presets for the common case, code
 * only when the UI genuinely can't be expressed as configuration.
 */

/** Resolve a preset's source descriptor against this vault and this instance. */
function resolveSource(app: App, preset: Preset, config: Record<string, unknown> | undefined): SourceRef | null {
  if (preset.source.kind === 'fixed-folder') {
    // Resolved live, so a renumbered command-center subfolder still works
    // (vault-paths.ts) and the user-configurable root is honoured.
    return { codec: preset.codec, folder: resolveCommandCenterPath(app, ...preset.source.segments) } as SourceRef;
  }
  // 'config' — whatever the settings modal's picker wrote into config.source.
  return asSourceRef(config?.source);
}

export function PresetHost({ preset, config, app, onConfigChange }: WidgetProps & { preset: Preset }) {
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [authoringOpen, setAuthoringOpen] = useState(false);
  /** The row whose detail view is open, if this preset declares one. */
  const [detailFile, setDetailFile] = useState<TFile | null>(null);

  const source = useMemo(
    () => resolveSource(app, preset, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, preset.id, config?.source],
  );

  const { rows, meta, loading, mutate } = useVaultData<CodecRow>(app, source, {
    schema:   preset.schema,
    template: preset.template,
  });

  const entry     = getRenderer(preset.renderer);
  const Authoring = getAuthoring(preset.authoring);
  const Detail    = getDetailView(preset.detail);

  // Only supplied when the preset declares a detail view — a renderer that
  // gets no handler falls back to its own default (open the note in Obsidian).
  const onOpenRow = useMemo(() => {
    if (!Detail) return undefined;
    return (row: CodecRow) => {
      const path = typeof row.path === 'string' ? row.path : null;
      const file = path ? app.vault.getAbstractFileByPath(path) : null;
      if (file instanceof TFile) setDetailFile(file);
    };
  }, [Detail, app]);

  // "Clear checked" is a checklist-codec operation, not generic CRUD, so the
  // host wires it rather than the renderer reaching for a codec itself.
  const onClearDone = useCallback(async () => {
    if (!source || preset.codec !== 'checklist') return;
    await checklistCodec.clearDone(app, source);
    await mutate.reload();
  }, [app, source, preset.codec, mutate]);

  /**
   * Column mutations are md-table's equivalent of clearDone: real codec
   * operations that the generic BoundMutations contract (add/update/remove a
   * ROW) has no room for. Same shape as above — the host binds them to the
   * source so the renderer still never sees `app` or a codec.
   */
  const columnOps = useMemo(() => {
    if (!source || preset.codec !== 'md-table') return undefined;
    const run = async (fn: () => Promise<void>) => { await fn(); await mutate.reload(); };

    /**
     * A column's key IS its header label, so renaming one orphans anything
     * stored against the old key — a resized column would silently snap back
     * to the default. Carry the width across as part of the rename, here
     * rather than in the renderer, because this is the only place that sees
     * both keys and the config at once.
     */
    const renameColumn = async (key: string, nextLabel: string) => {
      const widths = config?.columnWidths as Record<string, number> | undefined;
      const width  = widths?.[key];
      await run(() => mdTableCodec.renameColumn(app, source, key, nextLabel));
      if (width === undefined || nextLabel === key) return;
      const next = { ...widths };
      delete next[key];
      next[nextLabel] = width;
      onConfigChange?.({ columnWidths: next });
    };

    return {
      addColumn:    (label: string, atIndex?: number) => run(() => mdTableCodec.addColumn(app, source, label, atIndex)),
      renameColumn,
      removeColumn: (key: string)                     => run(() => mdTableCodec.removeColumn(app, source, key)),
      moveColumn:   (key: string, toIndex: number)    => run(() => mdTableCodec.moveColumn(app, source, key, toIndex)),
    };
  }, [app, source, preset.codec, mutate, config?.columnWidths, onConfigChange]);

  // Options are the preset's, with per-instance config allowed to override the
  // two things a user can actually change from the settings modal.
  const options = useMemo(() => {
    const base = { ...(preset.rendererOptions ?? {}) } as Record<string, unknown>;
    const title = (config?.title as string | undefined)?.trim();
    if (title) base.title = title;
    const columns = config?.columns;
    if (Array.isArray(columns) && columns.length) base.columns = columns;
    // View-level state the renderer persisted for itself (data-grid's column
    // widths). Merged the same way as title/columns so a renderer reads one
    // options bag and never touches config directly.
    const columnWidths = config?.columnWidths;
    if (columnWidths && typeof columnWidths === 'object') base.columnWidths = columnWidths;
    // A renderer that needs the source's field keys to pick default columns
    // (Record Table over an arbitrary folder) gets them from meta.
    if (!base.columns && meta && typeof meta === 'object' && 'fieldKeys' in meta) {
      base.fieldKeys = (meta as { fieldKeys: string[] }).fieldKeys;
    }
    return base;
  }, [preset.rendererOptions, config?.title, config?.columns, config?.columnWidths, meta]);

  if (!entry) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--cc2-muted)', fontSize: 12, textAlign: 'center', padding: '0 16px' }}>
        No renderer registered for "{preset.renderer}".
      </div>
    );
  }

  if (!source) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--cc2-muted)', fontSize: 12, textAlign: 'center', padding: '0 16px' }}>
        No folder configured — right-click and choose Edit Widget Settings.
      </div>
    );
  }

  const Renderer = entry.component;

  return (
    <>
      <Renderer
        rows={rows}
        // Codec-specific file-level state. SimpleList uses it to pick which
        // bucket a new item lands in; RecordTable ignores it (it reads the
        // field keys it needs off `options` instead).
        meta={meta}
        schema={preset.schema ?? []}
        mutate={mutate}
        loading={loading}
        options={options}
        tone={tone}
        wash={wash}
        app={app}
        onAdd={Authoring ? () => setAuthoringOpen(true) : undefined}
        onClearDone={preset.codec === 'checklist' ? onClearDone : undefined}
        columnOps={columnOps}
        onOptionsChange={onConfigChange}
        onOpenRow={onOpenRow}
      />

      {/* Rendered as a sibling of the renderer, not inside it — a detail view
          owns its own portaled overlay and must not be clipped by the widget's
          own bounds. */}
      {Detail && detailFile && (
        <Detail
          app={app}
          file={detailFile}
          tone={tone}
          wash={wash}
          onClose={() => setDetailFile(null)}
        />
      )}

      {Authoring && authoringOpen && (
        <Authoring
          app={app}
          folder={sourceFolder(source) ?? ''}
          onClose={() => setAuthoringOpen(false)}
          onCreated={(file: TFile) => {
            setAuthoringOpen(false);
            void mutate.reload();
            app.workspace.openLinkText(file.path, '');
          }}
        />
      )}
    </>
  );
}
