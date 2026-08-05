import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  // Gridstack ships CSS — ignore CSS imports in the JS bundle.
  // Gridstack's CSS is manually included in styles.css instead.
  // PNGs become data URIs. BRAT installs exactly three files (main.js,
  // manifest.json, styles.css), so nothing under assets/ ever reaches a mobile
  // install and every getResourcePath() into it resolves to a missing file —
  // which is why the AI provider button rendered as a broken image on iOS.
  // Only the provider marks are imported (96x96, ~14KB total). The Income &
  // Expense animations stay file-based and desktop-only: the GIF can't be
  // re-encoded without losing frames, and coin-drop is a sprite sheet whose
  // frame offsets depend on its pixel width.
  loader: { ".css": "empty", ".png": "dataurl" },
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  jsx: "automatic",
  jsxImportSource: "react",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
