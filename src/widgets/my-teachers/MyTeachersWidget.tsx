import React, { useState, useEffect, useCallback } from 'react';
import { listClasses, watchClassesFolder } from '../../data-sources/class-info';
import type { ClassInfoFields } from '../../data-sources/class-info';
import {
  readExtraContacts, addExtraContact, removeExtraContact, watchContactsFile,
} from '../../data-sources/class-contacts';
import type { ExtraContact } from '../../data-sources/class-contacts';
import type { WidgetProps } from '../registry';
import { AddContactModal } from './AddContactModal';

interface TeacherRow {
  key:     string;
  name:    string;
  email?:  string;
  classes: { slug: string; code: string; color?: string }[];
  manual:  ExtraContact | null; // present only for a manually-added contact (deletable)
}

// Purely derived from listClasses() (active only — listClasses defaults to
// excluding archived) plus Education/Contacts.md's manual extras. No
// class-archive cascade to wire here: archiving a class already drops it
// from listClasses()'s result, so a teacher who only taught that class
// silently stops appearing on the next reload — nothing to do beyond
// re-reading on change, same as the reload-on-vault-event pattern every
// other Education widget already uses.
function buildTeacherRows(classes: ClassInfoFields[], contacts: ExtraContact[]): TeacherRow[] {
  const byKey = new Map<string, TeacherRow>();

  for (const cls of classes) {
    if (!cls.teacher) continue;
    const key = (cls.teacherEmail || cls.teacher).trim().toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.classes.push({ slug: cls.slug, code: cls.code, color: cls.color });
    } else {
      byKey.set(key, {
        key,
        name: cls.teacher,
        email: cls.teacherEmail,
        classes: [{ slug: cls.slug, code: cls.code, color: cls.color }],
        manual: null,
      });
    }
  }

  const rows = Array.from(byKey.values());
  for (const c of contacts) {
    rows.push({ key: `manual:${c.name}:${c.email ?? ''}`, name: c.name, email: c.email, classes: [], manual: c });
  }
  return rows;
}

export function MyTeachersWidget({ app, config }: WidgetProps) {
  const [classes,  setClasses]  = useState<ClassInfoFields[]>([]);
  const [contacts, setContacts] = useState<ExtraContact[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);

  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const load = useCallback(async () => {
    const [cls, extra] = await Promise.all([listClasses(app), readExtraContacts(app)]);
    setClasses(cls);
    setContacts(extra);
    setLoading(false);
  }, [app]);

  useEffect(() => {
    load();
    const unwatchClasses  = watchClassesFolder(app, load);
    const unwatchContacts = watchContactsFile(app, load);
    return () => { unwatchClasses(); unwatchContacts(); };
  }, [app, load]);

  const rows = buildTeacherRows(classes, contacts);

  const emailTeacher = useCallback((email: string) => {
    window.location.href = `mailto:${email}`;
  }, []);

  const handleAddContact = useCallback(async (contact: ExtraContact) => {
    await addExtraContact(app, contact);
    setShowAdd(false);
    load();
  }, [app, load]);

  const handleRemoveContact = useCallback(async (c: ExtraContact) => {
    const confirmed = window.confirm(`Remove ${c.name} from contacts?`);
    if (!confirmed) return;
    await removeExtraContact(app, c.name, c.email);
    load();
  }, [app, load]);

  return (
    <div className="cc2-mt-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-mt-toolbar">
        <span className="cc2-mt-title">My Teachers</span>
        <button
          type="button"
          className="cc2-flush-btn cc2-mt-add"
          title="Add contact"
          onClick={() => setShowAdd(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="cc2-mt-list">
        {loading && <div className="cc2-mt-empty">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="cc2-mt-empty">No teachers yet — add a teacher from Class Settings, or add a contact directly.</div>
        )}
        {!loading && rows.map(row => (
          <div
            key={row.key}
            className={'cc2-mt-row' + (row.email ? ' cc2-mt-row-clickable' : '')}
            role={row.email ? 'button' : undefined}
            tabIndex={row.email ? 0 : undefined}
            title={row.email ? `Email ${row.name}` : undefined}
            onClick={row.email ? () => emailTeacher(row.email!) : undefined}
            onKeyDown={row.email ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); emailTeacher(row.email!); } }) : undefined}
          >
            <div className="cc2-mt-row-main">
              <span className="cc2-mt-name">{row.name}</span>
              {row.email && <span className="cc2-mt-email">{row.email}</span>}
            </div>

            <div className="cc2-mt-row-tags">
              {row.manual && <span className="cc2-mt-tag cc2-mt-tag-other">{row.manual.role}</span>}
              {row.classes.map(c => (
                <span key={c.slug} className="cc2-mt-tag">
                  <span className="cc2-mt-tag-dot" data-tone={c.color} />
                  {c.code}
                </span>
              ))}
            </div>

            {row.manual && (
              <button
                type="button"
                className="cc2-flush-btn cc2-mt-row-delete"
                title="Remove contact"
                aria-label="Remove contact"
                onClick={e => { e.stopPropagation(); handleRemoveContact(row.manual!); }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {showAdd && (
        <AddContactModal
          onCancel={() => setShowAdd(false)}
          onConfirm={handleAddContact}
        />
      )}
    </div>
  );
}
