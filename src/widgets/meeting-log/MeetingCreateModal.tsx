import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { App, TFile } from 'obsidian';
import {
  listMeetingTemplates,
  cloneBlankTemplate,
  createMeetingNote,
  todayLocalISO,
} from '../../data-sources/meetings';
import type { MeetingTemplate } from '../../data-sources/meetings';
import { LinkPickerModal } from './LinkPickerModal';

interface Props {
  app:       App;
  onClose:   () => void;
  onCreated: (file: TFile) => void;
}

type Step = 'template' | 'fields';

// Portaled to <body>, like every other modal in this app — reuses
// .cc2-modal-backdrop/.cc2-modal/.cc2-setup-* shell classes verbatim, which
// means it inherits the existing token-bridge on .cc2-modal-backdrop for
// free. No shared class here is ever prefixed with .cc2-root.
export function MeetingCreateModal({ app, onClose, onCreated }: Props) {
  const [step,            setStep]            = useState<Step>('template');
  const [templates,       setTemplates]       = useState<MeetingTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selected,        setSelected]        = useState<MeetingTemplate | null>(null);

  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const newTemplateRef = useRef<HTMLInputElement>(null);

  const [title,       setTitle]       = useState('');
  const [date,         setDate]        = useState(todayLocalISO());
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  // Entirely optional — a user who never opens this gets exactly the
  // pre-existing create flow, with no project/related-meetings frontmatter
  // added at all.
  const [showLinkPicker,   setShowLinkPicker]   = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<TFile[]>([]);
  const [selectedMeetings, setSelectedMeetings] = useState<TFile[]>([]);

  const titleRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    const list = await listMeetingTemplates(app);
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

  const selectTemplate = (tpl: MeetingTemplate) => {
    setSelected(tpl);
    setExtraValues(prev => {
      const next: Record<string, string> = {};
      for (const f of tpl.extraFields) next[f.key] = prev[f.key] ?? '';
      return next;
    });
    setStep('fields');
  };

  // A freshly cloned template has no fields worth reviewing yet and isn't
  // meant to be used for a real meeting immediately — hand off to the real
  // editor so the user can actually build it out (add cc2-extra-fields,
  // headers, etc.), then come back and use it once it's ready. Closes this
  // modal entirely rather than continuing the meeting-creation flow.
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
      const file = await createMeetingNote(app, {
        template: selected.file,
        title:    title.trim(),
        date,
        extraValues,
        projectLinks:        selectedProjects,
        relatedMeetingLinks: selectedMeetings,
      });
      onCreated(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create meeting note.');
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-mtg-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">
            {step === 'template' ? 'New Meeting — Choose a Template' : `New Meeting — ${selected?.name}`}
          </span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        {step === 'template' && (
          <div className="cc2-mtg-template-picker">
            {loadingTemplates && <div className="cc2-setup-loading">Scanning vault…</div>}

            {!loadingTemplates && templates.length === 0 && !showNewTemplate && (
              <div className="cc2-mtg-empty">No templates yet — create one to get started.</div>
            )}

            {!loadingTemplates && templates.map(tpl => (
              <button
                key={tpl.file.path}
                type="button"
                className="cc2-flush-btn cc2-mtg-template-row"
                onClick={() => selectTemplate(tpl)}
              >
                <span className="cc2-mtg-template-name">{tpl.name}</span>
                {tpl.extraFields.length > 0 && (
                  <span className="cc2-mtg-template-fields">
                    {tpl.extraFields.map(f => f.label).join(', ')}
                  </span>
                )}
              </button>
            ))}

            {!showNewTemplate ? (
              <button
                type="button"
                className="cc2-flush-btn cc2-mtg-new-template-btn"
                onClick={() => setShowNewTemplate(true)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New template
              </button>
            ) : (
              <div className="cc2-mtg-new-template-row">
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
                  className="cc2-flush-btn cc2-mtg-new-template-confirm"
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
            <div className="cc2-setup-body cc2-mtg-fields-body">
              <div className="cc2-cal-field">
                <label>Title *</label>
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Weekly sync, Client call…"
                />
              </div>
              <div className="cc2-cal-field">
                <label>Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
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

              <button
                type="button"
                className="cc2-flush-btn cc2-mtg-link-btn"
                onClick={() => setShowLinkPicker(true)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07l1.5-1.5" />
                </svg>
                {selectedProjects.length === 0 && selectedMeetings.length === 0
                  ? 'Connect to meetings or projects'
                  : [
                      selectedMeetings.length ? `${selectedMeetings.length} meeting${selectedMeetings.length > 1 ? 's' : ''}` : null,
                      selectedProjects.length ? `${selectedProjects.length} project${selectedProjects.length > 1 ? 's' : ''}` : null,
                    ].filter(Boolean).join(', ') + ' linked'}
              </button>

              {error && <div className="cc2-mtg-error">{error}</div>}
            </div>

            <div className="cc2-setup-footer">
              <button
                type="button"
                className="cc2-flush-btn cc2-mtg-back"
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

      {showLinkPicker && (
        <LinkPickerModal
          app={app}
          initialProjects={selectedProjects}
          initialMeetings={selectedMeetings}
          onCancel={() => setShowLinkPicker(false)}
          onApply={({ projects, meetings }) => {
            setSelectedProjects(projects);
            setSelectedMeetings(meetings);
            setShowLinkPicker(false);
          }}
        />
      )}
    </div>,
    document.body,
  );
}
