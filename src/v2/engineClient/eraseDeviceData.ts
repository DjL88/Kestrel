/**
 * "Forget me" on this device: removes everything InFlight keeps here. Originals on disk are never touched.
 * Pure over what it is given, so it can be tested; the app passes the real catalogue and storages.
 */
export const DEVICE_KEY_PREFIXES = ['kestrel', 'inflight'] as const;

export interface EraseDeps {
  clearCatalogue: () => Promise<void>;
  storages: readonly Pick<Storage, 'length' | 'key' | 'removeItem'>[];
  /** Extra IndexedDB databases to delete (names only). */
  deleteDatabases?: readonly string[];
  deleteDatabase?: (name: string) => Promise<void>;
}

export interface EraseResult {
  catalogueCleared: boolean;
  keysRemoved: number;
  databasesDeleted: number;
  problems: string[];
}

export function isDeviceKey(key: string): boolean {
  const lower = key.toLowerCase();
  return DEVICE_KEY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export async function eraseDeviceData(deps: EraseDeps): Promise<EraseResult> {
  const result: EraseResult = { catalogueCleared: false, keysRemoved: 0, databasesDeleted: 0, problems: [] };
  try { await deps.clearCatalogue(); result.catalogueCleared = true; } catch { result.problems.push('The photo catalogue could not be fully cleared.'); }
  for (const storage of deps.storages) {
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) { const key = storage.key(index); if (key && isDeviceKey(key)) keys.push(key); }
      for (const key of keys) { storage.removeItem(key); result.keysRemoved += 1; }
    } catch { result.problems.push('Some saved settings could not be removed.'); }
  }
  for (const name of deps.deleteDatabases ?? []) {
    try { await deps.deleteDatabase?.(name); result.databasesDeleted += 1; } catch { result.problems.push(`Could not delete ${name}.`); }
  }
  return result;
}
