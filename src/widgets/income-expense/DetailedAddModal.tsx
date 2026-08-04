import { todayISO as todayStr } from '../../core/dates';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { App } from 'obsidian';
import { ledgerSource } from '../../data-sources/budget';
import { lineTableCodec } from '../../core';
import { EXPENSE_CATEGORY_NAMES, INCOME_CATEGORY_NAMES } from '../../data-sources/budget-categories';
import { receiptKey, saveReceiptDetail, type ReceiptItem } from '../../data-sources/receipts';


interface Props {
  app:        App;
  budgetName: string;
  onClose:    () => void;
  onSaved:    (kind: 'income' | 'expense') => void;
}

// Structured, AI-free entry form — reuses the same .cc2-modal-backdrop/.cc2-modal
// classes as WidgetSetupModal/RecipeImportModal (same portal token bridge).
// Category here is an explicit user pick, bypassing guessCategory entirely —
// this is the "force yourself to categorize" path the quick-entry box skips.
//
// Vendor/notes/items are optional and saved separately via receipts.ts, not
// appended to the ledger line — see that file's header comment for why.
export function DetailedAddModal({ app, budgetName, onClose, onSaved }: Props) {
  const [kind,        setKind]        = useState<'income' | 'expense'>('expense');
  const [amount,      setAmount]      = useState('');
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState('');
  const [date,        setDate]        = useState(todayStr);
  const [vendor,      setVendor]      = useState('');
  const [notes,       setNotes]       = useState('');
  const [items,       setItems]       = useState<ReceiptItem[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  const categoryNames = kind === 'expense' ? EXPENSE_CATEGORY_NAMES : INCOME_CATEGORY_NAMES;

  useEffect(() => { amountRef.current?.focus(); }, []);
  useEffect(() => { setCategory(categoryNames[0]); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addItemRow = () => setItems(prev => [...prev, { name: '', price: 0 }]);
  const updateItemRow = (i: number, patch: Partial<ReceiptItem>) =>
    setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const removeItemRow = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    if (saving) return;

    setSaving(true);
    setError('');
    try {
      const dateArg = date !== todayStr() ? date : undefined;
      // appendEntry returns the date/time it actually wrote — receiptKey must
      // key off exactly that, not a recomputed "now" that could differ by a tick.
      const written = await lineTableCodec.appendEntry(app, ledgerSource(app, budgetName), {
        kind, amount: amt, description: description.trim(), category, date: dateArg,
      });

      const cleanItems = items
        .filter(it => it.name.trim() && it.price > 0)
        .map(it => ({ name: it.name.trim(), price: it.price }));
      const key = receiptKey(written.date, written.time, amt, description.trim());
      await saveReceiptDetail(app, budgetName, key, {
        vendor: vendor.trim() || undefined,
        notes: notes.trim() || undefined,
        items: cleanItems.length > 0 ? cleanItems : undefined,
      });

      onSaved(kind);
    } catch (e) {
      console.error('[CC2] DetailedAddModal save:', e);
      setError('Could not save that entry — see console.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">Detail Add</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Kind</span>
            <div className="cc2-iet-kind-toggle">
              <button
                type="button"
                className={`cc2-iet-kind-btn${kind === 'expense' ? ' active expense' : ''}`}
                onClick={() => setKind('expense')}
              >
                Expense
              </button>
              <button
                type="button"
                className={`cc2-iet-kind-btn${kind === 'income' ? ' active income' : ''}`}
                onClick={() => setKind('income')}
              >
                Income
              </button>
            </div>
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Amount</span>
            <input
              ref={amountRef}
              type="number"
              min="0"
              step="0.01"
              className="cc2-setup-input"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Description</span>
            <input
              type="text"
              className="cc2-setup-input"
              placeholder="e.g. Coffee, Paycheque…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            />
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Category</span>
            <select className="cc2-setup-select" value={category} onChange={e => setCategory(e.target.value)}>
              {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Date</span>
            <input
              type="date"
              className="cc2-setup-input"
              value={date}
              onChange={e => setDate(e.target.value || todayStr())}
            />
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Vendor <span className="cc2-setup-optional">(optional)</span></span>
            <input
              type="text"
              className="cc2-setup-input"
              placeholder="e.g. Whole Foods Market"
              value={vendor}
              onChange={e => setVendor(e.target.value)}
            />
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Items <span className="cc2-setup-optional">(optional)</span></span>
            <div className="cc2-iet-item-rows">
              {items.map((it, i) => (
                <div key={i} className="cc2-iet-item-row">
                  <input
                    type="text"
                    className="cc2-setup-input"
                    placeholder="Item name"
                    value={it.name}
                    onChange={e => updateItemRow(i, { name: e.target.value })}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="cc2-setup-input cc2-iet-item-price"
                    placeholder="0.00"
                    value={it.price || ''}
                    onChange={e => updateItemRow(i, { price: parseFloat(e.target.value) || 0 })}
                  />
                  <button type="button" className="cc2-flush-btn cc2-iet-item-remove" onClick={() => removeItemRow(i)} title="Remove item">×</button>
                </div>
              ))}
              <button type="button" className="cc2-flush-btn cc2-iet-item-add" onClick={addItemRow}>+ Add item</button>
            </div>
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Notes <span className="cc2-setup-optional">(optional)</span></span>
            <textarea
              className="cc2-setup-input cc2-iet-notes-input"
              rows={2}
              placeholder="Anything worth remembering about this one…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {error && <p className="cc2-setup-hint" style={{ color: 'var(--cc2-expense)' }}>{error}</p>}
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Entry →'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
