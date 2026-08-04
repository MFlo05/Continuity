import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { resolveCommandCenterPath } from '../../data-sources/vault-paths';
import type { SyllabusSource } from './useSyllabusImport';

export function syllabusSkillPath(app: App): string {
  return resolveCommandCenterPath(app, 'Skills', 'Syllabus-Import.md');
}

interface Props {
  app:      App;
  title:    string; // "Import Syllabus" / "Update Syllabus" / "Add a Syllabus with AI" — caller-supplied
  onClose:  () => void;
  onImport: (source: SyllabusSource) => void;
}

// Link/File picker mirroring AddResourceModal's own mode toggle (minus its
// label field — the syllabus's Resources.md row always gets a fixed
// "Syllabus" label, set by useSyllabusImport, not chosen here). Portaled
// with .cc2-nested-modal-backdrop like AddResourceModal — harmless when
// opened directly (ClassPageContent's topbar button, Assignments widget's
// empty state) and required for AddClassModal's nested usage (picking a
// syllabus before the class itself even exists yet).
export function SyllabusImportModal({ app, title, onClose, onImport }: Props) {
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [url,  setUrl]  = useState('');
  const [file, setFile] = useState<File | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode === 'url') urlRef.current?.focus(); }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canConfirm = mode === 'url' ? url.trim().length > 0 : !!file;

  const submit = () => {
    if (!canConfirm) return;
    if (mode === 'url') onImport({ kind: 'url', url: url.trim() });
    else if (file) onImport({ kind: 'file', file });
  };

  return createPortal(
    <div className="cc2-modal-backdrop cc2-nested-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">{title}</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            Paste a syllabus URL, or upload the file — PDF works most reliably; Word docs are supported
            best-effort. The AI assistant will read it and fill in assignments, schedule, teacher info, and
            policies ({syllabusSkillPath(app)}). Watch progress in the AI panel.
          </p>

          <div className="cc2-cfs-resource-mode-toggle">
            <button type="button" className={'cc2-flush-btn' + (mode === 'url' ? ' active' : '')} onClick={() => setMode('url')}>Link</button>
            <button type="button" className={'cc2-flush-btn' + (mode === 'file' ? ' active' : '')} onClick={() => setMode('file')}>File</button>
          </div>

          {mode === 'url' ? (
            <input
              ref={urlRef}
              type="text"
              className="cc2-setup-input"
              placeholder="https://…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          ) : (
            <input
              type="file"
              className="cc2-cfs-resource-file-input"
              accept=".pdf,.doc,.docx"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={submit} disabled={!canConfirm}>
            Import →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
