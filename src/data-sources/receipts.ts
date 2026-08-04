/**
 * receipts.ts — optional per-entry detail (vendor, notes, itemized line
 * items) for the Income & Expense Tracker's receipt Gallery view.
 *
 * Deliberately NOT stored in the ledger line itself. The ledger format
 * (`- HH:MM | YYYY-MM-DD | $amount | description | category`) is read by
 * `command-center/Skills/budget-capture.md` and `budget-reconciliation.md`, and
 * those skills "fix formatting" to match that exact 5-field shape — anything
 * appended past `category` risks getting silently normalized away the next
 * time AI-organize runs. Keeping this in a separate file means the ledger
 * format is completely untouched, so those skills' behavior can't be
 * affected no matter what they do to a line.
 *
 * Keyed by a natural composite key (date + time + amount + description) —
 * deliberately excluding `category`, since that's the field budget-capture.md
 * is most likely to rewrite (e.g. "Uncategorized" → a real category), so the
 * link between a ledger line and its receipt detail survives that edit.
 */

import { App, TFile, TAbstractFile, normalizePath } from 'obsidian';
import { budgetFolderPath } from './budget';

export type ReceiptItem = { name: string; price: number };

export type ReceiptDetail = {
  vendor?: string;
  notes?:  string;
  items?:  ReceiptItem[];
};

export function receiptKey(date: string, time: string, amount: number, description: string): string {
  return `${date}|${time}|${amount.toFixed(2)}|${description}`;
}

function receiptsFilePath(app: App, budgetName: string): string {
  return `${budgetFolderPath(app, budgetName)}/receipts.json`;
}

async function readStore(app: App, budgetName: string): Promise<Record<string, ReceiptDetail>> {
  const file = app.vault.getAbstractFileByPath(normalizePath(receiptsFilePath(app, budgetName)));
  if (!(file instanceof TFile)) return {};
  try {
    const raw = await app.vault.read(file);
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(app: App, budgetName: string, store: Record<string, ReceiptDetail>): Promise<void> {
  const path = normalizePath(receiptsFilePath(app, budgetName));
  const text = JSON.stringify(store, null, 2);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, text);
  } else {
    await app.vault.create(path, text);
  }
}

export async function loadReceipts(app: App, budgetName: string): Promise<Record<string, ReceiptDetail>> {
  return readStore(app, budgetName);
}

/** Only writes a receipt if it actually has something in it — an empty detail (no
 * vendor/notes/items) is the same as not having a receipt, so this skips the write. */
export async function saveReceiptDetail(app: App, budgetName: string, key: string, detail: ReceiptDetail): Promise<void> {
  const hasContent = !!(detail.vendor?.trim() || detail.notes?.trim() || (detail.items && detail.items.length > 0));
  if (!hasContent) return;
  const store = await readStore(app, budgetName);
  store[key] = detail;
  await writeStore(app, budgetName, store);
}

export function watchReceiptsFile(app: App, budgetName: string, cb: () => void): () => void {
  const path = normalizePath(receiptsFilePath(app, budgetName));
  const handler = (file: TAbstractFile) => { if (file instanceof TFile && file.path === path) cb(); };
  const ref = app.vault.on('modify', handler);
  const createRef = app.vault.on('create', handler);
  return () => { app.vault.offref(ref); app.vault.offref(createRef); };
}
