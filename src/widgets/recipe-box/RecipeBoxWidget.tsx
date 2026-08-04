import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { TFile } from 'obsidian';
import { RECIPE_CATEGORIES } from '../../data-sources/recipes';
import type { RecipeCardData } from '../../data-sources/recipes';
import { useRecipeCards } from '../recipe-vault/useRecipeCards';
import { peelFor } from '../shared/peel-stack';
import type { PeelConfig } from '../shared/peel-stack';
import type { WidgetProps } from '../registry';
import { RecipeFullscreen } from '../recipe-vault/RecipeFullscreen';
import { RecipeCreateModal } from '../recipe-vault/RecipeCreateModal';
import { RecipeImportModal } from '../recipe-vault/RecipeImportModal';
import { useRecipeImport } from '../recipe-vault/useRecipeImport';
import { BrandMark } from '../../ai/BrandMark';

const CAP = 3, SCALE_STEP = 0.055;

// The sole recipe-browsing widget (replaced the old plain-list
// RecipeVaultWidget outright once this proved out) — a flip-less,
// drag-less version of the Meal Planner's Recipe Box: same real-data
// loading and scroll physics, no card back, no "drag to plan" (this widget
// never places meals), click anywhere on a card opens the real
// RecipeFullscreen directly. Recipe creation/AI import live here too, via
// the shared useRecipeImport hook.
export function RecipeBoxWidget({ app, config }: WidgetProps) {
  // The card face itself deliberately doesn't consume tone (see
  // DESIGN_SYSTEM.md — it's photo-dominated, and the category chips are
  // already tuned to stay readable over any photo; tinting them risks
  // reintroducing exactly that solved problem). This is read purely to
  // forward into RecipeFullscreen, which genuinely does use it — same
  // relationship as CalendarStripWidget -> CalendarFullScreen.
  const tone = config?.tone as string | undefined;
  const wash = !!config?.wash;

  const { cards, loading } = useRecipeCards(app);

  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState('');
  const [stackFront, setStackFront] = useState(0);
  const [openFile,   setOpenFile]   = useState<TFile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { settings, canImportWithAI, isDark, handleImport } = useRecipeImport(app);

  const stackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());


  // Measures the scrollable stack area's own rendered size — the widget can
  // be resized to almost anything, so card/stage geometry is derived from
  // this on every layout change instead of picked once as fixed constants
  // (an earlier version did that and either wasted space at a larger size
  // or felt cramped at a smaller one — see DESIGN_SYSTEM.md).
  const [stackSize, setStackSize] = useState({ w: 480, h: 260 });
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setStackSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ratios lifted from the Meal Planner Recipe Box modal's own fixed layout
  // (stage 370 / top 16 / front 45 / card 296 / cardStep 236 / trackPad
  // 200px) so the *proportions* match — just computed continuously against
  // the measured area instead of frozen at one size.
  const cardMaxWidth = Math.min(stackSize.w * 0.92, 560);
  const cardHeight   = Math.round(stackSize.h * 0.80);
  const topOffset    = Math.round(stackSize.h * 0.043);
  const front        = Math.round(stackSize.h * 0.122);
  const peek         = front / CAP;
  const cardStep     = Math.round(cardHeight * 0.797);
  const trackPad     = Math.round(stackSize.h * 0.54);
  const peelConfig: PeelConfig = useMemo(
    () => ({ peek, scaleStep: SCALE_STEP, cap: CAP, front }),
    [peek, front],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(c => {
      if (q && !c.title.toLowerCase().includes(q) && !c.tags.some(t => t.toLowerCase().includes(q))) return false;
      if (category && !c.categories.includes(category)) return false;
      return true;
    });
  }, [cards, search, category]);

  useEffect(() => {
    setStackFront(0);
    if (stackRef.current) stackRef.current.scrollTop = 0;
  }, [search, category, cards.length]);

  const n = filtered.length;
  const windowed: number[] = [];
  for (let i = Math.max(0, stackFront - 1); i <= Math.min(n - 1, stackFront + 5); i++) windowed.push(i);

  // Same technique as RecipeBoxModal: mutate mounted cards' transform
  // directly via refs on every scroll tick (no React re-render), only
  // stackFront (which cards are mounted) goes through setState.
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const trackH = Math.max(1, n) * cardStep + trackPad;
    const maxScroll = Math.max(1, trackH - el.clientHeight);
    const p = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
    const k = p * Math.max(1, n - 1);
    for (const [i, cardEl] of cardRefs.current) {
      const { ty, sc, op, rot, z } = peelFor(i, k, peelConfig);
      cardEl.style.transform = `translateX(-50%) translateY(${ty}px) scale(${sc}) rotate(${rot}deg)`;
      cardEl.style.opacity = String(op);
      cardEl.style.zIndex = String(z);
    }
    const nf = Math.round(k);
    if (nf !== stackFront) setStackFront(nf);
  }

  return (
    <div className="cc2-rb-root" data-tone={tone} data-wash={wash || undefined}>
      <div className="cc2-rb-toolbar">
        <span className="cc2-rb-title">Recipe Box</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="cc2-flush-btn cc2-rv-ai-add"
          title={canImportWithAI ? 'Add a recipe with AI' : `Add with AI requires Claude CLI mode (currently ${settings.activeProvider})`}
          disabled={!canImportWithAI}
          onClick={() => setShowImport(true)}
        >
          <BrandMark provider={settings.activeProvider} size={14} isDark={isDark} />
          Add with AI
        </button>
        <button type="button" className="cc2-flush-btn cc2-rv-add" title="Create a new recipe" onClick={() => setShowCreate(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="cc2-rb-search-wrap">
        <input
          type="text"
          className="cc2-rb-search"
          placeholder="Search recipes or tags…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="cc2-rb-category" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {RECIPE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
        </select>
      </div>

      <div className="cc2-rb-stack" ref={stackRef} onScroll={handleScroll}>
        {loading && <div className="cc2-rb-empty">Loading…</div>}
        {!loading && cards.length === 0 && <div className="cc2-rb-empty">No recipes yet.</div>}
        {!loading && cards.length > 0 && n === 0 && <div className="cc2-rb-empty">No recipes match.</div>}
        {!loading && n > 0 && (
          <div className="cc2-rb-track" style={{ height: Math.max(1, n) * cardStep + trackPad }}>
            <div className="cc2-rb-stage" style={{ height: stackSize.h }}>
              {windowed.map(i => {
                const card = filtered[i];
                const { ty, sc, op, rot, z } = peelFor(i, stackFront, peelConfig);
                return (
                  <div
                    key={card.file.path}
                    ref={el => { if (el) cardRefs.current.set(i, el); else cardRefs.current.delete(i); }}
                    className="cc2-rb-cardwrap"
                    style={{
                      top: topOffset, maxWidth: cardMaxWidth, height: cardHeight,
                      transform: `translateX(-50%) translateY(${ty}px) scale(${sc}) rotate(${rot}deg)`,
                      opacity: op, zIndex: z,
                    }}
                  >
                    <RecipeStackCardCompact card={card} onOpen={() => setOpenFile(card.file)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {openFile && (
        <RecipeFullscreen app={app} file={openFile} onClose={() => setOpenFile(null)} tone={tone} wash={wash} />
      )}

      {showCreate && (
        <RecipeCreateModal
          app={app}
          onClose={() => setShowCreate(false)}
          onCreated={file => {
            setShowCreate(false);
            // No manual reload: the new note lands in the recipes folder, which
            // the codec's own watcher already covers.
            app.workspace.openLinkText(file.path, '');
          }}
        />
      )}

      {showImport && (
        <RecipeImportModal
          app={app}
          onClose={() => setShowImport(false)}
          onImport={url => { setShowImport(false); void handleImport(url); }}
        />
      )}
    </div>
  );
}

function RecipeStackCardCompact({ card, onOpen }: { card: RecipeCardData; onOpen: () => void }) {
  const total = card.totalMinutes;
  const frontStyle: React.CSSProperties | undefined = card.imageUrl
    ? { backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,.78), rgba(0,0,0,.28) 45%, rgba(0,0,0,.62)), url("${card.imageUrl}")` }
    : undefined;

  return (
    <div
      className={'cc2-rb-card' + (card.imageUrl ? '' : ' no-photo')}
      style={frontStyle}
      onClick={onOpen}
      title={card.title}
    >
      {card.categories.length > 0 && (
        <div className="cc2-rb-chips">
          {card.categories.slice(0, 3).map(cat => <span key={cat} className="cc2-rb-chip">{cat}</span>)}
        </div>
      )}
      <div className="cc2-rb-card-title">{card.title}</div>
      <div className="cc2-rb-card-meta">
        {total > 0 && <span>{total} min</span>}
        {total > 0 && card.ingredientCount > 0 && <span className="cc2-rb-meta-dot" />}
        {card.ingredientCount > 0 && <span>{card.ingredientCount} ingredients</span>}
      </div>
    </div>
  );
}
