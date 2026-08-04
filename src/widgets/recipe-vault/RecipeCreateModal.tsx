import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { App, TFile } from 'obsidian';
import {
  listRecipeTemplates,
  cloneBlankTemplate,
  createRecipeNote,
  RECIPE_CATEGORIES,
} from '../../data-sources/recipes';
import type { RecipeTemplate } from '../../data-sources/recipes';

interface Props {
  app:       App;
  onClose:   () => void;
  onCreated: (file: TFile) => void;
}

type Step = 'template' | 'fields';

// Portaled to <body>, reusing .cc2-modal-backdrop/.cc2-modal/.cc2-setup-*
// shell classes verbatim — same shape as MeetingCreateModal, minus a date
// field (recipes don't have one) and the meeting/project link picker (no
// backlinking concept for recipes yet).
export function RecipeCreateModal({ app, onClose, onCreated }: Props) {
  const [step,             setStep]             = useState<Step>('template');
  const [templates,        setTemplates]        = useState<RecipeTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates]  = useState(true);
  const [selected,         setSelected]         = useState<RecipeTemplate | null>(null);

  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const newTemplateRef = useRef<HTMLInputElement>(null);

  const [title,           setTitle]           = useState('');
  const [extraValues,     setExtraValues]     = useState<Record<string, string>>({});
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState('');

  const titleRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    const list = await listRecipeTemplates(app);
    setTemplates(list);
    setLoadingTemplates(false);
    return list;
  }, [app]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (showNewTemplate) newTemplateRef.current?.focus();
  }, [showNewTemplate]);

  useEffect(() => {
    if (step === 'fields') titleRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const selectTemplate = (tpl: RecipeTemplate) => {
    setSelected(tpl);
    setExtraValues(prev => {
      const next: Record<string, string> = {};
      for (const f of tpl.extraFields) next[f.key] = prev[f.key] ?? '';
      return next;
    });
    setStep('fields');
  };

  // Same reasoning as Meeting Notes: a freshly cloned template has nothing
  // worth reviewing yet — hand off to the real editor to build it out, then
  // come back and use it once it's ready.
  const handleCreateTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    const file = await cloneBlankTemplate(app, name);
    onClose();
    app.workspace.openLinkText(file.path, '');
  };

  const handleSubmit = async () => {
    if (!selected || !title.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const file = await createRecipeNote(app, {
        template: selected.file,
        title:    title.trim(),
        extraValues,
        categories: Array.from(selectedCategories),
      });
      onCreated(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create recipe note.');
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-rv-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">
            {step === 'template' ? 'New Recipe — Choose a Template' : `New Recipe — ${selected?.name}`}
          </span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        {step === 'template' && (
          <div className="cc2-rv-template-picker">
            {loadingTemplates && <div className="cc2-setup-loading">Scanning vault…</div>}

            {!loadingTemplates && templates.length === 0 && !showNewTemplate && (
              <div className="cc2-rv-empty">No templates yet — create one to get started.</div>
            )}

            {!loadingTemplates && templates.map(tpl => (
              <button
                key={tpl.file.path}
                type="button"
                className="cc2-flush-btn cc2-rv-template-row"
                onClick={() => selectTemplate(tpl)}
              >
                <span className="cc2-rv-template-name">{tpl.name}</span>
                {tpl.extraFields.length > 0 && (
                  <span className="cc2-rv-template-fields">
                    {tpl.extraFields.map(f => f.label).join(', ')}
                  </span>
                )}
              </button>
            ))}

            {!showNewTemplate ? (
              <button
                type="button"
                className="cc2-flush-btn cc2-rv-new-template-btn"
                onClick={() => setShowNewTemplate(true)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New template
              </button>
            ) : (
              <div className="cc2-rv-new-template-row">
                <input
                  ref={newTemplateRef}
                  type="text"
                  className="cc2-setup-input"
                  placeholder="Template name…"
                  value={newTemplateName}
                  onChange={e => setNewTemplateName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); handleCreateTemplate(); }
                    if (e.key === 'Escape') { e.preventDefault(); setShowNewTemplate(false); setNewTemplateName(''); }
                  }}
                />
                <button
                  type="button"
                  className="cc2-flush-btn cc2-rv-new-template-confirm"
                  onClick={handleCreateTemplate}
                  disabled={!newTemplateName.trim()}
                  title="Create template"
                >
                  <svg width="13" height="13" viewBox="0 0 9 9" fill="none">
                    <path d="M1 4.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'fields' && selected && (
          <>
            <div className="cc2-setup-body cc2-rv-fields-body">
              <div className="cc2-cal-field">
                <label>Title *</label>
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Grandma's lasagna, Weeknight stir fry…"
                />
              </div>

              <div className="cc2-cal-field">
                <label>Categories</label>
                <div className="cc2-rv-category-row">
                  {RECIPE_CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      className={'cc2-flush-btn cc2-rv-category-chip' + (selectedCategories.has(cat) ? ' active' : '')}
                      onClick={() => toggleCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {selected.extraFields.map(f => (
                <div className="cc2-cal-field" key={f.key}>
                  <label>{f.label}</label>
                  <input
                    type="text"
                    value={extraValues[f.key] ?? ''}
                    onChange={e => setExtraValues(v => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}

              {error && <div className="cc2-rv-error">{error}</div>}
            </div>

            <div className="cc2-setup-footer">
              <button
                type="button"
                className="cc2-flush-btn cc2-rv-back"
                onClick={() => setStep('template')}
                disabled={submitting}
              >
                ← Back
              </button>
              <button
                type="button"
                className="pill highlight"
                onClick={handleSubmit}
                disabled={submitting || !title.trim()}
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
