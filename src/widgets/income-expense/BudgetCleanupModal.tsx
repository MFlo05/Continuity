import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { useBudgetCleanup, budgetCaptureSkillPath, currentLedgerFilePath } from './useBudgetCleanup';

interface Props {
  app:        App;
  budgetName: string;
  onClose:    () => void;
}

// Small confirm dialog before handing off to the AI panel — structurally
// identical to RecipeImportModal minus the URL field, since there's nothing
// to type here, just a yes/cancel. Confirming closes the modal immediately
// and fires runCleanup() in the background (same fire-and-forget pattern as
// RecipeBoxWidget's onImport) — sendMessage's promise only resolves once the
// entire AI turn finishes, so awaiting it here before closing left the modal
// stuck on "Starting…" with Cancel/X disabled for the whole run, even though
// the AI panel was already visibly working.
export function BudgetCleanupModal({ app, budgetName, onClose }: Props) {
  const { runCleanup } = useBudgetCleanup(app, budgetName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = () => {
    onClose();
    void runCleanup();
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-rv-import-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Clean up your Budget with your AI Assistant</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-iet-cleanup-body">
            Your AI assistant will read <code>{budgetCaptureSkillPath(app)}</code> and categorize/organize <code>{currentLedgerFilePath(app, budgetName)}</code>. Watch progress in the AI panel.
          </p>
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={confirm}>
            Yes →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
