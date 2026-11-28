import { STORE_FILTERS, STORE_RATED_DEFAULT, STORE_TOP_DEFAULT, type StoreFilter } from '../../core/storeInCloud';
import { readBackupSelection } from './cloudBackupSelection';

/**
 * What the person last chose to store in the cloud, per project, kept on this device so it survives a restart and a
 * stopped or failed run can be retried with one press. Choosing never uploads anything: only pressing Store does.
 * Anything unreadable falls back to the plain default, which covers nothing until the person presses Store.
 */
export interface StoreChoice {
  filter: StoreFilter;
  tag: string;
  minRating: number;
  top: number;
  /** The photos picked by hand, kept so "Selected photos" can be retried after a restart. */
  selectedIds: string[];
  /** Send the full original too, so exporting on another device is lossless. */
  originals: boolean;
}

export const DEFAULT_STORE_CHOICE: StoreChoice = { filter: 'all', tag: '', minRating: STORE_RATED_DEFAULT, top: STORE_TOP_DEFAULT, selectedIds: [], originals: true };
const key = (projectId: string) => `kestrel.store-cloud.choice.v1.${projectId}`;

export function readStoreChoice(projectId: string | null, storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): StoreChoice {
  if (!projectId) return { ...DEFAULT_STORE_CHOICE };
  try {
    const raw = storage?.getItem(key(projectId));
    if (!raw) return { ...DEFAULT_STORE_CHOICE };
    const value = JSON.parse(raw) as Record<string, unknown>;
    const selection = readBackupSelection({ mode: 'selected', photoIds: value.selectedIds });
    const number = (n: unknown, fallback: number, min: number, max: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback);
    return {
      filter: STORE_FILTERS.includes(value.filter as StoreFilter) ? value.filter as StoreFilter : 'all',
      tag: typeof value.tag === 'string' ? value.tag.slice(0, 80) : '',
      minRating: number(value.minRating, STORE_RATED_DEFAULT, 1, 5),
      top: number(value.top, STORE_TOP_DEFAULT, 1, 5000),
      selectedIds: selection.mode === 'selected' ? selection.photoIds : [],
      originals: value.originals !== false,
    };
  } catch { return { ...DEFAULT_STORE_CHOICE }; }
}

export function writeStoreChoice(projectId: string | null, choice: StoreChoice, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  if (!projectId) return;
  try { storage?.setItem(key(projectId), JSON.stringify(choice)); } catch { /* the choice is a convenience; storing still works without it */ }
}
