import React, { useState, useEffect, useCallback } from 'react';
import { watchClassesFolder } from '../../data-sources/class-info';
import { readResources, addResourceLink, addResourceFile, removeResource } from '../../data-sources/class-resources';
import type { ResourceRow } from '../../data-sources/class-resources';
import { AddResourceModal } from '../my-classes/AddResourceModal';
import type { WidgetProps } from '../registry';

// One of the 5 class-page-only grid widgets — thin standalone wrapper around
// the same class-resources.ts calls the old ResourcesSection used, now
// self-loading (config.classSlug) since it's an independent grid item
// rather than a child handed pre-fetched props. AddResourceModal itself
// (shared with the Assignments widget's inline "+ Resource" picker) already
// carries its own "Summarize with AI" stub button.
export function ClassResourcesWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [showAdd,   setShowAdd]   = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setResources(await readResources(app, slug));
  }, [app, slug]);

  useEffect(() => { load(); return slug ? watchClassesFolder(app, load) : undefined; }, [app, slug, load]);

  const handleOpen = useCallback((r: ResourceRow) => {
    if (r.type === 'link') window.open(r.target);
    else app.workspace.openLinkText(r.target, '', true);
  }, [app]);

  const handleAddLink = useCallback(async (label: string, url: string) => {
    if (!slug) return;
    await addResourceLink(app, slug, label, url);
    setShowAdd(false);
    load();
  }, [app, slug, load]);

  const handleAddFile = useCallback(async (label: string, file: File) => {
    if (!slug) return;
    await addResourceFile(app, slug, label, file);
    setShowAdd(false);
    load();
  }, [app, slug, load]);

  const handleRemove = useCallback(async (r: ResourceRow) => {
    if (!slug) return;
    const confirmed = window.confirm(`Remove "${r.label}"?`);
    if (!confirmed) return;
    await removeResource(app, slug, r.label, r.target);
    load();
  }, [app, slug, load]);

  if (!slug) return null;

  return (
    <div className="cc2-crw-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-crw-header">
        <span className="cc2-crw-title">Resources</span>
        <button type="button" className="cc2-flush-btn cc2-cfs-add-btn" title="Add resource" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="cc2-crw-list">
        {resources.length === 0 && <div className="cc2-crw-empty">No resources yet.</div>}
        {resources.map((r, i) => (
          <div key={r.label + r.target + i} className="cc2-crw-row">
            <span className="cc2-crw-icon" data-tone={tone}>
              {r.type === 'link' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
                </svg>
              )}
            </span>
            <div className="cc2-crw-main">
              <button type="button" className="cc2-flush-btn cc2-crw-label" onClick={() => handleOpen(r)}>{r.label}</button>
              <span className="cc2-crw-source">{r.source === 'AI import' ? 'From syllabus' : 'Added by you'}</span>
            </div>
            <button type="button" className="cc2-flush-btn cc2-crw-delete" title="Remove" onClick={() => handleRemove(r)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {showAdd && (
        <AddResourceModal
          onCancel={() => setShowAdd(false)}
          onAddLink={handleAddLink}
          onAddFile={handleAddFile}
        />
      )}
    </div>
  );
}
