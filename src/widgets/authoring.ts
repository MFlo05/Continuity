import type { ComponentType } from 'react';
import type { App, TFile } from 'obsidian';
import { MeetingCreateModal } from './meeting-log/MeetingCreateModal';

/**
 * widgets/authoring.ts — bespoke "+ New…" flows a preset can opt into.
 *
 * A preset is data, so it can't hold a component — but template-driven
 * creation is real functionality that a generic "add a row" can't express.
 * Meeting Log's flow picks a template, substitutes `{{placeholders}}`, reads
 * the template's own `cc2-extra-fields` directive, and writes real Obsidian
 * wikilinks for project/related-meeting links. None of that is expressible as
 * a config bundle.
 *
 * So a preset names an authoring flow by id, and this maps the id to the
 * component. Deliberately a tiny, explicit registry rather than a general
 * plugin hook: the whole point of presets is that reaching into code is the
 * exception, and an id in a list makes each exception visible.
 */
export interface AuthoringProps {
  app:       App;
  /** The preset's resolved source folder, for flows that need to know it. */
  folder:    string;
  onClose:   () => void;
  /** Called with the created file so the host can reload and open it. */
  onCreated: (file: TFile) => void;
}

export const authoringRegistry: Record<string, ComponentType<any>> = {
  'meeting-create': MeetingCreateModal,
};

export function getAuthoring(id: string | undefined): ComponentType<any> | undefined {
  return id ? authoringRegistry[id] : undefined;
}
