import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { readClassInfo, writeClassInfo } from '../../data-sources/class-info';
import type { ClassInfoFields } from '../../data-sources/class-info';

interface Props {
  app: App;
  slug: string;
  onClose:   () => void;
  onChanged: () => void;
}

// Manual entry path — deliberately writes the exact same ClassInfoFields
// shape the AI transcript import (a later phase) will write, so both paths
// converge on one target. Grading/assignment/schedule row editors (the
// Class-Transcript.md side of things) are added once that phase lands; this
// covers only the base Class-Info.md fields.
export function ClassSettingsModal({ app, slug, onClose, onChanged }: Props) {
  const [info,         setInfo]         = useState<ClassInfoFields | null>(null);
  const [name,         setName]         = useState('');
  const [teacher,      setTeacher]      = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [room,         setRoom]         = useState('');
  const [officeHours,  setOfficeHours]  = useState('');
  const [officeLocation, setOfficeLocation] = useState('');
  const [grade,        setGrade]        = useState('');
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await readClassInfo(app, slug);
      if (cancelled || !loaded) return;
      setInfo(loaded);
      setName(loaded.name);
      setTeacher(loaded.teacher ?? '');
      setTeacherEmail(loaded.teacherEmail ?? '');
      setRoom(loaded.room ?? '');
      setOfficeHours(loaded.officeHours ?? '');
      setOfficeLocation(loaded.officeLocation ?? '');
      setGrade(loaded.grade ?? '');
    })();
    return () => { cancelled = true; };
  }, [app, slug]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await writeClassInfo(app, slug, {
      name:         name.trim(),
      teacher:      teacher.trim(),
      teacherEmail: teacherEmail.trim(),
      room:         room.trim(),
      officeHours:  officeHours.trim(),
      officeLocation: officeLocation.trim(),
      grade:        grade.trim(),
    });
    setSaving(false);
    onChanged();
    onClose();
  }, [app, slug, name, teacher, teacherEmail, room, officeHours, officeLocation, grade, onChanged, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">{info?.code ?? slug} — Class Settings</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        {!info ? (
          <div className="cc2-setup-loading">Loading…</div>
        ) : (
          <>
            <div className="cc2-setup-body cc2-mc-settings-body">
              <label className="cc2-mc-settings-label">Class name</label>
              <input
                className="cc2-setup-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Introduction to Chemistry"
              />

              <label className="cc2-mc-settings-label">Teacher</label>
              <input
                className="cc2-setup-input"
                value={teacher}
                onChange={e => setTeacher(e.target.value)}
                placeholder="e.g. Dr. Jane Smith"
              />

              <label className="cc2-mc-settings-label">Teacher email</label>
              <input
                className="cc2-setup-input"
                value={teacherEmail}
                onChange={e => setTeacherEmail(e.target.value)}
                placeholder="e.g. jsmith@school.edu"
              />

              <label className="cc2-mc-settings-label">Room</label>
              <input
                className="cc2-setup-input"
                value={room}
                onChange={e => setRoom(e.target.value)}
                placeholder="e.g. Bldg 4, Room 212"
              />

              <label className="cc2-mc-settings-label">Office hours</label>
              <input
                className="cc2-setup-input"
                value={officeHours}
                onChange={e => setOfficeHours(e.target.value)}
                placeholder="e.g. By appointment, or Tue/Thu 2–3pm"
              />

              <label className="cc2-mc-settings-label">Office location</label>
              <input
                className="cc2-setup-input"
                value={officeLocation}
                onChange={e => setOfficeLocation(e.target.value)}
                placeholder="e.g. McMahon Hall, Room 1-89"
              />

              <label className="cc2-mc-settings-label">Current grade (manual override)</label>
              <input
                className="cc2-setup-input"
                value={grade}
                onChange={e => setGrade(e.target.value)}
                placeholder="e.g. 91%"
              />
            </div>

            <div className="cc2-setup-footer">
              <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
              <button className="cc2-setup-confirm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
