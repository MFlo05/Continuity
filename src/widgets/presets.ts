import type { Preset, SourcePickerConfig } from '../core';
import { FLAT_TEMPLATE, TABLE_TEMPLATE } from '../core';
import type { TableColumn } from '../renderers/RecordTable';

/**
 * widgets/presets.ts — the preset list. DATA. No JSX, no components.
 *
 * This is the file that should grow when a new widget is wanted. Each entry is
 * a bundle of existing parts: which codec reads the data, which renderer draws
 * it, what options that renderer gets, and where the files live. PresetHost
 * turns any entry here into a working widget, so nothing else has to change —
 * no new folder, no new component, no new registry edit.
 *
 * Note that preset ids and renderer ids are DIFFERENT namespaces. `table` and
 * `simple-list` are drawing capabilities; `record-table`, `meeting-log`,
 * `checklist` and `grocery-list` are widgets that use them. Four presets over
 * two renderers — that's the ratio the refactor is aiming for.
 *
 * See WIDGET-INVENTORY.md's decision ladder: a new use case should stop here.
 * A new renderer (code) is rare; a new codec should approach never.
 */

// ── Pickers ───────────────────────────────────────────────────────────────

const FOLDER_PICKER: SourcePickerConfig = {
  kind:      'vault-folder',
  codec:     'record-folder',
  label:     'Folder of notes',
  nameField: { label: 'Widget name', placeholder: 'e.g. Recipes, Reading List…', configKey: 'title' },
  columns:   true,
};

/**
 * Offers every note in the vault that already contains checkbox items, plus a
 * "create new" path into <root>/checklists/. Deliberately NOT scoped to
 * command-center: a packing list living in a project folder is still a
 * checklist, and the metadata-cache scan costs nothing.
 */
const CHECKLIST_PICKER: SourcePickerConfig = {
  kind:              'vault-file',
  codec:             'checklist',
  label:             'Checklist note',
  nameField:         { label: 'Widget name', placeholder: 'e.g. Packing List, Errands…', configKey: 'title' },
  requireCheckboxes: true,
  scaffoldSegments:  ['checklists'],
};

/** Grocery lists keep their own folder — same picker, different scaffold home. */
const GROCERY_PICKER: SourcePickerConfig = {
  ...CHECKLIST_PICKER,
  label:            'Grocery list',
  nameField:        { label: 'Widget name', placeholder: 'e.g. Weekly Shop…', configKey: 'title' },
  scaffoldSegments: ['groceries'],
};

/**
 * Any markdown table in the vault. No `requireCheckboxes`-style filter is
 * needed — a table either parses or it doesn't, and the picker only lists ones
 * that did. Scoping to non-`.obsidian/` paths happens in discoverTables(),
 * because most of this vault's tables live in the plugin's own docs.
 */
const TABLE_PICKER: SourcePickerConfig = {
  kind:             'vault-table',
  codec:            'md-table',
  label:            'table',
  nameField:        { label: 'Widget name', placeholder: 'e.g. Reading List, Gear…', configKey: 'title' },
  scaffoldSegments: ['tables'],
};

const MEETING_COLUMNS: TableColumn[] = [
  { key: 'date',      label: 'Date',      kind: 'date' },
  { key: 'title',     label: 'Title',     kind: 'text', primary: true },
  { key: 'attendees', label: 'Attendees', kind: 'chip' },
];

// ── Presets ───────────────────────────────────────────────────────────────

export const PRESETS: Preset[] = [
  /**
   * The MINIMAL preset over the `table` renderer: General's Record Table. It
   * decides nothing — the user picks the folder and the columns in the settings
   * modal, which is why its source is 'config' and it ships no columns.
   *
   * A renderer only needs a preset like this one if you want it directly
   * placeable from the library; a renderer used solely by curated presets
   * needs none.
   */
  {
    id:       'record-table',
    label:    'Record Table',
    category: 'General',
    description: 'Any folder of notes as a sortable table — you pick the source folder and the frontmatter columns.',
    about:       'Points at a folder and reads each note’s frontmatter as a row. Nothing is decided for you: choose the folder and the columns at add time and it becomes whatever tracker you needed.',
    needs: [
      { kind: 'setup',   text: 'Choose the folder of notes it should read' },
      { kind: 'setup',   text: 'Pick which frontmatter keys become columns' },
      { kind: 'feature', text: 'Read-only — it never rewrites your notes' },
      { kind: 'feature', text: 'Click any row to open the note' },
    ],
    codec:    'record-folder',
    source:   { kind: 'config' },
    picker:   FOLDER_PICKER,
    renderer: 'table',
    rendererOptions: { title: 'Records', emptyText: 'No notes in this folder yet.' },
    defaults: { size: { w: 6, h: 5 }, minSize: { w: 3, h: 3 } },
  },

  /**
   * The MINIMAL preset over `data-grid`: General's Data Table.
   *
   * The first preset whose SCHEMA LIVES IN THE FILE. Every other one either
   * ships its columns or derives them from frontmatter keys; this one reads a
   * markdown table's header row, so adding a column is a user action inside
   * the widget rather than a code change here. That's what makes the
   * "reading list with author and status" / "grocery list with category and
   * price" family cost zero entries in this file.
   *
   * Note the ladder is intact rather than bypassed: this needed a new codec
   * (rung 4, a genuinely new on-disk format) AND a new renderer (rung 2,
   * because RecordTable is read-only), but every table a user builds on top of
   * it after that is rung 1 — configuration, not code.
   */
  {
    id:       'data-table',
    label:    'Data Table',
    category: 'General',
    description: 'An editable markdown table. Add rows and columns without leaving the dashboard.',
    about:       'View or create detailed tables or lists here. Add a column and the note updates; edit the note and the widget follows. Resize your columns to see the data that matters.',
    needs: [
      { kind: 'setup',   text: 'Pick a markdown table in your vault, or start a new one' },
      { kind: 'feature', text: 'Add and edit rows right in the widget' },
      { kind: 'feature', text: 'Add a column here and the note updates to match' },
    ],
    codec:    'md-table',
    source:   { kind: 'config' },
    picker:   TABLE_PICKER,
    renderer: 'data-grid',
    template: TABLE_TEMPLATE,
    rendererOptions: {
      title:     'Table',
      addLabel:  'Add row',
      emptyText: 'No rows yet — use + Row to add one.',
    },
    defaults: { size: { w: 6, h: 5 }, minSize: { w: 3, h: 3 } },
  },

  /** The MINIMAL preset over `simple-list`: General's Checklist. */
  {
    id:       'checklist',
    label:    'Checklist',
    category: 'General',
    description: 'A plain checkbox list, backed by any note in your vault that already has one.',
    about:       'Reads and writes ordinary checkbox lines, so the note stays perfectly readable outside the plugin. Point it at an existing checklist anywhere, or scaffold a new one.',
    needs: [
      { kind: 'setup',   text: 'Point it at a note with checkboxes, or create one' },
      { kind: 'feature', text: 'Stays plain markdown — readable on any device' },
      { kind: 'feature', text: 'Check things off from either side; it stays in sync' },
    ],
    codec:    'checklist',
    source:   { kind: 'config' },
    picker:   CHECKLIST_PICKER,
    renderer: 'simple-list',
    template: FLAT_TEMPLATE,
    rendererOptions: {
      title:          'Checklist',
      addPlaceholder: 'Add an item…',
      rowDisplay:     'plain',
      emptyText:      'Nothing here yet — add something above.',
    },
    defaults: { size: { w: 4, h: 6 }, minSize: { w: 3, h: 4 } },
  },

  /**
   * Curated: same codec, same renderer, same layout as Checklist — the ONLY
   * difference is `rowDisplay: 'ingredient'`, which shows a parsed qty/unit
   * prefix. That one option is why this stopped needing its own component.
   * Storage is still a plain `- [ ] <raw text>` line; the split is derived on
   * read and never written back.
   */
  {
    id:       'grocery-list',
    label:    'Grocery List',
    category: 'Nutrition',
    description: 'A checklist that parses quantities — “2 lbs chicken” reads as 2 · lbs · chicken.',
    about:       'Same storage as Checklist — one plain markdown line per item — but the quantity and units are split out for you as you type.',
    needs: [
      { kind: 'setup',   text: 'Pick or create a grocery list note' },
      { kind: 'feature', text: 'Type “2 lbs chicken” and it splits the amount out for you' },
      { kind: 'pairs',   text: 'Same plain-markdown storage as Checklist — nothing is locked in' },
    ],
    codec:    'checklist',
    source:   { kind: 'config' },
    picker:   GROCERY_PICKER,
    renderer: 'simple-list',
    template: FLAT_TEMPLATE,
    rendererOptions: {
      title:          'Grocery List',
      addPlaceholder: 'Add item… e.g. 2 lbs chicken breast',
      rowDisplay:     'ingredient',
      emptyText:      'List is empty — add something above.',
    },
    defaults: { size: { w: 4, h: 6 }, minSize: { w: 3, h: 4 } },
  },

  /**
   * A list view of the same recipes the Recipe Box shows as a card stack —
   * and the first preset to declare a `detail` view: clicking a row opens the
   * real RecipeFullscreen instead of dumping the user into raw markdown.
   *
   * Note what ISN'T here: no component, no parser, no watcher. The card stack
   * stays a hero renderer (its peel physics can't be configuration), but a
   * plain table over the same folder costs an array entry.
   */
  {
    id:       'recipe-list',
    label:    'Recipe List',
    category: 'Nutrition',
    description: 'Every recipe in your vault as a table. Click a row to open the full-screen view.',
    about:       'A flat, sortable index over the same Recipes folder the Recipe Box shows as a card stack. Rows open the real full-screen recipe reader rather than dumping you into raw markdown.',
    needs: [
      { kind: 'feature', text: 'No setup — it finds your Recipes folder on its own' },
      { kind: 'feature', text: 'Click a row for the full-screen reader, not raw markdown' },
      { kind: 'pairs',   text: 'Same recipes as Recipe Box and Meal Planner' },
    ],
    codec:    'record-folder',
    source:   { kind: 'fixed-folder', segments: ['Recipes'] },
    renderer: 'table',
    detail:   'recipe-fullscreen',
    rendererOptions: {
      title:   'Recipes',
      columns: [
        { key: 'title',      label: 'Recipe',     kind: 'text', primary: true },
        { key: 'servings',   label: 'Serves',     kind: 'chip' },
        { key: 'categories', label: 'Categories', kind: 'chip' },
      ],
      emptyText: 'No recipes yet — add one from the Recipe Box.',
    },
    defaults: { size: { w: 5, h: 5 }, minSize: { w: 3, h: 3 } },
  },

  /**
   * Curated over `table`: folder, columns and a template-driven authoring flow
   * all decided. Record Table and Meeting Log are one renderer over one codec,
   * differing only in configuration — the preset model's whole argument.
   */
  {
    id:       'meeting-log',
    label:    'Meeting Log',
    category: 'Productivity',
    description: 'Date, title and attendees for every meeting. Start new meetings from your templates here.',
    about:       'Curated over the same table renderer as Record Table: the folder, the columns and the note template are all decided, so logging a meeting is one button and one field. Use the default meeting templates or create your own.',
    needs: [
      { kind: 'feature', text: 'No setup — folder, columns and template are created for you' },
      { kind: 'feature', text: 'One button creates and files the meeting note' },
      { kind: 'feature', text: 'Attendees render as chips you can scan' },
    ],
    codec:    'record-folder',
    source:   { kind: 'fixed-folder', segments: ['Meetings'] },
    renderer: 'table',
    rendererOptions: {
      title:     'Meeting Notes',
      columns:   MEETING_COLUMNS,
      addLabel:  'Log a new meeting',
      emptyText: 'No meetings logged yet. Hit + to log the first one.',
    },
    authoring: 'meeting-create',
    defaults: { size: { w: 6, h: 5 }, minSize: { w: 3, h: 3 } },
  },
];

export const presetsById: Record<string, Preset> = Object.fromEntries(
  PRESETS.map(p => [p.id, p]),
);
