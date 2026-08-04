import type { ComponentType } from 'react';
import type { CodecId } from '../core';
import { RecordTable } from './RecordTable';
import { SimpleList } from './SimpleList';
import { DataGrid } from './DataGrid';

/**
 * renderers/registry.ts — renderer id → component.
 *
 * The "renderers" half of the Phase 4 split. A preset names a renderer by id;
 * this is where that id resolves. Declaring which codecs a renderer speaks is
 * what will eventually drive the "View as…" swap in the settings modal — a
 * source can be re-rendered by any renderer sharing its codec, with no data
 * migration.
 *
 * "View as…" is finally REAL, and `md-table` is what made it so: `data-grid`
 * and `table` both speak it, so one table can be redrawn editable or read-only
 * over the same source with no data migration. Note that the obvious-looking
 * pairing — a kanban board over `checklist`, swappable with `simple-list` —
 * would NOT have worked: a board wants horizontal room a list column doesn't
 * have, so the swap would cram one into the other's shape. A useful swap needs
 * two renderers with compatible footprints, not just a shared codec.
 *
 * Hero renderers deliberately do NOT live here. Task Manager's burner, the
 * Kanban board and the Class Scheduler are components bound to one job, not
 * interchangeable views over a source — they stay component-backed widgets in
 * widgets/registry.ts. That's a legitimate resting place, not a gap.
 */
export interface RendererEntry {
  id:     string;
  label:  string;
  /** Codecs whose rows this renderer can draw. */
  codecs: CodecId[];
  /** Props are the renderer's own; PresetHost supplies them. */
  component: ComponentType<any>;
}

/**
 * Renderer ids name a DRAWING CAPABILITY ('table'), never a widget ('record-table').
 * Keeping those namespaces distinct matters: several presets share one
 * renderer, so a renderer id that reads like a widget name suggests a 1:1
 * relationship that doesn't exist.
 */
export const rendererRegistry: Record<string, RendererEntry> = {
  table: {
    id:     'table',
    label:  'Table',
    codecs: ['record-folder', 'line-table', 'md-table'],
    component: RecordTable,
  },
  'simple-list': {
    id:     'simple-list',
    label:  'List',
    codecs: ['checklist'],
    component: SimpleList,
  },
  'data-grid': {
    id:     'data-grid',
    label:  'Editable Grid',
    codecs: ['md-table'],
    component: DataGrid,
  },
};

export function getRenderer(id: string): RendererEntry | undefined {
  return rendererRegistry[id];
}

/** Renderers that can draw a given codec — the "View as…" candidate list. */
export function renderersForCodec(codec: CodecId): RendererEntry[] {
  return Object.values(rendererRegistry).filter(r => r.codecs.includes(codec));
}
