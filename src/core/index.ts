/**
 * src/core/ — the codec / renderer / preset layer (REFACTOR-HANDOFF.md).
 *
 * Import from '../core' rather than reaching into individual files, so the
 * internal file split stays free to change as Phases 2-4 land.
 */
export type {
  SourceRef, CodecId, FieldType, FieldDef, RowId, CodecRow, Codec,
  BoundMutations, RendererProps, RendererDefinition, Preset, PresetSource,
  SourcePickerConfig,
} from './types';
export {
  CODEC_IDS, sourcePath, sourceFolder, sourceHeading, sourceKey, isSameSource,
  asSourceRef, withSourceLocation,
} from './types';

export { registerCodec, getCodec, registeredCodecIds } from './codec-registry';

export type { VaultSubscription, VaultWatchTargets } from './vault-events';
export { subscribeVault, vaultSubscriberCount } from './vault-events';

export type { UseVaultDataOptions, VaultData, VaultDataMulti } from './useVaultData';
export { useVaultData, useVaultDataMulti } from './useVaultData';

export type { SourceSnapshot, SubscribeSourceOptions } from './source-cache';
export {
  subscribeSource, getSourceSnapshot, invalidateSource, cachedSourceCount,
  publishPreviewSnapshot,
} from './source-cache';

export { PREVIEW_ROOT, isPreviewSource, seedPreviewSource } from './preview-source';

export {
  SOURCE_KEY, migrateWidgetConfig, migrateLayoutItems, migratePages, resolveWidgetSource,
} from './config-migration';

export {
  registerBuiltInCodecs, checklistCodec, recordFolderCodec, lineTableCodec, mdTableCodec,
  CodecError, parseItemText, parseMdTable,
  TODO_TEMPLATE, FLAT_TEMPLATE, LEDGER_INDEX_TEMPLATE, TABLE_TEMPLATE,
} from './codecs';
export type {
  ChecklistRow, ChecklistBucket, ChecklistMeta, RecordRow, RecordFolderMeta,
  LedgerRow, LineTableMeta, MdTableRow, MdTableMeta, MdTableColumn,
} from './codecs';
