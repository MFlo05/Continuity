import { useCallback } from 'react';
import type { App } from 'obsidian';
import { useAI } from '../../ai/AIContext';
import { useIsDark } from '../../ai/AIPanel';
import { yearFilePath } from '../../data-sources/budget';
import { resolveCommandCenterPath } from '../../data-sources/vault-paths';

export function budgetCaptureSkillPath(app: App): string {
  return resolveCommandCenterPath(app, 'Skills', 'budget-capture.md');
}

// The ledger *folder* (command-center/Finance/Ledgers/<name>/) isn't itself a
// file — pointing the AI at just the folder left it guessing at a filename
// and creating an empty "<name>.md" instead of editing the real
// "<year>-<name>.md". Always hand it the exact current-year ledger path.
export function currentLedgerFilePath(app: App, budgetName: string): string {
  return yearFilePath(app, budgetName, new Date().getFullYear());
}

// Mirrors useRecipeImport.ts's AI hand-off (see that file's comment for why
// the YOLO-scoping + forceNewConversation combination matters) — the prompt
// text, the lack of a URL argument, and useFastModel differ. Budget-capture
// is a bounded, rule-following task (keyword categorization, date math for
// recurring items, formatting) that the provider's cheapest model handles
// fine, so this always requests it rather than whatever heavier model the
// user has set as their global default.
export function useBudgetCleanup(app: App, budgetName: string) {
  const { settings, updateSettings, setPanelOpen, sendMessage } = useAI();
  const isDark = useIsDark();

  const canImportWithAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';

  const runCleanup = useCallback(async () => {
    setPanelOpen(true);

    const prevYolo = settings.claudeYoloMode;
    await updateSettings({ claudeYoloMode: true });
    try {
      await sendMessage(
        `Read the instructions at ${budgetCaptureSkillPath(app)} and follow them for the "${budgetName}" ledger — the current year's ledger file is ${currentLedgerFilePath(app, budgetName)}.`,
        undefined, undefined, { forceNewConversation: true, useFastModel: true },
      );
    } finally {
      await updateSettings({ claudeYoloMode: prevYolo });
    }
  }, [app, budgetName, settings.claudeYoloMode, updateSettings, setPanelOpen, sendMessage]);

  return { settings, canImportWithAI, isDark, runCleanup };
}
