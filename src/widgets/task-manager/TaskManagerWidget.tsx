import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMIT } from '../../context/DashboardContext';
import {
  useVaultData, resolveWidgetSource, parseItemText, sourcePath, TODO_TEMPLATE,
} from '../../core';
import type { ChecklistRow } from '../../core';
import { getRemaining } from './Timer';
import { Hourglass } from './Hourglass';
import type { WidgetProps } from '../registry';
import type { MITState } from '../../context/DashboardContext';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ballLabel(text: string): string {
  const words = text.trim().split(/\s+/).filter(w => /[a-zA-Z0-9]/.test(w[0] ?? ''));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function fmt(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── Large MIT ball (80px, 3-D sphere, bubbles when running) ──────────────────

function MITBall({ label, active, paused }: { label: string; active: boolean; paused: boolean }) {
  const isRunning = active && !paused;
  const ballRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRunning) return;
    const ball = ballRef.current;
    if (!ball) return;
    const spawn = () => {
      const b = document.createElement('div');
      b.className = 'cc-ball-bubble';
      b.style.left   = (Math.random() * 52 + 14) + 'px';
      const size     = Math.random() * 5 + 4;  // smaller: 4–9px
      b.style.width  = size + 'px';
      b.style.height = size + 'px';
      const dur      = Math.random() * 1.2 + 1.8;  // slower: 1.8–3s
      b.style.animationDuration = dur + 's';
      ball.appendChild(b);
      setTimeout(() => { try { ball.removeChild(b); } catch { /**/ } }, dur * 1000);
    };
    const id = setInterval(spawn, 320);  // less frequent: every 320ms
    return () => clearInterval(id);
  }, [isRunning]);

  return (
    <div style={{ width: 80, height: 80, flexShrink: 0 }}>
      <div
        ref={ballRef}
        className={'cc-ball' + (isRunning ? ' cc-ball-active' : '')}
        style={{ width: 80, height: 80, fontSize: 18, letterSpacing: '0.05em' }}
      >
        <span className="cc-ball-label">{label}</span>
      </div>
    </div>
  );
}

// ── Small trunk ball (52px) ───────────────────────────────────────────────────

function TrunkBall({
  task, isDragging, onPromote, onDragStart, onDragEnd,
}: {
  task:        string;
  isDragging:  boolean;
  onPromote:   (task: string) => void;
  onDragStart: () => void;
  onDragEnd:   () => void;
}) {
  const { displayText } = parseItemText(task);
  const label           = ballLabel(displayText);

  return (
    <div
      className="cc-trunk-ball-wrap"
      title={displayText}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('cc2/task-text', task);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => onPromote(task)}
    >
      <div
        className="cc-ball"
        style={{
          width: 52, height: 52,
          fontSize: 11, letterSpacing: '0.05em',
          cursor: 'pointer',
          opacity: isDragging ? 0.45 : 1,
          transform: isDragging ? 'scale(0.88)' : undefined,
        }}
      >
        <span className="cc-ball-label">{label}</span>
      </div>
      <span className="cc-trunk-ball-title">{displayText}</span>
    </div>
  );
}

// ── Inline timer panel (right column of Front Burner) ────────────────────────

function TimerPanel({
  mit, onUpdate, onDone,
}: {
  mit:      MITState;
  onUpdate: (m: MITState) => void;
  onDone:   () => void;
}) {
  const [remaining, setRemaining]       = useState(() => getRemaining(mit));
  const [editing,   setEditing]         = useState(false);
  const [editVal,   setEditVal]         = useState('');

  useEffect(() => {
    if (mit.isPaused) { setRemaining(getRemaining(mit)); return; }
    const id = setInterval(() => setRemaining(getRemaining(mit)), 500);
    return () => clearInterval(id);
  }, [mit]);

  const isExpired = remaining <= 0 && !mit.isPaused;
  const isUrgent  = !isExpired && remaining < 3 * 60;

  const togglePause = () => {
    if (mit.isPaused) {
      onUpdate({ ...mit, isPaused: false, startedAt: Date.now() - (mit.estimateSecs - mit.pausedRemaining) * 1000 });
    } else {
      onUpdate({ ...mit, isPaused: true, pausedRemaining: remaining });
    }
  };

  const commitEdit = () => {
    setEditing(false);
    const m = /^(\d{1,3}):(\d{2})$/.exec(editVal.trim());
    if (!m) return;
    const secs = parseInt(m[1]) * 60 + parseInt(m[2]);
    if (secs <= 0) return;
    if (mit.isPaused) {
      onUpdate({ ...mit, estimateSecs: secs, pausedRemaining: secs });
    } else {
      onUpdate({ ...mit, estimateSecs: secs, startedAt: Date.now() });
    }
  };

  return (
    <div className="cc2-tm-timer-panel">
      <span className="label">Focus Timer</span>

      <Hourglass
        remaining={remaining}
        total={mit.estimateSecs}
        active
        paused={mit.isPaused}
        size={56}
      />

      {/* Clock */}
      {editing ? (
        <input
          className="cc2-tm-edit-input tabular"
          value={editVal}
          autoFocus
          onChange={e => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <div
          className={'tabular cc2-tm-clock' + (isExpired ? ' expired' : isUrgent ? ' urgent' : '')}
          onClick={() => { setEditVal(fmt(remaining)); setEditing(true); }}
          title="Click to edit"
        >
          {fmt(remaining)}
        </div>
      )}

      {/* Controls */}
      <div className="cc2-tm-timer-actions">
        <button className="cc2-flush-btn cc2-tm-timer-btn" onClick={togglePause}>
          {mit.isPaused
            ? '▶ resume'
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden>
                  <rect x="0" y="0" width="3" height="10" rx="1"/>
                  <rect x="5" y="0" width="3" height="10" rx="1"/>
                </svg>
                pause
              </span>
          }
        </button>
        <button className="cc2-flush-btn cc2-tm-timer-btn cc2-tm-timer-btn-done" onClick={onDone}>✓ done</button>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function TaskManagerWidget({ config, app }: WidgetProps) {
  const source = useMemo(() => resolveWidgetSource(app, 'task-manager', config), [app, config]);
  const filePath = source ? sourcePath(source) : null;

  // The in-flight MIT task is keyed by this string in persisted plugin data
  // (PluginData.mitTasks), so it must keep matching what earlier versions
  // wrote — the legacy bare `listFile` name — or a running timer would be
  // orphaned on upgrade. Falls back to the resolved path for any widget that
  // only ever had a SourceRef.
  const mitKey = (config?.listFile as string | undefined) || filePath || '';
  const { mit, setMIT } = useMIT(mitKey);

  const { rows, mutate } = useVaultData<ChecklistRow>(app, source, { template: TODO_TEMPLATE });

  // Per-widget accent (right-click "Edit Widget Settings…"). Trim only —
  // deliberately no wash background here, since the burner's whole design is
  // "transparent, ivory card shows through" (see DESIGN_SYSTEM.md); a colored
  // wash would fight that rather than complement it.
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const [trunkOpen,     setTrunkOpen]     = useState(false);
  const [draggingTask,  setDraggingTask]  = useState<string | null>(null);
  const [isDragOver,    setIsDragOver]    = useState(false);
  const [manualProject, setManualProject] = useState(mit?.project ?? '');

  // The pool is every not-done row in a bucket the file's frontmatter flags
  // as active — the same rule getActiveTasks() applied, now carried on the
  // rows themselves rather than recomputed from a whole-file structure.
  const pool  = rows.filter(r => r.bucketActive && !r.done);
  const tasks = pool.map(r => r.text);

  useEffect(() => { setManualProject(mit?.project ?? ''); }, [mit?.project]);

  const handlePromote = useCallback((task: string) => {
    const { project } = parseItemText(task);
    setMIT({ task, project: project ?? undefined, estimateSecs: 25 * 60, startedAt: Date.now(), isPaused: false, pausedRemaining: 0 });
  }, [setMIT]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const text = e.dataTransfer.getData('cc2/task-text');
    if (text) handlePromote(text);
  }, [handlePromote]);

  // MIT state stores the task's TEXT (it outlives any one parse — it's
  // persisted across restarts), so completing it means finding the row that
  // still carries that text. Clearing the MIT regardless matches the old
  // markTaskDone(), which silently no-op'd when the line was already gone.
  const handleDone = useCallback(async () => {
    if (!mit) return;
    const row = pool.find(r => r.text === mit.task);
    if (row) await mutate.update(row.id, { done: true, raw: row.raw });
    setMIT(null);
    setManualProject('');
  }, [mit, pool, mutate, setMIT]);

  if (!source) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--cc-muted)', fontSize: 12 }}>
        No TODO list configured.
      </div>
    );
  }

  const { displayText, project: tagProject } = mit ? parseItemText(mit.task) : { displayText: '', project: null };
  const isRunning = !!mit && !mit.isPaused;
  const isPaused  = !!mit &&  mit.isPaused;
  const visible   = tasks.filter(t => t !== mit?.task);

  return (
    <div
      className={['cc2-tm', isDragOver ? 'cc2-tm-dragover' : '', isRunning ? 'focus-glow' : '', trunkOpen ? 'cc2-tm-trunk-open' : ''].filter(Boolean).join(' ')}
      data-tone={tone} data-wash={wash || undefined}
      onDragEnter={e => { if (e.dataTransfer.types.includes('cc2/task-text')) setIsDragOver(true); }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={e => { const r = e.relatedTarget as Node|null; if (!r || !e.currentTarget.contains(r)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >

      <div className="cc2-tm-toolbar">
        <span className="cc2-tm-title">Task Manager</span>
      </div>

      {/* ── Front Burner section ────────────────────────── */}
      <div className="cc2-tm-burner">
        {/* Left: ball + status */}
        <div className="cc2-tm-ball-col">
          {mit
            ? <MITBall label={ballLabel(displayText)} active paused={isPaused} />
            : <div className="cc-ball" style={{ width: 80, height: 80, fontSize: 24, opacity: 0.2, cursor: 'default', flexShrink: 0 }}>
                <span className="cc-ball-label">○</span>
              </div>
          }
          <div className="cc2-tm-status">
            {isRunning && <><span className="dot" /><span className="label">Simmering</span></>}
            {isPaused  && <span className="label">Task Paused</span>}
            {!mit      && <span className="label">{isDragOver ? 'Drop to Simmer' : 'Empty'}</span>}
          </div>
        </div>

        {/* Center: task label + project label */}
        <div className="cc2-tm-info">
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.022em', lineHeight: 1.25, color: mit ? 'var(--cc-text)' : 'var(--cc-muted)', marginBottom: 12 }}>
            {mit ? displayText : 'Drag a task here to start Cooking'}
          </div>

          {mit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {tagProject && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--cc2-accent)', background: 'color-mix(in srgb, var(--cc2-accent) 12%, transparent)', borderRadius: 4, padding: '1px 7px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {tagProject}
                </span>
              )}
              <input
                className="cc2-tm-project-input"
                placeholder={tagProject ? 'add project…' : '+ project'}
                value={manualProject}
                onChange={e => {
                  setManualProject(e.target.value);
                  if (mit) setMIT({ ...mit, project: e.target.value || undefined });
                }}
              />
            </div>
          )}
        </div>

        {/* Right: timer */}
        <div className="cc2-tm-timer-col">
          {mit
            ? <TimerPanel mit={mit} onUpdate={m => setMIT(m)} onDone={handleDone} />
            : (
              <div className="cc2-tm-timer-panel">
                <span className="label">Focus Timer</span>
                <Hourglass remaining={1} total={1} active={false} paused={false} size={56} />
                <div className="tabular cc2-tm-clock cc2-tm-clock-idle">—:—</div>
                <div className="cc2-tm-timer-actions">
                  <button className="cc2-flush-btn cc2-tm-timer-btn" disabled>▶ resume</button>
                  <button className="cc2-flush-btn cc2-tm-timer-btn cc2-tm-timer-btn-done" disabled>✓ done</button>
                </div>
              </div>
            )
          }
        </div>
      </div>

      {/* ── Back Burner (collapsible queue) ─────────────── */}
      <div className="cc2-tm-trunk-section">

        {/* Queue latch — clean divider row */}
        <button
          className="cc2-tm-latch"
          onClick={() => setTrunkOpen(o => !o)}
          aria-expanded={trunkOpen}
        >
          <span className="cc2-tm-latch-label">Queue</span>
          <span className="cc2-tm-latch-count">{visible.length}</span>
          <div className="cc2-tm-latch-spacer" />
          <svg
            className="cc2-tm-latch-chevron"
            width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
          >
            <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Queue compartment — warm paper pocket */}
        {trunkOpen && (
          <div className="cc2-tm-queue">
            <div className="cc2-tm-queue-content">
              {visible.length === 0 ? (
                <span className="cc2-tm-queue-empty">Nothing on the back burner</span>
              ) : (
                visible.map(task => (
                  <TrunkBall
                    key={task}
                    task={task}
                    isDragging={draggingTask === task}
                    onPromote={handlePromote}
                    onDragStart={() => setDraggingTask(task)}
                    onDragEnd={()   => setDraggingTask(null)}
                  />
                ))
              )}
            </div>
            {filePath && (
              <button
                className="ws-source-badge ws-source-badge-link cc2-tm-queue-source"
                onClick={() => app.workspace.openLinkText(filePath, '')}
                title={`Open ${filePath}`}
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="1.5" y="0.5" width="7" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M3.5 4h5M3.5 6h5M3.5 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                {filePath.replace(/\.md$/i, '').split('/').pop()}.md
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
