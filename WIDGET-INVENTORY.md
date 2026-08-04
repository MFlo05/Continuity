# Widget Inventory — refactor progress tracker

Companion to `REFACTOR-HANDOFF.md` (the plan) and `WIDGET-CONSTRUCTION.md`
(how to add one). One row per widget in `src/widgets/registry.ts`, tracking how
far each has moved onto the shared codec/renderer layers.

**Last updated:** Phases 0–4 complete, plus the shared source cache, the
`simple-list` renderer, and the Widget Library overhaul.

All three codecs exist — `checklist`, `record-folder`, `line-table` — and the
registry is split into **presets (data)** and **component-backed widgets
(code)**. `WidgetType` is an **open string**, not a closed union: adding a
widget no longer touches three files, and `widgetRegistry` is the single source
of truth for which ids exist.

Post-Phase-4 additions:
- **`core/source-cache.ts`** — one parsed snapshot per source, shared by every
  subscriber. Six Finance widgets on one ledger = one parse. Generalised out of
  `budgetStore.ts`, which shrank from a 109-line bespoke cache to 53 lines of
  selectors.
- **`simple-list` renderer** — extracted from Grocery List, which became a preset.
- **One source picker** — the card + count caption + expanding searchable list
  now serves every widget. Zero `<select>` dropdowns remain in the settings modal.
- **Library previews** — `core/preview-source.ts` + three guarded branches in
  `source-cache.ts` let a source's snapshot be SEEDED instead of read, so the
  Widget Library renders 17 real widget components against fixture data with
  no vault I/O and no changes to any widget file. See "Preview coverage" below.

---

## Library preview coverage

The Widget Library shows the real widget rather than a screenshot — frozen on
the card, interactive in the detail pane. Which widgets can do that is decided
by ONE thing: whether their data can be reached without touching the vault.

**Live (17)** — everything that resolves `config.source`, plus the Finance
suite (which derives its path from a ledger *name*, so the marker goes in the
name):

Record Table · Data Table · Checklist · Grocery List · Recipe List ·
Meeting Log · Task Manager · Kanban Board · TODO List · Recurring Items ·
Year Review · Month Review · Categorized Pie Chart · Expense Vs Income ·
Income & Expense Tracker · Time Period (reads no file at all)

**Art (11)** — skeleton geometry, because their data doesn't come through
`useVaultData`:

| Widget | Why not live |
|---|---|
| Calendar | Reads `CalendarContext`, not a source. Fixture-able with a stub provider — ~40 lines, deferred. |
| My Classes | Calls `listClasses(app)` and registers its own watchers inside the component. Needs a data-hook / presentational split first. |
| My Teachers | Same, plus a derived join over `class-contacts`. |
| Class Scheduler | `class-schedule.ts`, not evaluated. |
| Recipe Box | Two-layer read — rows via codec, then a per-note `vault.read` for bodies and images. |
| Meal Planner | `meal-plan.ts`, not a codec source. |
| The 6 placeholders | Nothing built to render. |

Making any of these live is now a per-widget job, not an infrastructure one —
the seeding mechanism already exists, so the work is the split, not the plumbing.
That's the same argument as porting a widget onto a codec: the shared layer is
built, what's left is the widget's own shape.

---

## How to read this

The refactor has **two independent axes**. A widget can be finished on one and
untouched on the other, so they get separate columns — collapsing them into a
single "migrated?" flag is what makes this kind of tracker go stale and lie.

**Codec** — how the data lives on disk (parse / serialize / mutate / watch).
Three exist for the whole app: `checklist`, `record-folder`, `line-table`.
A widget is done on this axis once it owns no parsing, no file I/O and no
vault watcher of its own.

**UI kind** — how it's drawn:

| Kind | Meaning |
|---|---|
| **Renderer** | Generic. Driven entirely by a source + options; knows nothing about any specific data. Reusable by any preset. |
| **Preset** | A config bundle over an existing renderer — folder, columns, chrome, defaults. Data, not code. The goal state for most widgets. |
| **Hero renderer** | Bespoke UI that no generic renderer can express, sitting on a **shared codec**. Legitimate and encouraged (handoff §1.2) — Task Manager's burner/hourglass is never going to be a table. |
| **Bespoke** | Not yet migrated. Still owns its own parser, I/O and watcher. |
| **Stub** | `PlaceholderWidget`. No implementation yet. |

A hero renderer is **not** a widget that needs its own codec. Bespoke *UI* and
a bespoke *file format* are different problems — most hero renderers share a
codec with something that looks nothing like them.

---

## Progress

| | Count |
|---|---|
| Widgets total | **36** |
| On a shared codec | **18** |
| **Presets** (data — zero component code) | **6** |
| **Generic renderers** | **3** |
| **Codecs** | **4** |
| **Timeline adapters** (query layer) | **6** |
| Awaiting a codec (deferred / unevaluated) | 10 |
| No codec needed | 2 |
| Unbuilt stubs | 6 |

```
src/core/         2,131 lines / 11 files   ← did not exist before
src/renderers/      510 lines /  3 files   ← did not exist before
src/time/           ~600 lines /  7 files  ← did not exist before
src/data-sources/ 3,058 lines / 22 files   ← was the entire data layer
```

## The fourth axis: `src/time/` — a query layer

Codec, renderer and preset all describe **one source**. `src/time/` describes a
**question asked across many at once** — "what is happening on this day" — and
owns no storage of its own.

It arrived proposed as a "time codec". It can't be one, for three independent
reasons worth recording so it isn't re-proposed:

1. A `SourceRef` addresses exactly ONE location (`path` or `folder`). There is
   no array, union or virtual variant, and `sourceKey`, `sourcePath` and
   `withSourceLocation` all assume that.
2. `Codec` requires `add`/`update`/`remove`/`ensure` with no read-only flavour.
   "Add an event" has no coherent answer — the target file depends entirely on
   what KIND of event it is.
3. Most of what it reads isn't codec-backed anyway: class schedules, reminders,
   meal plans and transcripts are bespoke, and Google Calendar is a remote API
   with no vault file at all.

This file already named the shape when it filed My Teachers as a derived join:
*"Needs a query layer, not a codec."* This is that, one layer wider — and My
Teachers is the obvious second consumer whenever it's worth porting.

**Six adapters**, each a thin map over parsing that already existed:
`class-schedule` (via `resolveWeek`, the only real recurrence model in the app)
· `assignments` (via `mergeAssignments`) · `reminders` · `meal-plan` ·
`recurring` (via the new `occurrencesBetween`) · Google Calendar, folded in by
`useTimeline` rather than as an adapter, because it has no `app` to read from
and no vault path to watch.

**Ledger entries are deliberately excluded.** A ledger row is money already
spent — history, not agenda. A recurring bill is a forward-looking commitment,
which is the only part of Finance that belongs on a day view.

Two things it surfaced rather than inherited:

- **`occurrencesBetween` had to be written.** `nextOccurrence` returns only the
  next hit, which is all the Recurring Items gallery ever needed; an agenda
  needs every hit in a window. It steps with `addDays`, not `n * 86_400_000`
  milliseconds — a month-long window crosses a DST boundary, and ms-stepping
  drifts a day at that point and never recovers.
- **Free-text due dates are counted, not dropped.** `AssignmentRow.dateOrWeek`
  is typed as ISO but collected from a field whose placeholder is "Due (e.g.
  Oct 24)". `ClassCalendarWidget` filters it by lexical comparison, so
  hand-typed dates vanish from the class timeline today with no indication. My
  Day reports them as "N with no usable date" instead. Fixing the input side is
  a separate job; hiding it here would make that job harder to notice.

Bespoke watchers remaining in `src/data-sources/`: **6** across 4 files
(was 18 across 8 — `budget.ts`, `meetings.ts`, `recipes.ts`, `class-info.ts` and
now `recurring.ts` have none).

That count understates the class port. `watchClassesFolder` had **10 call
sites**, each registering 4 raw listeners — a Class Page with 7 widgets plus the
page itself ran ~32 listeners against one folder, every one re-testing the same
prefix on every write anywhere in the vault. It's now a thin wrapper over the
shared hub (4 listeners for the whole plugin, with debouncing it never had), and
its signature is unchanged so none of the 10 callers moved.

Component files deleted because a preset replaced them: **4**
(`MeetingLogWidget`, `RecordTableWidget`, `GroceryListWidget`, plus
`todos.ts`/`groceries.ts` reduced to path helpers).

---

## ✅ On a shared codec

| Widget | Category | Codec | UI kind | Landed |
|---|---|---|---|---|
| Data Table | General | `md-table` | **Preset** → `data-grid`, user-picked table | Phase 7 |
| Recurring Items | Finance | `md-table` | **Hero** — grouped list + gallery, schedule math | Phase 7 |
| Record Table | General | `record-folder` | **Preset** → `table`, user-picked folder + columns | Phase 4 |
| Checklist | General | `checklist` | **Preset** → `simple-list`, user-picked note | Phase 4+ |
| Grocery List | Nutrition | `checklist` | **Preset** → `simple-list`, `rowDisplay: 'ingredient'` | Phase 4+ |
| Meeting Log | Productivity | `record-folder` | **Preset** → `table`, fixed folder + columns + authoring flow | Phase 4 |
| Recipe List | Nutrition | `record-folder` | **Preset** → `table`, first to declare a `detail` view | Phase 5 |
| Recipe Box | Nutrition | `record-folder` | **Hero** — peel-stack card scroller; reads via `useRecipeCards` | Phase 5 |
| My Classes | Education | `record-folder` (folder-records) | **Hero** — class cards, archive lifecycle | Phase 6 |
| Task Manager | Productivity | `checklist` | **Hero** — burner, hourglass, MIT timer | Phase 1 |
| Kanban Board | Productivity | `checklist` | **Hero** — columns, drag & drop, per-bucket colour | Phase 1 |
| TODO List | Productivity | `checklist` | **Hero** — tabs, iOS move-menu, class-linked mode | Phase 1 |
| Class Tasks | Class Page | `checklist` | **Hero** — reuses `TodoRow` | Phase 1 |
| Year Review | Finance | `line-table` | **Hero** — stat row | Phase 3 |
| Month Review | Finance | `line-table` | **Hero** — stat row | Phase 3 |
| Categorized Pie Chart | Finance | `line-table` | **Hero** — donut chart | Phase 3 |
| Expense Vs Income | Finance | `line-table` | **Hero** — bar chart | Phase 3 |
| Income & Expense Tracker | Finance | `line-table` | **Hero** — quick capture + gallery | Phase 3 |

**Four presets over two renderers**, and each pair proves the model:

- *Record Table* and *Meeting Log* — one renderer (`table`), one codec
  (`record-folder`). One picks its folder at setup; the other ships folder +
  columns + a template-driven authoring flow.
- *Checklist* and *Grocery List* — one renderer (`simple-list`), one codec
  (`checklist`). **The only difference is `rowDisplay`.** The qty/unit parsing
  was never list behaviour, it was one preset's row formatting — which is why
  Grocery List stopped needing a component at all.

None of the four has a component file.

Everything else that's "done" is a hero renderer — finished on the codec axis,
bespoke on the UI axis. That's a legitimate resting place, not a backlog item;
see `WIDGET-CONSTRUCTION.md` step 3.

**No codec needed:**

| Widget | Why |
|---|---|
| Time Period | A control, not a view. Writes `BudgetMonthContext`; reads no file at all. |
| My Day | Reads the **query layer**, not a source — six adapters at once. A preset binds one codec to one source, which is precisely what this isn't. See "The fourth axis" above. |

---

## Phase 3 notes — two decisions worth remembering

**The codec owns the format; `budgetStore.ts` keeps the cache.** Finance was
deliberately *not* routed through `useVaultData`. That store ref-counts a parsed
ledger year across all six Finance widgets, so logging one entry re-parses once;
`useVaultData` dedupes vault *listeners* (via the shared hub) but not *parses* —
each hook instance reads independently — so porting to it would have turned one
parse into six. The store now calls `lineTableCodec.readYear` + `subscribeVault`
instead of its own loader and listener pair.

→ **Follow-up:** generalise that cache into core so `useVaultData` dedupes parses
too, and `budgetStore.ts` can be deleted. Benefits every codec, not just Finance.

**Ledger rows can now be edited and deleted individually** — previously append
was the only mutation, so correcting an entry meant hand-editing markdown. Real
ledgers contain near-duplicate rows (this vault has three identical
`$241.29 | Gym | Health` entries and two identical `$28.00 | Claude AI` ones),
which is exactly what text-matching mutation gets wrong. **No widget exposes
this yet** — the capability exists, the UI doesn't.

---

## 🔲 Awaiting a codec — deferred or unevaluated

| Widget | Category | Data source today | Verdict |
|---|---|---|---|
| My Teachers | Education | `class-info` + `class-contacts` | **Won't fit as-is.** A derived join: teachers extracted from every class's frontmatter, grouped by email, merged with `Contacts.md`. No single source. Needs a query layer, not a codec. |
| Meal Planner | Nutrition | `meal-plan.ts` | Not evaluated |
| Class Scheduler | Education | `class-schedule.ts` (364 ln) | Not evaluated |
| Calendar | Productivity | Google Calendar API + `calendar.ts` | **Likely never a codec** — the source is a remote API, not vault files. |
| Recent Notes | Class Page | `class-notes.ts` | Not evaluated |
| Assignments & Grades | Class Page | `class-info` + `class-progress` | Not evaluated |
| Class Calendar | Class Page | `class-schedule` + `class-info` | Not evaluated |
| Grade Breakdown | Class Page | `class-grade-categories.ts` | Not evaluated |
| Resources | Class Page | `class-resources.ts` | Not evaluated |
| Class Policies | Class Page | `class-policies.ts` | Not evaluated |

---

## 🚧 Stubs — `PlaceholderWidget`, nothing built

| Widget | Category |
|---|---|
| Process Notes | Productivity |
| Art & Quote | Learning |
| French Reading | Learning |
| French Flash Cards | Learning |
| Bookmark Revival | Learning |
| Brain Dump | Capture |

These are the best test of whether the refactor worked: each should eventually
be a **preset**, not a new folder of code.

---

## Adding a widget

See **`WIDGET-CONSTRUCTION.md`** — the decision ladder, the preset shape, the
renderer contract, and the verification checklist all live there now.

The short version: a new use case is **one entry in `src/widgets/presets.ts`**.

### "View as…" is now unblocked

`md-table` has **two** renderers — `data-grid` (editable) and `table`
(read-only) — so `renderersForCodec('md-table')` finally returns a real choice
and the settings modal can offer the swap. Only the modal UI is left.

Worth recording why the *obvious* candidate was wrong: a `kanban` renderer over
`checklist`, swappable with `simple-list`, was the long-standing plan in this
file. It doesn't work. A board is intentionally wide and a list intentionally
narrow, so swapping one for the other crams a board into a column. **A useful
swap needs two renderers with compatible footprints, not merely a shared
codec** — which is exactly what the grid/table pair has.

### The fourth codec, and why it cleared the bar

`md-table` broke the "expected to stay at three" line in `codecs/index.ts`. It
qualified on both counts the ladder asks for:

- **A genuinely new on-disk format.** `line-table` sounds like it should cover
  markdown tables and doesn't — it parses *list items containing pipes*
  (`- HH:MM | date | $amt | desc | cat`) with a fixed five-field schema, no
  header row and no separator row. Nothing was reusable between the parsers.
- **Two consumers on day one.** The Data Table preset, and the Recurring Items
  table that `recurring.ts` had been hand-parsing with its own watcher — a case
  this very file had already filed as needing "its own handling."

It's also the first codec whose **schema comes from the file**: a table's header
row is its column list, so `meta.fieldKeys` is read off disk rather than
declared by a preset. That's what makes a reading list, a gear inventory or a
grocery list with price and category columns cost zero new code.

Four parser hazards it has to respect, each observed in this vault — see the
header comment in `core/codecs/md-table.ts`: fenced code blocks contain
byte-identical example tables (`Skills/Syllabus-Import.md`), a separator row is
required (`budget-reconciliation.md` has header-shaped CSV samples), empty cells
are meaningful, and **column alignment must round-trip** — the ledger index is
width-aligned, and an early version reflowed the whole file on first edit.

### The two-layer read (Phase 5 pattern, reusable)

A recipe note is **two shapes in one file**: frontmatter is a record-folder row,
and the body (`## Ingredients` / `## Image` / `## Notes`) is bespoke. The port
didn't force one to be the other — `useRecipeCards` reads rows through the codec
(cached, shared, watched) and does a per-note body parse keyed on
`path:mtime`, so an unchanged note is never re-parsed.

That recovered what the old hand-rolled `cardCache` did, generically. **The same
shape applies to classes**, where a record is a folder with a designated
`Class-Info.md` plus several sibling files — worth reaching for there rather
than re-deriving it.

One trap the port had to respect: recipe ingredient checkboxes are `- [ ]`
lines, so the checklist codec *could* read and write them. It must not.
`RecipeFullscreen.tsx:135` records that persisting them was tried and reverted
("every box was still checked from last time"). They stay in-memory only.

### Folder-records (Phase 6)

`{ codec: 'record-folder', folder: '…/Classes', recordFile: 'Class-Info.md' }`
makes the record unit a **folder** rather than a note — a class owns
Class-Info.md *plus* Tasks.md, Layout.json, Progress.md, and archiving moves the
whole folder, so it can't be a single file. This was the extension point left
documented-but-unbuilt in Phase 2; classes are the consumer that justified it.

Three details it had to get right, each with a test:

- **`name` is the folder slug**, not the note's basename — otherwise every class
  would be called "Class-Info".
- **`row.folder`** is exposed so consumers reach sibling files
  (`Class-Transcript.md`, `Progress.md`) — the same two-layer read the recipes
  port established.
- **`remove()` trashes the folder**, not just the designated note, or a deleted
  class would orphan its Tasks.md and Layout.json.

`recordFile` participates in `sourceKey`, so two sources over one folder reading
different designated notes can't collide in the shared cache.

**The write path was deliberately NOT ported.** `writeClassInfo`, `createClass`
and the transcript still use the hand-rolled YAML serializer — the transcript
needs it regardless, so porting the other two would be risk with no deletion
win. Worth knowing: that quoting was already hardened so *Obsidian's own
metadata-cache parser* reads it correctly, which is exactly why reading through
the codec is safe.

Only My Classes changes category, but the port benefits ~10 widgets: everything
that calls `listClasses` now shares one cached read, and everything that calls
`watchClassesFolder` shares one hub subscription.

### Known transitional state

Presets write `config.source` (a typed `SourceRef`) directly. Kanban, TODO List,
Task Manager and the Finance suite still write legacy string keys
(`listFile`, `budgetName`) that `config-migration.ts` translates on load. Both
work — `resolveWidgetSource()` handles either — but converting the legacy ones
is what would let the migration shim be deleted.
