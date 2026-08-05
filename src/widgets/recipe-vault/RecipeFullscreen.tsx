import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Component, MarkdownRenderer, Platform } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { parseRecipeNote, saveRecipeNotes } from '../../data-sources/recipes';
import type { RecipeIngredient } from '../../data-sources/recipes';
import { formatQty } from '../../data-sources/ingredient-line';

// Real Obsidian markdown rendering (headers, numbered steps, bold, etc.) —
// the "nice full-screen formatted view" the recipe list redirects to instead
// of the raw editor. Imperative by nature (MarkdownRenderer.render appends
// DOM into an element it owns), so it's wrapped in a ref + effect rather than
// returned as JSX. The Component instance exists purely to give the renderer
// something to manage the lifecycle of embedded child components against;
// unloading it on cleanup is what tears those back down.
function MarkdownBlock({ app, markdown, sourcePath }: { app: App; markdown: string; sourcePath: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.empty();
    const component = new Component();
    component.load();
    MarkdownRenderer.render(app, markdown, el, sourcePath, component);
    return () => component.unload();
  }, [app, markdown, sourcePath]);

  return <div ref={ref} className="cc2-recipe-fs-markdown" />;
}

// ─── Unit conversion (volume + weight only — counts/unknown units and
// temperatures are never converted) ─────────────────────────────────────────

type UnitSystem = 'imperial' | 'metric';

const VOL_ML: Record<string, number> = { cup: 240, tbsp: 15, tsp: 5, floz: 30, 'fl oz': 30, ml: 1, l: 1000 };
const WT_G:   Record<string, number> = { oz: 28.35, lb: 453.6, g: 1, kg: 1000 };

function roundMl(ml: number): number {
  if (ml < 20) return Math.round(ml);
  if (ml < 100) return Math.round(ml / 5) * 5;
  return Math.round(ml / 10) * 10;
}

/** Scale + (optionally) convert a single ingredient's measure to a display string. */
function displayMeasure(qty: number | null, unit: string | null, factor: number, system: UnitSystem): string {
  if (qty == null) return '';
  const q = qty * factor;
  const u = (unit || '').toLowerCase();
  if (system === 'metric') {
    if (u in VOL_ML) return `${roundMl(q * VOL_ML[u])} ml`;
    if (u in WT_G)   return `${Math.round(q * WT_G[u])} g`;
    // count / unknown unit — leave as a scaled fraction
  }
  // imperial (as authored) OR non-convertible unit
  return `${formatQty(q)}${unit ? ' ' + unit : ''}`.trim();
}

const parseMinutes = (v?: string | number | null): number => {
  if (v == null) return 0;
  const m = String(v).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
};

interface Props {
  app:     App;
  file:    TFile;
  onClose: () => void;
  // Forwarded from RecipeBoxWidget's own config — same relationship as
  // CalendarStripWidget -> CalendarFullScreen. This is a separate
  // document.body portal from the compact widget, so it needs its own copy
  // of the attributes rather than inheriting them.
  tone?: string;
  wash?: boolean;
}

// Portaled to <body>, following CalendarFullscreen's shell pattern — reuses
// the same token-bridge block (.cc2-recipe-fs-backdrop added alongside
// .cc2-cal-fs-backdrop/.cc2-cal-modal-overlay in styles.css) rather than
// declaring a new one.
export function RecipeFullscreen({ app, file, onClose, tone, wash }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentServings, setCurrentServings] = useState<number | null>(null);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const swipeX = useRef<number | null>(null);

  const load = useCallback(async () => {
    setContent(await app.vault.read(file));
    setLoading(false);
  }, [app, file]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ref = app.vault.on('modify', f => { if (f.path === file.path) load(); });
    return () => app.vault.offref(ref);
  }, [app, file, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { meta, ingredients, imageEmbed, notes, restBody } = useMemo(() => parseRecipeNote(content), [content]);

  // Serving scaling is a view-only reading convenience — it never writes
  // back to the file. Reset to the note's real servings whenever a
  // different file loads (or the file's own base servings changes), so a
  // fresh open never carries over a leftover scale from a previous recipe.
  useEffect(() => { setCurrentServings(meta.baseServings); }, [file.path, meta.baseServings]);
  useEffect(() => { setGalleryIndex(0); }, [file.path]);

  const scaleFactor = meta.baseServings && currentServings ? currentServings / meta.baseServings : 1;

  // The "## Image" section can hold several embeds (one per line) → gallery slides.
  const photos = useMemo(
    () => (imageEmbed || '').split('\n').map(l => l.trim()).filter(Boolean),
    [imageEmbed],
  );

  // Auto-advance (pauses on hover; only when there's more than one photo).
  useEffect(() => {
    if (paused || photos.length < 2) return;
    const t = setInterval(() => setGalleryIndex(i => (i + 1) % photos.length), 4500);
    return () => clearInterval(t);
  }, [paused, photos.length]);

  const totalMinutes = parseMinutes(meta.prepTime) + parseMinutes(meta.cookTime);

  // Checking off an ingredient is a "gathering my stuff" scratchpad, not a
  // permanent edit — writing it back to the file meant the next time you
  // cooked this recipe, every box was still checked from last time and had
  // to be manually cleared first. Kept purely in memory instead: it resets
  // automatically when the full-screen view closes (this component
  // unmounts), never touches the note.
  const [checkedSet, setCheckedSet] = useState<Set<string>>(new Set());
  useEffect(() => { setCheckedSet(new Set()); }, [file.path]);

  const checkedCount = ingredients.filter(i => checkedSet.has(i.raw)).length;

  const handleToggle = useCallback((ing: RecipeIngredient) => {
    setCheckedSet(prev => {
      const next = new Set(prev);
      if (next.has(ing.raw)) next.delete(ing.raw); else next.add(ing.raw);
      return next;
    });
  }, []);

  // Notes is the one section in this view that's editable in place — cooking
  // notes/variations jotted down while cooking, saved straight back to the
  // note's "## Notes" section (see saveRecipeNotes). Reset out of edit mode
  // on file switch so a draft never leaks from one recipe into the next.
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setEditingNotes(false); }, [file.path]);
  useEffect(() => { if (editingNotes) notesTextareaRef.current?.focus(); }, [editingNotes]);

  const startEditingNotes = useCallback(() => {
    setNotesDraft(notes);
    setEditingNotes(true);
  }, [notes]);

  const handleSaveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      await saveRecipeNotes(app, file, notesDraft);
      setEditingNotes(false);
    } finally {
      setSavingNotes(false);
    }
  }, [app, file, notesDraft]);

  const next = () => setGalleryIndex(i => (i + 1) % photos.length);
  const prev = () => setGalleryIndex(i => (i - 1 + photos.length) % photos.length);

  const onPointerDown = (e: React.PointerEvent) => { swipeX.current = e.clientX; };
  const onPointerUp = (e: React.PointerEvent) => {
    if (swipeX.current == null || photos.length < 2) return;
    const dx = e.clientX - swipeX.current;
    swipeX.current = null;
    if (dx <= -40) next();
    else if (dx >= 40) prev();
  };

  return createPortal(
    <div className="cc2-recipe-fs-backdrop" data-tone={tone} data-wash={wash || undefined}>
      <div className={'cc2-recipe-fs' + (Platform.isPhone ? ' cc2-fs--phone' : '')}>

        {/* ---- Topbar ---- */}
        <div className="cc2-recipe-fs-topbar">
          <button className="cc2-flush-btn cc2-recipe-fs-exit" onClick={onClose} title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M5 1H1v4M9 1h4v4M13 9v4H9M1 9v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Close</span>
          </button>
          <span className="cc2-recipe-fs-filename">{file.basename}</span>
          <button
            type="button"
            className="cc2-flush-btn cc2-recipe-fs-edit"
            style={{ marginLeft: 'auto' }}
            onClick={() => { onClose(); app.workspace.openLinkText(file.path, ''); }}
          >
            Edit in vault
          </button>
        </div>

        {/* ---- Masthead: chips + big title + Prep/Cook/Total/Serves subheader ---- */}
        <div className="cc2-recipe-fs-masthead">
          {meta.categories.length > 0 && (
            <div className="cc2-recipe-fs-chips">
              {meta.categories.map(c => (
                <span key={c} className="cc2-recipe-fs-chip">{c}</span>
              ))}
            </div>
          )}
          <h1 className="cc2-recipe-fs-title">{file.basename}</h1>
          <div className="cc2-recipe-fs-subhead">
            {meta.prepTime && <span className="cc2-recipe-fs-subhead-item">Prep <b>{meta.prepTime}</b></span>}
            {meta.prepTime && meta.cookTime && <span className="cc2-recipe-fs-subhead-dot" />}
            {meta.cookTime && <span className="cc2-recipe-fs-subhead-item">Cook <b>{meta.cookTime}</b></span>}
            {totalMinutes > 0 && <span className="cc2-recipe-fs-subhead-dot" />}
            {totalMinutes > 0 && <span className="cc2-recipe-fs-subhead-item is-total">Total <b>{totalMinutes} min</b></span>}
            {currentServings != null && <span className="cc2-recipe-fs-subhead-dot" />}
            {currentServings != null && <span className="cc2-recipe-fs-subhead-item">Serves <b>{currentServings}</b></span>}
          </div>
        </div>

        <div className="cc2-recipe-fs-body">
          {loading && <div className="cc2-recipe-fs-loading">Loading…</div>}

          {!loading && (
            <div className="cc2-recipe-fs-layout">

              {/* ---- Left ~60% (independently scrollable): ingredients + rendered body ---- */}
              <div className="cc2-recipe-fs-main-col">
                {ingredients.length > 0 && (
                  <div className="cc2-recipe-fs-ingredients">
                    <div className="cc2-recipe-fs-ing-head">
                      <div className="cc2-recipe-fs-section-label">Ingredients</div>
                      <div className="cc2-recipe-fs-ing-count">{checkedCount}<span>/{ingredients.length}</span></div>
                    </div>
                    {ingredients.map((ing, i) => {
                      const measure = displayMeasure(ing.qty, ing.unit, scaleFactor, unitSystem);
                      const isChecked = checkedSet.has(ing.raw);
                      return (
                        <div
                          key={ing.raw + i}
                          className={'cc2-recipe-fs-ing-row' + (isChecked ? ' done' : '')}
                          onClick={() => handleToggle(ing)}
                        >
                          <span className="cc2-recipe-fs-ing-check">
                            {isChecked && (
                              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                <path d="M1 4.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          {measure && <span className="cc2-recipe-fs-ing-qty">{measure}</span>}
                          {ing.url ? (
                            <a
                              className="cc2-recipe-fs-ing-name cc2-recipe-fs-ing-link"
                              href={ing.url}
                              onClick={e => {
                                // stopPropagation so this doesn't also toggle the row's
                                // checkbox; preventDefault + window.open (not target="_blank")
                                // because a plain anchor's native new-tab navigation isn't
                                // reliably allowed inside Obsidian's Electron shell —
                                // window.open(url) is the pattern already proven to work
                                // elsewhere in this codebase (google-oauth.ts).
                                e.stopPropagation();
                                e.preventDefault();
                                window.open(ing.url!);
                              }}
                            >
                              {ing.name}
                            </a>
                          ) : (
                            <span className="cc2-recipe-fs-ing-name">{ing.name}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Instructions / Required Tools render from the note body markdown; Notes
                    is pulled out into its own editable block below. */}
                <div className="cc2-recipe-fs-main">
                  <MarkdownBlock app={app} markdown={restBody} sourcePath={file.path} />
                </div>

                {/* ---- Notes: the one section editable in place, for jotting cooking
                    notes/variations without leaving the full-screen view ---- */}
                <div className="cc2-recipe-fs-notes">
                  <div className="cc2-recipe-fs-notes-head">
                    <div className="cc2-recipe-fs-section-label">Notes</div>
                    {!editingNotes && (
                      <button
                        type="button"
                        className="cc2-flush-btn cc2-recipe-fs-notes-edit-btn"
                        onClick={startEditingNotes}
                      >
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                          <path d="M9.5 1.5l3 3-7.5 7.5H2v-3l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>{notes ? 'Edit' : 'Add note'}</span>
                      </button>
                    )}
                  </div>

                  {editingNotes ? (
                    <div className="cc2-recipe-fs-notes-editor">
                      <textarea
                        ref={notesTextareaRef}
                        className="cc2-recipe-fs-notes-textarea"
                        value={notesDraft}
                        placeholder="Cooking notes, variations, substitutions…"
                        onChange={e => setNotesDraft(e.target.value)}
                        onKeyDown={e => {
                          // stopPropagation so Escape only exits note-editing rather than
                          // bubbling to the document-level listener that closes the whole
                          // full-screen view.
                          if (e.key === 'Escape') { e.stopPropagation(); setEditingNotes(false); }
                          else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSaveNotes(); }
                        }}
                      />
                      <div className="cc2-recipe-fs-notes-actions">
                        <button type="button" className="cc2-flush-btn" onClick={() => setEditingNotes(false)}>Cancel</button>
                        <button
                          type="button"
                          className="cc2-flush-btn cc2-recipe-fs-notes-save"
                          onClick={handleSaveNotes}
                          disabled={savingNotes}
                        >
                          {savingNotes ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : notes ? (
                    <MarkdownBlock app={app} markdown={notes} sourcePath={file.path} />
                  ) : (
                    <div className="cc2-recipe-fs-notes-empty">No notes yet — jot down variations or notes as you cook.</div>
                  )}
                </div>
              </div>

              {/* ---- Right ~40% (independently scrollable): shrunk meta card + gallery ---- */}
              <div className="cc2-recipe-fs-side-col">

                <div className="cc2-recipe-fs-info">
                  <div className="cc2-recipe-fs-info-controls">
                    {meta.baseServings != null && currentServings != null && (
                      <div className="cc2-recipe-fs-info-item">
                        <span className="cc2-recipe-fs-info-label">Servings</span>
                        <div className="cc2-recipe-fs-servings-control">
                          <button
                            type="button"
                            className="cc2-flush-btn cc2-recipe-fs-servings-step"
                            onClick={() => setCurrentServings(s => Math.max(1, (s ?? 1) - 1))}
                          >−</button>
                          <input
                            type="number"
                            min={1}
                            className="cc2-recipe-fs-servings-input"
                            value={currentServings}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10);
                              setCurrentServings(Number.isFinite(v) && v > 0 ? v : 1);
                            }}
                          />
                          <button
                            type="button"
                            className="cc2-flush-btn cc2-recipe-fs-servings-step"
                            onClick={() => setCurrentServings(s => (s ?? 1) + 1)}
                          >+</button>
                        </div>
                      </div>
                    )}

                    <div className="cc2-recipe-fs-info-item">
                      <span className="cc2-recipe-fs-info-label">Units</span>
                      <div className="cc2-recipe-fs-units">
                        <button
                          type="button"
                          className={'cc2-recipe-fs-unit-btn' + (unitSystem === 'imperial' ? ' active' : '')}
                          onClick={() => setUnitSystem('imperial')}
                        >Imperial</button>
                        <button
                          type="button"
                          className={'cc2-recipe-fs-unit-btn' + (unitSystem === 'metric' ? ' active' : '')}
                          onClick={() => setUnitSystem('metric')}
                        >Metric</button>
                      </div>
                    </div>
                  </div>

                  {currentServings !== meta.baseServings && (
                    <div className="cc2-recipe-fs-scaled-note">
                      Quantities scaled from {formatQty(meta.baseServings ?? 0)} servings · units convert volume &amp; weight
                    </div>
                  )}

                  {meta.sourceUrl && (
                    <a
                      className="cc2-recipe-fs-source-link"
                      href={meta.sourceUrl}
                      onClick={e => { e.preventDefault(); window.open(meta.sourceUrl!); }}
                    >
                      View original recipe
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 9.5l7-7M4 2.5h5.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </a>
                  )}
                </div>

                {photos.length > 0 && (
                  <div className="cc2-recipe-fs-gallery">
                    <div
                      className="cc2-recipe-fs-gallery-frame"
                      onPointerDown={onPointerDown}
                      onPointerUp={onPointerUp}
                      onMouseEnter={() => setPaused(true)}
                      onMouseLeave={() => setPaused(false)}
                    >
                      {/* Obsidian embeds must go through MarkdownRenderer, so we render the
                          active slide's embed. Key on the index so the block re-mounts. */}
                      <MarkdownBlock
                        key={galleryIndex}
                        app={app}
                        markdown={photos[galleryIndex]}
                        sourcePath={file.path}
                      />

                      {/* Overlaid on the photo rather than a separate header row, to keep
                          the frame as tall as possible within the locked right column. */}
                      <div className="cc2-recipe-fs-gallery-badge">Photos</div>
                      {photos.length > 1 && (
                        <div className="cc2-recipe-fs-gallery-counter">{galleryIndex + 1} / {photos.length}</div>
                      )}

                      {photos.length > 1 && (
                        <>
                          <button type="button" className="cc2-flush-btn cc2-recipe-fs-gallery-nav prev" onClick={prev} title="Previous photo">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          <button type="button" className="cc2-flush-btn cc2-recipe-fs-gallery-nav next" onClick={next} title="Next photo">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
