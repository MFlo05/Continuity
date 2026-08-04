import { useEffect, useMemo, useState } from 'react';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { useVaultData } from '../../core';
import type { RecordRow } from '../../core';
import { loadRecipeCardData, recipeSource } from '../../data-sources/recipes';
import type { RecipeCardData } from '../../data-sources/recipes';

/**
 * Card data for every recipe, for the two widgets that draw the peel-stack —
 * `RecipeBoxWidget` (dashboard) and `RecipeBoxModal` (inside Meal Planner).
 * Both ran a byte-identical loader before this; one hook now owns it.
 *
 * Two-layer read, because a recipe note is two shapes in one file:
 *   - frontmatter → a record-folder row, read and cached by the shared codec
 *   - body        → the `## Image` embed and the `## Ingredients` count, which
 *                   need a real parse (parseRecipeNote) per note
 *
 * The row layer is what changes when the vault changes, so the body parse is
 * keyed off it: `rowsKey` folds in each row's mtime, so a note that didn't
 * change isn't re-parsed.
 */
export function useRecipeCards(app: App): { cards: RecipeCardData[]; loading: boolean } {
  const source = useMemo(() => recipeSource(app), [app]);
  const { rows, loading: rowsLoading } = useVaultData<RecordRow>(app, source);

  const [cards, setCards] = useState<RecipeCardData[]>([]);
  const [parsing, setParsing] = useState(true);

  const rowsKey = rows.map(r => `${r.path}:${r.mtime}`).join('|');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const files = rows
        .map(r => app.vault.getAbstractFileByPath(r.path))
        .filter((f): f is TFile => f instanceof TFile);
      const data = await Promise.all(files.map(f => loadRecipeCardData(app, f)));
      // A slow parse for an old row set must not overwrite a newer one.
      if (cancelled) return;
      setCards(data);
      setParsing(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, rowsKey]);

  return { cards, loading: rowsLoading || parsing };
}
