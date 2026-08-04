import React, { useState, useCallback, useMemo } from 'react';
import type { WidgetProps } from '../registry';
import { useVaultData } from '../../core';
import type { MdTableRow } from '../../core';
import {
  recurringSource, toRecurringRows, recurringCells, formatAmount,
  type RecurringItem, type RecurringRow,
} from '../../data-sources/recurring';
import { categoryColor } from '../../data-sources/budget';
import { RecurringItemModal } from './RecurringItemModal';
import { RecurringItemsGallery } from './RecurringItemsGallery';
import { ViewToggle, useViewMode } from '../shared/ViewToggle';

type Row = { it: RecurringRow; i: number };

export function RecurringItemsWidget({ app, config }: WidgetProps) {
  const budgetName = (config?.budgetName as string | undefined) ?? '';

  const [modalState,   setModalState]   = useState<{ item?: RecurringRow } | null>(null);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [view, setView] = useViewMode(`cc2-ri-view-${budgetName}`);

  // Replaces the hand-written load + watchIndexFile pair this widget used to
  // own — one shared parse and one shared vault subscription, like every other
  // codec-backed widget.
  const source = useMemo(
    () => (budgetName ? recurringSource(app, budgetName) : null),
    [app, budgetName],
  );
  const { rows, loading, mutate } = useVaultData<MdTableRow>(app, source);
  const items = useMemo(() => toRecurringRows(rows), [rows]);

  /** Mutations address a row by ITS ID, never by position in the array. */
  const saveItem = useCallback(async (item: RecurringItem, existing?: RecurringRow) => {
    const cells = recurringCells(item);
    if (existing) await mutate.update(existing.id, { ...cells, raw: existing.raw } as Partial<MdTableRow>);
    else          await mutate.add(cells as Partial<MdTableRow>);
  }, [mutate]);

  if (!budgetName) {
    return (
      <div className="cc2-ri-root">
        <div className="cc2-ri-empty">This Recurring Items widget has no ledger configured yet.</div>
      </div>
    );
  }

  const tagged: Row[] = items.map((it, i) => ({ it, i }));
  const income   = tagged.filter(r => r.it.section === 'Income');
  const expenses = tagged.filter(r => r.it.section === 'Expenses');

  // The index is a position in THIS render's array — fine as a UI key. What
  // reaches the file is the row's own id, which is the whole point of the
  // codec layer: this used to splice the table by array index, so two
  // near-identical recurring items could delete the wrong one.
  const handleRemove = async (index: number) => {
    const target = items[index];
    setConfirmIndex(null);
    if (target) await mutate.remove(target.id);
  };

  const renderGroup = (label: string, rows: Row[]) => (
    <div className="cc2-ri-group">
      <div className="label cc2-ri-group-label">{label}</div>
      {rows.length === 0 && <div className="cc2-ri-empty-group">None yet</div>}
      {rows.map(({ it, i }) => (
        <div key={i} className="cc2-ri-row">
          <div className="cc2-ri-row-main">
            <span className="cc2-ri-row-desc">{it.description}</span>
            <span
              className="cc2-ri-row-category"
              style={{ color: categoryColor(it.category, it.section === 'Income' ? 'income' : 'expense') }}
            >
              {it.category}
            </span>
            <span className="cc2-ri-row-schedule">{it.schedule}</span>
          </div>
          <span className={`cc2-ri-row-amount ${it.section === 'Income' ? 'income' : 'expense'}`}>{formatAmount(it.amount)}</span>
          <div className="cc2-ri-row-actions">
            <button type="button" className="cc2-flush-btn cc2-ri-icon-btn" title="Edit" onClick={() => setModalState({ item: it })}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
            </button>
            {confirmIndex === i ? (
              <>
                <button type="button" className="cc2-flush-btn cc2-ri-icon-btn" title="Confirm remove" onClick={() => void handleRemove(i)}>✓</button>
                <button type="button" className="cc2-flush-btn cc2-ri-icon-btn" title="Cancel" onClick={() => setConfirmIndex(null)}>✕</button>
              </>
            ) : (
              <button type="button" className="cc2-flush-btn cc2-ri-icon-btn" title="Remove" onClick={() => setConfirmIndex(i)}>×</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="cc2-ri-root">
      <div className="cc2-ri-toolbar">
        <span className="cc2-ri-title">Recurring Items</span>
        <div className="cc2-iet-toolbar-btns">
          <button type="button" className="cc2-flush-btn cc2-ri-add-btn" onClick={() => setModalState({})}>+ Add</button>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === 'gallery' && (
        <RecurringItemsGallery
          items={items}
          confirmIndex={confirmIndex}
          onEdit={(_item, index) => setModalState({ item: items[index] })}
          onRequestConfirm={setConfirmIndex}
          onConfirmRemove={i => void handleRemove(i)}
          onCancelConfirm={() => setConfirmIndex(null)}
        />
      )}

      {view === 'list' && (
        <div className="cc2-ri-list">
          {loading
            ? <div className="cc2-ri-empty">Loading…</div>
            : (
              <>
                {renderGroup('Income', income)}
                {renderGroup('Expenses', expenses)}
              </>
            )}
        </div>
      )}

      {modalState && (
        <RecurringItemModal
          existing={modalState.item}
          onSave={item => saveItem(item, modalState.item)}
          onClose={() => setModalState(null)}
          onSaved={() => setModalState(null)}
        />
      )}
    </div>
  );
}
