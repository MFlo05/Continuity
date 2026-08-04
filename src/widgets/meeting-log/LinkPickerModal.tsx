import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { listProjectNotes, meetingsFolder } from '../../data-sources/meetings';
import type { ProjectEntry } from '../../data-sources/meetings';
import { recordFolderCodec } from '../../core';
import type { RecordRow } from '../../core';

interface Props {
  app:             App;
  initialProjects: TFile[];
  initialMeetings: TFile[];
  onCancel: () => void;
  onApply:  (selected: { projects: TFile[]; meetings: TFile[] }) => void;
}

type Tab = 'meetings' | 'projects';

// Portaled, opened from inside MeetingCreateModal (a portal-on-portal) — its
// backdrop gets a slightly higher z-index (see CSS) so it reliably stacks
// above the create modal rather than relying on DOM paint order.
export function LinkPickerModal({ app, initialProjects, initialMeetings, onCancel, onApply }: Props) {
  const [tab,      setTab]      = useState<Tab>('meetings');
  // Meetings come through the record-folder codec now — same rows the Meeting
  // Log widget shows, rather than a second private scan of the same folder.
  // Projects stay bespoke: they're identified vault-wide by `type: project`
  // in frontmatter, not by living in a folder, so no codec describes them.
  const [meetings, setMeetings] = useState<RecordRow[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');

  const [selectedMeetingPaths, setSelectedMeetingPaths] = useState<Set<string>>(
    () => new Set(initialMeetings.map(f => f.path)),
  );
  const [selectedProjectPaths, setSelectedProjectPaths] = useState<Set<string>>(
    () => new Set(initialProjects.map(f => f.path)),
  );

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([
        recordFolderCodec.read(app, { codec: 'record-folder', folder: meetingsFolder(app) }, []),
        Promise.resolve(listProjectNotes(app)),
      ]);
      setMeetings(m);
      setProjects(p);
      setLoading(false);
    })();
  }, [app]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // A filter typed in one tab shouldn't silently hide everything when you
  // switch to the other.
  useEffect(() => { setSearch(''); }, [tab]);

  const filteredMeetings = useMemo(
    () => meetings.filter(m => m.title.toLowerCase().includes(search.toLowerCase())),
    [meetings, search],
  );
  const filteredProjects = useMemo(
    () => projects.filter(p => p.title.toLowerCase().includes(search.toLowerCase())),
    [projects, search],
  );

  const toggleMeeting = (path: string) => {
    setSelectedMeetingPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const toggleProject = (path: string) => {
    setSelectedProjectPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const totalSelected = selectedMeetingPaths.size + selectedProjectPaths.size;

  // A record row carries its vault path, not a TFile — resolve on the way out,
  // since generateMarkdownLink needs the real file object.
  const handleApply = () => {
    onApply({
      projects: projects.filter(p => selectedProjectPaths.has(p.file.path)).map(p => p.file),
      meetings: [...selectedMeetingPaths]
        .map(path => app.vault.getAbstractFileByPath(path))
        .filter((f): f is TFile => f instanceof TFile),
    });
  };

  return createPortal(
    <div className="cc2-modal-backdrop cc2-link-picker-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-link-picker-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Connect to…</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-link-picker-tabs">
          <button
            type="button"
            className={'cc2-flush-btn cc2-link-picker-tab' + (tab === 'meetings' ? ' active' : '')}
            onClick={() => setTab('meetings')}
          >
            Meetings{selectedMeetingPaths.size > 0 ? ` (${selectedMeetingPaths.size})` : ''}
          </button>
          <button
            type="button"
            className={'cc2-flush-btn cc2-link-picker-tab' + (tab === 'projects' ? ' active' : '')}
            onClick={() => setTab('projects')}
          >
            Projects{selectedProjectPaths.size > 0 ? ` (${selectedProjectPaths.size})` : ''}
          </button>
        </div>

        <div className="cc2-link-picker-search-wrap">
          <input
            type="text"
            className="cc2-setup-input cc2-link-picker-search"
            placeholder={tab === 'meetings' ? 'Search meetings…' : 'Search projects…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="cc2-link-picker-list">
          {loading && <div className="cc2-mtg-empty">Loading…</div>}

          {!loading && tab === 'meetings' && filteredMeetings.length === 0 && (
            <div className="cc2-mtg-empty">No meetings found.</div>
          )}
          {!loading && tab === 'meetings' && filteredMeetings.map(m => {
            const selected = selectedMeetingPaths.has(m.path);
            return (
              <div
                key={m.path}
                className={'cc2-link-picker-row' + (selected ? ' selected' : '')}
                onClick={() => toggleMeeting(m.path)}
              >
                <span className="cc2-kb-check">
                  {selected && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1 4.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="cc2-link-picker-row-title">{m.title}</span>
                <span className="cc2-link-picker-row-date">{m.date}</span>
              </div>
            );
          })}

          {!loading && tab === 'projects' && filteredProjects.length === 0 && (
            <div className="cc2-mtg-empty">No project notes found yet.</div>
          )}
          {!loading && tab === 'projects' && filteredProjects.map(p => {
            const selected = selectedProjectPaths.has(p.file.path);
            return (
              <div
                key={p.file.path}
                className={'cc2-link-picker-row' + (selected ? ' selected' : '')}
                onClick={() => toggleProject(p.file.path)}
              >
                <span className="cc2-kb-check">
                  {selected && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1 4.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="cc2-link-picker-row-title">{p.title}</span>
              </div>
            );
          })}
        </div>

        <div className="cc2-setup-footer cc2-link-picker-footer">
          <span className="cc2-link-picker-count">
            {totalSelected > 0 ? `${totalSelected} selected` : 'Nothing selected'}
          </span>
          <div className="cc2-link-picker-footer-actions">
            <button type="button" className="cc2-flush-btn cc2-link-picker-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" className="pill highlight" onClick={handleApply}>Apply</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
