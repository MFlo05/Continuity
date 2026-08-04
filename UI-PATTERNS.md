# UI Patterns — how to build UI in this codebase

Implementation companion to `DESIGN_SYSTEM.md` (which owns *how it looks* —
tokens, typography, colour) and `WIDGET-CONSTRUCTION.md` (which owns *widget
architecture*). This file owns the recipes and the traps.

**Read the gotchas before styling any `<button>`, `<svg>`, or modal.** They are
not edge cases — they hit almost every interactive element, and every one of
them fails *silently*: the thing renders, it just renders wrong.

---

## Obsidian CSS Override Gotchas

Obsidian ships base styles for raw `<button>` and `<svg>` that fight ours, and
its DOM structure fights `createPortal`. Check all five on every new
button/icon/portaled view — not just the ones that "look wrong."

### 1. Button chrome — `background`, `border`, `box-shadow`

Obsidian's base `button` rule sets its own `background-color` and `box-shadow`.
The shadow alone renders as a faint ring that reads as a border, so a button can
look "raised" with zero border and a transparent background.

CSS only overrides a property if some rule *actually declares that property* — a
rule that never mentions `box-shadow` doesn't beat Obsidian's default no matter
how specific it is.

> **Every custom button rule must declare all three — `background`, `border`,
> `box-shadow` — even the ones you want to be `none`/`transparent`.**

In practice this also needs `!important`, because Obsidian's selectors aren't
always plain `button` — some are scoped (`.workspace-leaf-content button`) with
specificity that beats a single custom class.

*A new coloured `<button>` rendering as a blank white box is almost always this.
Assume it first, not last — the tone-picker swatches were bitten by exactly this.*

### 1b. The same trap applies to the BOX MODEL

`height`, `line-height`, `padding`, `text-align`. Obsidian's base `button` rule
sets these too, and `.cc2-flush-btn` does **not** guard them — it only covers
chrome. A flush button given its own `padding` on top of Obsidian's inherited
fixed `height` renders its text pushed out of the bottom of the box and clipped,
with no other visual clue.

```css
height: auto !important;
min-height: 0 !important;
line-height: 1.45 !important;
padding: 7px 10px !important;
text-align: left !important;   /* Obsidian centres button text */
```

*Bit the settings-modal folder picker. If a new button's text looks cramped,
clipped, or mysteriously centred, assume this before anything else.*

### 2. SVG sizing — `width`, `height`

Obsidian's base svg rules override the `width`/`height` **attributes** on
`<svg>` elements, so `<svg width="14" height="14">` can silently render at the
wrong size. Every icon button needs its own rule:

```css
.my-btn svg {
  width: 14px !important; height: 14px !important;
  min-width: 14px !important; display: block !important;
}
```

Search `styles.css` for `svg {` to see the ~15 existing examples — copy the
pattern, don't reinvent it.

### 3. The `!important` cascade trap

Once a base rule uses `!important` (per #1), every state that overrides it —
`:hover`, `.active`, `:disabled` — must **also** use `!important` on that
property, even though it already has higher specificity. `!important`
declarations are compared against other `!important` declarations first, so a
plain `.cc2-tab.active { background: X }` loses to
`.cc2-tab { background: transparent !important }`.

### 4. Portals escape `.cc2-root` — for CSS variables AND class selectors

Several components render via `createPortal(children, document.body)` —
`CalendarFullscreen`, the Add/Edit Event modal, `WidgetLibraryModal`,
`WidgetSettingsModal`, and more (grep `createPortal` before assuming). A portal
to `document.body` makes that subtree a **direct child of `<body>`**, not a
descendant of `.cc2-root`, even though it looks like it's inside the plugin.

This breaks two independent things, and fixing one does not fix the other:

- **CSS custom properties.** `--cc2-*` are defined on `.theme-light/.dark
  .cc2-root` and don't inherit into the portal. **Fix: the token bridge** —
  re-declare the full `--cc2-*` set on the portal's root element. Two examples
  exist in `styles.css`: `.cc2-modal-backdrop`, and the shared
  `.cc2-cal-fs-backdrop, .cc2-cal-modal-overlay, .cc2-recipe-fs-backdrop,
  .cc2-mp-box-backdrop` block. Extend an existing block if the surface is
  conceptually the same family; otherwise add a copy.
- **Class selectors.** `.cc2-root .cc2-flush-btn` needs a literal `.cc2-root`
  *ancestor element* — no variable bridge fixes DOM ancestry. The selector just
  never matches, with no visual clue. **Fix: don't prefix shared button classes
  with `.cc2-root`.** `.cc2-flush-btn` and `.pill` both had the prefix removed.
  If you need more specificity, repeat the class itself
  (`.cc2-flush-btn.cc2-cal-fs-view-opt.active`) — never add `.cc2-root`.

**Shared fix for #1:** use `.cc2-flush-btn`, which bakes the chrome guard in
once. There's no shared fix for #1b, #2 or #3 — sizes and active-state values
vary per component, so apply them by hand each time.

---

## Component patterns

### Glass Card (`.glass`)

The primary surface, applied automatically to every `ws-shell` widget container.

- Light: warm cream glass + subtle paper grain via SVG noise overlay
- Dark: deep transparent glass + inner top highlight
- `border-radius: var(--cc2-radius)` (14px), `backdrop-filter: var(--cc2-glass-blur)`

Variants: `.glass-strong` (more opaque, for inner sections needing lift),
`.glass-soft` (more transparent, nested panels), `.focus-glow` (running state —
radial warm glow animates around the container).

### Widget Header — the standard, adopt for every widget

```css
.cc2-<x>-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  flex-shrink: 0; min-height: 46px; box-sizing: border-box; padding: 10px 12px;
  border-bottom: 1px solid var(--cc2-border);   /* see divider rule below */
}
.cc2-<x>-title { font-size: 10px; font-weight: 600; letter-spacing: 0.14em;
                 text-transform: uppercase; color: var(--cc2-faint); }
```

The title is exactly the Uppercase Micro-Label recipe (`DESIGN_SYSTEM.md`) —
this component is "micro-label title + a real divider + a fixed-height row it
can't be squeezed out of," not a new typography rule.

**`min-height: 46px` + `box-sizing: border-box` is load-bearing.** Matching the
CSS *rules* across headers isn't enough — height is content-driven, so a header
with a button in it renders taller than a bare-title one even with byte-identical
container CSS. Only a shared `min-height` forces them equal. Check a rendered
header against a sibling with different content before calling it matched.

**The 25px content budget is real.** `46 − 20 padding − 1 border = 25px` for
anything besides the title. A 26×26 or 28×28 icon button silently grows the
header past 46px. Fix by sizing the *content* down (24×24 icon buttons, tighter
input padding), never by raising `min-height` — that moves every header that's
already correct.

**Divider is a per-widget decision, not a blanket rollout.** Keep it if the
header carries real options (search, view toggle, tab strip). Drop it if it's
just a title. A shared renderer must make it opt-in, never automatic.

### Physical Key Button (`.pill`)

6px radius, embossed. Reserved for the small set of primary, stand-out actions.

```css
border-radius: 6px;
box-shadow: inset 0 1px 0 [top-highlight], 0 1px 2px [drop-shadow];
```

Full-pill (`border-radius: 999px`) is for **tags and count badges only** — never
action buttons.

- `.pill.solid` — full dark/light invert, for a genuinely filled button
- `.pill.highlight` — the translucent "selected" look, **not** a filled button.
  Same values as `.cc2-tab.active` / `.cc2-cal-fs-view-opt.active`. If those get
  tuned, update this to match — they're one recipe, not three similar ones.

No `.cc2-root` prefix (gotcha #4) — several `.pill` usages are portaled.

### Flush Button (`.cc2-flush-btn`) — the default for secondary controls

Most buttons are **not** primary actions and should not get the embossed
treatment.

- **Boxed** (`.pill`, `.pill.solid`, `.pill.highlight`, `.cc2-add-widget-btn`):
  the few primary CTAs.
- **Flush** (everything else — icon buttons, nav arrows, view toggles, inline
  links, page tabs, modal close): no border, no static background, no shadow.
  Soft tint on hover only.

```tsx
// component class sets box model only; .cc2-flush-btn owns the chrome
<button className="cc2-flush-btn cc2-cal-fs-nav-arrow">…</button>
```

`.cc2-flush-btn` owns color, background, border, box-shadow, hover, active and
disabled. **Don't redeclare chrome on the component class** — that's how the
override bug creeps back in. It has no `.cc2-root` prefix (gotcha #4).

**Bespoke `.active` states hand-guard instead.** `.cc2-tab`, `.cc2-edit-toggle`
and `.cc2-ai-yolo-btn` don't use `.cc2-flush-btn` at all — they're flush at rest
via their own `!important` guard, because their active states (translucent
bleed-through, solid amber) are too custom for the generic tint. When you do
this, gotcha #3 applies: the `.active` rule needs `!important` on every property
the base rule guards.

**Boxed on purpose — don't "fix" these four:** `.cc2-cs-block-ctrl` and
`.cc2-mp-block-ctrl` (sit on arbitrary user-coloured blocks, need their own
chrome to stay legible), `.cc2-ai-info-btn` (a "?" help badge), and
`.cc2-cal-color-default` (a chip-style reset). Don't add `.cc2-flush-btn` to any.

**Dashed-border "+ Add X" boxes are an inconsistency, not a pattern.** Every add
affordance should be icon-led and borderless (`.cc2-cnw-new`, `.cc2-cfs-add-btn`,
`.cc2-kb-add-task`, `.cc2-tl-add-tab`). `.cc2-caw-dashed-btn` still uses one —
known, unfixed.

### Widget-width responsiveness: container queries, never media queries

A GridStack widget's pixel width comes from the dashboard's width and column
count, **not the viewport** — the same widget can be wide or narrow at any
screen size, so `@media` is the wrong tool.

```css
.cc2-tm { container-type: inline-size; container-name: cc2-tm; }
@container cc2-tm (max-width: 480px) { /* stack the layout */ }
```

Named containers nest: `.cc2-tm-timer-col` is its own container
(`cc2-tm-timer`), so its buttons stack independently of the outer breakpoint.

### Speckled Paper Overlay (`::after`, `.theme-light` only)

Discrete radial-gradient flecks — a distinct technique from the Glass Card's
`feTurbulence` grain. Turbulence reads as a soft blur; individual specks read as
flecked cardstock. Use when a surface specifically wants that tactile look;
don't blanket-replace the existing near-invisible grain.

Rules that matter (learned by tuning against the reference):

- Colours are `color-mix()`'d from `--cc2-text`/`--cc2-muted`/`--cc2-faint`,
  **never hardcoded hex** — that's what keeps flecks in-palette if tokens retune.
- **The colour-stop and transparent-stop radii must differ**
  (`0.5px, transparent 1.1px`, not `1px, transparent 1px`). Same-radius stops
  give a hard-edged dot; the ~0.5px offset gives a soft halo that reads far less
  dirty.
- Six layers at varied position / core radius (0.4–0.7px) / tile size
  (95–240px) avoid an obvious repeating grid. Scale all six together for a
  smaller surface.
- Mix percentages live in the 28–40% range. Higher (45–65%) was tried and read
  as too stark; smaller core radius + the soft-fade offset fixed "harsh" better
  than lowering opacity alone.

Used on the Recipe Card's reverse face only (`.cc2-mp-box-back::after`) — the
front stays clean so the fleck reads as the card's physical backing. Tried and
deliberately removed from the Meal Planner's flat panel; don't rediscover it.

### Smaller pieces

- **Status Dot (`.dot`)** — 6px pulsing indicator, white in dark / near-black in
  light. Only while a task is actively running.
- **3-D Sphere (`.cc-ball`)** — the signature element. 80px (Front Burner; idle
  monochrome, active orange/red radial gradient + bubbles) and 52px (Back Burner;
  always monochrome, hover lifts). Bubbles: 4–9px, opacity 0.18→0, rise 1.8–3s,
  spawned every 320ms, z-index below the label.
- **Queue Latch + Pocket** — a warm paper pocket, not industrial. Depth stack:
  page linen → ivory glass card (elevated) → `var(--cc2-bg)` pocket (drops back
  to linen = recessed). Latch row is a full-width `border-top`, 32px, micro-label
  + count chip left, chevron right (rotates 180° on `aria-expanded`).
- **Hourglass (`Hourglass.tsx`)** — self-contained animated SVG, inline styles
  and `useId()`-scoped ids. No CSS dependency, no token-bridge concern. Props:
  `remaining`/`total` drive the sand ratio, `active`/`paused` gate the pour,
  `size` sets width (height follows a fixed 100:184 ratio).

---

## CSS conventions

- **One prefix per owner.** `cc2-tbl-*` (table renderer), `cc2-lst-*`
  (simple-list), `cc2-kb-*` (kanban), `cc2-tm-*` (task manager), `cc2-settings-*`
  (settings modal). **A shared renderer never wears a widget's prefix** — when
  you extract a renderer from a widget, renaming its CSS prefix is part of the
  job, not a follow-up. (`cc2-mtg-*` → `cc2-tbl-*` and `cc2-gl-*` → `cc2-lst-*`
  both happened this way.)
- **Empty-state text is one size: 12px.** Every `.cc2-*-empty` class.
- **Modal surfaces use `--cc2-bg-raised`, never `--cc2-bg`.** The latter is the
  warm tan *stage* colour; a modal is an elevated surface and must read as a
  card. This applies to fields inside modals too, not just the modal shell.
- **Don't fork the shared active-tab recipe.** `.cc2-tab.active`,
  `.cc2-view-toggle-btn.active`, `.cc2-brw-scope-btn.active`,
  `.cc2-link-picker-tab.active`, `.cc2-cal-fs-view-opt.active` are one
  `color-mix` recipe copied deliberately. If per-widget tone ever needs to reach
  it, change the recipe once — not one call site.

---

## Files

| File | Role |
|---|---|
| `styles.css` | All CSS — gridstack core + the full design system |
| `main.ts` | Plugin entry; applies `.cc2-root` to the view container |
| `src/app.tsx` | Topbar, page tabs, stage layout |
| `src/grid/WidgetShell.tsx` | Glass card wrapper, edit-mode handle |
| `src/grid/GridPage.tsx` | Gridstack init, nav-spacer row, widget registration |
| `src/grid/WidgetSettingsModal.tsx` | The one settings screen — source picker, colour, per-widget sections |
| `src/renderers/` | Generic renderers + registry |
| `src/core/` | Codecs, vault-event hub, source cache, `useVaultData` |
