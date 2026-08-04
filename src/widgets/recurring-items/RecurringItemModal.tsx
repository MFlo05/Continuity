import { todayISO as todayStr } from '../../core/dates';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ordinal, parseSchedule as parseScheduleShared,
  type RecurringItem,
} from '../../data-sources/recurring';
import { EXPENSE_CATEGORY_NAMES, INCOME_CATEGORY_NAMES } from '../../data-sources/budget-categories';


type ScheduleMode = 'monthly' | 'everyN' | 'custom';

/** Adapts recurring.ts's shared ParsedSchedule shape into this form's flat
 * local shape (mode/day/interval/startDate/custom) — same reverse-parsing
 * logic recurring.ts's nextOccurrence() uses, just one shared source of truth. */
function parseSchedule(raw: string): { mode: ScheduleMode; day: number; interval: number; startDate: string; custom: string } {
  const parsed = parseScheduleShared(raw);
  if (parsed.mode === 'monthly') return { mode: 'monthly', day: parsed.day, interval: 1, startDate: todayStr(), custom: raw };
  if (parsed.mode === 'everyN') return { mode: 'everyN', day: 1, interval: parsed.interval, startDate: parsed.startDate, custom: raw };
  return { mode: 'custom', day: 1, interval: 1, startDate: todayStr(), custom: raw };
}

interface Props {
  existing?: RecurringItem;
  /**
   * Persisting is the widget's job, not this modal's — it owns the bound
   * `mutate` and therefore the row identity being written to. That's also what
   * keeps this component free of vault I/O, per the widget rules; it used to
   * call addRecurringItem/updateRecurringItem directly.
   */
  onSave:   (item: RecurringItem) => Promise<void>;
  onClose:  () => void;
  onSaved:  () => void;
}

export function RecurringItemModal({ existing, onSave, onClose, onSaved }: Props) {
  // Labels only — which row gets written is the caller's concern now.
  const isEdit = existing !== undefined;
  const initialSchedule = existing ? parseSchedule(existing.schedule) : parseSchedule('');

  const [section,     setSection]     = useState<'Income' | 'Expenses'>(existing?.section ?? 'Expenses');
  const [amount,      setAmount]      = useState(existing ? String(existing.amount) : '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [category,    setCategory]    = useState(existing?.category ?? '');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialSchedule.mode);
  const [day,          setDay]          = useState(initialSchedule.day);
  const [interval,     setInterval_]    = useState(initialSchedule.interval);
  const [startDate,    setStartDate]    = useState(initialSchedule.startDate);
  const [customText,   setCustomText]   = useState(initialSchedule.custom);

  const amountRef = useRef<HTMLInputElement>(null);
  const categoryNames = section === 'Expenses' ? EXPENSE_CATEGORY_NAMES : INCOME_CATEGORY_NAMES;

  useEffect(() => { amountRef.current?.focus(); }, []);
  useEffect(() => {
    if (!existing) setCategory(categoryNames[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const scheduleText = (): string => {
    if (scheduleMode === 'monthly') return `${ordinal(day)} of each month`;
    if (scheduleMode === 'everyN')  return `Every ${interval} days from ${startDate}`;
    return customText.trim();
  };

  const submit = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    const schedule = scheduleText();
    if (!schedule) { setError('Schedule is required.'); return; }
    if (saving) return;

    setSaving(true);
    setError('');
    const item: RecurringItem = { amount: amt, description: description.trim(), category, section, schedule };
    try {
      await onSave(item);
      onSaved();
    } catch (e) {
      console.error('[CC2] RecurringItemModal save:', e);
      setError('Could not save that item — see console.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onClose}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">{isEdit ? 'Edit Recurring Item' : 'Add Recurring Item'}</span>
          <button className="cc2-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Section</span>
            <div className="cc2-iet-kind-toggle">
              <button
                type="button"
                className={`cc2-iet-kind-btn${section === 'Expenses' ? ' active expense' : ''}`}
                onClick={() => setSection('Expenses')}
              >
                Expenses
              </button>
              <button
                type="button"
                className={`cc2-iet-kind-btn${section === 'Income' ? ' active income' : ''}`}
                onClick={() => setSection('Income')}
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
              placeholder="e.g. Mortgage, Rental Income…"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Category</span>
            <select className="cc2-setup-select" value={category} onChange={e => setCategory(e.target.value)}>
              {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="cc2-iet-form-row">
            <span className="cc2-iet-form-label">Schedule</span>
            <div className="cc2-iet-kind-toggle cc2-ri-schedule-toggle">
              <button type="button" className={`cc2-iet-kind-btn${scheduleMode === 'monthly' ? ' active' : ''}`} onClick={() => setScheduleMode('monthly')}>Monthly</button>
              <button type="button" className={`cc2-iet-kind-btn${scheduleMode === 'everyN' ? ' active' : ''}`} onClick={() => setScheduleMode('everyN')}>Every N days</button>
              <button type="button" className={`cc2-iet-kind-btn${scheduleMode === 'custom' ? ' active' : ''}`} onClick={() => setScheduleMode('custom')}>Custom</button>
            </div>
          </div>

          {scheduleMode === 'monthly' && (
            <div className="cc2-iet-form-row">
              <span className="cc2-iet-form-label">Day of month</span>
              <input
                type="number" min="1" max="31" className="cc2-setup-input"
                value={day} onChange={e => setDay(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              />
            </div>
          )}

          {scheduleMode === 'everyN' && (
            <>
              <div className="cc2-iet-form-row">
                <span className="cc2-iet-form-label">Every how many days</span>
                <input
                  type="number" min="1" className="cc2-setup-input"
                  value={interval} onChange={e => setInterval_(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
              <div className="cc2-iet-form-row">
                <span className="cc2-iet-form-label">Starting from</span>
                <input
                  type="date" className="cc2-setup-input"
                  value={startDate} onChange={e => setStartDate(e.target.value || todayStr())}
                />
              </div>
            </>
          )}

          {scheduleMode === 'custom' && (
            <div className="cc2-iet-form-row">
              <span className="cc2-iet-form-label">Schedule text</span>
              <input
                type="text" className="cc2-setup-input" placeholder="e.g. Twice a year"
                value={customText} onChange={e => setCustomText(e.target.value)}
              />
            </div>
          )}

          <p className="cc2-setup-hint">Will be saved as: <code>{scheduleText() || '…'}</code></p>

          {error && <p className="cc2-setup-hint" style={{ color: 'var(--cc2-expense)' }}>{error}</p>}
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onClose}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes →' : 'Add Item →'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
