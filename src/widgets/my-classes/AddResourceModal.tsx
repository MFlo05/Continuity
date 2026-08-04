import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Notice } from 'obsidian';
import { useAI } from '../../ai/AIContext';
import { useIsDark } from '../../ai/AIPanel';
import { BrandMark } from '../../ai/BrandMark';

interface Props {
  onCancel:  () => void;
  onAddLink: (label: string, url: string) => void;
  onAddFile: (label: string, file: File) => void;
}

// Two-mode modal (Link / File) rather than two separate modals — mirrors the
// "Vault vs Computer" peer-option convention AIPanel's own attach menu
// already uses. File mode writes into the class's own Resources/ subfolder
// (see class-resources.ts's addResourceFile), never the vault-wide default
// attachments folder.
export function AddResourceModal({ onCancel, onAddLink, onAddFile }: Props) {
  const [mode,  setMode]  = useState<'link' | 'file'>('link');
  const [label, setLabel] = useState('');
  const [url,   setUrl]   = useState('');
  const [file,  setFile]  = useState<File | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  const { settings } = useAI();
  const isDark = useIsDark();
  const canImportWithAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';

  useEffect(() => { labelRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const trimmedLabel = label.trim();
  const canConfirm = mode === 'link'
    ? trimmedLabel.length > 0 && url.trim().length > 0
    : trimmedLabel.length > 0 && !!file;

  const confirm = () => {
    if (!canConfirm) return;
    if (mode === 'link') onAddLink(trimmedLabel, url.trim());
    else if (file) onAddFile(trimmedLabel, file);
  };

  return createPortal(
    // cc2-nested-modal-backdrop bumps z-index above a plain .cc2-modal-backdrop
    // — harmless when opened directly (as ResourcesSection does), needed when
    // opened from inside AssignmentDetailModal (a modal-on-modal case, same
    // precedent as LinkPickerModal's own z-index bump over MeetingCreateModal).
    <div className="cc2-modal-backdrop cc2-nested-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Add Resource</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <div className="cc2-cfs-resource-mode-toggle">
            <button type="button" className={'cc2-flush-btn' + (mode === 'link' ? ' active' : '')} onClick={() => setMode('link')}>Link</button>
            <button type="button" className={'cc2-flush-btn' + (mode === 'file' ? ' active' : '')} onClick={() => setMode('file')}>File</button>
          </div>

          <input
            ref={labelRef}
            type="text"
            className="cc2-setup-input"
            placeholder="Label, e.g. Kritik"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />

          {mode === 'link' ? (
            <input
              type="text"
              className="cc2-setup-input"
              placeholder="https://…"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          ) : (
            <input
              type="file"
              className="cc2-cfs-resource-file-input"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
          <span className="cc2-cfs-resource-footer-spacer" />
          {/* Notice-stub only — real AI wiring (reading the resource and
              summarizing it into the class folder) is a later phase, same
              as Import Syllabus; this button exists now so the intended
              flow is visible rather than silently missing. */}
          <button
            type="button"
            className="cc2-flush-btn cc2-cfs-resource-ai-btn"
            title={canImportWithAI ? 'Summarize this resource with AI (coming soon)' : `Requires Claude CLI mode (currently ${settings.activeProvider})`}
            disabled={!canImportWithAI}
            onClick={() => new Notice('Summarizing with AI is coming in a later update.')}
          >
            <BrandMark provider={settings.activeProvider} size={13} isDark={isDark} />
            Summarize with AI
          </button>
          <button className="cc2-setup-confirm" onClick={confirm} disabled={!canConfirm}>Add</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
