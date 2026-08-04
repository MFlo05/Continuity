import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { App, TFile, TFolder } from 'obsidian';
import type { WidgetType } from '../types';
import { widgetRegistry } from '../widgets/registry';
import { useCalendar } from '../calendar/CalendarContext';
import { todoFilePath } from '../data-sources/todos';
import { checklistCodec, recordFolderCodec, asSourceRef, sourceFolder, sourcePath, sourceHeading } from '../core';
import type { ChecklistBucket, SourceRef, SourcePickerConfig } from '../core';
import { discoverTables } from '../core/codecs/md-table';
import type { DiscoveredTable } from '../core/codecs/md-table';
import { resolveCommandCenterPath } from '../data-sources/vault-paths';
import { defaultColumnsFor, humanizeKey } from '../renderers/RecordTable';
import type { TableColumn } from '../renderers/RecordTable';
import { readSchedule, updateDayBounds } from '../data-sources/class-schedule';
import { readClassInfo, writeClassInfo } from '../data-sources/class-info';
import { readGradeCategories, addGradeCategory, removeGradeCategory } from '../data-sources/class-grade-categories';
import type { GradeCategory } from '../data-sources/class-grade-categories';
import { TonePicker } from '../widgets/shared/TonePicker';
import { InfoTooltip } from '../widgets/shared/InfoTooltip';

interface Props {
  app:  App;
  type: WidgetType;
  // 'create': shown from the Widget Library at add-time, calls onConfirm with
  // the config to seed a brand-new LayoutItem. 'edit': shown via right-click
  // on an already-placed widget, calls onConfirm with a patch to merge into
  // its existing config.
  mode: 'create' | 'edit';
  existingConfig?: Record<string, unknown>;
  // Only set by ClassPageContent.tsx's own usage — classSlug/classCode are
  // injected into a class-page widget's rendered `config` at render time
  // (see that file's own comment), never persisted into the raw LayoutItem
  // this modal's `existingConfig` reads from, so the Grade Breakdown section
  // below needs it passed through explicitly rather than reading it off
  // existingConfig like everything else in this modal does.
  classSlug?: string;
  onConfirm: (config: Record<string, unknown>) => void;
  onCancel:  () => void;
}

// Calendar's own OAuth status/connect/disconnect already exists inline in
// CalendarStripWidget (useCalendar()) — this just surfaces the same hook's
// state here too, so it's reachable from one settings screen alongside color,
// rather than only a tiny icon buried in the widget's own header.
function CalendarOAuthSection() {
  const { status, connecting, login, logout, calendars } = useCalendar();
  const primary = calendars.find(c => c.primary) ?? calendars[0];

  return (
    <div className="cc2-settings-section">
      <span className="cc2-settings-section-label">Google Calendar</span>
      <div className="cc2-settings-oauth-row">
        <span className={`cc2-settings-oauth-status${status === 'connected' ? ' connected' : ''}`}>
          {status === 'connected' ? `Connected${primary ? ` as ${primary.summary}` : ''}` : 'Not connected'}
        </span>
        {status === 'connected' ? (
          <button type="button" className="cc2-flush-btn cc2-settings-oauth-btn" onClick={() => void logout()}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="cc2-flush-btn cc2-settings-oauth-btn" onClick={() => login()} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}

// Kanban's bucket list + "Include in Task Manager" toggle per bucket. Reads
// straight from the currently-selected TODO file's live frontmatter (not this
// widget's own `config` — bucket membership belongs to the shared file, the
// same frontmatter list `addBucket`/`deleteBucket` already coordinate
// through), and writes immediately via setBucketActive the instant a toggle
// flips rather than deferring to this modal's Save button — same immediacy
// as the identical toggle already offered at bucket-creation time
// (AddBucketModal), just now reachable for buckets that already exist.
function KanbanBucketSection({ app, listFile }: { app: App; listFile: string }) {
  const [buckets,     setBuckets]     = useState<ChecklistBucket[]>([]);
  const [activeNames, setActiveNames] = useState<Set<string>>(new Set());
  const [loaded,      setLoaded]      = useState(false);

  // Built from the file the picker above currently has selected, which may
  // not be the widget's saved source yet — so it's derived here rather than
  // read off config.source.
  const source: SourceRef | null = listFile
    ? { codec: 'checklist', path: todoFilePath(app, listFile) }
    : null;

  const load = useCallback(async () => {
    if (!source) { setBuckets([]); setActiveNames(new Set()); setLoaded(true); return; }
    const meta = await checklistCodec.readMeta(app, source);
    setBuckets(meta.buckets);
    setActiveNames(new Set(meta.activeBucketNames));
    setLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, listFile]);

  useEffect(() => { setLoaded(false); void load(); }, [load]);

  const toggle = async (bucketName: string) => {
    if (!source) return;
    const nowActive = !activeNames.has(bucketName);
    setActiveNames(prev => {
      const next = new Set(prev);
      if (nowActive) next.add(bucketName); else next.delete(bucketName);
      return next;
    });
    await checklistCodec.setBucketActive(app, source, bucketName, nowActive);
  };

  return (
    <div className="cc2-settings-section">
      <span className="cc2-settings-section-label">Buckets</span>
      {!loaded && <div className="cc2-setup-loading">Scanning…</div>}
      {loaded && buckets.length === 0 && (
        <div className="cc2-settings-oauth-status">No buckets yet — add some from the board, then come back here.</div>
      )}
      {loaded && buckets.map(b => (
        <div key={b.name} className="cc2-settings-bucket-row">
          <span className="cc2-settings-bucket-name">{b.name}</span>
          <label className="cc2-settings-bucket-toggle">
            <input
              type="checkbox"
              checked={activeNames.has(b.name)}
              onChange={() => void toggle(b.name)}
            />
            Include in Task Manager
          </label>
        </div>
      ))}
    </div>
  );
}

// Vault-wide folder picker, for General-category raw renderers (registry.ts's
// SourcePickerConfig). Unlike the fixed-folder picker in the main component
// below, this targets ANY folder in the vault, so it's a searchable flat list
// of full paths rather than a select of names — the same shape Obsidian's own
// folder suggester uses, and far less machinery than a collapsible tree.
function VaultFolderSection({ app, label, value, onChange }: {
  app: App; label: string; value: string; onChange: (path: string) => void;
}) {
  const [search, setSearch] = useState('');

  const folders = useMemo(
    () => app.vault.getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map(f => f.path)
      .filter(p => p && p !== '/')
      .sort((a, b) => a.localeCompare(b)),
    [app],
  );

  const q = search.trim().toLowerCase();
  const matched = q ? folders.filter(p => p.toLowerCase().includes(q)) : folders;
  // Cap the rendered list — a large vault can have thousands of folders, and
  // the search box is the real navigation tool here.
  const visible = matched.slice(0, 200);

  return (
    <div className="cc2-settings-section">
      <span className="cc2-settings-section-label">{label}</span>
      <input
        type="text"
        className="cc2-setup-input"
        placeholder="Search folders…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="cc2-settings-folder-list">
        {visible.length === 0 && (
          <div className="cc2-settings-oauth-status">No folders match "{search}"</div>
        )}
        {/* Folder name first, its full path beneath in smaller faint text.
            Chosen over depth indentation because this list is search-filtered:
            an indented child whose parents have been filtered out reads as
            being at the wrong level, whereas an explicit path is always true.
            The path line is dropped for top-level folders, where it would just
            repeat the name. */}
        {visible.map(path => {
          const slash  = path.lastIndexOf('/');
          const name   = slash === -1 ? path : path.slice(slash + 1);
          const parent = slash === -1 ? ''   : path.slice(0, slash);
          return (
            <button
              key={path}
              type="button"
              className={'cc2-flush-btn cc2-settings-folder-row' + (path === value ? ' selected' : '')}
              onClick={() => onChange(path)}
            >
              <span className="cc2-settings-folder-name">{name}</span>
              {parent && <span className="cc2-settings-folder-path">{parent}</span>}
            </button>
          );
        })}
        {matched.length > visible.length && (
          <div className="cc2-settings-oauth-status">
            +{matched.length - visible.length} more — keep typing to narrow.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The ONE source-picking UI, shared by every widget that picks a file, folder
 * or ledger — Kanban, TODO List, Task Manager, the Finance suite, Checklist,
 * Grocery List, Record Table.
 *
 * Two radio cards in one group (use existing / create new). Selecting "use
 * existing" expands a searchable, scrolling list beneath it; the card itself
 * carries a caption saying what's being filtered ("14 with checkboxes",
 * "1 Ledger") so the user can see the scope before opening it.
 *
 * This replaced an inline `<select>` dropdown on the legacy picker, which gave
 * no count, no search, and no room to show where a file actually lives.
 */
export interface PickerItem {
  /** What gets written to config — a bare name for legacy setups, a full path otherwise. */
  key:   string;
  name:  string;
  /** Second line: the containing folder. */
  sub?:  string;
}

function SourcePickerCards({
  label, items, caption, mode, onModeChange, selectedKey, onSelect,
  newName, onNewName, newPlaceholder, createHint, extraRows, autoFocusNew,
}: {
  label:        string;
  items:        PickerItem[];
  caption:      string;
  mode:         'existing' | 'new';
  onModeChange: (m: 'existing' | 'new') => void;
  selectedKey:  string;
  onSelect:     (key: string) => void;
  newName:      string;
  onNewName:    (v: string) => void;
  newPlaceholder?: string;
  createHint?:  React.ReactNode;
  /** e.g. TODO List's third "Link to classes" option, in the same radio group. */
  extraRows?:   React.ReactNode;
  autoFocusNew?: boolean;
}) {
  const [search, setSearch] = useState('');
  const newRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode === 'new' && autoFocusNew) newRef.current?.focus(); }, [mode, autoFocusNew]);

  const q = search.trim().toLowerCase();
  const matched = q
    ? items.filter(i => i.name.toLowerCase().includes(q) || (i.sub ?? '').toLowerCase().includes(q))
    : items;
  const visible = matched.slice(0, 200);

  return (
    <div className="cc2-settings-section cc2-settings-picker">
      {items.length > 0 && (
        <label className={`cc2-setup-row${mode === 'existing' ? ' active' : ''}`}>
          <input
            type="radio" name="cc2-setup-mode"
            checked={mode === 'existing'}
            onChange={() => onModeChange('existing')}
          />
          <span className="cc2-setup-row-label">Use existing {label}</span>
          <span className="cc2-setup-row-caption">{caption}</span>
        </label>
      )}

      {/* Indented and rule-marked so the search + list read as belonging to the
          selected option, rather than as more siblings in a flat column. */}
      {mode === 'existing' && items.length > 0 && (
        <div className="cc2-settings-file-sub">
          <input
            type="text"
            className="cc2-setup-input"
            placeholder={`Search ${label.toLowerCase()}s…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="cc2-settings-file-list">
            {visible.length === 0 && (
              <div className="cc2-settings-file-note">No matches for "{search}"</div>
            )}
            {visible.map(item => (
              <button
                key={item.key}
                type="button"
                className={'cc2-flush-btn cc2-settings-folder-row' + (item.key === selectedKey ? ' selected' : '')}
                onClick={() => { onModeChange('existing'); onSelect(item.key); }}
              >
                <span className="cc2-settings-folder-name">{item.name}</span>
                {item.sub && <span className="cc2-settings-folder-path">{item.sub}</span>}
              </button>
            ))}
            {matched.length > visible.length && (
              <div className="cc2-settings-file-note">
                +{matched.length - visible.length} more — keep typing to narrow.
              </div>
            )}
          </div>
        </div>
      )}

      <label className={`cc2-setup-row${mode === 'new' ? ' active' : ''}`}>
        <input
          type="radio" name="cc2-setup-mode"
          checked={mode === 'new'}
          onChange={() => onModeChange('new')}
        />
        <span className="cc2-setup-row-label">Create new {label}</span>
        <input
          ref={newRef}
          type="text"
          className="cc2-setup-input"
          placeholder={newPlaceholder ?? 'e.g. Work, Personal…'}
          value={newName}
          onChange={e => { onModeChange('new'); onNewName(e.target.value); }}
        />
      </label>
      {mode === 'new' && newName.trim() && createHint && (
        <div className="cc2-settings-file-sub cc2-settings-file-note">{createHint}</div>
      )}

      {extraRows}
    </div>
  );
}

/**
 * Single-file picker for General's raw list renderers. Two mutually-exclusive
 * modes in one radio group, same shape as the legacy fixed-folder picker below:
 * point at an existing note, or name a new one.
 *
 * Detection is free. `metadataCache.getFileCache(f).listItems[].task` is set
 * for every checkbox line Obsidian has already indexed, so "is this a
 * checklist" needs zero file reads — which is what makes a whole-vault scan
 * viable here where the folder picker had to cap its list.
 *
 * "Create new" writes no file: it only computes the path. The codec's
 * ensure(template) creates it on first render, which is the same plug-and-play
 * path every other widget already uses.
 */
function VaultFileSection({ app, picker, value, onChange }: {
  app: App; picker: SourcePickerConfig; value: string; onChange: (path: string) => void;
}) {
  const [mode,   setMode]   = useState<'existing' | 'new'>('existing');
  const [newName, setNewName] = useState('');

  const scaffold = useMemo(
    () => resolveCommandCenterPath(app, ...(picker.scaffoldSegments ?? [])),
    [app, picker.scaffoldSegments],
  );

  const items = useMemo<PickerItem[]>(() => {
    const files = app.vault.getMarkdownFiles();
    const hits = picker.requireCheckboxes
      ? files.filter(f => (app.metadataCache.getFileCache(f)?.listItems ?? []).some(li => li.task !== undefined))
      : files;
    return hits
      .map(f => ({ key: f.path, name: f.basename, sub: f.parent?.path && f.parent.path !== '/' ? f.parent.path : undefined }))
      .sort((a, b) => a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, picker.requireCheckboxes, value]);

  // Keep the parent in sync as the user types a new name.
  useEffect(() => {
    if (mode !== 'new') return;
    const name = newName.trim();
    onChange(name ? `${scaffold}/${name}.md` : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, newName, scaffold]);

  // No section label: the hint above this already introduces the picker, and a
  // second "CHECKLIST NOTE" heading between them read as duplication.
  return (
    <SourcePickerCards
      label={picker.label.toLowerCase()}
      items={items}
      caption={picker.requireCheckboxes ? `${items.length} with checkboxes` : `${items.length} notes`}
      mode={mode}
      onModeChange={setMode}
      selectedKey={value}
      onSelect={onChange}
      newName={newName}
      onNewName={setNewName}
      newPlaceholder="e.g. Packing List"
      createHint={<>Will be created at <code>{scaffold}/{newName.trim()}.md</code></>}
    />
  );
}

/**
 * Table picker — the only picker that enumerates something finer-grained than
 * a file. A note routinely holds several tables (a class transcript holds
 * three), so listing notes wouldn't identify a source; the unit here is one
 * table, identified by its path AND the heading above it.
 *
 * Both halves ride in the modal's single source-path state, encoded as
 * `path#heading`. Obsidian forbids `#` in filenames, so splitting on the FIRST
 * `#` is unambiguous even for a heading that contains one itself.
 *
 * "Create new" writes no file — it computes a path, and mdTableCodec.ensure()
 * seeds the note with a starter table on first render, the same plug-and-play
 * route every other picker uses.
 */
export function encodeTableKey(path: string, heading: string | null): string {
  return heading ? `${path}#${heading}` : path;
}
export function decodeTableKey(key: string): { path: string; heading?: string } {
  const at = key.indexOf('#');
  return at < 0 ? { path: key } : { path: key.slice(0, at), heading: key.slice(at + 1) };
}

function VaultTableSection({ app, picker, value, onChange }: {
  app: App; picker: SourcePickerConfig; value: string; onChange: (key: string) => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [newName, setNewName] = useState('');
  const [tables, setTables] = useState<DiscoveredTable[] | null>(null);

  const scaffold = useMemo(
    () => resolveCommandCenterPath(app, ...(picker.scaffoldSegments ?? [])),
    [app, picker.scaffoldSegments],
  );

  useEffect(() => {
    let cancelled = false;
    void discoverTables(app).then(found => { if (!cancelled) setTables(found); });
    return () => { cancelled = true; };
  }, [app]);

  useEffect(() => {
    if (mode !== 'new') return;
    const name = newName.trim();
    onChange(name ? `${scaffold}/${name}.md` : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, newName, scaffold]);

  const items = useMemo<PickerItem[]>(
    () => (tables ?? [])
      .map(t => ({
        key:  encodeTableKey(t.path, t.heading),
        name: t.heading ?? t.path.split('/').pop()!.replace(/\.md$/, ''),
        sub:  `${t.path} · ${t.columns.length} cols · ${t.rows} rows`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [tables],
  );

  if (tables === null) return <div className="cc2-setup-loading">Scanning for tables…</div>;

  return (
    <SourcePickerCards
      label="table"
      items={items}
      caption={`${items.length} tables`}
      mode={mode}
      onModeChange={setMode}
      selectedKey={value}
      onSelect={onChange}
      newName={newName}
      onNewName={setNewName}
      newPlaceholder="e.g. Reading List"
      createHint={<>Will be created at <code>{scaffold}/{newName.trim()}.md</code> with a starter table</>}
    />
  );
}

// Which frontmatter keys become columns. Offered keys come from the chosen
// folder's own notes (recordFolderCodec.readMeta), so this only ever lists
// fields that actually exist there. Leaving it untouched saves nothing and the
// widget falls back to defaultColumnsFor() — same result, no stored noise.
function ColumnPickerSection({ app, folder, value, onChange }: {
  app: App; folder: string; value: TableColumn[]; onChange: (cols: TableColumn[]) => void;
}) {
  const [fieldKeys, setFieldKeys] = useState<string[] | null>(null);

  useEffect(() => {
    if (!folder) { setFieldKeys(null); return; }
    let cancelled = false;
    void recordFolderCodec
      .readMeta(app, { codec: 'record-folder', folder })
      .then(meta => { if (!cancelled) setFieldKeys(meta.fieldKeys); });
    return () => { cancelled = true; };
  }, [app, folder]);

  if (!folder) return null;
  if (fieldKeys === null) return <div className="cc2-setup-loading">Reading folder…</div>;

  // date/title are synthesized by the codec for every row regardless of
  // frontmatter, so they're always offerable even in a folder that has none.
  const available = ['date', 'title', ...fieldKeys.filter(k => !['date', 'created', 'title', 'position'].includes(k))];
  const effective = value.length ? value : defaultColumnsFor(fieldKeys);

  const isOn      = (key: string) => effective.some(c => c.key === key);
  const isPrimary = (key: string) => effective.some(c => c.key === key && c.primary);

  const toggle = (key: string) => {
    if (isOn(key)) {
      const next = effective.filter(c => c.key !== key);
      // Never leave the table with no primary column to carry the row.
      if (next.length && !next.some(c => c.primary)) next[next.length - 1] = { ...next[next.length - 1], primary: true };
      onChange(next);
      return;
    }
    const kind: TableColumn['kind'] = key === 'date' ? 'date' : 'chip';
    onChange([...effective, { key, label: humanizeKey(key), kind }]);
  };

  const makePrimary = (key: string) => {
    onChange(effective.map(c => ({
      ...c,
      primary: c.key === key || undefined,
      kind:    c.key === key ? 'text' : c.kind,
    })));
  };

  return (
    <div className="cc2-settings-section">
      <span className="cc2-settings-section-label">Columns</span>
      {available.length === 0 && (
        <div className="cc2-settings-oauth-status">No notes in that folder yet — defaults will be used.</div>
      )}
      {available.map(key => (
        <div key={key} className="cc2-settings-col-row">
          <label className="cc2-settings-col-toggle">
            <input type="checkbox" checked={isOn(key)} onChange={() => toggle(key)} />
            {key}
          </label>
          <button
            type="button"
            className={'cc2-flush-btn cc2-settings-col-primary' + (isPrimary(key) ? ' selected' : '')}
            title="Use as the main column"
            disabled={!isOn(key)}
            onClick={() => makePrimary(key)}
          >
            main
          </button>
        </div>
      ))}
    </div>
  );
}

// Class Scheduler's day-start/day-end — file-backed (Education/Class-Schedule.md),
// same "reads live state, writes immediately, no Save button" convention as
// KanbanBucketSection above, since these bounds aren't part of this widget's
// own `config` (see class-schedule.ts's own comment on why they're shared
// data, not a per-instance preference).
function ClassSchedulerHoursSection({ app }: { app: App }) {
  const [dayStartMin, setDayStartMin] = useState<number | null>(null);
  const [dayEndMin,   setDayEndMin]   = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await readSchedule(app);
      if (!cancelled) { setDayStartMin(s.dayStartMin); setDayEndMin(s.dayEndMin); }
    })();
    return () => { cancelled = true; };
  }, [app]);

  const toTimeStr = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  const commit = async (startMin: number, endMin: number) => {
    if (endMin <= startMin) return;
    setDayStartMin(startMin); setDayEndMin(endMin);
    await updateDayBounds(app, startMin, endMin);
  };

  return (
    <div className="cc2-settings-section">
      <span className="cc2-settings-section-label">Scheduler Hours</span>
      {dayStartMin == null || dayEndMin == null ? (
        <div className="cc2-setup-loading">Loading…</div>
      ) : (
        <div className="cc2-settings-hours-row">
          <label className="cc2-settings-hours-field">
            <span>Day starts</span>
            <input type="time" className="cc2-setup-input" value={toTimeStr(dayStartMin)} onChange={e => void commit(toMin(e.target.value), dayEndMin)} />
          </label>
          <label className="cc2-settings-hours-field">
            <span>Day ends</span>
            <input type="time" className="cc2-setup-input" value={toTimeStr(dayEndMin)} onChange={e => void commit(dayStartMin, toMin(e.target.value))} />
          </label>
        </div>
      )}
    </div>
  );
}

// Grade Breakdown's per-assignment vs per-category mode picker + (in category
// mode) the category/weight list itself. Reads/writes Class-Info.md's
// cc2-grade-mode directly (a class-level property, not this widget
// instance's own config — the Assignments widget needs to read the same
// value) and Grade-Categories.md — both write immediately on change, same
// "no Save button" convention as KanbanBucketSection/ClassSchedulerHoursSection
// above, since neither lives in this modal's own deferred-until-Save patch.
function GradeModeSection({ app, slug }: { app: App; slug: string }) {
  const [gradeMode,  setGradeModeState] = useState<'assignment' | 'category'>('assignment');
  const [categories, setCategories]     = useState<GradeCategory[]>([]);
  const [loaded,     setLoaded]         = useState(false);
  const [newName,    setNewName]        = useState('');
  const [newWeight,  setNewWeight]      = useState('');

  const load = useCallback(async () => {
    const [info, cats] = await Promise.all([readClassInfo(app, slug), readGradeCategories(app, slug)]);
    setGradeModeState(info?.gradeMode ?? 'assignment');
    setCategories(cats);
    setLoaded(true);
  }, [app, slug]);

  useEffect(() => { setLoaded(false); void load(); }, [load]);

  const setMode = async (mode: 'assignment' | 'category') => {
    setGradeModeState(mode);
    await writeClassInfo(app, slug, { gradeMode: mode });
  };

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    await addGradeCategory(app, slug, name, newWeight.trim() || '0%');
    setNewName(''); setNewWeight('');
    void load();
  };

  const removeCategory = async (name: string) => {
    await removeGradeCategory(app, slug, name);
    void load();
  };

  const totalWeight = categories.reduce((sum, c) => {
    const n = parseFloat(c.weight.replace('%', ''));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  return (
    <div className="cc2-settings-section">
      <span className="cc2-settings-section-label cc2-settings-section-label-info">
        Grading
        <InfoTooltip text="Per-assignment: every assignment carries its own weight (e.g. Homework 1 = 5%) — best when your syllabus lists a percentage for each one. By category: assignments are grouped into categories (Homework, Exams, etc.), each with one overall weight — best when your syllabus only gives category-level percentages instead of breaking down every individual assignment." />
      </span>
      {!loaded && <div className="cc2-setup-loading">Loading…</div>}
      {loaded && (
        <>
          <div className="cc2-settings-grademode-tabs">
            <button type="button" className={`cc2-tab${gradeMode === 'assignment' ? ' active' : ''}`} onClick={() => void setMode('assignment')}>
              Weighted per Assignment
            </button>
            <button type="button" className={`cc2-tab${gradeMode === 'category' ? ' active' : ''}`} onClick={() => void setMode('category')}>
              Weighted by Category
            </button>
          </div>

          {gradeMode === 'category' && (
            <div className="cc2-settings-gradecats">
              <div className="cc2-settings-gradecats-header">
                <span className="cc2-settings-section-label cc2-settings-section-label-info">
                  Grade Categories
                  <InfoTooltip text="Each assignment in the Assignments tab gets tagged with one of these categories instead of entering its own weight — the Grade Breakdown widget averages the scores in each category and applies that category's weight. These should add up to 100%." />
                </span>
                {categories.length > 0 && (
                  <span className={`cc2-settings-gradecats-total${Math.round(totalWeight) !== 100 ? ' warn' : ''}`}>
                    {Math.round(totalWeight * 10) / 10}% total
                  </span>
                )}
              </div>

              {categories.length === 0 && (
                <div className="cc2-settings-oauth-status">No categories yet — add one below.</div>
              )}
              {categories.map(c => (
                <div key={c.name} className="cc2-settings-gradecat-row">
                  <span className="cc2-settings-gradecat-name">{c.name}</span>
                  <span className="cc2-settings-gradecat-weight">{c.weight}</span>
                  <button type="button" className="cc2-flush-btn cc2-settings-gradecat-remove" title="Remove category" onClick={() => void removeCategory(c.name)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}

              <div className="cc2-settings-gradecat-add">
                <input
                  type="text" className="cc2-setup-input" placeholder="Category, e.g. Homework"
                  value={newName} onChange={e => setNewName(e.target.value)}
                />
                <input
                  type="text" className="cc2-setup-input cc2-settings-gradecat-weight-input" placeholder="20%"
                  value={newWeight} onChange={e => setNewWeight(e.target.value)}
                />
                <button type="button" className="cc2-flush-btn cc2-settings-gradecat-add-btn" onClick={() => void addCategory()} disabled={!newName.trim()}>
                  + Add
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// One settings screen per widget, reused both at add-time (Widget Library ->
// create mode) and via right-click on an already-placed widget (edit mode) —
// same picker/fields either way, just seeded from existingConfig and routed
// to a patch instead of a fresh LayoutItem. Replaces the old separate
// WidgetSetupModal + WidgetToneModal (folded in here) so there's one place
// per widget to change its file/folder location, connection, and color.
export function WidgetSettingsModal({ app, type, mode, existingConfig, classSlug, onConfirm, onCancel }: Props) {
  const def    = widgetRegistry[type];
  const setup  = def?.requiresFileSetup;
  // A widget has either a fixed-folder file picker (presets) or a vault-wide
  // folder picker (General's raw renderers) — never both.
  const picker = def?.sourcePicker;
  // Both kinds can offer a display-name field; they just write different keys.
  const nameField = setup?.extraNameField ?? picker?.nameField;

  // ── File/folder picker (only relevant when `setup` is set) ──
  const [fileMode,  setFileMode]  = useState<'existing' | 'new'>('existing');
  const [files,     setFiles]     = useState<string[]>([]);
  const [selected,  setSelected]  = useState('');
  const [newName,   setNewName]   = useState('');
  const [extraName, setExtraName] = useState(
    (nameField && (existingConfig?.[nameField.configKey] as string | undefined)) ?? '',
  );
  const [ready, setReady] = useState(!setup);
  /** The fixed folder a legacy setup scans — shown as each row's second line. */
  const scanFolderPath = useMemo(() => (setup ? setup.scanFolder(app) : ''), [app, setup]);

  // ── Vault-wide source picker (only relevant when `picker` is set) ──
  // One state for both kinds: a folder path or a file path, depending on
  // picker.kind. Seeded from whichever half of the existing SourceRef applies.
  const [folderPath, setFolderPath] = useState<string>(() => {
    const existing = asSourceRef(existingConfig?.source);
    if (!existing) return '';
    // 'vault-table' round-trips through the same single state slot as the
    // other two, carrying its heading in the encoded key.
    if (picker?.kind === 'vault-table') {
      const p = sourcePath(existing);
      return p ? encodeTableKey(p, sourceHeading(existing)) : '';
    }
    return (picker?.kind === 'vault-file' ? sourcePath(existing) : sourceFolder(existing)) ?? '';
  });
  const [columns, setColumns] = useState<TableColumn[]>(
    () => (existingConfig?.columns as TableColumn[] | undefined) ?? [],
  );

  useEffect(() => {
    if (!setup) return;
    const scanFolder = setup.scanFolder(app);
    const folder = app.vault.getAbstractFileByPath(scanFolder);
    const found: string[] = [];
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (setup.mode === 'folder') { if (child instanceof TFolder) found.push(child.name); }
        else { if (child instanceof TFile && child.extension === 'md') found.push(child.basename); }
      }
    }
    found.sort();
    setFiles(found);

    const existingName = existingConfig?.[setup.configKey] as string | undefined;
    if (existingName && found.includes(existingName)) {
      setSelected(existingName); setFileMode('existing');
    } else if (existingName) {
      // Points at a name not currently on disk (shouldn't normally happen in
      // edit mode, but don't silently lose the user's existing value) —
      // surface it as the "new" name rather than falling back to found[0].
      setNewName(existingName); setFileMode('new');
    } else if (found.length > 0) {
      setSelected(found[0]); setFileMode('existing');
    } else {
      setFileMode('new');
    }
    setReady(true);
  }, [app, setup, existingConfig]);


  // ── Color (always relevant) ──
  const [tone, setTone] = useState<string>((existingConfig?.tone as string | undefined) ?? 'paper');
  const [wash, setWash] = useState<boolean>(!!existingConfig?.wash);

  // ── Class Scheduler's "Include weekends?" — a per-instance display
  // preference (which day columns render), unlike Hours above which is
  // shared file data — so this follows the normal deferred-until-Save
  // config-patch flow every other field in this modal already uses. ──
  const [includeWeekends, setIncludeWeekends] = useState<boolean>(!!existingConfig?.includeWeekends);

  // ── TODO List's "Link to classes?" — a display-mode switch, not file
  // data: when on, the widget derives its tabs from the user's active
  // classes instead of `setup`'s file/bucket picker below, which this
  // toggle hides entirely for todo-list (see canConfirm/confirm() below,
  // which both skip the file requirement while this is checked). Toggling
  // it never touches the widget's existing listFile/listName config — that
  // patch key is simply left unwritten while classLinked is on, so
  // switching back off restores exactly what was there. ──
  const [classLinked, setClassLinked] = useState<boolean>(!!existingConfig?.classLinked);
  const todoClassLinked = type === 'todo-list' && classLinked;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canConfirm = picker
    ? !!folderPath
    : (todoClassLinked || !setup || (fileMode === 'existing' ? !!selected : newName.trim().length > 0));
  // Whatever file/folder this modal's own picker currently resolves to —
  // reactive to fileMode/selected/newName so the Kanban bucket section below
  // updates live if the user re-picks a different file in this same session,
  // not just whatever was already saved in existingConfig.
  const effectiveListFile = fileMode === 'existing' ? selected : newName.trim();

  const confirm = () => {
    if (!canConfirm) return;
    const patch: Record<string, unknown> = {};
    if (setup && !todoClassLinked) {
      const name = fileMode === 'existing' ? selected : newName.trim();
      patch[setup.configKey] = name;
    }
    // Writes the typed SourceRef straight into config — no legacy string key,
    // so resolveWidgetSource() needs no mapping entry for these widgets.
    if (picker && folderPath) {
      // 'vault-file' produces a FILE source, 'vault-folder' a folder source —
      // the two halves of SourceRef. 'vault-table' is a file source plus the
      // heading that selects which table in it.
      if (picker.kind === 'vault-table') {
        const { path, heading } = decodeTableKey(folderPath);
        patch.source = { codec: picker.codec, path, ...(heading ? { heading } : {}) };
      } else {
        patch.source = picker.kind === 'vault-file'
          ? { codec: picker.codec, path: folderPath }
          : { codec: picker.codec, folder: folderPath };
      }
      if (picker.columns) patch.columns = columns.length ? columns : undefined;
    }
    if (nameField && !todoClassLinked) {
      patch[nameField.configKey] = extraName.trim() || undefined;
    }
    if (type === 'todo-list') {
      patch.classLinked = classLinked;
    }
    // Kanban hides this section entirely (per-bucket color replaces it), and
    // the whole Finance suite has its own semantic color system (income/
    // expense role color, category color, savings-rate tiers — see
    // DESIGN_SYSTEM.md) instead of a free per-widget accent — don't silently
    // reset/overwrite whatever's already there when saving other settings
    // for either kind of widget.
    if (type !== 'kanban' && def?.category !== 'Finance') {
      patch.tone = tone === 'paper' ? undefined : tone;
      patch.wash = wash;
    }
    if (type === 'class-scheduler') {
      patch.includeWeekends = includeWeekends;
    }
    onConfirm(patch);
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">{mode === 'create' ? 'Configure' : 'Edit'}: {def?.label ?? type}</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-setup-body">
          {/* Widget display title — independent of file selection (still
              shown in class-linked mode's own toolbar, see
              TodoListWidget.tsx), so it belongs at the very top, first,
              rather than nested inside — and gated behind the readiness of —
              the file-picker section below it. */}
          {nameField && (
            <div className="cc2-setup-namefield cc2-setup-namefield-first">
              <span className="cc2-setup-namefield-label">
                {nameField.label} <span className="cc2-setup-optional">(optional)</span>
              </span>
              <input
                type="text"
                className="cc2-setup-input cc2-setup-namefield-input"
                placeholder={nameField.placeholder}
                value={extraName}
                onChange={e => setExtraName(e.target.value)}
              />
            </div>
          )}

          {/* General-category raw renderers: point it at any folder, then pick
              which frontmatter keys become columns. */}
          {picker && (
            <>
              <p className="cc2-setup-hint">
                {picker.kind === 'vault-file' ? (
                  <>Pick a <strong>{picker.label}</strong>, or create a new one. Any note with
                  <code> - [ ] </code> checkbox lines works.</>
                ) : picker.kind === 'vault-table' ? (
                  <>Pick a <strong>{picker.label}</strong>, or create a new one. Each table is
                  listed under the heading above it — a note holding several tables offers each
                  one separately.</>
                ) : (
                  <>Choose a <strong>{picker.label}</strong> for this widget. Every note directly
                  inside it becomes a row — subfolders (a <code>Templates/</code> folder, say)
                  are ignored.</>
                )}
              </p>
              {picker.kind === 'vault-file' ? (
                <VaultFileSection
                  app={app}
                  picker={picker}
                  value={folderPath}
                  onChange={setFolderPath}
                />
              ) : picker.kind === 'vault-table' ? (
                <VaultTableSection
                  app={app}
                  picker={picker}
                  value={folderPath}
                  onChange={setFolderPath}
                />
              ) : (
                <VaultFolderSection
                  app={app}
                  label={picker.label}
                  value={folderPath}
                  onChange={setFolderPath}
                />
              )}
              {picker.columns && (
                <ColumnPickerSection
                  app={app}
                  folder={folderPath}
                  value={columns}
                  onChange={setColumns}
                />
              )}
            </>
          )}

          {setup && (
            <>
              <p className="cc2-setup-hint">
                Choose a <strong>{setup.label}</strong> for this widget. Widgets sharing the same {setup.label} will stay in sync.
              </p>

              {!ready && <div className="cc2-setup-loading">Scanning vault…</div>}

              {/* Same card + expanding-list UI the Checklist picker uses —
                  this used to be an inline <select>, which showed no count, no
                  search, and no hint of where a file lived. */}
              {ready && (
                <SourcePickerCards
                  label={setup.label}
                  items={files.map(f => ({
                    key:  f,
                    name: f,
                    sub:  setup.mode === 'folder' ? undefined : `${scanFolderPath}/${f}.md`,
                  }))}
                  caption={`${files.length} ${setup.label}${files.length === 1 ? '' : 's'}`}
                  mode={classLinked ? 'new' : fileMode}
                  onModeChange={m => { setClassLinked(false); setFileMode(m); }}
                  selectedKey={classLinked ? '' : selected}
                  onSelect={key => { setClassLinked(false); setSelected(key); }}
                  newName={newName}
                  onNewName={v => { setClassLinked(false); setNewName(v); }}
                  newPlaceholder={setup.newPlaceholder}
                  autoFocusNew
                  extraRows={type === 'todo-list' ? (
                    /* Third mutually-exclusive option in the SAME radio group —
                       "link to classes" bypasses file selection entirely, so it
                       belongs alongside the other two ways of deciding what
                       this widget reads, not bolted on elsewhere. */
                    <label className={`cc2-setup-row${classLinked ? ' active' : ''}`}>
                      <input
                        type="radio"
                        name="cc2-setup-mode"
                        checked={classLinked}
                        onChange={() => setClassLinked(true)}
                      />
                      <span className="cc2-setup-row-label">Link to classes</span>
                      <span className="cc2-setup-row-caption">1 tab per active class</span>
                    </label>
                  ) : undefined}
                />
              )}
            </>
          )}

          {type === 'kanban' && effectiveListFile && (
            <>
              <div className="cc2-settings-divider" />
              <KanbanBucketSection app={app} listFile={effectiveListFile} />
            </>
          )}

          {type === 'calendar-strip' && (
            <>
              <div className="cc2-settings-divider" />
              <CalendarOAuthSection />
            </>
          )}

          {type === 'class-grade-widget' && classSlug && (
            <>
              <div className="cc2-settings-divider" />
              <GradeModeSection app={app} slug={classSlug} />
            </>
          )}

          {type === 'class-scheduler' && (
            <>
              <div className="cc2-settings-divider" />
              <ClassSchedulerHoursSection app={app} />
              <label className="cc2-settings-bucket-toggle cc2-settings-weekends-toggle">
                <input
                  type="checkbox"
                  checked={includeWeekends}
                  onChange={e => setIncludeWeekends(e.target.checked)}
                />
                Include weekends?
              </label>
            </>
          )}

          {/* Kanban's board-wide color is redundant now that every bucket has
              its own independent tone/wash (right there on the column header)
              — omitted here entirely rather than offering two color controls
              that mostly overlap. The Finance suite (Year/Month Review,
              Pie Chart, Expense vs Income, Time Period, Income & Expense
              Tracker, Recurring Items) is excluded too — its color is
              semantic (income/expense role, per-category, savings-rate
              tiers), not a free accent choice, so this generic swatch would
              just be a dead control. Every other widget still gets this. */}
          {type !== 'kanban' && def?.category !== 'Finance' && (
            <>
              <div className="cc2-settings-divider" />
              <TonePicker
                tone={tone} wash={wash} onToneChange={setTone} onWashChange={setWash}
                // Recipe Box's card face is photo-dominated and deliberately
                // never washes (see DESIGN_SYSTEM.md) — only the fullscreen
                // viewer it controls actually uses color, and that view has
                // no page-level wash either, so the toggle would be a dead
                // control here.
                showWash={type !== 'recipe-box'}
              />
            </>
          )}
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={confirm} disabled={!canConfirm}>
            {mode === 'create' ? 'Add Widget →' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
