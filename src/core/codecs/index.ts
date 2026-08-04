import { registerCodec } from '../codec-registry';
import { checklistCodec } from './checklist';
import { recordFolderCodec } from './record-folder';
import { lineTableCodec } from './line-table';
import { mdTableCodec } from './md-table';

/**
 * Registers every built-in codec. Called once from main.ts's onload(), before
 * any view renders — a widget that mounts with no codec registered would
 * render its "no codec" error state instead of its data.
 *
 * Four are registered: checklist (Phase 1), record-folder (Phase 2), line-table
 * (Phase 3), md-table.
 *
 * This list said "expected to stay at three" for a long time, and that bar was
 * the right one — md-table cleared it rather than eroding it. A markdown table
 * is a genuinely different on-disk format from all three (line-table parses
 * LIST ITEMS containing pipes, with a fixed schema and no header row), and it
 * arrived with two consumers: user-authored tables, and the Recurring Items
 * table that data-sources/recurring.ts used to hand-parse with its own watcher.
 * A fifth still means a genuinely new format, which should approach never.
 */
export function registerBuiltInCodecs(): void {
  registerCodec(checklistCodec);
  registerCodec(recordFolderCodec);
  registerCodec(lineTableCodec);
  registerCodec(mdTableCodec);
}

export {
  checklistCodec, CodecError, parseItemText, parseChecklist, TODO_TEMPLATE, FLAT_TEMPLATE,
} from './checklist';
export type { ChecklistRow, ChecklistBucket, ChecklistMeta, ChecklistCodec } from './checklist';

export { recordFolderCodec } from './record-folder';
export type { RecordRow, RecordFolderMeta, RecordFolderCodec } from './record-folder';

export { lineTableCodec, parseLedgerYear, ledgerYears, LEDGER_INDEX_TEMPLATE } from './line-table';
export type { LedgerRow, LineTableMeta, LineTableCodec } from './line-table';

export { mdTableCodec, parseMdTable, TABLE_TEMPLATE } from './md-table';
export type { MdTableRow, MdTableMeta, MdTableColumn, MdTableCodec } from './md-table';
