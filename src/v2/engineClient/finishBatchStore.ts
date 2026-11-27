import type { FinishResult } from './runFinishBatch';

/**
 * What the last "Finish best" batch did, kept in memory for the Review dialog. It holds only the results the dialog
 * shows; the edits themselves live in the catalogue, so closing the app loses nothing but the review list, and History
 * can still take every step back.
 */
export interface FinishBatchSnapshot {
  projectId: string | null;
  phase: 'idle' | 'running' | 'done';
  /** Photos the batch was asked to finish. */
  total: number;
  /** In plan order, as each photo finished. */
  results: readonly FinishResult[];
  /** Cancel (or leaving the project) stopped it before every photo was looked at. */
  stopped: boolean;
}

const IDLE: FinishBatchSnapshot = { projectId: null, phase: 'idle', total: 0, results: [], stopped: false };

export function createFinishBatchStore() {
  let snapshot: FinishBatchSnapshot = IDLE;
  const listeners = new Set<() => void>();
  const set = (next: FinishBatchSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(projectId: string, total: number) { set({ projectId, phase: 'running', total, results: [], stopped: false }); },
    add(result: FinishResult) { set({ ...snapshot, results: [...snapshot.results, result] }); },
    finish(stopped: boolean) { if (snapshot.phase === 'running') set({ ...snapshot, phase: 'done', stopped }); },
    mark(photoId: string, patch: Partial<Pick<FinishResult, 'review' | 'changedSince'>>) {
      set({ ...snapshot, results: snapshot.results.map((result) => (result.photoId === photoId ? { ...result, ...patch } : result)) });
    },
    /** Approve all: every edit still waiting for a look counts as kept. Nothing is changed in the catalogue. */
    keepAll() {
      set({ ...snapshot, results: snapshot.results.map((result) => (result.state === 'applied' && result.review === 'pending' ? { ...result, review: 'kept' } : result)) });
    },
    reset() { if (snapshot !== IDLE) set(IDLE); },
  };
}

export const finishBatchStore = createFinishBatchStore();
