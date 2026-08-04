import React, { useState, useLayoutEffect, useEffect, useCallback, useRef, useMemo } from 'react';
import type { App } from 'obsidian';
import { loadReceipts, receiptKey, watchReceiptsFile, type ReceiptDetail } from '../../data-sources/receipts';
import { useBudgetRecentMonthsEntries } from '../../data-sources/budgetStore';
import { categoryColor } from '../../data-sources/budget';
import { peelFor } from '../shared/peel-stack';
import type { PeelConfig } from '../shared/peel-stack';

const CAP = 3, SCALE_STEP = 0.055;
const ITEMS_CAP = 4;

function fmt$(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ReceiptCard = {
  key: string;
  kind: 'income' | 'expense';
  title: string;
  vendor?: string;
  date: string;
  category: string;
  amount: string;
  totalWord: string;
  notes?: string;
  items: { name: string; price: string }[];
};

// Receipt peel-stack for Income & Expense Tracker's Gallery view. Mirrors
// RecipeBoxWidget's ResizeObserver + scroll-driven peel pattern exactly —
// same shared peelFor() from shared/peel-stack.ts, same "mutate mounted
// cards' transform via refs on scroll, only push the mount window through
// React state" technique. See design_handoff_multiview_widgets/README.md
// for the full visual spec this was ported from.
export function IncomeExpenseGallery({ app, budgetName }: { app: App; budgetName: string }) {
  const entries = useBudgetRecentMonthsEntries(app, budgetName);
  const [receipts, setReceipts] = useState<Record<string, ReceiptDetail>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [stackFront, setStackFront] = useState(0);

  const stackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const loadReceiptData = useCallback(() => {
    if (!budgetName) return;
    loadReceipts(app, budgetName).then(setReceipts).catch(console.error);
  }, [app, budgetName]);

  useEffect(() => {
    if (!budgetName) return;
    loadReceiptData();
    return watchReceiptsFile(app, budgetName, loadReceiptData);
  }, [app, budgetName, loadReceiptData]);

  // Measured synchronously (useLayoutEffect, before paint) rather than
  // starting from a guessed default — a stale default rendered even for one
  // frame produced a card sized for a much bigger box than the real one at
  // small widget sizes, reading as "cards not shrinking / overflowing".
  const [stackSize, setStackSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setStackSize({ w: rect.width, h: rect.height });
    const ro = new ResizeObserver(obsEntries => {
      const { width, height } = obsEntries[0].contentRect;
      if (width > 0 && height > 0) setStackSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ratios adapted from design_handoff_multiview_widgets's geoFor('iet') —
  // cardH brought down from the prototype's 0.905 (way too tall for an entry
  // with no items/notes, all dead space in the middle) and top/front aligned
  // with the Recurring gallery's so both stacks start at the same height
  // instead of one sitting ~20-30px lower than the other.
  const REFERENCE_W = 360;
  const stackW     = stackSize?.w ?? 0;
  const stackH     = stackSize?.h ?? 0;
  const cardW      = Math.min(Math.round(stackW * 0.9), REFERENCE_W);
  const cardH      = Math.round(stackH * 0.74);
  const topOffset  = Math.round(stackH * 0.02);
  const front      = Math.round(stackH * 0.08);
  const peek       = front / CAP;
  const cardStep   = Math.round(cardH * 0.64);
  // Scales card-internal font/padding down together as the widget shrinks
  // (e.g. toward 4x4), rather than the outer box shrinking while fixed-px
  // text/padding inside stays the same size and starts overflowing/cramping.
  const cardScale = Math.max(0.6, Math.min(1, cardW / REFERENCE_W));
  const trackPad   = Math.round(stackH * 0.38);
  const peelConfig: PeelConfig = useMemo(
    () => ({ peek, scaleStep: SCALE_STEP, cap: CAP, front }),
    [peek, front],
  );

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)),
    [entries],
  );

  const cards: ReceiptCard[] = useMemo(() => sorted.map(e => {
    const key = receiptKey(e.date, e.time, e.amount, e.description);
    const detail = receipts[key];
    const items = (detail?.items ?? []).map(it => ({ name: it.name, price: fmt$(it.price) }));
    return {
      key,
      kind: e.kind,
      title: e.description,
      vendor: detail?.vendor,
      date: e.date,
      category: e.category,
      amount: (e.kind === 'income' ? '+' : '−') + fmt$(e.amount),
      totalWord: e.kind === 'income' ? 'Received' : 'Paid',
      notes: detail?.notes,
      items,
    };
  }), [sorted, receipts]);

  useEffect(() => { setStackFront(0); if (stackRef.current) stackRef.current.scrollTop = 0; }, [budgetName]);

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
      {n === 0 && <div className="cc2-gallery-empty">Your income and expenses appear here</div>}
      {n > 0 && stackSize && (
      <div className="cc2-gallery-track" style={{ height: Math.max(1, n) * cardStep + trackPad }}>
        <div className="cc2-gallery-stage" style={{ height: stackH }}>
          {windowed.map(i => {
            const card = cards[i];
            const { ty, sc, op, rot, z } = peelFor(i, stackFront, peelConfig);
            const isExpanded = !!expanded[card.key];
            const over = card.items.length > ITEMS_CAP;
            const visibleItems = over && !isExpanded ? card.items.slice(0, ITEMS_CAP) : card.items;
            const hasItems = card.items.length > 0;

            return (
              <div
                key={card.key}
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
                <div className="cc2-receipt-card" style={{ '--rmask': `linear-gradient(#000 0 0) top/100% calc(100% - ${8 * cardScale}px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom/${16 * cardScale}px ${8 * cardScale}px repeat-x` } as React.CSSProperties}>
                  <div className="cc2-receipt-speckle" />
                  <div className="cc2-receipt-inner">
                    <div className="cc2-receipt-header">
                      <div className="cc2-receipt-kind-row">
                        <span className="cc2-receipt-dot" />
                        <span className="cc2-receipt-kind-label">{card.kind === 'income' ? 'Income' : 'Expense'}</span>
                      </div>
                      <div className="cc2-receipt-title">{card.title}</div>
                      {card.vendor && <div className="cc2-receipt-vendor">{card.vendor}</div>}
                    </div>

                    <div className="cc2-receipt-rule" />
                    <div className="cc2-receipt-meta">
                      <span>{card.date}</span>
                      <span style={{ color: categoryColor(card.category, card.kind) }}>{card.category}</span>
                    </div>

                    {hasItems && (
                      <>
                        <div className={`cc2-receipt-items${isExpanded ? ' expanded' : ''}`}>
                          {visibleItems.map((it, idx) => (
                            <div key={idx} className="cc2-receipt-item-row">
                              <span className="cc2-receipt-item-name">{it.name}</span>
                              <span className="cc2-receipt-item-price">{it.price}</span>
                            </div>
                          ))}
                        </div>
                        {over && (
                          <button
                            type="button"
                            className="cc2-flush-btn cc2-receipt-toggle"
                            onClick={() => setExpanded(prev => ({ ...prev, [card.key]: !prev[card.key] }))}
                          >
                            <span className="cc2-receipt-toggle-dots">•••</span>
                            <span>{isExpanded ? 'Show less' : `${card.items.length - ITEMS_CAP} more items`}</span>
                          </button>
                        )}
                      </>
                    )}
                    {!hasItems && card.notes && <div className="cc2-receipt-notes">{card.notes}</div>}

                    <div className="cc2-receipt-spacer" />

                    <div className="cc2-receipt-total-rule" />
                    <div className="cc2-receipt-total-row">
                      <span className="cc2-receipt-total-label">Total {card.totalWord}</span>
                      <span className="cc2-receipt-total-amount">{card.amount}</span>
                    </div>
                    {hasItems && card.notes && <div className="cc2-receipt-notes-footer">{card.notes}</div>}
                  </div>
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
