import { assignBurstGroups } from '../../core/cullingEngine';
import { appendProjectPhotos, applyImportBursts } from '../../core/projects';
import type { CullingState, PhotoFrame } from '../../core/types';

/**
 * G07: an import belongs to its project, not to the screen. Leaving the project while photos are still importing (the
 * owner's 2,000-NEF card) must not drop the photos that finish meanwhile, nor hand them to a project that is being
 * reopened without their originals. Each finished photo goes to exactly one place:
 *
 * - the project is open: straight into it, as before;
 * - the project is closed: held here and written to its saved catalogue, in order, a batch at a time;
 * - the project is being opened: held until it is on screen, then added there (the caller first re-registers their
 *   originals in the opened project's preview provider).
 *
 * Writes to one project are serialised, and a state whose save failed is kept so a reopen never reads an older copy.
 */
export interface ImportBatch {
  importId: string;
  sequenceBase: number;
  frames: PhotoFrame[];
  /** The whole import, once it has finished: burst groups are worked out across all of it. */
  bursts?: PhotoFrame[];
}

/** Add one batch to a project. Safe to repeat: a photo already in the project (by stable key) is not added twice. */
export function applyImportBatch(project: CullingState, batch: ImportBatch): CullingState {
  let next = batch.frames.length ? appendProjectPhotos(project, batch.frames, batch.importId, { sequenceBase: batch.sequenceBase }) : project;
  if (batch.bursts?.length) {
    next = applyImportBursts(next, assignBurstGroups([...batch.bursts].sort((a, b) => a.sequenceIndex - b.sequenceIndex)), batch.importId);
  }
  return next;
}

export interface ImportHandoffDeps {
  /** True while this project is the one on screen (and not being left). */
  isOpen: (projectKey: string) => boolean;
  /** Add batches to the open project. */
  applyOpen: (projectKey: string, batches: ImportBatch[]) => void;
  load: (projectKey: string) => Promise<CullingState | null>;
  /** Store a closed project. A rejection keeps the batches here to be written again. */
  save: (projectKey: string, project: CullingState) => Promise<void>;
  /** Told after a closed project gained photos, or when it could not be written. */
  onWritten?: (projectKey: string, added: number) => void;
  onWriteFailed?: (projectKey: string, error: unknown) => void;
  delayMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface ImportHandoff {
  /** A finished batch of photos for a project. */
  add: (projectKey: string, batch: ImportBatch) => void;
  /** Write a closed project's held photos now. */
  flush: (projectKey: string) => Promise<void>;
  /**
   * The project is about to be opened: stop writing it, wait for any write in progress, and return the newest state
   * written here (or null: load it from the catalogue). Photos that finish from now on are held for `finishOpen`.
   */
  beginOpen: (projectKey: string) => Promise<CullingState | null>;
  /** The opened project is on screen: the photos held for it. The caller adds them (after re-registering originals). */
  finishOpen: (projectKey: string) => ImportBatch[];
  /** Opening failed: write the held photos to the catalogue instead. */
  abortOpen: (projectKey: string) => void;
  /** True while photos are held or being written for this project. */
  pending: (projectKey: string) => boolean;
  /** Every held photo written (or failed). */
  idle: () => Promise<void>;
}

export function createImportHandoff(deps: ImportHandoffDeps): ImportHandoff {
  const delayMs = deps.delayMs ?? 1500;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const held = new Map<string, ImportBatch[]>();
  const written = new Map<string, CullingState>();
  const chains = new Map<string, Promise<void>>();
  const timers = new Map<string, unknown>();
  const opening = new Set<string>();

  const take = (key: string) => { const batches = held.get(key) ?? []; held.delete(key); return batches; };
  const hold = (key: string, batches: ImportBatch[]) => { if (batches.length) held.set(key, [...batches, ...(held.get(key) ?? [])]); };
  const serial = (key: string, work: () => Promise<void>) => {
    const next = (chains.get(key) ?? Promise.resolve()).then(work);
    const settled = next.catch(() => undefined);
    chains.set(key, settled);
    void settled.then(() => { if (chains.get(key) === settled) chains.delete(key); });
    return next;
  };

  const write = (key: string) => serial(key, async () => {
    if (opening.has(key)) return;
    const batches = take(key);
    if (!batches.length) return;
    if (deps.isOpen(key)) { deps.applyOpen(key, batches); return; }
    try {
      const base = written.get(key) ?? await deps.load(key);
      if (!base) throw new Error('The project to import into could not be found.');
      const next = batches.reduce(applyImportBatch, base);
      // Kept only until it is stored: a failed save must not make a reopen read the older catalogue copy, and a stored
      // one is read back fresh, so a rename or archive made meanwhile is not overwritten.
      written.set(key, next);
      await deps.save(key, next);
      written.delete(key);
      deps.onWritten?.(key, batches.reduce((sum, batch) => sum + batch.frames.length, 0));
    } catch (error) {
      // Nothing is dropped: the photos stay held and are written with the next batch, or handed over on open.
      hold(key, batches);
      deps.onWriteFailed?.(key, error);
      queueMicrotask(() => schedule(key));
      throw error;
    }
  });

  const schedule = (key: string) => {
    if (timers.has(key) || opening.has(key)) return;
    timers.set(key, setTimer(() => { timers.delete(key); void write(key).catch(() => undefined); }, delayMs));
  };
  const cancelTimer = (key: string) => { const timer = timers.get(key); if (timer !== undefined) { clearTimer(timer); timers.delete(key); } };

  return {
    add(key, batch) {
      if (!opening.has(key) && !held.has(key) && deps.isOpen(key)) { deps.applyOpen(key, [batch]); return; }
      held.set(key, [...(held.get(key) ?? []), batch]);
      schedule(key);
    },
    flush(key) { cancelTimer(key); return write(key); },
    async beginOpen(key) {
      opening.add(key);
      cancelTimer(key);
      await (chains.get(key) ?? Promise.resolve());
      const newest = written.get(key) ?? null;
      written.delete(key);
      return newest;
    },
    finishOpen(key) {
      if (!opening.delete(key)) return [];
      return take(key);
    },
    abortOpen(key) {
      if (!opening.delete(key)) return;
      if (held.has(key)) schedule(key);
    },
    pending: (key) => held.has(key) || chains.has(key) || timers.has(key),
    async idle() {
      for (const key of [...timers.keys()]) { cancelTimer(key); void write(key).catch(() => undefined); }
      await Promise.all([...chains.values()]);
    },
  };
}

/**
 * Which photos of an unfinished import are not in the project yet, kept on this device so that reopening the project
 * (after a reload, or after the browser closed mid-import) says so instead of looking complete. The files themselves
 * cannot be kept by a browser between sessions, so they are named for the person to import again. Cleared when an import
 * into the project finishes with nothing left.
 */
const PENDING_PREFIX = 'inflight.v2.importPending.';
const MAX_PENDING_NAMES = 5000;
type NameStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function writePendingImport(storage: NameStore, projectKey: string, names: readonly string[]): void {
  try {
    if (!names.length) storage.removeItem(PENDING_PREFIX + projectKey);
    else storage.setItem(PENDING_PREFIX + projectKey, JSON.stringify({ names: names.slice(0, MAX_PENDING_NAMES), count: names.length }));
  } catch {
    // Storage full or blocked: the import itself is unaffected; only the reminder is lost.
  }
}

export function readPendingImport(storage: NameStore, projectKey: string): { count: number; names: string[] } | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PENDING_PREFIX + projectKey) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { names, count } = parsed as { names?: unknown; count?: unknown };
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string') || typeof count !== 'number' || !Number.isInteger(count) || count < names.length) return null;
    return count > 0 ? { count, names } : null;
  } catch {
    return null;
  }
}
