# Widget Construction Guide

**How to add a widget to Command Center V2.** Companion to `DESIGN_SYSTEM.md`
(which owns *how it looks*) and `WIDGET-INVENTORY.md` (which tracks *what
exists*). This file owns *how it's built*.

Read this before creating any new widget. Almost every request should end at
**Step 1** and touch exactly one file.

---

## The decision ladder

Work down it and stop at the first rung that fits. Going further than
necessary is the failure mode this whole architecture exists to prevent.

| # | Situation | What you write | Cost |
|---|---|---|---|
| **1** | A new use case over an existing data shape | **A preset** — one entry in `src/widgets/presets.ts` | Data. No new file. |
| **2** | No existing renderer can draw it | **A renderer** in `src/renderers/` + a registry entry | Code. Rare. |
| **3** | The UI genuinely can't be configuration (a burner, a board, a scheduler) | **A hero renderer** — a component in `src/widgets/`, listed in `componentWidgets` | Code. Legitimate. |
| **4** | A genuinely new file format on disk | **A codec** in `src/core/codecs/` | Should approach never. There are 3. |

**Never** fork a one-off widget with its own parser, file I/O or vault watcher.
That's the thing the refactor removed; re-adding one undoes it.

---

## The three layers

```
CODEC      how data lives on disk — parse, serialize, mutate, watch. Zero UI.
             checklist  · - [ ] lines, optional ## buckets
             record-folder · one note per row, frontmatter = fields
             line-table    · structured lines as rows (the Finance ledger)

RENDERER   how it's drawn. A React component. Zero parsing, zero file I/O.
             table        · over record-folder, line-table
             simple-list  · over checklist

PRESET     what the library lists. Data: codec + renderer + source + options.
```

Renderers × codecs is a matrix. A new renderer inherits every codec; a new
preset is minted from parts that already exist.

**Renderer ids name a capability** (`table`, `simple-list`). **Preset ids name a
widget** (`record-table`, `grocery-list`). They are different namespaces — don't
reuse a name across them.

---

## Step 1 — Add a preset (the 90% case)

One entry in `src/widgets/presets.ts`. Nothing else changes: `PresetHost`
renders it, `widgetRegistry` picks it up, the library lists it.

```ts
{
  id:       'reading-list',          // becomes the persisted widget type
  label:    'Reading List',          // shown on the library card
  category: 'Productivity',          // General | Productivity | Nutrition | Finance
                                     // Learning | Capture | Education | Class Page

  // Library copy. Not optional in practice — a widget with no description is
  // a blank card in the library, which is the exact problem the redesign
  // fixed. `preview.kind: 'live'` additionally needs a fixture entry in
  // src/grid/library-fixtures.ts; without one it silently falls back to art.
  description: 'Every book you meant to get to, with where you left off.',
  about:       'Points at your Reading folder and reads each note’s frontmatter…',
  needs: [
    { kind: 'feature', text: 'No setup — it finds the folder on its own' },
    { kind: 'setup',   text: 'Something the user must do at add time' },
  ],
  preview:  { kind: 'live', art: 'table' },

  codec:    'record-folder',
  source:   { kind: 'fixed-folder', segments: ['Reading'] },
  renderer: 'table',
  rendererOptions: {
    title:   'Reading List',
    columns: [
      { key: 'date',   label: 'Added',  kind: 'date' },
      { key: 'title',  label: 'Title',  kind: 'text', primary: true },
      { key: 'author', label: 'Author', kind: 'chip' },
    ],
  },
  defaults: { size: { w: 6, h: 5 }, minSize: { w: 3, h: 3 } },
}
```

### Choosing the source

| `source` | Meaning |
|---|---|
| `{ kind: 'fixed-folder', segments: ['Meetings'] }` | A known folder under the Command Center root. Resolved live, so a renumbered folder still works and the user's configurable root is honoured. |
| …with `recordFile` on the `SourceRef` | Makes the record a **folder** rather than a note, with fields from a designated note inside it (`Classes/<slug>/Class-Info.md`). Use when a record owns several files. `row.folder` then points at the record's folder, and `remove()` trashes the folder. |
| `{ kind: 'config' }` | The user picks it in the settings modal. **Requires a `picker`.** |

A `config` source needs a picker:

```ts
picker: {
  kind:  'vault-file',              // or 'vault-folder'
  codec: 'checklist',
  label: 'Checklist note',
  nameField: { label: 'Widget name', placeholder: 'e.g. Errands…', configKey: 'title' },
  requireCheckboxes: true,          // vault-file: only offer notes with - [ ] lines
  scaffoldSegments: ['checklists'], // vault-file: where "create new" writes
  columns: true,                    // vault-folder: show the column picker
}
```

The picker writes `config.source` — a typed `SourceRef` — directly. It creates
no file: it computes a path, and the codec's `ensure(template)` creates it on
first render. Set `template` on the preset for that (`FLAT_TEMPLATE`,
`TODO_TEMPLATE`, or your own string).

### Optional fields

- `schema?: FieldDef[]` — field definitions handed to the codec
- `authoring?: string` — a bespoke "+ New…" modal id from `src/widgets/authoring.ts`.
  Use only for real authoring flows (templates, placeholder substitution) that
  a generic "add a row" can't express. Each one is an exception; keep it visible.
- `detail?: string` — a rich "open this record" view id from
  `src/widgets/detail-views.ts`. Replaces the default row click (open the note
  in Obsidian). The sibling of `authoring`: that owns *creating* a record, this
  owns *opening* one.

  ```ts
  detail: 'recipe-fullscreen',   // see the recipe-list preset
  ```

  A detail view receives `{ app, file, onClose, tone?, wash? }` and owns its own
  portaled overlay — `PresetHost` renders it as a sibling of the renderer so it
  isn't clipped by the widget's bounds. Renderers get an optional `onOpenRow`
  and fall back to `openLinkText` when the preset declares no detail view.
- `classPageOnly?: boolean` — restricted to the Class Page library
- `defaults.tone?` — a default accent tone

### Library previews

`preview.kind: 'live'` mounts the REAL component in the library against fixture
data. To earn it, add an entry to `src/grid/library-fixtures.ts`: a `SourceRef`
under `PREVIEW_ROOT`, its seeded rows, and the `config` bag the widget receives.

The seeding happens in `core/preview-source.ts` — `source-cache.ts` recognises a
preview source and serves the seed instead of calling the codec, so **a preview
performs no vault I/O and no widget code changes to support one.** A widget that
can't reach its data that way (it reads a context, or calls the vault directly)
sets `kind: 'art'` and picks an `ArtKind`; see WIDGET-INVENTORY.md's "Library
preview coverage" for who's on which side and why.

`art` is required either way — it's the fallback when a live preview is over the
concurrency cap, on mobile, or has thrown.

### Renderer options available today

**`table`** (`src/renderers/RecordTable.tsx`)
`title` · `columns` (omit to derive from `fieldKeys`) · `emptyText` · `addLabel`
· `openOnClick` · `divider` · `showColumnHeaders` (default **on**, also enables
fixed-width column alignment)
Column kinds: `date` · `text` · `chip` · `number`; one column should be `primary`.

**`simple-list`** (`src/renderers/SimpleList.tsx`)
`title` · `addPlaceholder` · `rowDisplay` (`'plain'` | `'ingredient'`) ·
`bucket` (**omit = all buckets**; set to scope to one) · `showClearDone` ·
`showCount` · `emptyText`

---

## Step 2 — Add a renderer

Only when no existing renderer can draw the data. Write it in
`src/renderers/`, then register it:

```ts
// src/renderers/registry.ts
'kanban': {
  id: 'kanban', label: 'Board',
  codecs: ['checklist'],        // which codecs' rows it can draw
  component: KanbanBoard,
},
```

`PresetHost` supplies these props:

```
rows        parsed rows from the codec
meta        codec-specific file-level state (checklist: buckets)
schema      the preset's FieldDef[]
mutate      add / update / remove / reload, bound to the source
loading     boolean
options     the preset's rendererOptions
tone, wash  the per-widget accent
app         navigation / openFile ONLY — never vault I/O
onAdd       present when the preset declares an authoring flow
onClearDone present for checklist sources
```

**Rules for a renderer**

1. No parsing, no file I/O, no vault watchers. Data comes in as `rows`; changes
   go out through `mutate`. `app` is for `openLinkText`, never `vault.read`.
2. **Default chrome to off, or to the curated look — never impose it silently.**
   A renderer is shared; a new option that changes layout must not alter presets
   that never asked for it. Both `divider` and `showColumnHeaders` exist because
   of this, and getting it wrong changed Meeting Log's appearance twice.
3. Add an option only when a **second preset would plausibly want it**. One
   consumer means it belongs in that preset's own component, not in a shared
   renderer.
4. Style under a renderer-owned prefix (`cc2-tbl-*`, `cc2-lst-*`), never a
   widget-specific one. If you extract a renderer from a widget, rename its CSS
   prefix as part of the job.
5. Follow `DESIGN_SYSTEM.md` — Widget Header standard, container queries (never
   media queries), tone + wash, and the Obsidian override gotchas for every
   `<button>` and `<svg>`.

---

## Step 3 — Hero renderers

A **hero renderer** is bespoke UI that no generic renderer can express — Task
Manager's burner and hourglass, Kanban's drag-and-drop board, the Class
Scheduler. It still reads through a codec; only its *presentation* is bespoke.

This is a legitimate end state, not a backlog item. 29 of the current widgets
are hero renderers or not-yet-migrated bespoke ones, and most will stay that way.

A hero renderer is a component in `src/widgets/<name>/` listed in
`componentWidgets` inside `src/widgets/registry.ts`. It gets `WidgetProps`
(`config`, `app`, `onConfigChange`) and reads data with `useVaultData`:

```tsx
const source = useMemo(() => resolveWidgetSource(app, 'my-widget', config), [app, config]);
const { rows, meta, loading, mutate } = useVaultData<ChecklistRow>(app, source, {
  template: TODO_TEMPLATE,
});
```

**Never** call `app.vault.read`, `vault.modify`, or `vault.on` in a widget.

---

## Step 4 — Add a codec

Only for a genuinely new on-disk format. Implement the `Codec<Row>` contract
(`src/core/types.ts`), register it in `src/core/codecs/index.ts`.

Required: `id` · `label` · `read` · `add` · `update` · `remove` · `ensure`
Optional but expected: `readMeta` · `readAll` (one pass for rows + meta —
without it the shared cache parses the file twice per load) · `watchTargets`

**Rows must carry stable ids and mutations must address them by id, never by
matching raw text.** Real files contain duplicates: this vault has three
identical `$241.29 | Gym | Health` ledger rows and two identical `Claude AI`
ones. Text matching silently hits the wrong one.

---

## Where things live

```
src/core/
  types.ts              contracts: SourceRef, Codec, Preset, RendererProps
  codecs/               3 codecs
  codec-registry.ts     codec id → implementation
  vault-events.ts       ONE vault subscription hub for the whole plugin
  source-cache.ts       one parsed snapshot per source, shared by all subscribers
  useVaultData.ts       the hook every renderer reads through
  config-migration.ts   legacy config keys → SourceRef

src/renderers/          generic renderers + registry
src/widgets/
  presets.ts            ← THE PRESET LIST. Start here.
  PresetHost.tsx        renders any preset
  authoring.ts          bespoke "+ New…" flows
  registry.ts           presets ∪ componentWidgets → one lookup
  <name>/               hero renderer components
```

---

## Before you call it done

1. **`npm run build`.** Obsidian runs `main.js`, not the TypeScript. A
   typecheck and a scratch bundle prove nothing about what's actually running —
   three phases of work once sat undeployed because of this. CSS-only changes
   are the exception: `styles.css` is read directly, so those need a reload only.
2. `npx tsc --noEmit -p tsconfig.json` — expect the **4-error baseline**
   (3 in `node_modules/obsidian/obsidian.d.ts`, 1 pre-existing in `src/app.tsx:2`).
   Anything beyond that is yours.
3. Reload Obsidian and use the thing. Offline tests don't exercise React.
4. If you touched a shared renderer, check **every preset that uses it**, not
   just the one you were working on.
5. Update `WIDGET-INVENTORY.md`.

---

## Known transitional state

**Two ways a widget finds its data.** Presets write `config.source` (a typed
`SourceRef`) directly. The older widgets — Kanban, TODO List, Task Manager, the
Finance suite — still write legacy string keys (`listFile`, `budgetName`) that
`config-migration.ts` translates on load. Both work; `resolveWidgetSource()`
handles either. Converting the legacy ones would let the migration shim be
deleted.

**"View as…" isn't exposed.** `renderersForCodec()` exists and the settings
modal could offer a renderer swap over the same source with no data migration —
but there's one renderer per codec, so there's nothing to swap to. A second
renderer for any codec unlocks it.
