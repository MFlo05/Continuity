import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { App, TFile } from 'obsidian';
import { RECIPE_CATEGORIES } from '../../data-sources/recipes';
import type { RecipeCardData } from '../../data-sources/recipes';
import { useRecipeCards } from '../recipe-vault/useRecipeCards';
import { peelFor } from '../shared/peel-stack';
import type { PeelConfig } from '../shared/peel-stack';

// Ported verbatim from the design prototype's _onStackScroll math — see
// widgets/shared/peel-stack.ts for the formula itself (shared with the
// standalone Recipe Box widget, which uses a smaller-scale PEEL_CONFIG).
const PEEK = 15, SCALE_STEP = 0.055, CAP = 3;
const PEEL_CONFIG: PeelConfig = { peek: PEEK, scaleStep: SCALE_STEP, cap: CAP, front: CAP * PEEK };
const CARD_STEP = 236, TRACK_PAD = 200;

interface Props {
  app:       App;
  onClose:   () => void;
  tone?:     string;
  onStartDrag:       (recipeTitle: string, colSpan: number, e: React.PointerEvent) => void;
  onOpenFullscreen:  (file: TFile) => void;
}

// Portaled, own token bridge via .cc2-modal-backdrop (same as every other
// modal in this codebase). Closes itself (the caller flips showBox off) the
// instant a "Drag to plan" gesture starts, via onStartDrag — a centered
// modal blocking the grid the user needs to aim a drop at is worse than
// just closing outright, so there's no "collapsed, click-through, still
// visible" in-between state here.
export function RecipeBoxModal({ app, onClose, tone, onStartDrag, onOpenFullscreen }: Props) {
  const { cards, loading } = useRecipeCards(app);

  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState('');
  const [flipped,  setFlipped]  = useState<Set<string>>(new Set());
  const [stackFront, setStackFront] = useState(0);

  const stackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Search matches title or tags; category filters by the recipe's own
  // categories list — both reset the stack to the top, same as the design.
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

  // Mutates each mounted card's transform directly (no React re-render per
  // scroll tick) so the peel tracks the scrollbar 1:1 — only stackFront
  // (which cards are mounted) goes through setState, and only when it
  // actually crosses an integer boundary.
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const trackH = Math.max(1, n) * CARD_STEP + TRACK_PAD;
    const maxScroll = Math.max(1, trackH - el.clientHeight);
    const p = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
    const k = p * Math.max(1, n - 1);
    for (const [i, cardEl] of cardRefs.current) {
      const { ty, sc, op, rot, z } = peelFor(i, k, PEEL_CONFIG);
      cardEl.style.transform = `translateX(-50%) translateY(${ty}px) scale(${sc}) rotate(${rot}deg)`;
      cardEl.style.opacity = String(op);
      cardEl.style.zIndex = String(z);
    }
    const nf = Math.round(k);
    if (nf !== stackFront) setStackFront(nf);
  }

  function toggleFlip(path: string) {
    setFlipped(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  return createPortal(
    <div
      className="cc2-modal-backdrop cc2-mp-box-backdrop"
      data-tone={tone}
      onMouseDown={onClose}
    >
      <div className="cc2-modal cc2-mp-box" onMouseDown={e => e.stopPropagation()}>
        <div className="cc2-modal-header cc2-mp-box-hdr">
          <div>
            <div className="cc2-modal-title">Recipe Box</div>
            <div className="cc2-mp-box-sub">Flip a card for details · drag it onto your week</div>
          </div>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-mp-box-controls">
          <input
            type="text"
            className="cc2-mp-box-search"
            placeholder="Search recipes or tags…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="cc2-mp-box-category" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {RECIPE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        <div className="cc2-mp-box-stack" ref={stackRef} onScroll={handleScroll}>
          {loading && <div className="cc2-mp-box-empty">Loading…</div>}
          {!loading && n === 0 && <div className="cc2-mp-box-empty">No recipes match.</div>}
          {!loading && n > 0 && (
            <div className="cc2-mp-box-track" style={{ height: Math.max(1, n) * CARD_STEP + TRACK_PAD }}>
              <div className="cc2-mp-box-stage">
                {windowed.map(i => {
                  const card = filtered[i];
                  const { ty, sc, op, rot, z } = peelFor(i, stackFront, PEEL_CONFIG);
                  return (
                    <div
                      key={card.file.path}
                      ref={el => { if (el) cardRefs.current.set(i, el); else cardRefs.current.delete(i); }}
                      className="cc2-mp-box-cardwrap"
                      style={{ transform: `translateX(-50%) translateY(${ty}px) scale(${sc}) rotate(${rot}deg)`, opacity: op, zIndex: z }}
                    >
                      <RecipeStackCard
                        card={card}
                        flipped={flipped.has(card.file.path)}
                        onFlip={() => toggleFlip(card.file.path)}
                        onDragStart={e => onStartDrag(card.title, 1, e)}
                        onOpenFullscreen={() => onOpenFullscreen(card.file)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RecipeStackCard({ card, flipped, onFlip, onDragStart, onOpenFullscreen }: {
  card: RecipeCardData;
  flipped: boolean;
  onFlip: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onOpenFullscreen: () => void;
}) {
  const total = card.totalMinutes;
  const frontStyle: React.CSSProperties | undefined = card.imageUrl
    ? { backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,.8), rgba(0,0,0,.32) 42%, rgba(0,0,0,.72)), url("${card.imageUrl}")` }
    : undefined;

  return (
    <div className="cc2-mp-box-card">
      <div className={'cc2-mp-box-flip' + (flipped ? ' flipped' : '')} onClick={onFlip}>
        <div className={'cc2-mp-box-face cc2-mp-box-front' + (card.imageUrl ? '' : ' no-photo')} style={frontStyle}>
          <div className="cc2-mp-box-front-top">
            {card.categories.length > 0 && (
              <div className="cc2-mp-box-chips">
                {card.categories.slice(0, 3).map(cat => <span key={cat} className="cc2-mp-box-chip">{cat}</span>)}
              </div>
            )}
            <div className="cc2-mp-box-front-title">{card.title}</div>
            <div className="cc2-mp-box-front-meta">
              {total > 0 && <span>{total} min</span>}
              {total > 0 && card.ingredientCount > 0 && <span className="cc2-mp-box-meta-dot" />}
              {card.ingredientCount > 0 && <span>{card.ingredientCount} ingredients</span>}
            </div>
          </div>
          <div className="cc2-mp-box-front-footer">
            <span className="cc2-mp-box-flip-hint">click to flip</span>
            <button
              type="button"
              className="cc2-mp-box-drag-pill"
              title="Drag to plan"
              onPointerDown={e => { e.stopPropagation(); onDragStart(e); }}
              onClick={e => e.stopPropagation()}
            >
              ⠿ Drag to plan
            </button>
          </div>
        </div>

        <div className="cc2-mp-box-face cc2-mp-box-back">
          <div className="cc2-mp-box-back-eyebrow">RECIPE CARD</div>
          <div className="cc2-mp-box-back-title">{card.title}</div>
          <div className="cc2-mp-box-stats">
            <div className="cc2-mp-box-stat">
              <span className="cc2-mp-box-stat-num">{total || '—'}</span>
              <span className="cc2-mp-box-stat-label">min total</span>
            </div>
            <div className="cc2-mp-box-stat">
              <span className="cc2-mp-box-stat-num">{card.ingredientCount || '—'}</span>
              <span className="cc2-mp-box-stat-label">ingredients</span>
            </div>
            <div className="cc2-mp-box-stat">
              <span className="cc2-mp-box-stat-num">{card.servings ?? '—'}</span>
              <span className="cc2-mp-box-stat-label">serves</span>
            </div>
          </div>
          {(card.prepTime || card.cookTime) && (
            <div className="cc2-mp-box-back-times">
              {card.prepTime && `Prep ${card.prepTime}`}
              {card.prepTime && card.cookTime && ' · '}
              {card.cookTime && `Cook ${card.cookTime}`}
            </div>
          )}
          {card.categories.length > 0 && (
            <div className="cc2-mp-box-chips">
              {card.categories.slice(0, 4).map(cat => <span key={cat} className="cc2-mp-box-chip outline">{cat}</span>)}
            </div>
          )}
          <div className="cc2-mp-box-back-footer">
            <button type="button" className="cc2-flush-btn cc2-mp-box-full-btn" onClick={e => { e.stopPropagation(); onOpenFullscreen(); }}>
              Full recipe →
            </button>
            <button
              type="button"
              className="cc2-mp-box-drag-pill accent"
              title="Drag to plan"
              onPointerDown={e => { e.stopPropagation(); onDragStart(e); }}
              onClick={e => e.stopPropagation()}
            >
              ⠿ Drag to plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
