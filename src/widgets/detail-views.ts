import type { ComponentType } from 'react';
import type { App, TFile } from 'obsidian';
import { RecipeFullscreen } from './recipe-vault/RecipeFullscreen';

/**
 * widgets/detail-views.ts — rich "open this record" views a preset can opt into.
 *
 * The sibling of `authoring.ts`. That registry owns creating a record; this one
 * owns opening one. Without it, a preset's only option for a row click is
 * `openLinkText` — which drops the user into raw markdown and throws away
 * whatever purpose-built view already exists for that kind of record.
 *
 * Deliberately a tiny explicit registry rather than a general plugin hook: a
 * preset is data and can't hold a component, and keeping each exception listed
 * by name is what stops "reach into code" from becoming the default.
 *
 * A detail view is portaled and owns its own overlay — it renders alongside the
 * renderer, not inside it, so it isn't clipped by the widget's own bounds.
 */
export interface DetailViewProps {
  app:     App;
  /** The record's own note. */
  file:    TFile;
  onClose: () => void;
  /** Forwarded so the detail view can match the widget's accent. */
  tone?:   string;
  wash?:   boolean;
}

export const detailRegistry: Record<string, ComponentType<any>> = {
  'recipe-fullscreen': RecipeFullscreen,
};

export function getDetailView(id: string | undefined): ComponentType<any> | undefined {
  return id ? detailRegistry[id] : undefined;
}
