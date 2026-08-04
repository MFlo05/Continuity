import { useCallback } from 'react';
import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import { useAI } from '../../ai/AIContext';
import { useIsDark } from '../../ai/AIPanel';
import { classFolderPath } from '../../data-sources/class-info';
import { scheduleFilePath } from '../../data-sources/class-schedule';
import { addResourceLink, addResourceFile } from '../../data-sources/class-resources';
import { syllabusSkillPath } from './SyllabusImportModal';

export type SyllabusSource = { kind: 'url'; url: string } | { kind: 'file'; file: File };

// Mirrors useRecipeImport.ts's exact shape (YOLO-mode scoping +
// forceNewConversation handoff is proven-correct there — copied, not
// re-derived, per that file's own comment on why it's worth keeping as one
// canonical implementation rather than a subtly-different variant per
// import feature).
export function useSyllabusImport(app: App) {
  const { settings, updateSettings, setPanelOpen, sendMessage } = useAI();
  const isDark = useIsDark();
  const canImportWithAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';

  const handleImport = useCallback(async (slug: string, classCode: string, source: SyllabusSource) => {
    // Every call site fires this without awaiting/catching it (it's an
    // event-handler callback, not something a render can wait on) — without
    // this wrapper, any throw below (a bad path, a rejected sendMessage,
    // anything) becomes a silent unhandled promise rejection: the panel
    // never opens, nothing happens, and there's no clue why. Surface it.
    try {
      setPanelOpen(true);

      // Land the raw syllabus itself as a tagged Resources.md row FIRST —
      // gives the prompt below a concrete, already-resolved path/url to hand
      // off, and makes the source material visible in ClassResourcesWidget
      // ("From syllabus") even if the AI call itself later fails or the
      // panel gets closed early.
      let sourceDescription: string;
      if (source.kind === 'url') {
        await addResourceLink(app, slug, 'Syllabus', source.url, 'AI import');
        sourceDescription = `this URL: ${source.url}`;
      } else {
        const path = await addResourceFile(app, slug, 'Syllabus', source.file, 'AI import');
        sourceDescription = `the file at ${path}`;
      }

      // Resolved to concrete strings here, not left for the skill file to
      // reconstruct — Recipe-Creation.md hardcodes a stale command-center
      // root path this vault no longer actually uses; passing
      // already-resolved paths avoids repeating that exact staleness trap.
      const classFolder = classFolderPath(app, slug);
      const scheduleFile = scheduleFilePath(app);
      const skillPath    = syllabusSkillPath(app);

      const prevYolo = settings.claudeYoloMode;
      await updateSettings({ claudeYoloMode: true });
      try {
        await sendMessage(
          `Read the instructions at ${skillPath} and follow them to import a syllabus for "${classCode}" ` +
          `(class slug: ${slug}, class folder: ${classFolder}) from ${sourceDescription}. ` +
          `If you find recurring weekly meeting times, the shared class schedule file is at ${scheduleFile}.`,
          undefined, undefined, { forceNewConversation: true },
        );
      } finally {
        await updateSettings({ claudeYoloMode: prevYolo });
      }
    } catch (err) {
      console.error('Syllabus import failed:', err);
      new Notice(`Syllabus import failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [app, settings.claudeYoloMode, updateSettings, setPanelOpen, sendMessage]);

  return { settings, canImportWithAI, isDark, handleImport };
}
