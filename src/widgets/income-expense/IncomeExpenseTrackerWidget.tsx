import { todayISO as todayStr } from '../../core/dates';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { WidgetProps } from '../registry';
import { ledgerSource, parseQuickAmount, categoryColor } from '../../data-sources/budget';
import { lineTableCodec } from '../../core';
import { useBudgetRecentEntries } from '../../data-sources/budgetStore';
import { guessCategory } from '../../data-sources/budget-categories';
import { assetUrl } from '../../ai/asset-utils';
import { useAI } from '../../ai/AIContext';
import { useIsDark } from '../../ai/AIPanel';
import { BrandMark } from '../../ai/BrandMark';
import { DetailedAddModal } from './DetailedAddModal';
import { BudgetCleanupModal } from './BudgetCleanupModal';
import { IncomeExpenseGallery } from './IncomeExpenseGallery';
import { ViewToggle, useViewMode } from '../shared/ViewToggle';

/** Returns today as "YYYY-MM-DD" in local time. */

function BurningMoneyGif() {
  return <img className="cc2-iet-burn-gif" src={assetUrl('burning_money.gif')} alt="" />;
}

function CoinDropDiv() {
  // background-image set inline (not in CSS) — the sprite sheet is a real
  // asset file loaded via resourcePath, not a base64 string baked into
  // styles.css (see DESIGN_SYSTEM.md's asset-loading note).
  return <div className="cc2-iet-coin-drop" style={{ backgroundImage: `url(${assetUrl('coin-drop.png')})` }} />;
}

export function IncomeExpenseTrackerWidget({ app, config }: WidgetProps) {
  const budgetName = (config?.budgetName as string | undefined) ?? '';

  const [input,        setInput]        = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [animKey,      setAnimKey]      = useState(0);
  const [animActive,   setAnimActive]   = useState<'income' | 'expense' | null>(null);
  const [error,        setError]        = useState('');
  const [showDetail,   setShowDetail]   = useState(false);
  const [showCleanup,  setShowCleanup]  = useState(false);

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { settings } = useAI();
  const isDark = useIsDark();
  const canUseAI = settings.activeProvider === 'claude' && settings.claudeAuthMode === 'cli';
  const [view, setView] = useViewMode(`cc2-iet-view-${budgetName}`);

  const recent = useBudgetRecentEntries(app, budgetName);

  // Plug-and-play scaffolding: the codec creates the index + current-year
  // ledger if they're missing, and no-ops when they're not.
  useEffect(() => {
    if (!budgetName) return;
    void lineTableCodec.ensure(app, ledgerSource(app, budgetName));
  }, [app, budgetName]);

  const playAnim = useCallback((kind: 'income' | 'expense') => {
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    setAnimKey(k => k + 1);
    setAnimActive(kind);
    animTimerRef.current = setTimeout(() => setAnimActive(null), 1500);
  }, []);

  useEffect(() => () => { if (animTimerRef.current) clearTimeout(animTimerRef.current); }, []);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || submitting || !budgetName) return;

    const parsed = parseQuickAmount(text);
    if (!parsed) { setError('No amount found — include a number, e.g. "-20 Coffee" or "1000 Paycheque".'); return; }

    setSubmitting(true);
    setError('');
    try {
      const dateArg = selectedDate !== todayStr() ? selectedDate : undefined;
      const category = guessCategory(parsed.description, parsed.kind);
      await lineTableCodec.appendEntry(app, ledgerSource(app, budgetName), {
        kind: parsed.kind, amount: parsed.amount, description: parsed.description, category, date: dateArg,
      });
      setInput('');
      setSelectedDate(todayStr());
      playAnim(parsed.kind);
    } catch (e) {
      console.error('[CC2] appendEntry:', e);
      setError('Could not save that entry — see console.');
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [app, budgetName, input, submitting, selectedDate, playAnim]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
  };

  const today = todayStr();

  if (!budgetName) {
    return (
      <div className="cc2-iet-root">
        <div className="cc2-iet-empty">This Income &amp; Expense Tracker has no budget configured yet.</div>
      </div>
    );
  }

  return (
    <div className="cc2-iet-root">
      {animActive && (
        animActive === 'expense'
          ? <BurningMoneyGif key={animKey} />
          : <CoinDropDiv key={animKey} />
      )}

      <div className="cc2-iet-toolbar">
        <span className="cc2-iet-title">Income &amp; Expense Tracker</span>
        <div className="cc2-iet-toolbar-btns">
          <button
            type="button"
            className="cc2-flush-btn cc2-iet-detail-btn"
            title="Add a structured entry — no AI, explicit category"
            onClick={() => setShowDetail(true)}
          >
            <span className="cc2-iet-btn-full">Detail Add</span>
            <span className="cc2-iet-btn-compact">+</span>
          </button>
          <button
            type="button"
            className="cc2-flush-btn cc2-iet-ai-btn"
            title={canUseAI ? 'Clean up your budget with AI' : `Requires Claude CLI mode (currently ${settings.activeProvider})`}
            disabled={!canUseAI}
            onClick={() => setShowCleanup(true)}
          >
            <BrandMark provider={settings.activeProvider} size={14} isDark={isDark} />
            <span className="cc2-iet-btn-full">Clean up with AI</span>
          </button>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === 'gallery' && <IncomeExpenseGallery app={app} budgetName={budgetName} />}

      {view === 'list' && (
        <>
          <div className="cc2-iet-entry">
            <div className="cc2-iet-input-wrap">
              <textarea
                ref={textareaRef}
                className="cc2-iet-textarea"
                placeholder='-$5 Coffee, or 1000 Paycheque… (Enter to save, Shift+Enter for a new line)'
                value={input}
                onChange={e => { setInput(e.target.value); if (error) setError(''); }}
                onKeyDown={handleKeyDown}
                rows={2}
                disabled={submitting}
              />
              <div className="cc2-iet-input-controls">
                <button
                  type="button"
                  className="cc2-iet-submit"
                  onClick={() => void submit()}
                  disabled={!input.trim() || submitting}
                  title="Save (Enter)"
                >
                  {submitting ? '…' : '↵'}
                </button>
              </div>
            </div>

            <div className="cc2-iet-below-row">
              {error
                ? <div className="cc2-iet-error">{error}</div>
                : <div className="cc2-iet-hint">Use "-" for expenses, e.g. "-$5 Coffee" or "1000 Paycheque"</div>}
              <div className="cc2-iet-date-group">
                {selectedDate !== today && (
                  <button type="button" className="cc2-flush-btn" onClick={() => setSelectedDate(today)} title="Reset to today">×</button>
                )}
                <input
                  type="date"
                  className="cc2-iet-date-input"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value || today)}
                  title={selectedDate !== today ? `Backdated to ${selectedDate}` : 'Date — click to backdate'}
                />
              </div>
            </div>
          </div>

          {recent.length > 0 && (
            <div className="cc2-iet-recent">
              {recent.map((e, i) => (
                <div key={i} className="cc2-iet-row">
                  <span className={`cc2-iet-row-date ${e.kind}`}>
                    {/* "00:00" means no real time was captured (AI-added recurring
                        items, reconciled statement lines) — show the date instead
                        even when it's today, rather than a misleading midnight. */}
                    {e.date !== today || e.ts === '00:00' ? e.date.slice(5) : e.ts}
                  </span>
                  <span className="cc2-iet-row-text">{e.text}</span>
                  <span className="cc2-iet-row-category" style={{ color: categoryColor(e.category, e.kind) }}>{e.category}</span>
                </div>
              ))}
            </div>
          )}
          {recent.length === 0 && (
            <div className="cc2-iet-empty">Your income and expenses appear here</div>
          )}
        </>
      )}

      {showDetail && (
        <DetailedAddModal
          app={app}
          budgetName={budgetName}
          onClose={() => setShowDetail(false)}
          onSaved={kind => { setShowDetail(false); playAnim(kind); }}
        />
      )}

      {showCleanup && (
        <BudgetCleanupModal
          app={app}
          budgetName={budgetName}
          onClose={() => setShowCleanup(false)}
        />
      )}
    </div>
  );
}
