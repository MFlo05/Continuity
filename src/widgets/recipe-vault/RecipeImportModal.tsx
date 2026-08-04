import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { resolveCommandCenterPath } from '../../data-sources/vault-paths';

export function recipeSkillPath(app: App): string {
  return resolveCommandCenterPath(app, 'Skills', 'Recipe-Creation.md');
}

interface Props {
  app:      App;
  onClose:  () => void;
  onImport: (url: string) => void;
}

// Portaled to <body>, reusing .cc2-modal-backdrop/.cc2-modal verbatim (same
// token bridge as every other modal here). Deliberately its own file rather
// than another step bolted onto RecipeCreateModal — the two flows share
// nothing (one's a form with template/fields steps, this is "paste a link
// and hand off to the AI panel"), and onImport does the actual useAI() work
// (via useRecipeImport, RecipeBoxWidget's caller) so this component stays a
// dumb URL prompt.
export function RecipeImportModal({ app, onClose, onImport }: Props) {
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onImport(trimmed);
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-rv-import-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Add Recipe with AI</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            Paste a recipe URL — the AI assistant will read it, write a new recipe note ({recipeSkillPath(app)}), and grab a couple of photos. Watch progress in the AI panel.
          </p>
          <input
            ref={inputRef}
            type="text"
            className="cc2-setup-input"
            placeholder="https://…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={submit} disabled={!url.trim()}>
            Import →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
