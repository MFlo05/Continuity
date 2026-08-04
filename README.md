# Continuity

The space that ties your life together. A personal dashboard plugin for
[Obsidian](https://obsidian.md) — a drag-and-drop widget grid over your vault,
with widgets for todos, notes, calendar, meal plans, and budgeting, plus a
dedicated education suite for students.

Works on desktop and mobile (iOS/Android).

## Installing on a phone or another computer

This plugin isn't in the Obsidian community catalog, so it installs through
**BRAT** (Beta Reviewers Auto-update Tester).

1. In Obsidian on the target device: **Settings → Community plugins → Browse**,
   install and enable **BRAT**.
2. **Settings → BRAT → Add beta plugin**.
3. Enter this repository: `MFlo05/Continuity`
4. BRAT downloads the latest release and enables the plugin.

To pull a newer version later: **Settings → BRAT → Check for updates**, then
reload Obsidian.

> BRAT reads GitHub **Releases**, not the files in this repository. A plain
> `git push` will not reach your devices — you have to cut a release. See below.

## Developing

```bash
npm install      # once, after cloning
npm run dev      # watch mode: rebuilds main.js as you edit src/
```

`npm run dev` rebuilds on save. Reload Obsidian (Ctrl+R / Cmd+R) to see changes.

The repo lives directly inside `.obsidian/plugins/`, so the working copy *is*
the installed plugin — edits show up in Obsidian immediately.

## Releasing a new version

```powershell
.\release.ps1 0.1.2
```

That bumps `manifest.json` and `package.json`, runs a production build, commits,
pushes, and creates the GitHub Release with `main.js`, `manifest.json`, and
`styles.css` attached — which is what BRAT actually downloads.

Requires the [GitHub CLI](https://cli.github.com/) (`winget install GitHub.cli`).

## What's deliberately not in this repo

- **`data.json`** — your saved dashboard contents *and* Google Calendar OAuth
  tokens. Personal and secret; never commit it. Each device keeps its own.
- **`node_modules/`** — restored by `npm install`.
- **`*.zip`** — design mockup archives.

## Layout

| Path | What's there |
|---|---|
| `main.ts` | Plugin entry point — registers the view and settings tab |
| `src/widgets/` | One folder per widget |
| `src/core/` | Vault read/write, codecs, caching |
| `src/data-sources/` | Parsers mapping vault notes to typed data |
| `src/calendar/` | Google Calendar OAuth and sync |
| `src/grid/` | Gridstack layout, widget library, settings modals |
| `main.js`, `styles.css` | Build output — committed so releases can ship it |
| `DESIGN_SYSTEM.md` | Visual language and component conventions |
