import React, { useState, useLayoutEffect, useEffect, useRef, useMemo } from 'react';
import { nextOccurrence, type RecurringItem } from '../../data-sources/recurring';
import { categoryColor } from '../../data-sources/budget';
import { peelFor } from '../shared/peel-stack';
import type { PeelConfig } from '../shared/peel-stack';

const CAP = 3, SCALE_STEP = 0.055;

function fmt$(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNextDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type CleanCard = {
  index: number;
  kind: 'income' | 'expense';
  title: string;
  category: string;
  schedule: string;
  amount: string;
  nextDate: string;
  daysNum: string;
  daysWord: string;
  sortKey: number;
};

interface Props {
  items:            RecurringItem[];
  confirmIndex:     number | null;
  onEdit:           (item: RecurringItem, index: number) => void;
  onRequestConfirm: (index: number) => void;
  onConfirmRemove:  (index: number) => void;
  onCancelConfirm:  () => void;
}

// Clean peel-stack for Recurring Items' Gallery view — same shared peelFor()
// physics as the receipt gallery, no paper texture/torn edge. Cards sort
// soonest -> furthest by computed next-occurrence date (recurring.ts's
// nextOccurrence — real but intentionally simple date math, not a full
// scheduling engine, per the "don't wire that up just yet" scope for this
// pass). Items with an unparseable/custom schedule sort last and show "—".
export function RecurringItemsGallery({ items, confirmIndex, onEdit, onRequestConfirm, onConfirmRemove, onCancelConfirm }: Props) {
  const [stackFront, setStackFront] = useState(0);
  const stackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Measured synchronously (useLayoutEffect, before paint) rather than
  // starting from a guessed default — this widget's minSize (4x4) can be far
  // smaller than any reasonable fallback, so a stale default rendered even
  // for one frame produced a card sized for a much bigger box than the real
  // one, reading as "cards not shrinking / overflowing" at small sizes.
  const [stackSize, setStackSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setStackSize({ w: rect.width, h: rect.height });
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setStackSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ratios adapted from design_handoff_multiview_widgets's geoFor('ri') —
  // cardH brought up again (was 0.64) to fill the dead space left below the
  // card at most sizes and give the footer more room to actually show, and
  // top/front match IncomeExpenseGallery's exactly so both stacks start at
  // the same height.
  const REFERENCE_W = 372;
  const stackW     = stackSize?.w ?? 0;
  const stackH     = stackSize?.h ?? 0;
  const cardW      = Math.min(Math.round(stackW * 0.92), REFERENCE_W);
  const cardH      = Math.round(stackH * 0.80);
  const topOffset  = Math.round(stackH * 0.02);
  const front      = Math.round(stackH * 0.08);
  const peek       = front / CAP;
  const cardStep   = Math.round(cardH * 0.72);
  const trackPad   = Math.round(stackH * 0.38);
  // Below this, the footer (NEXT date + days-until) doesn't fit alongside
  // header/title/amount/meta without overflowing — hide it rather than
  // cramming/clipping it (the card's overflow:hidden would otherwise just
  // clip it mid-text, which still looks broken).
  const showFooter = cardH >= 150;
  const peelConfig: PeelConfig = useMemo(
    () => ({ peek, scaleStep: SCALE_STEP, cap: CAP, front }),
    [peek, front],
  );
  // Scales card-internal font/padding down together as the widget shrinks
  // (e.g. toward 4x4), rather than the outer box shrinking while fixed-px
  // text/padding inside stays the same size and starts overflowing/cramping.
  const cardScale = Math.max(0.6, Math.min(1, cardW / REFERENCE_W));

  const cards: CleanCard[] = useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const decorated = items.map((it, index) => {
      const next = nextOccurrence(it.schedule, now);
      const daysUntil = next ? Math.max(0, Math.round((next.getTime() - todayMidnight) / 86400000)) : Infinity;
      return {
        index,
        kind: it.section === 'Income' ? 'income' as const : 'expense' as const,
        title: it.description,
        category: it.category,
        schedule: it.schedule,
        amount: (it.section === 'Income' ? '+' : '−') + fmt$(it.amount),
        nextDate: next ? fmtNextDate(next) : '—',
        daysNum: next ? String(daysUntil) : '—',
        daysWord: next && daysUntil === 1 ? 'day' : 'days',
        sortKey: next ? daysUntil : Infinity,
      };
    });
    return decorated.sort((a, b) => a.sortKey - b.sortKey);
  }, [items]);

  useEffect(() => { setStackFront(0); if (stackRef.current) stackRef.current.scrollTop = 0; }, [items.length]);

  const n = cards.length;
  const windowed: number[] = [];
  for (let i = Math.max(0, stackFront - 1); i <= Math.min(n - 1, stackFront + 5); i++) windowed.push(i);

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

  // ref is attached on this one persistent outer div in every branch (empty,
  // not-yet-measured, and fully rendered) — the ResizeObserver setup in the
  // layout effect above only ever runs once, right after mount, so it must
  // find a real element then; if an earlier render's "empty" state omitted
  // the ref, later data arriving async would never re-attach it and the
  // stack would stay stuck unmeasured forever (cards permanently missing).
  return (
    <div className="cc2-gallery-stack" ref={stackRef} onScroll={n > 0 && stackSize ? handleScroll : undefined}>
      {n === 0 && <div className="cc2-gallery-empty">Your recurring items appear here</div>}
      {n > 0 && stackSize && (
      <div className="cc2-gallery-track" style={{ height: Math.max(1, n) * cardStep + trackPad }}>
        <div className="cc2-gallery-stage" style={{ height: stackH }}>
          {windowed.map(i => {
            const card = cards[i];
            const { ty, sc, op, rot, z } = peelFor(i, stackFront, peelConfig);
            const isConfirming = confirmIndex === card.index;

            return (
              <div
                key={`${card.index}-${card.title}`}
                ref={el => { if (el) cardRefs.current.set(i, el); else cardRefs.current.delete(i); }}
                className="cc2-gallery-cardwrap"
                style={{
                  top: topOffset, width: cardW, height: cardH,
                  transform: `translateX(-50%) translateY(${ty}px) scale(${sc}) rotate(${rot}deg)`,
                  opacity: op, zIndex: z,
                  '--rk': card.kind === 'income' ? 'var(--cc2-income)' : 'var(--cc2-expense)',
                  '--card-scale': cardScale,
                } as React.CSSProperties}
              >
                <div className="cc2-ri-clean-card">
                  <div className="cc2-ri-clean-top">
                    <div className="cc2-ri-clean-kind">
                      <span className="cc2-ri-clean-dot" />
                      <span className="cc2-ri-clean-kind-label">{card.kind === 'income' ? 'Income' : 'Expense'}</span>
                    </div>
                    <div className="cc2-ri-clean-actions">
                      <button type="button" className="cc2-flush-btn cc2-ri-clean-icon-btn" title="Edit" onClick={() => onEdit(items[card.index], card.index)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      </button>
                      {isConfirming ? (
                        <>
                          <button type="button" className="cc2-flush-btn cc2-ri-clean-icon-btn" title="Confirm remove" onClick={() => onConfirmRemove(card.index)}>✓</button>
                          <button type="button" className="cc2-flush-btn cc2-ri-clean-icon-btn" title="Cancel" onClick={onCancelConfirm}>✕</button>
                        </>
                      ) : (
                        <button type="button" className="cc2-flush-btn cc2-ri-clean-icon-btn" title="Remove" onClick={() => onRequestConfirm(card.index)}>×</button>
                      )}
                    </div>
                  </div>

                  <div className="cc2-ri-clean-title">{card.title}</div>
                  <div className="cc2-ri-clean-amount">{card.amount}</div>
                  <div className="cc2-ri-clean-meta">
                    <span style={{ color: categoryColor(card.category, card.kind) }}>{card.category}</span>
                    <span className="cc2-ri-clean-meta-dot" />
                    <span>{card.schedule}</span>
                  </div>

                  <div className="cc2-ri-clean-spacer" />

                  {showFooter && (
                    <div className="cc2-ri-clean-footer">
                      <div>
                        <div className="cc2-ri-clean-next-label">Next</div>
                        <div className="cc2-ri-clean-next-date">{card.nextDate}</div>
                      </div>
                      <div className="cc2-ri-clean-days">
                        <span className="cc2-ri-clean-days-num">{card.daysNum}</span>
                        <span className="cc2-ri-clean-days-word">{card.daysWord}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
