import { ImportCullCache } from '../core/importCullCache';
import type { PhotoFrame } from '../core/types';
import { DETECTOR_MODEL } from '../core/objectDetection';
import { bundledModelUrl } from './bundledModelAssets';
import { observeCullImage } from './cullPreviewObservation';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { sharedCullObservationPool } from './cullObservationPool';
import { cullPoolSize, looksLikePhone } from '../core/cullPoolSize';

/** Photos waiting per lane: enough to keep every worker busy, never a 500-photo resource backlog. */
const QUEUED_PER_LANE = 8;

export interface ImportCullPreflight {
  offer(frame: PhotoFrame): void;
  /** Stop starting work; release completed numeric evidence after the active observation settles. */
  finish(): Promise<ImportCullCache | undefined>;
  abort(): void;
}

/**
 * Runs optional local subject observations while other photos are importing.
 * Nothing is automatically kept/rejected here, and neither originals nor
 * preview pixels are persisted in the cache.
 */
export function createImportCullPreflight(
  projectId: string, importId: string, provider: BrowserPreviewProvider, importSignal: AbortSignal,
): ImportCullPreflight | undefined {
  // No model means no expensive preview-only preflight that the final cull
  // would need to repeat. The app remains fully usable without ONNX assets.
  if (!bundledModelUrl(DETECTOR_MODEL.file)) return undefined;
  const cache = new ImportCullCache(projectId, importId, DETECTOR_MODEL.sha256);
  const controller = new AbortController();
  const queued: PhotoFrame[] = [];
  const seen = new Set<string>();
  let closed = false;
  /** One lane per culling worker (every core but one, at most 4 on phones); one lane on the main thread without them. */
  let laneLimit = 1;
  const lanes = new Set<Promise<void>>();
  let sized: Promise<void> | null = null;
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const maxQueued = QUEUED_PER_LANE * cullPoolSize(nav?.hardwareConcurrency, looksLikePhone(nav?.userAgent));

  function abort() {
    closed = true;
    queued.length = 0;
    controller.abort();
  }
  if (importSignal.aborted) abort();
  else importSignal.addEventListener('abort', abort, { once: true });

  async function lane(): Promise<void> {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { cache.failDetector(); return; }
    while (!controller.signal.aborted && cache.usable && queued.length) {
      const frame = queued.shift()!;
      try {
        const version = provider.originalInfo(frame.stableKey);
        const observation = await observeCullImage(frame, provider, controller.signal, canvas, context, true);
        if (controller.signal.aborted) break;
        if (observation.detectorFailed) {
          cache.failDetector();
          queued.length = 0;
          break;
        }
        const current = provider.originalInfo(frame.stableKey);
        // Never attach a decoded preview to a source that changed mid-read.
        if (observation.base && version && current && version.size === current.size &&
            version.lastModified === current.lastModified) {
          cache.put(frame, version, observation);
        }
      } catch {
        if (!controller.signal.aborted) {
          // An unexpected model/canvas failure cannot leave earlier model
          // scores eligible for unattended keeper selection.
          cache.failDetector();
          queued.length = 0;
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  function startLanes() {
    if (closed || controller.signal.aborted || !queued.length) return;
    // The pool is asked once; until it answers, one lane starts so the first photo is not kept waiting.
    sized ??= sharedCullObservationPool().then((pool) => { laneLimit = pool?.size ?? 1; startLanes(); }, () => undefined);
    while (lanes.size < laneLimit && queued.length) { // each new lane takes its first photo straight away
      const running: Promise<void> = lane().catch(() => {
        // Preflight is optional. Unexpected browser/model failures must never
        // fail an otherwise successful photo import.
        cache.failDetector();
        queued.length = 0;
      }).finally(() => {
        lanes.delete(running);
        // An arrival in the final microtask of the previous run must not be
        // stranded forever waiting for a new file to arrive.
        if (!closed && queued.length) startLanes();
      });
      lanes.add(running);
    }
  }

  function offer(frame: PhotoFrame) {
    if (closed || controller.signal.aborted || !cache.usable ||
        queued.length >= maxQueued || seen.has(frame.id) ||
        frame.decision !== 'unreviewed' || frame.isDemo || frame.virtualCopy || frame.removedAt != null ||
        !provider.originalInfo(frame.stableKey)) return;
    const info = provider.originalInfo(frame.stableKey);
    if (!info || !Number.isSafeInteger(info.size) || info.size <= 0 ||
        !Number.isFinite(info.lastModified)) return;
    seen.add(frame.id);
    queued.push(frame);
    startLanes();
  }

  return {
    offer,
    abort,
    async finish() {
      closed = true;
      queued.length = 0;
      // Started lanes must settle before the final scan resets detector
      // health; otherwise both scans could race over the model singleton.
      await sized;
      while (lanes.size) await Promise.all([...lanes]);
      importSignal.removeEventListener('abort', abort);
      return !importSignal.aborted && !controller.signal.aborted && cache.usable && cache.size > 0 ? cache : undefined;
    },
  };
}
