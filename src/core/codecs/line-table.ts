import { TFile, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { Codec, CodecRow, FieldDef, RowId, SourceRef } from '../types';
import { sourceFolder, sourcePath } from '../types';
import { CodecError } from './checklist';
import { localISO, MONTHS } from '../dates';

/**
 * core/codecs/line-table.ts — the line-table codec.
 *
 * Structured lines as rows. Promoted from data-sources/budget.ts, whose format
 * is V1-Command-Center-compatible and **must not change** — existing vault
 * files and AI skills read this exact shape.
 *
 * ON-DISK — a ledger is a FOLDER, not a file:
 *
 *     Finance/Ledgers/Home-Ledger/
 *       1-Index-Home-Ledger.md      recurring items table + category legend
 *       2026-Home-Ledger.md         ← rows live here, newest month on top
 *
 *     ## June 2026
 *     ### Income
 *     - HH:MM | YYYY-MM-DD | $amount | description | category
 *     ### Expenses
 *     - HH:MM | YYYY-MM-DD | $amount | description | category
 *     ---
 *     ## May 2026
 *
 * This is the case the folder-shaped `line-table` SourceRef variant was added
 * for back in Phase 0: one source spanning N year files plus an index.
 *
 * WHAT THIS CODEC DOES NOT OWN — and deliberately so:
 *
 *   - **Caching.** data-sources/budgetStore.ts keeps that job. It ref-counts a
 *     parsed year across all six Finance widgets, so logging one entry
 *     re-parses the ledger ONCE. useVaultData dedupes vault *listeners* (via
 *     the shared hub) but not *parses* — every hook instance reads
 *     independently — so routing Finance through it would turn 1 parse into 6.
 *     The codec owns the format; the store owns the cache. Generalising that
 *     cache into core so budgetStore can be deleted is the proper follow-up.
 *   - **Summaries** (`getMonthSummary`, `getYearSummary`, `getRecentMonths`).
 *     Those are projections over rows, not disk concerns — they stay in
 *     budget.ts and work unchanged on `LedgerRow`.
 *   - **Category colour.** Presentation, and semantic to Finance.
 *
 * NEW CAPABILITY: rows carry stable ids, so entries can now be updated and
 * deleted individually. Previously the only mutation was append — editing a
 * logged entry meant hand-editing the markdown or asking the AI to rewrite it.
 */

export interface LedgerRow extends CodecRow {
  /** `<year>:<lineIndex>` — a folder source spans several year files, so the
   *  year is part of the identity, not just the line. */
  id:          RowId;
  time:        string;   // "HH:MM"
  date:        string;   // "YYYY-MM-DD"
  amount:      number;
  description: string;
  category:    string;
  kind:        'income' | 'expense';
  year:        number;
  raw?:        string;
}

export interface LineTableMeta {
  /** Years that actually have a ledger file on disk, descending. */
  years:  number[];
  /** The ledger's folder name, e.g. "Home-Ledger". */
  ledger: string;
}

const ENTRY_RE      = /^\s*-\s+(.+)$/;
const ENTRY_LINE_RE = /^(\s*-\s+)(.+)$/;

function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function monthYearLabel(dateStr: string): string {
  const yr = parseInt(dateStr.slice(0, 4));
  const mo = parseInt(dateStr.slice(5, 7)) - 1;
  return `${MONTHS[mo]} ${yr}`;
}

/** Strips a trailing "-Ledger" for display only; files always keep the suffix. */
function displayName(name: string): string {
  return name.replace(/-ledger$/i, '').trim() || name;
}

// ── Paths, derived from the source ────────────────────────────────────────
//
// A ledger source comes in two shapes, and both are legitimate:
//
//   { codec:'line-table', folder: '…/Home-Ledger' }            the whole ledger
//   { codec:'line-table', path:   '…/2026-Home-Ledger.md' }    ONE year
//
// The year-scoped file source is what the Finance widgets subscribe to, so the
// shared source cache keys per year and a widget showing 2026 doesn't force a
// re-read of every year on disk. The folder source stays for anything that
// genuinely wants the whole history.

/** The ledger's folder, whichever source shape was given. */
function ledgerFolder(src: SourceRef): string {
  const folder = sourceFolder(src);
  if (folder) return folder;
  const path = sourcePath(src) ?? '';
  return path.slice(0, path.lastIndexOf('/'));
}

/** The ledger's folder NAME, e.g. "Home-Ledger". */
function ledgerName(src: SourceRef): string {
  return ledgerFolder(src).split('/').filter(Boolean).pop() ?? '';
}

/** For a file source: the year encoded in `<YYYY>-<name>.md`. */
function sourceYear(src: SourceRef): number | null {
  const path = sourcePath(src);
  if (!path) return null;
  const m = /(\d{4})-[^/]*\.md$/.exec(path);
  return m ? parseInt(m[1]) : null;
}

function yearPath(src: SourceRef, year: number): string {
  return normalizePath(`${ledgerFolder(src)}/${year}-${ledgerName(src)}.md`);
}

function indexPath(src: SourceRef): string {
  return normalizePath(`${ledgerFolder(src)}/1-Index-${ledgerName(src)}.md`);
}

/**
 * Years with a `<YYYY>-<name>.md` file present, newest first. A file source
 * resolves to just its own year — it IS one year by definition.
 */
export function ledgerYears(app: App, src: SourceRef): number[] {
  const own = sourceYear(src);
  if (own !== null) return [own];

  const folder = app.vault.getAbstractFileByPath(ledgerFolder(src));
  if (!(folder instanceof TFolder)) return [];

  const suffix = `-${ledgerName(src)}`;
  const years: number[] = [];
  for (const child of folder.children) {
    if (!(child instanceof TFile) || child.extension !== 'md') continue;
    const m = new RegExp(`^(\\d{4})${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).exec(child.basename);
    if (m) years.push(parseInt(m[1]));
  }
  return years.sort((a, b) => b - a);
}

// ── Seeds — verbatim from budget.ts, format unchanged ─────────────────────

export const LEDGER_INDEX_TEMPLATE = [
  '# Ledger Hub',
  '',
  '> Command Center budget ledger — entries live in yearly files below.',
  '> Format: `- HH:MM | YYYY-MM-DD | $amount | description | category`',
  '',
  '## Recurring Items',
  '',
  '## Yearly Ledgers',
  '',
].join('\n');

function indexSeed(name: string): string {
  return [
    `# ${displayName(name)} Ledger Hub`,
    '',
    '> Command Center budget ledger — entries live in yearly files below.',
    '> Format: `- HH:MM | YYYY-MM-DD | $amount | description | category`',
    '>',
    '> **Income categories:** Salary, Freelance, Investment, Side Hustle, Gift, Rental Income, Other Income',
    '> **Expense categories:** Housing, Groceries, Transport, Utilities, Dining Out, Shopping, Savings/Inv, Entertainment, Subscriptions, Health, Hardware, Travel, Self Care, Other',
    '',
    '## Recurring Items',
    '> Edit this table to add recurring items (paychecks, bills, subscriptions). Ask your AI assistant to "process my budget entries" to auto-add any missing ones for the current month.',
    '',
    '| Amount | Description | Category | Section | Schedule |',
    '| --- | --- | --- | --- | --- |',
    '',
    '## Yearly Ledgers',
    '',
  ].join('\n');
}

function yearFileSeed(year: number, name: string): string {
  return [
    `# Ledger ${year}`,
    '',
    "> Yearly ledger — newest month on top. Append new entries at the bottom of the current month's section.",
    '> Format: `- HH:MM | YYYY-MM-DD | $amount | description | category`',
    `> Recurring items table lives in [[1-Index-${name}|Budget Hub]].`,
    '',
    '---',
    '',
  ].join('\n');
}

// ── Parser — moved verbatim from budget.ts's parseBudgetContent ───────────

/**
 * Rows for one year file. Kind comes from the enclosing `### Income` /
 * `### Expenses` heading; any `##` or `---` closes the current section, which
 * is what stops a month header from leaking rows into the wrong kind.
 */
export function parseLedgerYear(content: string, year: number): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let kind: 'income' | 'expense' | null = null;

  content.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();

    if (/^###\s+income/i.test(trimmed))  { kind = 'income';  return; }
    if (/^###\s+expense/i.test(trimmed)) { kind = 'expense'; return; }
    if (/^##/.test(trimmed) || trimmed === '---') { kind = null; return; }
    if (!kind) return;

    const m = trimmed.match(ENTRY_RE);
    if (!m) return;

    const parts = m[1].split(/\s*\|\s*/);
    if (parts.length < 4) return;

    const [time, date, amountRaw, description, category = 'Uncategorized'] = parts;
    if (!date) return;

    rows.push({
      id:          `${year}:${index}`,
      time:        (time ?? '00:00').trim(),
      date:        date.trim(),
      amount:      parseAmount(amountRaw),
      description: description.trim(),
      category:    category.trim(),
      kind,
      year,
      raw,
    });
  });

  return rows;
}

function serializeRow(row: Pick<LedgerRow, 'time' | 'date' | 'amount' | 'description' | 'category'>): string {
  const amountStr = `$${(row.amount > 0 ? row.amount : 0).toFixed(2)}`;
  return `- ${row.time} | ${row.date} | ${amountStr} | ${row.description} | ${row.category}`;
}

/**
 * Insert `line` into the correct `## <Month Year>` → `### Income|Expenses`
 * subsection, creating either if absent. Moved verbatim from budget.ts —
 * this is the part that keeps the on-disk shape V1-compatible.
 */
function insertLedgerLine(lines: string[], h2: string, h3: string, line: string): string[] {
  const out = [...lines];

  let monthIdx = out.findIndex(l => l.trim() === h2);

  if (monthIdx < 0) {
    const firstSep = out.findIndex(l => l.trim() === '---');
    const insertPos = firstSep >= 0 ? firstSep + 1 : 0;
    const block = ['', h2, '', '### Income', '', '### Expenses', '', '---'];
    out.splice(insertPos, 0, ...block);
    monthIdx = insertPos + 1;
  }

  let monthEnd = out.length;
  for (let i = monthIdx + 1; i < out.length; i++) {
    const t = out[i].trim();
    if (t === '---' || /^##[^#]/.test(t)) { monthEnd = i; break; }
  }

  const subRe = h3 === '### Income' ? /^###\s+income/i : /^###\s+expense/i;
  let subIdx = -1;
  for (let i = monthIdx + 1; i < monthEnd; i++) {
    if (subRe.test(out[i].trim())) { subIdx = i; break; }
  }

  if (subIdx < 0) {
    out.splice(monthEnd, 0, h3, '');
    subIdx = monthEnd;
    monthEnd = monthEnd + 2;
  }

  let subEnd = monthEnd;
  for (let i = subIdx + 1; i < monthEnd; i++) {
    if (/^###/.test(out[i].trim())) { subEnd = i; break; }
  }

  let insertAt = subIdx + 1;
  for (let i = subIdx + 1; i < subEnd; i++) {
    if (/^\s*-\s/.test(out[i])) insertAt = i + 1;
  }

  out.splice(insertAt, 0, line);
  return out;
}

// ── Vault plumbing ────────────────────────────────────────────────────────

async function ensureFile(app: App, path: string, seed: string): Promise<TFile> {
  const np = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(np);
  if (existing instanceof TFile) return existing;

  const folder = np.substring(0, np.lastIndexOf('/'));
  if (folder && !(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
    await app.vault.createFolder(folder).catch(() => {});
  }

  return app.vault.create(np, seed).catch(async () => {
    const retry = app.vault.getAbstractFileByPath(np);
    if (retry instanceof TFile) return retry;
    throw new CodecError(`Cannot create ${np}`);
  });
}

/** Edits one year file in place: parse, rewrite lines, save. */
async function editYear(
  app: App,
  src: SourceRef,
  year: number,
  fn: (lines: string[], rows: LedgerRow[]) => string[] | null,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(yearPath(src, year));
  if (!(file instanceof TFile)) return;

  await app.vault.process(file, content => {
    const lines = content.split(/\r?\n/);
    const next = fn(lines, parseLedgerYear(content, year));
    return next ? next.join('\n') : content;
  });
}

function splitId(id: RowId): { year: number; index: number } | null {
  const m = /^(\d{4}):(\d+)$/.exec(id);
  return m ? { year: parseInt(m[1]), index: parseInt(m[2]) } : null;
}

// ── The codec ─────────────────────────────────────────────────────────────

export interface LineTableCodec extends Codec<LedgerRow> {
  readMeta(app: App, src: SourceRef): Promise<LineTableMeta>;

  /**
   * Rows for ONE year file. This is what budgetStore caches against — the
   * generic `read()` spans every year in the folder, which is more than any
   * Finance widget needs and would defeat the store's per-year granularity.
   */
  readYear(app: App, src: SourceRef, year: number): Promise<LedgerRow[]>;

  /**
   * Append an entry, creating the month section and/or the year file if
   * needed. Returns the date/time actually written, so a caller keying a
   * side-store off it (receipts.ts) doesn't have to recompute "now" and risk
   * disagreeing by a tick. Separate from the generic `add()` because that
   * contract returns void.
   */
  appendEntry(
    app: App, src: SourceRef,
    entry: { kind: 'income' | 'expense'; amount: number; description: string; category: string; date?: string },
  ): Promise<{ date: string; time: string }>;
}

export const lineTableCodec: LineTableCodec = {
  id:    'line-table',
  label: 'Ledger',

  async read(app: App, src: SourceRef, _schema: FieldDef[]): Promise<LedgerRow[]> {
    const out: LedgerRow[] = [];
    for (const year of ledgerYears(app, src)) {
      out.push(...await this.readYear(app, src, year));
    }
    return out;
  },

  async readYear(app: App, src: SourceRef, year: number): Promise<LedgerRow[]> {
    // A file source is already year-scoped; read it directly rather than
    // rebuilding a path from a folder it doesn't have.
    const path = sourcePath(src) ?? yearPath(src, year);
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    return parseLedgerYear(await app.vault.cachedRead(file), year);
  },

  async readMeta(app: App, src: SourceRef): Promise<LineTableMeta> {
    return { years: ledgerYears(app, src), ledger: ledgerName(src) };
  },

  /** Index file + the current year's ledger, both only if missing. */
  async ensure(app: App, src: SourceRef): Promise<void> {
    const name = ledgerName(src);
    if (!name) return;
    const year = new Date().getFullYear();
    await ensureFile(app, indexPath(src), indexSeed(name));
    await ensureFile(app, yearPath(src, year), yearFileSeed(year, name));
  },

  async add(app: App, src: SourceRef, row: Partial<LedgerRow>): Promise<void> {
    await this.appendEntry(app, src, {
      kind:        row.kind ?? 'expense',
      amount:      row.amount ?? 0,
      description: row.description ?? '',
      category:    row.category ?? 'Uncategorized',
      date:        typeof row.date === 'string' ? row.date : undefined,
    });
  },

  async appendEntry(app, src, entry): Promise<{ date: string; time: string }> {
    const name = ledgerName(src);
    if (!name) throw new CodecError('No ledger configured.');

    const now     = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateStr = entry.date ?? localISO(now);

    const line = serializeRow({
      time: timeStr, date: dateStr,
      amount: entry.amount, description: entry.description, category: entry.category,
    });
    const year = parseInt(dateStr.slice(0, 4));
    const h2   = `## ${monthYearLabel(dateStr)}`;
    const h3   = entry.kind === 'income' ? '### Income' : '### Expenses';

    // ensureFile, not editYear: appending to a year that has no file yet is
    // the normal path every January.
    const file    = await ensureFile(app, yearPath(src, year), yearFileSeed(year, name));
    const content = await app.vault.read(file);
    await app.vault.modify(file, insertLedgerLine(content.split(/\r?\n/), h2, h3, line).join('\n'));

    return { date: dateStr, time: timeStr };
  },

  /**
   * Edit an entry in place. New capability — the ledger previously only
   * supported append, so correcting a logged entry meant hand-editing the
   * markdown. Kind is NOT patchable: it's encoded by which `###` section the
   * line sits under, so changing it is a move, not an edit.
   */
  async update(app: App, src: SourceRef, id: RowId, patch: Partial<LedgerRow>): Promise<void> {
    const at = splitId(id);
    if (!at) return;

    await editYear(app, src, at.year, (lines, rows) => {
      const row = rows.find(r => r.id === id);
      if (!row) return null;                        // moved underneath us
      if (patch.raw !== undefined && row.raw !== patch.raw) return null;

      const m = ENTRY_LINE_RE.exec(lines[at.index]);
      if (!m) return null;

      const next = [...lines];
      next[at.index] = m[1] + serializeRow({
        time:        patch.time        ?? row.time,
        date:        patch.date        ?? row.date,
        amount:      patch.amount     ?? row.amount,
        description: patch.description ?? row.description,
        category:    patch.category    ?? row.category,
      }).replace(/^-\s+/, '');
      return next;
    });
  },

  async remove(app: App, src: SourceRef, id: RowId): Promise<void> {
    const at = splitId(id);
    if (!at) return;

    await editYear(app, src, at.year, (lines, rows) => {
      if (!rows.some(r => r.id === id)) return null;
      const next = [...lines];
      next.splice(at.index, 1);
      return next;
    });
  },

  /**
   * The year files, not the whole folder — the index file holds the recurring
   * items table and its own widget watches it separately, so waking every
   * Finance widget on an index edit would be noise.
   *
   * A file source watches only itself, including when that file doesn't exist
   * yet: 'create' matters as much as 'modify' here, since a brand-new ledger's
   * first year file is created, not modified.
   */
  watchTargets(app: App, src: SourceRef) {
    const own = sourcePath(src);
    if (own) return { paths: [own] };

    const years = ledgerYears(app, src);
    const current = new Date().getFullYear();
    if (!years.includes(current)) years.push(current);   // may not exist yet
    return { paths: years.map(y => yearPath(src, y)) };
  },
};
