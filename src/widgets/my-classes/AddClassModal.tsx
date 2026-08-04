import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { useAI } from '../../ai/AIContext';
import { useIsDark } from '../../ai/AIPanel';
import { BrandMark } from '../../ai/BrandMark';
import { SyllabusImportModal } from './SyllabusImportModal';
import type { SyllabusSource } from './useSyllabusImport';

export interface NewClassFields {
  code: string;
  name: string;
  teacher: string;
  teacherEmail: string;
  room: string;
}

interface Props {
  app:   App;
  error?: string;
  onCancel:  () => void;
  onConfirm: (fields: NewClassFields) => void;
  // Fires with whatever's already been typed into this form (in case the
  // user filled in a field or two manually before also reaching for AI) plus
  // the picked syllabus source. The caller (MyClassesWidget) creates+seeds
  // the class first, then hands the source off to useSyllabusImport — the
  // class doesn't exist yet at the moment this button is clicked, unlike
  // every other "Import Syllabus" entry point in the app.
  onImportSyllabus: (fields: NewClassFields, source: SyllabusSource) => void;
}

// Reuses the same .cc2-modal-backdrop/.cc2-setup-modal/.cc2-setup-* shell as
// AddBucketModal (Kanban) for visual consistency and its portal token-bridge.
//
// The "Add a Syllabus with AI" button mirrors Recipe Box's exact
// Add-with-AI button (BrandMark + canImportWithAI gating, same
// .cc2-flush-btn-layered recipe). Gated on canConfirm too (not just
// canImportWithAI) — a class code has to exist before there's anything to
// import a syllabus INTO.
export function AddClassModal({ app, error, onCancel, onConfirm, onImportSyllabus }: Props) {
  const [code,         setCode]         = useState('');
  const [name,         setName]         = useState('');
  const [teacher,      setTeacher]      = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [room,         setRoom]         = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  const { settings } = useAI();
  const isDark = useIsDark();
  const canImportWithAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';
  const [showSyllabusPicker, setShowSyllabusPicker] = useState(false);

  useEffect(() => { codeRef.current?.focus(); }, []);

  const trimmedCode = code.trim();
  const canConfirm   = trimmedCode.length > 0;
  const currentFields = () => ({
    code: trimmedCode,
    name: name.trim(),
    teacher: teacher.trim(),
    teacherEmail: teacherEmail.trim(),
    room: room.trim(),
  });
  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(currentFields());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Enter' && canConfirm) confirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfirm, trimmedCode, name, teacher, teacherEmail, room]);

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">New Class</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            Creates a new class folder under <strong>Education/Classes</strong>.
          </p>

          <input
            ref={codeRef}
            type="text"
            className="cc2-setup-input"
            placeholder="Class code, e.g. CHEM 101"
            value={code}
            onChange={e => setCode(e.target.value)}
          />
          <input
            type="text"
            className="cc2-setup-input"
            placeholder="Class name, e.g. Introduction to Chemistry"
            value={name}
            onChange={e => setName(e.target.value)}
          />

          <button
            type="button"
            className="cc2-flush-btn cc2-mc-ai-btn"
            title={
              !canImportWithAI ? `Requires Claude CLI mode (currently ${settings.activeProvider})`
              : !canConfirm ? 'Enter a class code first'
              : 'Add a syllabus with AI'
            }
            disabled={!canImportWithAI || !canConfirm}
            onClick={() => setShowSyllabusPicker(true)}
          >
            <BrandMark provider={settings.activeProvider} size={14} isDark={isDark} />
            Add a Syllabus with AI
          </button>
          {showSyllabusPicker && (
            <SyllabusImportModal
              app={app}
              title="Add a Syllabus with AI"
              onClose={() => setShowSyllabusPicker(false)}
              onImport={(source: SyllabusSource) => {
                setShowSyllabusPicker(false);
                onImportSyllabus(currentFields(), source);
              }}
            />
          )}

          <div className="cc2-settings-divider" />

          <label className="cc2-mc-settings-label cc2-mc-settings-label-first">Teacher (optional)</label>
          <input
            type="text"
            className="cc2-setup-input"
            placeholder="e.g. Dr. Jane Smith"
            value={teacher}
            onChange={e => setTeacher(e.target.value)}
          />
          <label className="cc2-mc-settings-label">Teacher email (optional)</label>
          <input
            type="text"
            className="cc2-setup-input"
            placeholder="e.g. jsmith@school.edu"
            value={teacherEmail}
            onChange={e => setTeacherEmail(e.target.value)}
          />
          <label className="cc2-mc-settings-label">Room (optional)</label>
          <input
            type="text"
            className="cc2-setup-input"
            placeholder="e.g. Bldg 4, Room 212"
            value={room}
            onChange={e => setRoom(e.target.value)}
          />

          {error && <div className="cc2-kb-bucket-error">{error}</div>}
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={confirm} disabled={!canConfirm}>
            Add Class
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
