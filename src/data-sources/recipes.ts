import { App, TFile, TFolder } from 'obsidian';
import { parseIngredientLine, type ParsedIngredientLine } from './ingredient-line';
import { resolveCommandCenterPath } from './vault-paths';
import type { SourceRef } from '../core';

/**
 * recipes.ts — recipe NOTE BODIES, templates, and creation.
 *
 * The folder listing, the frontmatter parser, the vault watcher and the
 * mtime-keyed card cache all moved out in the Phase-5 port: a recipe note's
 * frontmatter is a textbook record-folder row, so `recordFolderCodec` reads it
 * and `core/source-cache.ts` caches it, shared with every other subscriber.
 *
 * What's left is the part no codec describes — a recipe note's BODY is
 * structured (`## Ingredients` / `## Image` / `## Notes` / everything else) and
 * each section is treated differently by the full-screen view.
 */

export function recipesFolder(app: App): string {
  return resolveCommandCenterPath(app, 'Recipes');
}

/** The recipes folder as a typed source — what the codec reads. */
export function recipeSource(app: App): SourceRef {
  return { codec: 'record-folder', folder: recipesFolder(app) };
}
export function recipeTemplatesFolder(app: App): string {
  return resolveCommandCenterPath(app, 'Recipes', 'Templates');
}
export const BLANK_STARTER_TEMPLATE_NAME = 'Blank';

// Fixed cookbook categories — a dedicated multiselect in the create modal and
// a single-select filter dropdown in the widget, not a generic cc2-extra-fields
// text field (that mechanism is for arbitrary single-value text, not a fixed
// vocabulary with multiselect UI).
export const RECIPE_CATEGORIES = [
  'Appetizers', 'Soups', 'Salads', 'Main Dishes', 'Sides', 'Dessert',
  'Breads', 'Eggs', 'Vegetables', 'Pasta', 'Brunch', 'Cocktails', 'Breakfast',
] as const;

// Used if Templates/Recipes/Blank.md is missing — "+ New template" must never hard-fail.
const FALLBACK_BLANK_TEMPLATE =
  '---\ncc2-extra-fields: servings:Servings, prepTime:Prep time, cookTime:Cook time, sourceUrl:Source URL, tags:Tags\n---\n\n# {{title}}\n\n## Ingredients\n- [ ] \n\n## Instructions\n1. \n\n## Notes\n';

// ── Frontmatter — narrow, hand-rolled, duplicated from meetings.ts rather
// than shared (same accepted tradeoff already documented there: each
// data-source file owns its own parser scoped to exactly what it writes). ──

function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!block) return { fields: {}, body: content };

  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    fields[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: content.slice(block[0].length) };
}

function serializeFrontmatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// A template declares its own capture fields, e.g.:
//   cc2-extra-fields: servings:Servings, tags:Tags
function parseExtraFieldsDirective(raw: string | undefined): RecipeExtraFieldDef[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const idx = entry.indexOf(':');
      if (idx === -1) return { key: entry, label: entry };
      const key   = entry.slice(0, idx).trim();
      const label = entry.slice(idx + 1).trim() || key;
      return { key, label };
    });
}

// Plain global {{key}} find-replace — no engine, no conditionals.
function substitutePlaceholders(text: string, values: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function sanitizeForFilename(s: string): string {
  return s.trim().replace(/[/\\:*?"<>|]/g, '-').slice(0, 60).trim();
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  await app.vault.createFolder(path).catch(() => { /* race with another creator — fine */ });
}

export interface RecipeExtraFieldDef { key: string; label: string; }

export interface RecipeTemplate {
  file:        TFile;
  name:        string;
  extraFields: RecipeExtraFieldDef[];
}

// Shared shape for both "tags" (freeform) and "categories" (fixed
// vocabulary) — both are just comma-separated frontmatter strings.
export function parseCommaList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

// ── Template scanning ──

export async function listRecipeTemplates(app: App): Promise<RecipeTemplate[]> {
  const folder = app.vault.getAbstractFileByPath(recipeTemplatesFolder(app));
  if (!(folder instanceof TFolder)) return [];

  const files = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
  const templates: RecipeTemplate[] = [];
  for (const file of files) {
    try {
      const { fields } = parseFrontmatter(await app.vault.read(file));
      templates.push({
        file,
        name: file.basename,
        extraFields: parseExtraFieldsDirective(fields['cc2-extra-fields']),
      });
    } catch { /* skip unreadable files */ }
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

// Recipe LISTING moved to the record-folder codec — `recordFolderCodec.read()`
// over `recipeSource(app)` returns exactly these rows, with `Templates/`
// excluded for free (records are direct-child files only) and the frontmatter
// read through Obsidian's own metadata cache instead of a hand-rolled parser.

// ── Ingredients — parsed from the "## Ingredients" section's checkbox lines,
// same shape/format as Grocery List (`- [ ] 2 cups flour`), reusing the same
// shared parseIngredientLine so both widgets speak the same ingredient shape. ──

export interface RecipeIngredient extends ParsedIngredientLine {
  raw:  string;
  done: boolean;
}

function findSectionRange(lines: string[], headerName: string): { start: number; end: number } | null {
  const headerRe = new RegExp(`^##\\s+${headerName}\\s*$`, 'i');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i].trim())) { start = i; break; }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) { end = i; break; }
  }
  return { start, end };
}

// ── Recipe meta — prep/cook time, servings (+ a parsed base number for
// scaling), and the source URL, read straight from frontmatter. ──

export interface RecipeMeta {
  servings:     string | null;   // raw display string, e.g. "4" or "4-6"
  baseServings: number | null;   // leading number out of `servings`, or null if unparseable — scaling UI is hidden when this is null
  prepTime:     string | null;
  cookTime:     string | null;
  sourceUrl:    string | null;
  categories:   string[];        // same `categories` frontmatter field as the recipe list view
  tags:         string[];
}

function parseLeadingNumber(s: string | undefined): number | null {
  if (!s) return null;
  const m = /\d+(?:\.\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : null;
}

// Parses a recipe note into everything the full-screen view treats
// specially — meta fields, parsed Ingredients (own interactive checklist,
// not raw markdown), the raw "## Image" embed (rendered as a hero, e.g.
// "![[Pasted image ...png]]" — Obsidian-style wikilink embeds, so it's handed
// to the real MarkdownRenderer rather than treated as a plain `<img>` src),
// and everything else (rendered as one markdown block). Ingredients/Image
// sections are stripped from restBody in one pass — removing highest
// start-index first — so splicing one range doesn't shift the other's indices.
export interface RecipeNoteParsed {
  meta:        RecipeMeta;
  ingredients: RecipeIngredient[];
  imageEmbed:  string;
  notes:       string;
  restBody:    string;
}

export function parseRecipeNote(content: string): RecipeNoteParsed {
  const { fields, body } = parseFrontmatter(content);

  const meta: RecipeMeta = {
    servings:     fields['servings']?.trim() || null,
    baseServings: parseLeadingNumber(fields['servings']),
    prepTime:     fields['prepTime']?.trim() || null,
    cookTime:     fields['cookTime']?.trim() || null,
    sourceUrl:    fields['sourceUrl']?.trim() || null,
    categories:   parseCommaList(fields['categories']),
    tags:         parseCommaList(fields['tags']),
  };

  const lines = body.split('\n');

  const ingRange = findSectionRange(lines, 'Ingredients');
  const ingredients: RecipeIngredient[] = [];
  if (ingRange) {
    for (let i = ingRange.start + 1; i < ingRange.end; i++) {
      const t = lines[i].trim();
      const done = /^- \[x\] (.+)$/i.exec(t);
      const todo = /^- \[ \] (.+)$/.exec(t);
      const m = done ?? todo;
      if (m) ingredients.push({ raw: m[1], done: !!done, ...parseIngredientLine(m[1]) });
    }
  }

  const imgRange = findSectionRange(lines, 'Image');
  const imageEmbed = imgRange
    ? lines.slice(imgRange.start + 1, imgRange.end).join('\n').trim()
    : '';

  // Pulled out of restBody (like Ingredients/Image) so the full-screen view
  // can render it as an editable textarea instead of static markdown.
  const notesRange = findSectionRange(lines, 'Notes');
  const notes = notesRange
    ? lines.slice(notesRange.start + 1, notesRange.end).join('\n').trim()
    : '';

  const ranges = [ingRange, imgRange, notesRange]
    .filter((r): r is { start: number; end: number } => !!r)
    .sort((a, b) => b.start - a.start);
  for (const r of ranges) lines.splice(r.start, r.end - r.start);

  // The template seeds the note with a leading "# {{title}}" H1. The
  // full-screen view already shows the real title (file.basename) in its
  // masthead, so leaving this in restBody just duplicates it right under the
  // ingredients list.
  const firstContentIdx = lines.findIndex(l => l.trim() !== '');
  if (firstContentIdx !== -1 && /^#\s+\S/.test(lines[firstContentIdx].trim())) {
    lines.splice(firstContentIdx, 1);
  }

  return { meta, ingredients, imageEmbed, notes, restBody: lines.join('\n') };
}

// ── Notes editing — the full-screen view's "Notes" section is editable in
// place (cooking notes/variations jotted down while cooking), unlike every
// other section there which is read-only rendered markdown. Rewrites just
// the "## Notes" section's body, leaving frontmatter and every other section
// byte-for-byte untouched; creates the section (before "## Image" if one
// exists, else at the end) if the note doesn't have one yet. ──

function hasFrontmatterBlock(content: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(content);
}

function replaceNotesSectionText(content: string, notesText: string): string {
  const { fields, body } = parseFrontmatter(content);
  const lines = body.split('\n');
  const trimmed = notesText.replace(/\s+$/, '');
  const newLines = trimmed.split('\n');

  const range = findSectionRange(lines, 'Notes');
  if (range) {
    const hasNext = range.end < lines.length;
    lines.splice(range.start + 1, range.end - range.start - 1, ...(hasNext ? [...newLines, ''] : newLines));
  } else {
    const imgRange = findSectionRange(lines, 'Image');
    const section = ['## Notes', ...newLines, ''];
    if (imgRange) {
      lines.splice(imgRange.start, 0, ...section);
    } else {
      if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
      lines.push(...section);
    }
  }

  const newBody = lines.join('\n');
  return hasFrontmatterBlock(content) ? serializeFrontmatter(fields, newBody) : newBody;
}

export async function saveRecipeNotes(app: App, file: TFile, notesText: string): Promise<void> {
  const content = await app.vault.read(file);
  const updated = replaceNotesSectionText(content, notesText);
  if (updated !== content) await app.vault.modify(file, updated);
}

// ── Creation ──

export async function createRecipeNote(
  app: App,
  opts: { template: TFile; title: string; extraValues: Record<string, string>; categories?: string[] },
): Promise<TFile> {
  const folder = recipesFolder(app);
  await ensureFolder(app, folder);

  const base = sanitizeForFilename(opts.title) || 'New Recipe';
  let name = base;
  let path = `${folder}/${name}.md`;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    name = `${base} (${suffix})`;
    path = `${folder}/${name}.md`;
    suffix++;
  }

  const raw = await app.vault.read(opts.template);
  const values: Record<string, string> = { title: opts.title, ...opts.extraValues };
  const substituted = substitutePlaceholders(raw, values);

  // Same reasoning as meetings.ts: re-parse so extra-field values land in
  // frontmatter under their own key, with no naming collision risk since
  // those keys are exactly what the template's own cc2-extra-fields
  // directive declared.
  const parsed = parseFrontmatter(substituted);
  const fields: Record<string, string> = { ...parsed.fields };
  delete fields['cc2-extra-fields'];
  // Always create every declared field, even left blank — so a property
  // (e.g. sourceUrl) the user skipped in the create modal still exists as
  // an empty frontmatter key they can just fill in later via Obsidian's
  // Properties UI, instead of having to type the property name from scratch.
  for (const [key, value] of Object.entries(opts.extraValues)) {
    fields[key] = value;
  }
  fields['categories'] = (opts.categories ?? []).join(', ');

  const content = Object.keys(fields).length ? serializeFrontmatter(fields, parsed.body) : substituted;
  return app.vault.create(path, content);
}

// ── Template cloning ("+ New template") ──

export async function cloneBlankTemplate(app: App, newName: string): Promise<TFile> {
  const folder = recipeTemplatesFolder(app);
  await ensureFolder(app, folder);

  const blankPath = `${folder}/${BLANK_STARTER_TEMPLATE_NAME}.md`;
  const blankFile = app.vault.getAbstractFileByPath(blankPath);
  const blankContent = blankFile instanceof TFile ? await app.vault.read(blankFile) : FALLBACK_BLANK_TEMPLATE;

  const sanitized = sanitizeForFilename(newName) || 'New Template';
  let name = sanitized;
  let path = `${folder}/${name}.md`;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    name = `${sanitized} (${suffix})`;
    path = `${folder}/${name}.md`;
    suffix++;
  }

  return app.vault.create(path, blankContent);
}

// ── Recipe Box card data — everything a flip-card needs (front + back),
// resolved from the real vault rather than hardcoded like the design
// prototype. Reads the full note (not just frontmatter, unlike
// listRecipeEntries) since ingredient count and the hero image both live in
// the body. ──

function parseMinutes(v: string | null): number {
  if (!v) return 0;
  const m = /\d+/.exec(v);
  return m ? parseInt(m[0], 10) : 0;
}

export interface RecipeCardData {
  file:            TFile;
  title:           string;
  imageUrl:        string | null; // app:// resource URL for the ## Image section's first embed, or null
  ingredientCount: number;
  servings:        string | null;
  prepTime:        string | null;
  cookTime:        string | null;
  totalMinutes:    number;
  categories:      string[];
  tags:            string[];
}

export async function loadRecipeCardData(app: App, file: TFile): Promise<RecipeCardData> {
  // cachedRead: this is a display path and Obsidian keeps the content hot.
  const content = await app.vault.cachedRead(file);
  const { meta, ingredients, imageEmbed } = parseRecipeNote(content);

  // imageEmbed can hold one or more "![[filename]]" lines (RecipeFullscreen's
  // gallery) — the card front only ever shows one, so just the first.
  let imageUrl: string | null = null;
  const embedMatch = /!\[\[([^\]|]+)/.exec(imageEmbed);
  if (embedMatch) {
    const target = app.metadataCache.getFirstLinkpathDest(embedMatch[1].trim(), file.path);
    if (target) imageUrl = app.vault.getResourcePath(target);
  }

  return {
    file, title: file.basename, imageUrl,
    ingredientCount: ingredients.length,
    servings: meta.servings, prepTime: meta.prepTime, cookTime: meta.cookTime,
    totalMinutes: parseMinutes(meta.prepTime) + parseMinutes(meta.cookTime),
    categories: meta.categories, tags: meta.tags,
  };
}

// The mtime-keyed `cardCache` that used to sit here is gone. It existed because
// the old watcher re-listed and re-parsed EVERY recipe on any change anywhere
// in the folder; the shared source cache (core/source-cache.ts) now means the
// row read happens once per change for all subscribers, and each card's body
// parse is keyed off the row it belongs to.
//
// `watchRecipesFolder` is gone too — the shared vault-event hub
// (core/vault-events.ts) handles it, via the codec's watchTargets.
