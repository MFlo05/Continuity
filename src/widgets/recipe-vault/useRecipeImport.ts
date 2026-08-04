import { useCallback } from 'react';
import type { App } from 'obsidian';
import { useAI } from '../../ai/AIContext';
import { useIsDark } from '../../ai/AIPanel';
import { recipesFolder } from '../../data-sources/recipes';
import { recipeSkillPath } from './RecipeImportModal';

// Originally shared by RecipeVaultWidget (since removed — replaced by
// RecipeBoxWidget) and RecipeBoxWidget; kept as its own hook rather than
// folded back into RecipeBoxWidget now that there's only one caller, since
// it's still a clean seam if a future recipe-browsing surface needs the
// same import flow. Extracted in the first place because the YOLO-mode
// scoping + forceNewConversation handoff is exact behavior that took real
// debugging to get right (see DESIGN_SYSTEM.md's stdin.end()/stale-closure
// notes) — copy-pasting it risks a subtly different, silently-broken
// variant instead of reusing the one proven-correct version. The caller
// keeps its own showImport/setShowImport modal-visibility state — this
// hook only owns the AI call itself.
export function useRecipeImport(app: App) {
  const { settings, updateSettings, setPanelOpen, sendMessage } = useAI();
  const isDark = useIsDark();

  // Only Claude CLI mode has real web-fetch/tool capability today — see
  // DESIGN_SYSTEM.md / the meal-planning plan for why other providers can't
  // drive this feature.
  const canImportWithAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';

  const handleImport = useCallback(async (url: string) => {
    setPanelOpen(true);

    // YOLO mode scoped to just this one send — fetching the page +
    // downloading photos would otherwise be several separate approval
    // clicks. Restored in `finally` so it never leaks into what the user
    // does next in the panel.
    const prevYolo = settings.claudeYoloMode;
    await updateSettings({ claudeYoloMode: true });
    try {
      // The destination folder is resolved HERE and passed as a concrete
      // path, never left for the skill file to reconstruct from a hardcoded
      // root — same rule useSyllabusImport.ts already follows. Without it the
      // skill fell back to its own literal "command-center/Recipes", which is
      // wrong for any vault whose root has been renamed: the note landed in a
      // freshly-created folder the widget doesn't read.
      await sendMessage(
        `Read the instructions at ${recipeSkillPath(app)} and follow them to create a recipe note from this URL: ${url}. ` +
        `Write the note into ${recipesFolder(app)} (create the folder if it doesn't exist).`,
        undefined, undefined, { forceNewConversation: true },
      );
    } finally {
      await updateSettings({ claudeYoloMode: prevYolo });
    }
  }, [app, settings.claudeYoloMode, updateSettings, setPanelOpen, sendMessage]);

  return { settings, canImportWithAI, isDark, handleImport };
}
