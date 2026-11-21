import type { PhotoFrame } from '../core/types';
import type { SearchEvidenceReceipt } from '../core/photoSearch';

export interface QuietPhotoIndexOptions {
  frames: readonly PhotoFrame[];
  modelRevision: string;
  /** Caller uses an already consented, installed LOCAL reader. Never downloads a model. */
  scan: (frame: PhotoFrame, signal?: AbortSignal) => Promise<SearchEvidenceReceipt | null>;
  /** Store against latest project state, using retainPhotoSearchEvidence and fresh source identity. */
  save: (receipt: SearchEvidenceReceipt) => void | Promise<void>;
  /** Do not compete with sliders, culling, export or a busy photo decoder. */
  isBusy?: () => boolean;
  /** Default yields to the UI between scans; injectable for tests. */
  yieldToUi?: () => Promise<void>;
  signal?: AbortSignal;
  /** Bound the work per scheduling pass; the caller may resume remaining frames later. */
  maxScans?: number;
}

export interface QuietPhotoIndexProgress {
  scanned: number;
  saved: number;
  skipped: number;
  failed: number;
  deferred: boolean;
}

/** Single-flight, bounded, cancellation-aware scheduler with no network or UI side effects. */
export async function indexPhotosQuietly(options: QuietPhotoIndexOptions): Promise<QuietPhotoIndexProgress> {
  const result: QuietPhotoIndexProgress = { scanned: 0, saved: 0, skipped: 0, failed: 0, deferred: false };
  const maxScans = Number.isFinite(options.maxScans)
    ? Math.max(0, Math.min(40, Math.trunc(options.maxScans!))) : 8;
  const idle = options.yieldToUi ?? (async () => {
    if (typeof window === 'undefined') return;
    await new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 1200 });
      else window.setTimeout(resolve, 25);
    });
  });
  if (options.signal?.aborted || !options.modelRevision.trim() || maxScans === 0) return result;

  for (const frame of options.frames) {
    if (options.signal?.aborted) break;
    if (result.scanned >= maxScans || options.isBusy?.()) { result.deferred = true; break; }
    if (frame.removedAt != null || !frame.stableKey ||
        (frame.searchEvidence?.schema === 1 &&
         frame.searchEvidence.sourceStableKey === frame.stableKey &&
         frame.searchEvidence.modelRevision === options.modelRevision)) {
      result.skipped += 1;
      continue;
    }
    await idle();
    if (options.signal?.aborted) break;
    if (options.isBusy?.()) { result.deferred = true; break; }
    result.scanned += 1;
    try {
      const receipt = await options.scan(frame, options.signal);
      if (options.signal?.aborted) break;
      if (!receipt || receipt.frameId !== frame.id || receipt.sourceStableKey !== frame.stableKey ||
          receipt.modelRevision !== options.modelRevision) { result.skipped += 1; continue; }
      await options.save(receipt);
      result.saved += 1;
    } catch {
      // One unreadable/damaged photo never interrupts editing or indexing its neighbours.
      result.failed += 1;
    }
  }
  return result;
}
