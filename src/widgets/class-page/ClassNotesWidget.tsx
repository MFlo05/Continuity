import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { watchClassesFolder } from '../../data-sources/class-info';
import { listClassNotes, createBlankClassNote, relativeDate } from '../../data-sources/class-notes';
import type { ClassNote } from '../../data-sources/class-notes';
import { readProgress } from '../../data-sources/class-progress';
import type { WidgetProps } from '../registry';

// Cycled per-card, not tied to the class's own accent color — the same tone
// set every tone-picker in this plugin already offers, reused here purely
// for a soft pastel card background rather than adding new colors outside
// DESIGN_SYSTEM.md's palette.
const CARD_TONES = ['ochre', 'terracotta', 'rust', 'rose', 'plum', 'indigo', 'slate', 'spruce', 'sage', 'moss'];

// One of the 5 class-page-only grid widgets (registry.ts's classPageOnly
// flag) — a standalone top-level widget now, not a sub-panel of a fixed
// layout, so its root follows the same plain flex-column convention every
// other top-level widget uses (MyTeachersWidget, TodoListWidget, etc.), not
// the old .cc2-cfs-panel bordered-card look (WidgetShell IS the card now).
// classSlug is threaded in via config (ClassPageContent injects it into every
// item's config when building the page it hands to GridPage), the same way
// every other per-instance setting reaches a grid widget.
export function ClassNotesWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const classCode = (config?.classCode as string | undefined) ?? '';
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [notes,        setNotes]        = useState<ClassNote[]>([]);
  const [linkedTo,     setLinkedTo]     = useState<Map<string, string>>(new Map());
  const [loading,      setLoading]      = useState(true);
  const [query,        setQuery]        = useState('');

  const load = useCallback(async () => {
    if (!slug) return;
    const [n, progress] = await Promise.all([listClassNotes(app, { slug }), readProgress(app, slug)]);
    setNotes(n);
    // Inverted lookup (assignment item -> its noteLinks) so each card can
    // show what it's linked to, matching the mockup's "linkedTo" badge.
    const map = new Map<string, string>();
    for (const [item, p] of progress.assignments) {
      for (const path of p.noteLinks) map.set(path, item);
    }
    setLinkedTo(map);
    setLoading(false);
  }, [app, slug]);

  useEffect(() => { load(); return watchClassesFolder(app, load); }, [app, load]);

  const handleNew = useCallback(async () => {
    if (!slug) return;
    const file = await createBlankClassNote(app, slug, classCode);
    load();
    app.workspace.openLinkText(file.path, '', true);
  }, [app, slug, classCode, load]);

  const handleOpenNote = useCallback((path: string) => {
    app.workspace.openLinkText(path, '', true);
  }, [app]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(n => n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q));
  }, [notes, query]);

  if (!slug) return null;

  return (
    <div className="cc2-cnw-shell" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-cnw-header">
        <span className="cc2-cnw-title">Recent Notes</span>
        <input
          type="text"
          className="cc2-cnw-search"
          placeholder="Search notes…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="button" className="cc2-flush-btn cc2-cnw-new" title="New note" onClick={handleNew}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New note
        </button>
      </div>
      <div className="cc2-cnw-list">
        {loading && <div className="cc2-cnw-empty">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div className="cc2-cnw-empty">{query ? 'No notes match your search.' : 'No notes yet — hit + to start one.'}</div>
        )}
        {!loading && filtered.map((n, i) => {
          const linkedItem = linkedTo.get(n.file.path);
          return (
            <button
              key={n.file.path}
              type="button"
              className="cc2-flush-btn cc2-cnw-card"
              data-tone={CARD_TONES[i % CARD_TONES.length]}
              onClick={() => handleOpenNote(n.file.path)}
            >
              {/* .cc2-cnw-card-body (not the excerpt itself) carries flex:1,
                  so the footer always anchors to the card's bottom edge even
                  when a note has no excerpt yet (a fresh blank note). */}
              <span className="cc2-cnw-card-body">
                <span className="cc2-cnw-card-title">{n.title}</span>
                {n.excerpt && <span className="cc2-cnw-card-excerpt">{n.excerpt}</span>}
              </span>
              <span className="cc2-cnw-card-footer">
                <span className="cc2-cnw-card-date">{relativeDate(n.mtime)}</span>
                {linkedItem && (
                  <span className="cc2-cnw-card-linked">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    {linkedItem}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
