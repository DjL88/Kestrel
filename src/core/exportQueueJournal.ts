/**
 * Durable export plan journal. This is metadata only: no image bytes, secrets or
 * file-system handles. A persisted job is NEVER automatically executed on startup.
 * Callers must reacquire destination permission, verify source identity and check
 * each output receipt before explicitly resuming a job.
 */
export interface ExportQueueStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}
export interface ExportQueueItem {
  readonly sourceId: string;
  readonly sourceSha256: string;
  readonly filename: string;
  readonly subfolder: string;
}
export interface ExportQueueReceipt {
  readonly index: number;
  readonly outputSha256: string;
  readonly relativePath: string;
}
export interface ExportQueueCheckpoint<Recipe> {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly items: readonly ExportQueueItem[];
  readonly recipe: Recipe;
  readonly receipts: readonly ExportQueueReceipt[];
  readonly state: 'pending' | 'paused' | 'completed';
}
const sha = /^[a-f0-9]{64}$/i;
// A journal can be reopened on Windows, macOS or a case-insensitive NAS.
// Reject ambiguous names before any adapter receives a destination path.
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const safePart = (s: string) => s.length > 0 && s !== '.' && s !== '..' &&
  s.normalize('NFC') === s && !reserved.test(s) &&
  !/[\\\\/:*?"<>|\u0000-\u001f\u007f]/.test(s) && !/[. ]$/.test(s);
const pathFor = (item: ExportQueueItem) => item.subfolder ? item.subfolder + '/' + item.filename : item.filename;
const portablePathKey = (item: ExportQueueItem) => pathFor(item).normalize('NFC').toLowerCase();
function validate(value: unknown): asserts value is ExportQueueCheckpoint<unknown> {
  if (!value || typeof value !== 'object') throw new Error('Invalid export checkpoint.');
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(v.id) ||
      typeof v.title !== 'string' || !Array.isArray(v.items) || v.items.length === 0 ||
      !Array.isArray(v.receipts) || !['pending', 'paused', 'completed'].includes(v.state as string) ||
      !('recipe' in v)) throw new Error('Invalid export checkpoint.');
  const paths = new Set<string>();
  for (const raw of v.items) {
    const item = raw as ExportQueueItem;
    if (!item || typeof item.sourceId !== 'string' || !item.sourceId ||
        typeof item.sourceSha256 !== 'string' || !sha.test(item.sourceSha256) ||
        typeof item.filename !== 'string' || !safePart(item.filename) ||
        typeof item.subfolder !== 'string' ||
        (item.subfolder !== '' && !safePart(item.subfolder))) throw new Error('Unsafe export checkpoint item.');
    const path = portablePathKey(item);
    if (paths.has(path)) throw new Error('Export filename collision.');
    paths.add(path);
  }
  const indexes = new Set<number>();
  for (const raw of v.receipts) {
    const receipt = raw as ExportQueueReceipt;
    if (!receipt || !Number.isInteger(receipt.index) || receipt.index < 0 ||
        receipt.index >= v.items.length || indexes.has(receipt.index) ||
        typeof receipt.outputSha256 !== 'string' || !sha.test(receipt.outputSha256) ||
        receipt.relativePath !== pathFor(v.items[receipt.index] as ExportQueueItem))
      throw new Error('Invalid export completion receipt.');
    indexes.add(receipt.index);
  }
  if (v.state === 'completed' && indexes.size !== v.items.length) throw new Error('Incomplete export marked completed.');
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function createExportQueueJournal(storage: ExportQueueStorage, prefix = 'kestrel.export.v1.') {
  function key(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new Error('Invalid export job ID.');
    return prefix + id;
  }
  return {
    load<Recipe>(id: string): ExportQueueCheckpoint<Recipe> | null {
      const raw = storage.read(key(id));
      if (raw === null) return null;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new Error('Corrupt export checkpoint; no export was resumed.'); }
      validate(value);
      if (value.id !== id) throw new Error('Export checkpoint identity mismatch.');
      return copy(value) as ExportQueueCheckpoint<Recipe>;
    },
    save<Recipe>(checkpoint: ExportQueueCheckpoint<Recipe>): void {
      validate(checkpoint);
      // Storage write must be atomic/durable in the platform adapter. A failed
      // write propagates: callers must not claim the job was accepted.
      storage.write(key(checkpoint.id), JSON.stringify(checkpoint));
    },
    receipt<Recipe>(id: string, receipt: ExportQueueReceipt): ExportQueueCheckpoint<Recipe> {
      const current = this.load<Recipe>(id);
      if (!current || current.state === 'completed') throw new Error('Export job cannot be updated.');
      if (current.receipts.some(r => r.index === receipt.index)) throw new Error('Output already recorded; verify before retry.');
      const next = { ...current, receipts: [...current.receipts, receipt] };
      this.save(next);
      return next;
    },
    pause<Recipe>(id: string): void {
      const current = this.load<Recipe>(id);
      if (!current) throw new Error('Export job not found.');
      this.save({ ...current, state: 'paused' });
    },
    async pendingForExplicitResume<Recipe>(
      id: string,
      verifySource: (item: ExportQueueItem) => Promise<boolean>,
      verifyOutput: (item: ExportQueueItem, receipt: ExportQueueReceipt) => Promise<boolean>,
    ): Promise<{ checkpoint: ExportQueueCheckpoint<Recipe>; pending: readonly number[] }> {
      const current = this.load<Recipe>(id);
      if (!current) throw new Error('Export job not found.');
      if (current.state === 'completed') return { checkpoint: current, pending: [] };
      for (const item of current.items) {
        if (!await verifySource(item)) throw new Error('Original identity could not be verified; export remains paused.');
      }
      for (const receipt of current.receipts) {
        if (!await verifyOutput(current.items[receipt.index], receipt))
          throw new Error('Previously exported file changed or disappeared; manual recovery required.');
      }
      const completed = new Set(current.receipts.map(r => r.index));
      return { checkpoint: current, pending: current.items.map((_, i) => i).filter(i => !completed.has(i)) };
    },
    remove(id: string): void { storage.remove(key(id)); },
  };
}
