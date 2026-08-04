# Command Center V2 — Design System

> **This file owns how the app LOOKS as a system** — colour, typography, tone,
> iconography, and the rules that apply everywhere. Keep it updated when
> decisions change.
>
> It does **not** own per-widget appearance. Each widget's own visual intent —
> and the decisions that shouldn't be "fixed" by a future pass — live in
> **`DESIGN-WIDGET-NOTES.md`**. Read the entry for the widget you're changing,
> not the whole file.
>
> It does not own implementation either. That lives next door:
>
> | Looking for | Read |
> |---|---|
> | One widget's appearance, its deliberate deviations, its CSS prefix | **`DESIGN-WIDGET-NOTES.md`** |
> | Obsidian CSS gotchas, button/SVG recipes, glass card, widget header, container queries | **`UI-PATTERNS.md`** |
> | Codecs, renderers, presets — how a widget is architected | **`WIDGET-CONSTRUCTION.md`** |
> | What widgets exist and their migration state | **`WIDGET-INVENTORY.md`** |

---

## Philosophy

The plugin lives inside Obsidian but should feel like a different room — the one you actually *work* in. The aesthetic draws from two references:
- **Programa** (programa.design) — curated, warm, modern-retro. Generous whitespace, uppercase micro-labels, physical tactility, paper warmth.
- **Superlist** (superlist.com) — deep glass cards in dark mode, strong radius, restrained but intentional.

The signature element is the **industrial latch + 3-D sphere** — a physical-object metaphor for task focus. Everything else should be quiet and disciplined so that moment lands.

---

## What We Inherit from Obsidian

| Token | Obsidian source | Why |
|---|---|---|
| Body font | `--font-interface` | Matches the user's vault |
| Mono font | `--font-monospace` | Timer, data displays |
| Accent color | `--interactive-accent` | Feels native, user's choice |
| Dark/light mode | `.theme-dark` / `.theme-light` on `<body>` | Theme detection |

Everything else is ours.

---

## Color Tokens

Defined in `styles.css` on `.cc2-root`, split by `.theme-light` and `.theme-dark`.

### Light Mode

```
--cc2-bg          #DDD3C3   Warm tan — the stage. Deliberately richer so cards pop off it.
--cc2-bg-raised   #FAF7F2   Near-white warm (modal backgrounds, raised surfaces)
--cc2-border      rgba(30,24,16, 0.13)
--cc2-border-mid  rgba(30,24,16, 0.20)
--cc2-text        #1A1612   Warm near-black
--cc2-muted       #5C5046   Warm brown-gray (darker than before for readability)
--cc2-faint       #9A8A7C
--cc2-glass-bg    rgba(254,251,246, 0.97)  Near-white warm ivory — HIGH contrast vs bg
--cc2-glass-blur  blur(20px) saturate(130%)
--cc2-shadow      0 1px 3px rgba(30,24,16,0.10), 0 6px 24px rgba(30,24,16,0.10)
--energy-1        #96B882   Warm sage (more saturated)
--energy-2        #C9AA82   Warm tan
--energy-3        #D4906A   Warm terracotta
--energy-glow     rgba(195,148,100,0.50)
```

**The Programa contrast principle:** Background is warm/sandy, cards are essentially near-white. The contrast is created by the VALUE difference (dark warm bg vs bright near-white card) not by the hue. The warmth anchors the page; the bright cards pop off it. Active nav tab gets a subtle accent color tint — this is the deliberate "color pop." Do not make the glass bg warm/creamy — keep it near-white so it reads as a clean surface.

### Dark Mode

```
--cc2-bg          #131110   Warm near-black (brown-tinged, never pure)
--cc2-bg-raised   #1C1A18   Card/surface lift
--cc2-border      rgba(255,248,235, 0.08)
--cc2-border-mid  rgba(255,248,235, 0.13)
--cc2-text        #F0EDE6   Warm off-white
--cc2-muted       #8C8378   Warm medium gray
--cc2-faint       #4A4440   Warm dark gray
--cc2-glass-bg    rgba(255,252,245, 0.045)
--cc2-glass-blur  blur(28px) saturate(140%)
--cc2-shadow      inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 0 rgba(0,0,0,0.3)
--energy-1        #8FD2F0   Cool blue (contrast on dark)
--energy-2        #A8B4F0
--energy-3        #C39FE0
--energy-glow     rgba(155,175,235,0.55)
```

### Shared Tokens (both modes)

```
--cc2-radius      14px      Widget card corner radius
--cc2-radius-sm   8px       Smaller elements (modals, inputs)
--cc2-radius-xs   6px       Buttons, tags
--cc2-gap         8px       Widget grid gutter
--cc2-accent      var(--interactive-accent)   Obsidian passthrough
```

**Danger / success tokens** — the app-wide red/green for destructive actions (delete/remove/error) and confirm/positive states:

```
--cc2-danger       #C0574B    --cc2-danger-bg    rgba(192,87,75,0.10)    --cc2-danger-line    rgba(192,87,75,0.25)
--cc2-success      #5F9E6E    --cc2-success-bg   rgba(95,158,110,0.10)   --cc2-success-line   rgba(95,158,110,0.25)
```

Same value in both themes (declared once in the shared `.cc2-root` block, not per theme) since these were already used identically regardless of theme before the token existed — this is a refactor, not a new color choice. Before this pass, `#C0574B`/`#5F9E6E` were hardcoded independently in ~35 places; a second, drifted red family (`rgba(240,90,70,*)`, `#DC2626`, `#E0796A`) had crept into a handful of spots (Calendar's error states, the grade-category weight warning, Task Manager's expired-timer color) and is now folded into `--cc2-danger` too. **Not the same thing as `--cc2-income`/`--cc2-expense`** (see Finance Suite Color System below) — those are a semantic financial in/out pair pinned to the Sage/Rust tone palette; danger/success are the generic destructive/positive pair used everywhere else (delete buttons, error text, confirm actions, "done" checkmarks). Also re-declared in the modal-backdrop token bridges (both light and dark, both bridge copies — see Obsidian gotcha #4) so portaled modal content can reference them too.

---

## Per-Widget Accent Color (Tone + Wash)

**The goal is optional color *pops*, not a second theme.** Everything above this section is the base warm palette every widget gets by default, unconditionally — this feature layers a user-chosen accent on *top* of it, per widget instance, and must never look like a different app when nobody touches it. Every hookup below is written as `var(--t, <original-value>)` specifically so that an untouched widget (no tone chosen) renders pixel-identical to before this feature existed — `--t` simply doesn't exist until a `data-tone` attribute is present, so the fallback always wins by default.

**The palette** — 10 curated tones plus an implicit "Paper" default (no tone at all), spanning a warm arc through a cool arc through a green arc so neighboring picks in the swatch row don't collide: `ochre`, `terracotta`, `rust`, `rose` (Clay Rose) / `plum`, `indigo`, `slate`, `spruce` / `sage`, `moss`. Designed as its own reference file (`command-center-widget-palette.html`, not part of the repo — a standalone swatch/demo page) before being ported into `styles.css`. Each tone is three tokens, defined per theme (`.theme-light .cc2-root` / `.theme-dark .cc2-root`, alongside `--cc2-income`/`--cc2-expense` etc.):

```
--cc2-tone-<name>       solid ink (light mode) / glow (dark mode) — swatches, ticks, dots, "now" markers
--cc2-tone-<name>-bg    wash background tint (low alpha)
--cc2-tone-<name>-line  wash border tint (higher alpha than -bg)
```

Light-mode alphas are **tiered by hue**, not flat — pale hues (ochre, moss) use a higher alpha (0.13/0.36) than deep hues (rust, indigo, 0.08/0.24) so one flat recipe doesn't make ochre invisible and rust shouty. Dark-mode glows are normalized to similar lightness with flat alphas (0.06/0.18) — dark surfaces don't have the same "pale hue disappears" problem.

**Per-instance mapping**: a widget's own root (or a swatch button) carries `data-tone="sage"` etc., which a single unscoped, global rule set maps to the three generic working variables actually consumed everywhere else:

```css
[data-tone="sage"] { --t: var(--cc2-tone-sage); --t-bg: var(--cc2-tone-sage-bg); --t-line: var(--cc2-tone-sage-line); }
/* ...one line per tone... */
[data-tone="paper"] { --t: var(--cc2-muted); --t-bg: transparent; --t-line: var(--cc2-border); }
```

This indirection (`data-tone` → `--t`) is what lets a shared CSS rule like `.cc2-cal-wgt-accent { color: var(--t, var(--cc2-accent)); }` work for *any* tone without a per-tone rule — only the mapping block above needs to enumerate all 10 names, everything downstream just reads `--t`/`--t-bg`/`--t-line`.

**Two intensities**, chosen per widget in the settings modal:
- **Trim** (default) — the tone only lives in a title, micro-label, tick mark, or "now"/"today" indicator. The card surface stays exactly as before.
- **Wash** — additionally tints the widget's own background/border: `background: linear-gradient(var(--t-bg), var(--t-bg)), var(--cc2-bg-raised); border-color: var(--t-line);` on the widget's own root (e.g. `.cc2-cal-widget[data-wash]`) — never on `WidgetShell`'s shared outer card frame, which stays untouched by this feature entirely (a deliberate scope boundary, not a gap — keeps the blast radius to each widget's own content, and means `WidgetShell.tsx`/`GridPage.tsx` needed zero changes).

**Config, not a new persistence mechanism**: `config.tone` (a tone id, or simply absent/`undefined` for Paper — never the literal string `'paper'` is persisted) and `config.wash` (boolean) live in the same per-widget `LayoutItem.config` bag every other widget setting already uses, read as plain props (`config?.tone as string | undefined`, `!!config?.wash`) by whichever widget component has been wired to consume them.

**Widgets can now write their own config directly, not just via this modal.** `WidgetProps` gained an optional `onConfigChange?: (patch: Record<string, unknown>) => void` — the same `handleConfigChange` `app.tsx` already built for `WidgetSettingsModal`, threaded one level further through `GridPage.tsx`/`GridItem` into every widget component's own props. Added specifically for Kanban's per-bucket color popover (below), which needs to persist a change the instant a swatch is clicked, from inside the widget itself, without routing through the shared settings modal at all. Most widgets still don't need this — it's `undefined` unless a widget genuinely has its own in-place, self-directed config write, which is the exception, not the rule.

**`WidgetSettingsModal.tsx`** (`src/grid/`) is the *one* settings screen per widget type — it replaced two separate, narrower modals (`WidgetSetupModal.tsx`, the old file/folder picker; `WidgetToneModal.tsx`, an even-older standalone color-only modal) once it became clear color needed to sit alongside file setup and Calendar's OAuth controls in one place rather than three. It renders up to four sections depending on the widget: the file/folder existing-vs-new picker (only if `registry.ts`'s `requiresFileSetup` is set), Kanban's bucket list (only for `'kanban'`), a Google Calendar connect/disconnect status row (only for `'calendar-strip'`, reusing the exact same `useCalendar()` state the compact widget's own inline connect button already uses — not a separate OAuth flow), and the color swatch row + Trim/Wash toggle (every widget **except** `'kanban'`, whose per-bucket color replaced a board-wide picker entirely — see the Kanban section below). Two modes: `mode="create"` (from the Widget Library, seeds a brand-new `LayoutItem`) and `mode="edit"` (from right-click, patches an existing item's config). **Every widget now pauses on this screen at add-time** — even ones with nothing else to configure (Recipe Box, Meal Planner, the `PlaceholderWidget` stubs) — so color is offered upfront, not just discoverable later.

**Entry point is right-click, not a gear icon on every card** — `app.tsx`'s existing `handleContextMenu` (already used for "Edit Layout"/"Add Widget…") gained a check: walk up from whatever DOM element was actually right-clicked (`.closest('.grid-stack-item')`, reading the `gs-id` attribute `GridPage.tsx` already sets) to find which `LayoutItem` is under the cursor, and prepend an "Edit Widget Settings…" item if one was found. Right-click on empty canvas falls through to exactly today's menu — no behavior change there. This was a deliberate choice over adding a settings icon to `WidgetShell`'s toolbar, specifically to avoid cluttering every widget's chrome with a control most people won't touch often; it also meant zero new props needed on `WidgetShell`/`GridPage` at all, since `app.tsx` already has direct access to `activePage.items`.

**Rollout is intentionally incremental — reading this section is not a guarantee every widget visually responds yet.** Every widget can *store* a tone/wash preference via the settings modal (universal, no gating), but a widget only *renders* differently once its own CSS is actually wired to read `data-tone`/`data-wash` on its own root. As of this pass, that's **Calendar Strip, Task Manager, Kanban, Meeting Log, Recipe Fullscreen, Grocery List, and Meal Planner** (see their own sections below for exactly which elements — Recipe Box is the one deliberate exception: it stores and forwards `tone`/`wash` but its own card face intentionally renders no differently, see its section for why). The entire **Finance suite** (Year Review, Month Review, Categorized Pie Chart, Expense vs Income, Time Period, Income & Expense Tracker, Recurring Items) is excluded from this settings-modal section entirely — same shape as the Kanban exclusion (`def?.category !== 'Finance'` alongside the existing `type !== 'kanban'` check in `WidgetSettingsModal.tsx`), because its color isn't a free per-widget accent, it's already semantic — see "Finance Suite Color System" below.

**Wash is the default expectation for a wired widget, not the exception — most widgets should end up with it.** The two current holdouts are both for a real structural reason, not a stylistic default: Task Manager's burner is intentionally transparent ("the ivory card surface shows through" — see its own section), and Kanban's *board root* already has a considered recessed-pocket/raised-chip depth relationship (`.cc2-kb-column`'s own comment, referenced from the Meal Planner section) — individual Kanban *buckets* do get Wash, only the outer board doesn't. Every other wired widget (Calendar, Meeting Log) gets Wash. When wiring a new widget in, default to giving it Wash unless there's a specific reason like these two not to.

**Fullscreen/portaled surfaces need their own token-bridge copy of the `--cc2-tone-*` variables — the same rule as gotcha #4 above, now exercised for a second variable family.** `CalendarFullscreen.tsx` is a *separate* `document.body` portal from the compact widget (see "Calendar" section below), so `tone`/`wash` are passed down as explicit props and re-applied via `data-tone`/`data-wash` on its own root (`.cc2-cal-fs-backdrop`) — without that, `--t` simply wouldn't exist inside the portal no matter what the compact widget's own `data-tone` was set to. The `--cc2-tone-*` values themselves were added to the *existing* shared bridge block (`.theme-light/.dark .cc2-cal-fs-backdrop, .cc2-cal-modal-overlay, .cc2-recipe-fs-backdrop, .cc2-mp-box-backdrop` in `styles.css`) and to `.cc2-modal-backdrop`'s bridge (for the settings modal's own swatch buttons) — both extended in place, not forked into new blocks, same as every other token this codebase bridges.

**A concrete, real instance of Obsidian gotcha #1 — worth reading if you're skimming past that section as "obviously fine, my rule sets `background`":** the color swatch buttons (`.cc2-tone-swatch`) initially set `background: var(--t)` with no `!important` and rendered as blank white boxes — Obsidian's base `<button>` background won outright, exactly as gotcha #1 describes, even though the rule was correct and specific. Every property on `.cc2-tone-swatch` (`background`, `border`, the `.selected` `box-shadow`, the `[data-tone="paper"]` override) now carries `!important`. Treat this as the reminder gotcha #1 asks for: a new colored `<button>` needing `!important` isn't a maybe, it's the default assumption.

**Deliberately NOT touched, to protect an existing "one recipe, copied everywhere" convention**: the Day/Week/Month view-switcher's active-tab tint inside Calendar's fullscreen (`.cc2-cal-fs-view-opt.active`'s `color-mix(in srgb, var(--cc2-accent) 40%, var(--cc2-text))`) is the *exact same* shared recipe reused verbatim across `.cc2-tab.active`, `.cc2-view-toggle-btn.active`, `.cc2-brw-scope-btn.active`, and `.cc2-link-picker-tab.active` — all unrelated to Calendar. Making Calendar's instance alone follow `--t` would silently fork one copy of a recipe every one of those comments explicitly says to keep identical ("copy the values, don't re-derive them — if those ever get tuned, update this to match"). If per-widget tone ever needs to reach the active-tab highlight too, that's a decision to make once, for the shared recipe, not a one-off override buried in Calendar's CSS.

---

## Finance Suite Color System

The Finance suite (`src/widgets/budget-review/`, `src/widgets/income-expense/`, `src/widgets/recurring-items/` — 7 widget types total) deliberately sits outside the per-widget Tone + Wash system above. Its color isn't a free accent choice, it's meaning: whether money moved in or out, which category it belongs to, whether savings are healthy. A generic swatch picker would just compete with that meaning, so the whole suite is excluded from `WidgetSettingsModal`'s color section (see the rollout note above) in favor of the two mechanisms below — neither is user-editable, both reuse the existing 10-tone palette so everything still keys off one shared set of colors and gets correct light/dark variants for free.

**Income/Expense role color — hardcoded to Sage/Rust, not a Tone/Wash choice.** `--cc2-income`/`--cc2-expense` (declared alongside the tone tokens in `.theme-light/.dark .cc2-root` and the unknown-theme fallback) now simply point at `var(--cc2-tone-sage)`/`var(--cc2-tone-rust)` instead of an independent hex pair. This was a deliberate choice over making income/expense user-editable: green=in/red=out is a universal-enough convention that letting a user flip it (e.g. expense = Ochre) would hurt scannability more than it'd help, so the color stays fixed — but pinning it to the tone palette rather than its own hex means it finally gets a real dark-mode glow variant the way every other tone does (the old hex pair was flat, same value regardless of theme). Sage was picked over Spruce (the first choice) specifically because Spruce reads too bluish/teal for an unambiguous "green = money in" signal. Every existing consumer (`.cc2-iet-row-date.income/.expense`, `.cc2-iet-kind-btn.active.*`, `.cc2-ri-row-amount.income/.expense`, the `--rk` alias driving `.cc2-ri-clean-*`/`.cc2-receipt-*`, `StatCard`'s `accent` prop, `ExpenseVsIncomeWidget`'s bar fills) needed zero changes — they already read `var(--cc2-income)`/`var(--cc2-expense)`.

**Savings-rate tiers — Sage → Terracotta → Rust.** Year Review and Month Review each compute `savingsColor` from `summary.savingsRate`: ≥20% is `var(--cc2-income)` (Sage), 10–19% is `var(--cc2-tone-terracotta)`, below 10% is `var(--cc2-expense)` (Rust) — a clean green→orange→red gradient. The 10–19% tier used to be a flat hardcoded `#D9A441` with no dark-mode variant at all; Terracotta was picked over Ochre specifically to read as a more distinct "warning" midpoint between the two role colors.

**Category color — a positional map onto the 10-tone palette, not a manual per-item picker.** `categoryColor(cat, kind)` in `src/data-sources/budget.ts` replaces what used to be a single flat 14-hex `CATEGORY_COLORS` table (same value regardless of theme). It now builds two independent maps — one for expense categories, one for income categories — from the canonical, ordered category lists already in `budget-categories.ts` (`EXPENSE_CATEGORIES`/`INCOME_CATEGORIES` keys):

- The first 10 categories (by declaration order) each get one of the 10 tones, solid — using a fixed **interleaved** order (`sage, rust, indigo, ochre, plum, spruce, terracotta, slate, moss, rose`) so neighboring categories never share a hue family. This order is deliberately a separate list from `TonePicker.tsx`'s `WIDGET_TONES` (swatch-UI display order) — the two lists serve different purposes and shouldn't be conflated.
- Any category past the 10th (today: `Hardware`, `Travel`, `Self Care` on the expense side, wrapping back to `sage`/`rust`/`indigo` respectively) gets that same tone **softened 55%** toward the card surface — `color-mix(in srgb, var(--cc2-tone-<name>) 55%, var(--cc2-bg-raised))` — the exact recipe prototyped in `command-center-widget-palette.html`'s chart-series "lap 2". A category list long enough to need a third lap is a data problem, not a palette problem.
- The fallback bucket (`Other`/`Other Income`) always stays neutral — `var(--cc2-faint)`, never assigned a tone — matching the donut chart's pre-existing gray "Other" treatment.

Consumers: `BudgetReviewShared.tsx`'s `DonutChart` (slice `fill` + legend dot — unchanged call sites, `categoryColor(cat)` defaults to `kind: 'expense'`), `RecurringItemsWidget.tsx`'s `.cc2-ri-row-category` label and `RecurringItemsGallery.tsx`'s per-card category text, and `IncomeExpenseTrackerWidget.tsx`'s `.cc2-iet-row-category` label and `IncomeExpenseGallery.tsx`'s per-receipt category text — all four set the color as an inline `style`, not a CSS class, since it varies per-row/per-category rather than by a static state. In every one of these, the **amount/kind role color is left exactly as-is** — category color only ever touches the category label itself, so "is this money in or out" is still answerable at a glance without reading the category.

---

## Typography Scale

All sizes use `--font-interface` (Obsidian passthrough). Never hardcode a font family except monospace.

| Role | Size | Weight | Tracking | Case | Usage |
|---|---|---|---|---|---|
| Hero clock | 26px | 400 | -0.02em | — | Task Manager's `.cc2-tm-clock` timer display |
| Task title | 22px | 600 | -0.022em | — | Front burner task name |
| Body | 13–14px | 400 | — | — | General text |
| Body compact | 12.5px | 400 | — | — | Body text inside cards/rows (row labels, template names, AI panel rows) — used pervasively enough to be its own tier, not a mistake |
| UI label | 12px | 500 | 0.01em | — | Buttons, tabs |
| Micro-label | 10px | 600 | 0.14em | UPPER | Section headers/status indicators, e.g. widget header titles, "SIMMERING", "BACK BURNER" |
| Card eyebrow | 10px | 700 | 0.12em | UPPER | Small in-card labels one notch punchier than a micro-label — receipt/recurring-item kind labels, Recipe Box/Meal Planner card chips and day/slot labels |
| Caption | 9–11px | 400–500 | 0.06em | — | Ball titles, meta |
| Mono data | var | 600–700 | tabular-nums | — | Timer, counts |

The **uppercase micro-label** at 10px / 600 / 0.14em is the Programa signature. Use it consistently for section headers and status indicators throughout the plugin. The **card eyebrow** (10px / 700 / 0.12em) is a distinct, deliberately bolder sibling for tiny labels living inside a card rather than a section header — don't blend the two recipes; before this pass it had drifted across 10 different classes (700-weight, tracking ranging 0.06em–0.16em, sizes 8.5–10px) — all now converged to the one value above except `.cc2-mp-box-stat-label` (8.5px/600/0.06em), which stays as its own documented micro-micro exception for a dense inline stat grid.

**"Hero clock" was a stale doc entry** — the row above used to read 48px/300/-0.03em, describing a size that no longer exists anywhere in `styles.css`. `.cc2-tm-clock` was deliberately shrunk once the Task Manager's hourglass visual took over the "hero" role; the doc just never got updated to match. If you're hunting for an actual 48px clock, stop — it isn't there.

**Empty-state text is one size, not five.** Every `.cc2-*-empty` class across the app is 12px now — before this pass they ranged 11–13px (11, 11.5, 12, 12.5, 13) for what is conceptually the same "no items yet" treatment. If you add a new one, use 12px.

---

## Iconography

The CSS recipes for buttons, cards and headers moved to `UI-PATTERNS.md`. What
stays here is the *visual vocabulary*: which shape means what, and at what size.

### Icon Shapes — one canonical path per meaning

Every icon-only or icon+label button should reuse ONE of these exact `<path>` shapes for its meaning, not a fresh hand-drawn variant. Before this pass, several had drifted into 3-4 different silhouettes for the same action.

- **Add / create (plus):** `viewBox="0 0 24 24"`, `<path d="M12 5v14M5 12h14" />`, `strokeWidth="2"` (or `2.4` for the smallest instances), round caps. Used everywhere something is being added (`.cc2-cnw-new`, `.cc2-cfs-add-btn`, `.cc2-kb-add-task`, `.cc2-tl-add-tab`, `.cc2-cal-wgt-detailed-btn`'s "Add Event"). `.cc2-cal-wgt-detailed-btn` used to render a pencil here — fixed to the plus above.
- **Edit (pencil):** `viewBox="0 0 24 24"`, `<path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />`, `strokeWidth="2"`, round caps/joins. This is `.cc2-edit-toggle`'s original shape (the app's most prominent edit affordance), now also used by `.cc2-caw-edit-btn`, `.cc2-cs-block-ctrl`'s "Edit time", and `.cc2-ri-icon-btn`/`.cc2-ri-clean-icon-btn` (which used to render a plain `✎` text glyph, not an svg at all — replaced so it actually respects the app's icon sizing/color rules). Don't reintroduce a different pencil silhouette (a lucide-style two-path pencil, a smaller wedge-tip variant, etc.) — if a new edit action needs an icon, copy this path.
- **Close / remove / x-cross:** `viewBox="0 0 24 24"`, `<path d="M6 6l12 12M18 6L6 18" />`, `strokeWidth="2"`, round caps. Used by the AI panel's `.cc2-ai-icon-btn` "Close" and now also `.cc2-ai-file-chip-remove` (used to be a plain `×` text character). **`.cc2-modal-close`'s plain `✕` text glyph is a deliberately separate, app-wide convention for dismissing a whole modal** (used in every `.cc2-modal`-based dialog) — the two aren't meant to converge; the svg x-cross is for small in-panel icon buttons, the text `✕` is for "close this entire modal."
- **Delete (trash can):** the AI panel's `.cc2-ai-history-del` is the one trash-can icon in the app (`<rect>`+`<path>` combo, see `AIPanel.tsx`). Every other "delete this item" control (Kanban cards/columns, Grocery rows, Contacts, Todo tabs, etc.) uses the same x-cross path as Close above instead of a trash can — that's intentional, not a gap; trash-can is reserved for "delete an entire conversation," not "remove one row."

### Icon Button Size Tiers

Icon-only buttons converge to one of these box/svg pairings — pick the tier matching the button's prominence, don't invent a new in-between size:

| Tier | Box | SVG | Used for |
|---|---|---|---|
| XS | 14–16px | 9px | Tight inline controls inside cards/rows — checkboxes (`.cc2-kb-check`/`.cc2-lst-check`), tiny row-delete (`.cc2-kb-card-delete`, `.cc2-lst-row-delete`, `.cc2-ccw-reminder-delete`), tab-delete (`.cc2-tl-tab-delete`, 8px) |
| S | 20px | 12px | Row-level utility buttons — `.cc2-kb-add-task`, `.cc2-kb-column-delete`, `.cc2-crw-delete`, `.cc2-cpw-delete`, `.cc2-settings-gradecat-remove`, `.cc2-ai-history-del`. **Exception:** `.cc2-ai-info-btn`'s "?" symbol stays 14px in its 20px box — it's a static informational glyph, not an action icon, and reads better a size up |
| M | 24px | 14px | Header add-buttons — the most common tier: `.cc2-cfs-add-btn`, `.cc2-kb-add-bucket`, `.cc2-mtg-add`, `.cc2-mc-add`, `.cc2-mt-add`, `.cc2-tl-add-tab`, `.cc2-cs-lock-btn` |
| L | 26–28px | 14px | Prominent single-purpose buttons — `.cc2-rv-new-template-confirm`, `.cc2-mtg-new-template-confirm`, `.cc2-ri-clean-icon-btn`, `.cc2-ai-icon-btn`, `.cc2-mt-row-delete`. `.cc2-cal-wgt-icon-btn` (sync/expand/disconnect) is its own self-consistent 28px/15px sub-tier |
| XL | 32px | 14px | `.cc2-cfs-close`, `.cc2-cfs-edit`, `.cc2-mc-menu-btn` |
| Hero | 30–34px | 15–18px | Distinctive one-off controls that intentionally read bigger — `.cc2-view-toggle-btn` (30×24/15px), `.cc2-ai-send` (30px circle/18px), `.cc2-recipe-fs-gallery-nav` (34px circle/14px) |

Every icon-only button's svg child must have an explicit `width`/`height`/`min-width` guard with `!important` (Obsidian gotcha #2) — a handful were missing this guard entirely before this pass (`.cc2-kb-check`, `.cc2-lst-check`, `.cc2-settings-gradecat-remove`, `.cc2-tl-tab-delete`, `.cc2-tl-move-btn`, `.cc2-cal-color-swatch`, `.cc2-cal-wgt-detailed-btn`, `.cc2-ai-model-row`, `.cc2-ri-icon-btn`) and silently rendered at whatever size their `<svg width=/height=>` attributes said (or Obsidian's own default, if even those were missing).

### Uppercase Micro-Label (`.label`)

```
font-size: 10px
font-weight: 600
letter-spacing: 0.14em
text-transform: uppercase
color: var(--cc2-faint)
```

Use for: section headers ("SIMMERING", "BACK BURNER", "FOCUS TIMER"), status indicators, widget section dividers.

---

## Per-widget visual notes → moved

Every per-widget entry — Recipe Vault / full-screen, Meal Planner, Recipe Box,
Navigation, AI Panel, Calendar, Widget Shell, Task Manager, Kanban, Meeting Log,
Grocery List — now lives in **`DESIGN-WIDGET-NOTES.md`**, which opens with an
index. Nothing was rewritten; the entries are verbatim.

This split exists because those notes were ~68% of this file's bytes while being
relevant to exactly one widget at a time. This file is the part that applies to
*everything*, so it's the one worth reading in full.

**Source comments still say "see `DESIGN_SYSTEM.md`" in ~12 places that now mean
the notes file** (`.cc2-mp-root`, `.cc2-kb-column`, the burner's transparency,
the `stdin.end()` debugging story, Recipe Box's sizing, Grocery List's entry
pattern). They weren't rewritten — this signpost is the one hop that keeps them
resolving. If you're touching one of those files anyway, fixing its comment to
name the right file is a welcome drive-by.

---

## What NOT to do

*Visual rules only. The implementation traps — Obsidian's button/SVG overrides,
the `!important` cascade, portal token bridges — moved to **`UI-PATTERNS.md`**.
Read those before shipping any button, icon or modal.*

- No full-pill buttons for actions (999px radius = tags only)
- No boxed/embossed treatment on secondary or utility buttons — reserve boxed for the handful of genuinely primary actions
- No pure `#000000` or `#ffffff` — always warm the blacks and whites
- No cold blue-gray as a neutral in light mode (it reads as "default app", not "curated")
- No numbered markers (01/02/03) unless content is truly sequential
- No heavy shadows in light mode — keep them ultra-subtle
- Don't add decorative animation — every motion must serve a purpose
- Don't use `var(--cc2-accent)`/`var(--interactive-accent)` for small text — it's user-themeable and can wash out; prefer `--cc2-text` and reserve accent for larger UI or a deliberate tint-mix "color pop"
- Don't give a stage-level surface (full-screen view, sliding panel) the stage background color (`--cc2-bg`/`--cc-bg`) — if it's an elevated view over the app, it should read as a card (`--cc2-bg-raised`/`--cc-raised`), not as more stage
- Don't fork the shared "active tab" color-mix recipe (`.cc2-tab.active` / `.cc2-view-toggle-btn.active` / `.cc2-brw-scope-btn.active` / `.cc2-link-picker-tab.active` / `.cc2-cal-fs-view-opt.active`) to make one instance follow a per-widget tone — see "Per-Widget Accent Color"'s closing note. If tone ever needs to reach it, change the shared recipe once, not one call site
- A new colored `<button>` rendering as a blank/white box almost always means a missing `!important` on `background`/`border`/`box-shadow` (gotcha #1) — assume this first, not last; it's bitten this codebase more than once, most recently the tone-picker's swatch buttons

