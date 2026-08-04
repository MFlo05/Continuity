# Command Center V2 — read this first

Obsidian plugin. React + TypeScript, bundled by esbuild into `main.js`.

**This file loads automatically every session. The reference files below
are the briefing — read the ones relevant to the task before writing code.**

| File | Owns | Read it when |
|---|---|---|
| `DESIGN_SYSTEM.md` | How the app **looks** as a system — colour tokens, typography scale, tone/wash, icon canon | Any visual change |
| `DESIGN-WIDGET-NOTES.md` | How **one widget** looks — its visual intent and deliberate deviations | Changing a specific widget's appearance. **Read only that widget's entry**, not the file |
| `UI-PATTERNS.md` | How to **build** UI here — Obsidian gotchas, button/SVG recipes, component patterns | Any button, icon, modal, or CSS |
| `WIDGET-CONSTRUCTION.md` | How widgets are **architected** — codecs, renderers, presets | Adding or changing a widget |
| `WIDGET-INVENTORY.md` | What currently **exists** and its migration state | Orienting / picking work |

---

## Non-negotiables

These are the rules that get broken most often. Violating any of them produces
work that looks fine and is wrong.

1. **`npm run build` before you call anything done.** Obsidian runs `main.js`,
   not the TypeScript. A passing typecheck proves nothing about what's running.
   CSS-only changes are the exception — `styles.css` is read directly, so those
   need a reload only.

2. **Typecheck baseline is 4 errors** (3 in `node_modules/obsidian/obsidian.d.ts`,
   1 pre-existing in `src/app.tsx:2`). Anything beyond that is yours.
   `npx tsc --noEmit -p tsconfig.json`

3. **Never do vault I/O in a widget or renderer.** No `vault.read`,
   `vault.modify`, or `vault.on`. Data comes from `useVaultData`; writes go
   through `mutate`. `app` is for `openLinkText` only.

4. **Every custom `<button>` must declare `background`, `border`, `box-shadow`
   AND the box model (`height`, `line-height`, `padding`) with `!important`.**
   Obsidian's base styles win otherwise, silently. Every icon `<svg>` needs its
   own sized `!important` rule. See `UI-PATTERNS.md` gotcha #1/#1b/#2.

5. **Container queries, never media queries** for widget-internal layout. A
   widget's width comes from its grid span, not the viewport.

6. **A new widget is one entry in `src/widgets/presets.ts`.** Writing a
   component is rung 3 of 4 on the ladder, not the default. See
   `WIDGET-CONSTRUCTION.md`.

7. **Don't impose chrome on a shared renderer.** New options that change layout
   default to off, or the presets that never asked for it silently change.

---

## Layout

```
main.ts                 plugin entry, view registration, codec registration
styles.css              ALL css (~7.5k lines). Obsidian loads it directly.
src/core/               codecs, the vault-event hub, the source cache, useVaultData
src/renderers/          generic renderers (table, simple-list) + registry
src/widgets/presets.ts  THE PRESET LIST — start here for new widgets
src/widgets/            hero-renderer components, registry, PresetHost
src/data-sources/       legacy per-domain modules, being emptied phase by phase
```

## Conventions

- CSS classes are prefixed per owner: `cc2-tbl-*` (table renderer),
  `cc2-lst-*` (simple-list), `cc2-kb-*` (kanban), `cc2-tm-*` (task manager).
  **A shared renderer never wears a widget's prefix** — rename if you extract one.
- Comments explain *why*, not *what*. Match the surrounding density; this
  codebase's comments carry real decisions and are meant to be read.
- The vault's Command Center root is user-configurable (currently `Continuity`)
  — always resolve paths through `resolveCommandCenterPath()`, never a literal.
