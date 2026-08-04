import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { readClassTranscript, readClassInfo, watchClassesFolder } from '../../data-sources/class-info';
import type { ClassTranscript, AssignmentRow } from '../../data-sources/class-info';
import {
  readProgress, setAssignmentScore, setAssignmentStatus,
  addCustomAssignment, editCustomAssignment, removeCustomAssignment,
  linkAssignmentResource, unlinkAssignmentResource, linkAssignmentNote, unlinkAssignmentNote,
} from '../../data-sources/class-progress';
import type { ClassProgress } from '../../data-sources/class-progress';
import { readResources, addResourceLink, addResourceFile } from '../../data-sources/class-resources';
import type { ResourceRow } from '../../data-sources/class-resources';
import { listClassNotes, createClassNote } from '../../data-sources/class-notes';
import type { ClassNote } from '../../data-sources/class-notes';
import { readGradeCategories, addGradeCategory } from '../../data-sources/class-grade-categories';
import type { GradeCategory } from '../../data-sources/class-grade-categories';
import { mergeAssignments, computeGrade, computeGradeByCategory, letterFor, STATUS_LABEL, STATUS_CYCLE } from './assignment-utils';
import type { EffectiveAssignment } from './assignment-utils';
import { AddResourceModal } from '../my-classes/AddResourceModal';
import { useSyllabusImport } from '../my-classes/useSyllabusImport';
import type { SyllabusSource } from '../my-classes/useSyllabusImport';
import { SyllabusImportModal } from '../my-classes/SyllabusImportModal';
import { InfoTooltip } from '../shared/InfoTooltip';
import type { WidgetProps } from '../registry';

type Picker = { item: string; kind: 'note' | 'res' } | null;

// One of the 5 class-page-only grid widgets. Row-click-to-expand (chevron
// rotates) replaces the old click-to-open-modal (AssignmentDetailModal) —
// the mockup's own pattern, and genuinely lower-friction since the picker
// sits right where you're already looking instead of a separate portal.
// AddAssignmentModal/AssignmentDetailModal are retired; their logic lives
// here inline (the add/edit strip, and the resource/note picker).
export function ClassAssignmentsWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const classCode = (config?.classCode as string | undefined) ?? '';
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const { canImportWithAI, handleImport: importSyllabus } = useSyllabusImport(app);
  const [showSyllabusPicker, setShowSyllabusPicker] = useState(false);

  const [transcript, setTranscript] = useState<ClassTranscript | null>(null);
  const [progress,   setProgress]   = useState<ClassProgress | null>(null);
  const [resources,  setResources]  = useState<ResourceRow[]>([]);
  const [notes,      setNotes]      = useState<ClassNote[]>([]);
  const [gradeMode,  setGradeMode]  = useState<'assignment' | 'category'>('assignment');
  const [categories, setCategories] = useState<GradeCategory[]>([]);

  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [showAddResource, setShowAddResource] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [draftItem,     setDraftItem]     = useState('');
  const [draftDue,      setDraftDue]      = useState('');
  const [draftWorth,    setDraftWorth]    = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const draftRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    const [t, p, r, n, info, cats] = await Promise.all([
      readClassTranscript(app, slug), readProgress(app, slug),
      readResources(app, slug), listClassNotes(app, { slug }),
      readClassInfo(app, slug), readGradeCategories(app, slug),
    ]);
    setTranscript(t); setProgress(p); setResources(r); setNotes(n);
    setGradeMode(info?.gradeMode ?? 'assignment');
    setCategories(cats);
  }, [app, slug]);

  useEffect(() => { load(); return slug ? watchClassesFolder(app, load) : undefined; }, [app, slug, load]);
  useEffect(() => { if (showForm) draftRef.current?.focus(); }, [showForm]);

  const assignments = useMemo(() => mergeAssignments(transcript, progress), [transcript, progress]);
  const computed = useMemo(
    () => gradeMode === 'category' ? computeGradeByCategory(assignments, categories) : computeGrade(assignments),
    [assignments, gradeMode, categories],
  );
  const letter = computed != null && transcript?.gradeScale ? letterFor(computed, transcript.gradeScale) : null;

  const handleScore = useCallback(async (item: string, score: string) => {
    if (!slug) return;
    await setAssignmentScore(app, slug, item, score);
    load();
  }, [app, slug, load]);

  const handleCycleStatus = useCallback(async (row: EffectiveAssignment) => {
    if (!slug) return;
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(row.status) + 1) % STATUS_CYCLE.length];
    await setAssignmentStatus(app, slug, row.item, next);
    load();
  }, [app, slug, load]);

  const openAddForm = () => { setShowForm(true); setEditingItem(null); setDraftItem(''); setDraftDue(''); setDraftWorth(''); setDraftCategory(''); };
  const openEditForm = (row: EffectiveAssignment) => {
    setShowForm(true); setEditingItem(row.item);
    setDraftItem(row.item); setDraftDue(row.dateOrWeek === 'Varies' ? '' : row.dateOrWeek);
    setDraftWorth(row.worth); setDraftCategory(row.category ?? '');
  };
  const cancelForm = () => { setShowForm(false); setEditingItem(null); };

  const submitForm = useCallback(async () => {
    if (!slug) return;
    const name = draftItem.trim();
    if (!name) return;
    const category = draftCategory.trim();
    const row: AssignmentRow = gradeMode === 'category'
      ? { item: name, dateOrWeek: draftDue.trim(), worth: '', category: category || undefined }
      : { item: name, dateOrWeek: draftDue.trim(), worth: draftWorth.trim() };
    // Typing a not-yet-registered category name here is how a category gets
    // created in the first place — same "seamless" spirit as the mode switch
    // itself: the weight can be filled in later from the Grade Breakdown
    // widget's own settings, but naming it shouldn't require a trip there first.
    if (gradeMode === 'category' && category && !categories.some(c => c.name === category)) {
      await addGradeCategory(app, slug, category, '0%');
    }
    if (editingItem) await editCustomAssignment(app, slug, editingItem, row);
    else await addCustomAssignment(app, slug, row);
    setShowForm(false); setEditingItem(null);
    load();
  }, [app, slug, draftItem, draftDue, draftWorth, draftCategory, gradeMode, categories, editingItem, load]);

  const handleRemove = useCallback(async (item: string) => {
    if (!slug) return;
    const confirmed = window.confirm(`Remove "${item}"?`);
    if (!confirmed) return;
    await removeCustomAssignment(app, slug, item);
    if (expandedItem === item) setExpandedItem(null);
    load();
  }, [app, slug, expandedItem, load]);

  const toggleRow = (item: string) => {
    setExpandedItem(prev => (prev === item ? null : item));
    setPicker(null);
  };

  const togglePicker = (item: string, kind: 'note' | 'res') => {
    setPicker(prev => (prev?.item === item && prev.kind === kind ? null : { item, kind }));
  };

  const toggleResourceLink = useCallback(async (item: string, label: string, linked: boolean) => {
    if (!slug) return;
    if (linked) await unlinkAssignmentResource(app, slug, item, label);
    else await linkAssignmentResource(app, slug, item, label);
    load();
  }, [app, slug, load]);

  const toggleNoteLink = useCallback(async (item: string, path: string, linked: boolean) => {
    if (!slug) return;
    if (linked) await unlinkAssignmentNote(app, slug, item, path);
    else await linkAssignmentNote(app, slug, item, path);
    load();
  }, [app, slug, load]);

  const handlePickerCreateNote = useCallback(async (item: string) => {
    if (!slug) return;
    const file = await createClassNote(app, slug, `${item} — notes`, `# ${item} — notes\n\n`);
    await linkAssignmentNote(app, slug, item, file.path);
    setPicker(null);
    load();
    app.workspace.openLinkText(file.path, '', true);
  }, [app, slug, load]);

  const handleAddResourceLink = useCallback(async (label: string, url: string) => {
    if (!slug || !picker) return;
    await addResourceLink(app, slug, label, url);
    await linkAssignmentResource(app, slug, picker.item, label);
    setShowAddResource(false); setPicker(null);
    load();
  }, [app, slug, picker, load]);

  const handleAddResourceFile = useCallback(async (label: string, file: File) => {
    if (!slug || !picker) return;
    await addResourceFile(app, slug, label, file);
    await linkAssignmentResource(app, slug, picker.item, label);
    setShowAddResource(false); setPicker(null);
    load();
  }, [app, slug, picker, load]);

  if (!slug) return null;

  return (
    <div className="cc2-caw-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-caw-header">
        <span className="cc2-caw-title">Assignments &amp; Grades</span>
        {gradeMode === 'category' && (
          <InfoTooltip text="This class grades by category — pick one per assignment instead of entering its own weight. Manage categories and their weights in the Grade Breakdown widget's own settings." />
        )}
        <div className="cc2-caw-header-actions">
          {computed != null && (
            <span className="cc2-cfs-grade-badge">{computed.toFixed(1)}%{letter ? ` (${letter})` : ''}</span>
          )}
          <button type="button" className="cc2-flush-btn cc2-cfs-add-btn" title="Add assignment" onClick={openAddForm}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="cc2-caw-form">
          <input
            ref={draftRef}
            type="text"
            className="cc2-setup-input cc2-caw-form-item"
            placeholder="Assignment name"
            value={draftItem}
            onChange={e => setDraftItem(e.target.value)}
          />
          <input
            type="text"
            className="cc2-setup-input cc2-caw-form-due"
            placeholder="Due (e.g. Oct 24)"
            value={draftDue}
            onChange={e => setDraftDue(e.target.value)}
          />
          {gradeMode === 'category' ? (
            <>
              <input
                type="text"
                className="cc2-setup-input cc2-caw-form-worth"
                placeholder="Category"
                list="cc2-caw-category-options"
                value={draftCategory}
                onChange={e => setDraftCategory(e.target.value)}
              />
              <datalist id="cc2-caw-category-options">
                {categories.map(c => <option key={c.name} value={c.name} />)}
              </datalist>
            </>
          ) : (
            <input
              type="text"
              className="cc2-setup-input cc2-caw-form-worth"
              placeholder="Weight %"
              value={draftWorth}
              onChange={e => setDraftWorth(e.target.value)}
            />
          )}
          <button type="button" className="cc2-setup-confirm cc2-caw-form-submit" onClick={submitForm} disabled={!draftItem.trim()}>
            {editingItem ? 'Save' : 'Add'}
          </button>
          <button type="button" className="cc2-flush-btn cc2-caw-form-cancel" onClick={cancelForm}>Cancel</button>
        </div>
      )}

      <div className="cc2-caw-list">
        {assignments.length === 0 && !showForm && (
          <div className="cc2-caw-empty">
            <div className="cc2-caw-empty-text">No assignments yet. Add them by hand — or let AI set up your whole semester from the syllabus.</div>
            <div className="cc2-caw-empty-actions">
              <button
                type="button"
                className="cc2-setup-confirm"
                title={canImportWithAI ? 'Import syllabus with AI' : 'Requires Claude CLI mode'}
                disabled={!canImportWithAI}
                onClick={() => setShowSyllabusPicker(true)}
              >
                ✦ Import syllabus
              </button>
              <button type="button" className="cc2-setup-cancel" onClick={openAddForm}>Add manually</button>
            </div>
          </div>
        )}
        {assignments.map((row, i) => {
          const linkedCount = row.resourceLabels.length + row.noteLinks.length;
          const expanded = expandedItem === row.item;
          const rowPicker = picker?.item === row.item ? picker.kind : null;
          const pickerPool = rowPicker === 'note'
            ? notes.filter(n => !row.noteLinks.includes(n.file.path))
            : rowPicker === 'res' ? resources.filter(r => !row.resourceLabels.includes(r.label)) : [];

          return (
            <div key={row.item + i} className="cc2-caw-item">
              <div className="cc2-cfs-assign-row" onClick={() => toggleRow(row.item)}>
                <button
                  type="button"
                  className="cc2-flush-btn cc2-cfs-status-pill"
                  data-status={row.status}
                  onClick={e => { e.stopPropagation(); handleCycleStatus(row); }}
                >
                  {STATUS_LABEL[row.status]}
                </button>
                <div className="cc2-cfs-assign-main">
                  <span className="cc2-cfs-assign-item">{row.item}</span>
                  <span className="cc2-cfs-assign-meta">
                    {row.dateOrWeek || 'Varies'}
                    {row.worth ? ` · worth ${row.worth}` : ''}
                    {row.category ? ` · ${row.category}` : ''}
                    {row.origin === 'custom' ? ' · added by you' : ''}
                  </span>
                </div>
                {linkedCount > 0 && (
                  <span className="cc2-caw-link-count">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    {linkedCount}
                  </span>
                )}
                <input
                  type="text"
                  className="cc2-cfs-assign-score"
                  placeholder="Score"
                  defaultValue={row.score ?? ''}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { if (e.target.value !== (row.score ?? '')) handleScore(row.item, e.target.value); }}
                />
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="cc2-caw-chevron" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}>
                  <path d="M2 5l5 5 5-5" />
                </svg>
              </div>

              {expanded && (
                <div className="cc2-caw-expand">
                  <div className="cc2-caw-chips">
                    <span className="cc2-caw-chips-label">Linked</span>
                    {row.noteLinks.map(path => {
                      const note = notes.find(n => n.file.path === path);
                      return (
                        <span key={path} className="cc2-caw-chip" data-tone={tone}>
                          <span className="cc2-caw-chip-kind">NOTE</span>
                          {note?.title ?? path}
                          <button type="button" className="cc2-flush-btn cc2-caw-chip-remove" title="Unlink" onClick={() => toggleNoteLink(row.item, path, true)}>
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        </span>
                      );
                    })}
                    {row.resourceLabels.map(label => (
                      <span key={label} className="cc2-caw-chip" data-tone={tone}>
                        <span className="cc2-caw-chip-kind">RES</span>
                        {label}
                        <button type="button" className="cc2-flush-btn cc2-caw-chip-remove" title="Unlink" onClick={() => toggleResourceLink(row.item, label, true)}>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </span>
                    ))}
                    {linkedCount === 0 && <span className="cc2-caw-no-links">Nothing linked yet</span>}
                  </div>

                  <div className="cc2-caw-expand-actions">
                    <button type="button" className="cc2-caw-dashed-btn" onClick={() => togglePicker(row.item, 'note')}>+ Note</button>
                    <button type="button" className="cc2-caw-dashed-btn" onClick={() => togglePicker(row.item, 'res')}>+ Resource</button>
                    <button type="button" className="cc2-flush-btn cc2-caw-edit-btn" onClick={() => openEditForm(row)}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      Edit
                    </button>
                    {row.origin === 'custom' && (
                      <button type="button" className="cc2-flush-btn cc2-caw-remove-btn" onClick={() => handleRemove(row.item)}>Remove</button>
                    )}
                  </div>

                  {rowPicker && (
                    <div className="cc2-caw-picker">
                      <div className="cc2-caw-picker-label">{rowPicker === 'note' ? 'Link a note' : 'Link a resource'}</div>
                      <button
                        type="button"
                        className="cc2-flush-btn cc2-cfs-detail-row cc2-caw-picker-create"
                        data-tone={tone}
                        onClick={() => (rowPicker === 'note' ? handlePickerCreateNote(row.item) : (setShowAddResource(true)))}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                        {rowPicker === 'note' ? 'Create new note' : 'Create new resource'}
                      </button>
                      {rowPicker === 'note' && pickerPool.map(n => (
                        <button key={n.file.path} type="button" className="cc2-cfs-detail-row cc2-caw-picker-row" onClick={() => toggleNoteLink(row.item, n.file.path, false)}>
                          {n.title}
                        </button>
                      ))}
                      {rowPicker === 'res' && (pickerPool as ResourceRow[]).map(r => (
                        <button key={r.label} type="button" className="cc2-cfs-detail-row cc2-caw-picker-row" onClick={() => toggleResourceLink(row.item, r.label, false)}>
                          {r.label}
                        </button>
                      ))}
                      {pickerPool.length === 0 && <div className="cc2-cfs-detail-empty">Everything is already linked.</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddResource && (
        <AddResourceModal
          onCancel={() => setShowAddResource(false)}
          onAddLink={handleAddResourceLink}
          onAddFile={handleAddResourceFile}
        />
      )}

      {showSyllabusPicker && (
        <SyllabusImportModal
          app={app}
          title="Import Syllabus"
          onClose={() => setShowSyllabusPicker(false)}
          onImport={(source: SyllabusSource) => {
            setShowSyllabusPicker(false);
            importSyllabus(slug, classCode, source);
          }}
        />
      )}
    </div>
  );
}
