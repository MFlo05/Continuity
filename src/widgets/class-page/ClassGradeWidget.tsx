import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { readClassTranscript, readClassInfo, watchClassesFolder } from '../../data-sources/class-info';
import type { ClassTranscript } from '../../data-sources/class-info';
import { readProgress } from '../../data-sources/class-progress';
import type { ClassProgress } from '../../data-sources/class-progress';
import { readGradeCategories } from '../../data-sources/class-grade-categories';
import type { GradeCategory } from '../../data-sources/class-grade-categories';
import { mergeAssignments } from './assignment-utils';
import type { WidgetProps } from '../registry';

function parsePercent(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace('%', ''));
  return isNaN(n) ? null : n;
}

// One of the 5 class-page-only grid widgets — display-only, computed from
// the same Class-Transcript.md + Progress.md merge the Assignments widget
// uses (self-loaded independently, see assignment-utils.ts's own comment on
// why sibling grid widgets don't share fetched state).
//
// Two modes, per the class's own cc2-grade-mode (set in this widget's own
// settings — see WidgetSettingsModal.tsx's GradeModeSection): 'assignment'
// shows one bar PER ASSIGNMENT (sorted by weight, heaviest first — the
// original/default behavior, real syllabi that give a weight for every
// single assignment). 'category' shows one bar PER CATEGORY instead —
// averaging the scores of every assignment tagged with that category and
// applying the category's own weight — for the (very common) syllabus shape
// that only gives aggregate category percentages, not a per-item split.
export function ClassGradeWidget({ config, app }: WidgetProps) {
  const slug = config?.classSlug as string | undefined;
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [transcript, setTranscript] = useState<ClassTranscript | null>(null);
  const [progress,   setProgress]   = useState<ClassProgress | null>(null);
  const [gradeMode,  setGradeMode]  = useState<'assignment' | 'category'>('assignment');
  const [categories, setCategories] = useState<GradeCategory[]>([]);

  const load = useCallback(async () => {
    if (!slug) return;
    const [t, p, info, cats] = await Promise.all([
      readClassTranscript(app, slug), readProgress(app, slug),
      readClassInfo(app, slug), readGradeCategories(app, slug),
    ]);
    setTranscript(t); setProgress(p);
    setGradeMode(info?.gradeMode ?? 'assignment');
    setCategories(cats);
  }, [app, slug]);

  useEffect(() => { load(); return slug ? watchClassesFolder(app, load) : undefined; }, [app, slug, load]);

  const assignmentRows = useMemo(() => {
    const assignments = mergeAssignments(transcript, progress);
    return assignments
      .map(a => {
        const worth = parsePercent(a.worth);
        const score = parsePercent(a.score);
        return { item: a.item, worth, score };
      })
      .filter(r => r.worth != null)
      .sort((a, b) => (b.worth ?? 0) - (a.worth ?? 0));
  }, [transcript, progress]);

  // Every category's bar always shows, even ungraded (dash/opacity-0 fill,
  // same honesty convention as an ungraded assignment row) — only a totally
  // unparseable/missing weight drops a category from the list entirely,
  // same filter assignment mode already applies to worth.
  const categoryRows = useMemo(() => {
    const assignments = mergeAssignments(transcript, progress);
    return categories
      .map(c => {
        const worth = parsePercent(c.weight);
        const scores = assignments
          .filter(a => a.category === c.name)
          .map(a => parsePercent(a.score))
          .filter((s): s is number => s != null);
        const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        return { item: c.name, worth, score };
      })
      .filter(r => r.worth != null)
      .sort((a, b) => (b.worth ?? 0) - (a.worth ?? 0));
  }, [transcript, progress, categories]);

  const rows = gradeMode === 'category' ? categoryRows : assignmentRows;

  if (!slug) return null;

  return (
    <div className="cc2-cgw-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-cgw-header">
        <span className="cc2-cgw-title">Grade Breakdown</span>
      </div>
      <div className="cc2-cgw-list">
        {gradeMode === 'category' && categories.length === 0 && (
          <div className="cc2-cgw-empty">Set up grade categories in this widget's settings to get started.</div>
        )}
        {rows.length === 0 && !(gradeMode === 'category' && categories.length === 0) && (
          <div className="cc2-cgw-empty">
            {gradeMode === 'category' ? 'No graded assignments in any category yet.' : 'No weighted assignments yet.'}
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.item + i} className="cc2-cgw-row">
            <div className="cc2-cgw-row-top">
              <span className="cc2-cgw-row-label">{r.item}</span>
              <span className="cc2-cgw-row-detail">
                {r.score != null ? `${r.score.toFixed(0)}%` : '—'} · worth {r.worth}%
              </span>
            </div>
            <div className="cc2-cgw-track">
              <div className="cc2-cgw-fill" style={{ width: `${r.score ?? 0}%`, opacity: r.score != null ? 1 : 0 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="cc2-cgw-footer">
        {gradeMode === 'category'
          ? 'Enter scores per assignment in the Assignments tab — each category averages its own'
          : 'Enter scores for each assignment — or overwrite your grade in the header'}
      </div>
    </div>
  );
}
