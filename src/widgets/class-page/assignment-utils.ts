import type { AssignmentRow, ClassTranscript, GradeScaleRow } from '../../data-sources/class-info';
import type { AssignmentStatus, ClassProgress } from '../../data-sources/class-progress';
import type { GradeCategory } from '../../data-sources/class-grade-categories';

// Shared between class-assignments-widget and class-grade-widget — as two
// independent top-level grid widgets (no parent/child prop channel between
// sibling GridPage items, unlike the old fixed-layout Class Fullscreen), each
// loads its own Class-Transcript.md/Progress.md and merges them through
// these same pure functions, rather than one fetching once and threading
// props down — matching how every other pair of widgets in this app that
// read the same underlying file (e.g. Kanban/Task Manager both reading the
// same TodoFile) already stays independent rather than sharing loaded state.

export interface EffectiveAssignment extends AssignmentRow {
  status: AssignmentStatus;
  resourceLabels: string[];
  noteLinks: string[];
  origin: 'syllabus' | 'custom';
}

export const STATUS_LABEL: Record<AssignmentStatus, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'completed':   'Completed',
};
export const STATUS_CYCLE: AssignmentStatus[] = ['not-started', 'in-progress', 'completed'];

export function mergeAssignments(transcript: ClassTranscript | null, progress: ClassProgress | null): EffectiveAssignment[] {
  if (!progress) return [];
  const fromSyllabus = (transcript?.assignments ?? []).map(row => ({ ...row, origin: 'syllabus' as const }));
  const custom = progress.customAssignments.map(row => ({ ...row, origin: 'custom' as const }));
  return [...fromSyllabus, ...custom].map(row => {
    const p = progress.assignments.get(row.item);
    return {
      ...row,
      score: p?.score,
      status: p?.status ?? 'not-started',
      resourceLabels: p?.resourceLabels ?? [],
      noteLinks: p?.noteLinks ?? [],
    };
  });
}

function parsePercent(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace('%', ''));
  return isNaN(n) ? null : n;
}

// Every row with both a parseable weight and an entered score contributes;
// rows still ungraded are excluded rather than counted as 0, so a
// partly-graded term shows an honest running average, not a misleadingly
// low one.
export function computeGrade(rows: EffectiveAssignment[]): number | null {
  let earned = 0, possible = 0;
  for (const r of rows) {
    const worth = parsePercent(r.worth);
    const score = parsePercent(r.score);
    if (worth == null || score == null) continue;
    earned += worth * (score / 100);
    possible += worth;
  }
  return possible > 0 ? (earned / possible) * 100 : null;
}

export function letterFor(pct: number, scale: GradeScaleRow[]): string | null {
  return scale.find(r => pct >= r.min && pct <= r.max)?.letter ?? null;
}

// Category-mode sibling of computeGrade — a category's own "score" is the
// simple average of every assignment tagged with it that's actually been
// graded (individual items carry no weight of their own within a category,
// only the category itself does), then weighted exactly like computeGrade's
// per-assignment worth. Same "ungraded rows/categories are excluded, not
// counted as 0" honesty as computeGrade.
export function computeGradeByCategory(rows: EffectiveAssignment[], categories: GradeCategory[]): number | null {
  let earned = 0, possible = 0;
  for (const cat of categories) {
    const weight = parsePercent(cat.weight);
    if (weight == null) continue;
    const scores = rows
      .filter(r => r.category === cat.name)
      .map(r => parsePercent(r.score))
      .filter((s): s is number => s != null);
    if (scores.length === 0) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    earned += weight * (avg / 100);
    possible += weight;
  }
  return possible > 0 ? (earned / possible) * 100 : null;
}
