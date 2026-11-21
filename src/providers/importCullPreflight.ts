import { ImportCullCache } from '../core/importCullCache';
import type { PhotoFrame } from '../core/types';
import { DETECTOR_MODEL } from '../core/objectDetection';
import { bundledModelUrl } from './bundledModelAssets';
import { observeCullImage } from './cullPreviewObservation';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

const MAX_QUEUED = 8; // one ONNX inference at a time, never a 500-photo resource backlog

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
  let worker: Promise<void> | null = null;

  function abort() {
    closed = true;
    queued.length = 0;
    controller.abort();
  }
  if (importSignal.aborted) abort();
  else importSignal.addEventListener('abort', abort, { once: true });

  async function run(): Promise<void> {
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

  function startWorker() {
    if (worker || closed || controller.signal.aborted || !queued.length) return;
    worker = run().catch(() => {
      // Preflight is optional. Unexpected browser/model failures must never
      // fail an otherwise successful photo import.
      cache.failDetector();
      queued.length = 0;
    }).finally(() => {
      worker = null;
      // An arrival in the final microtask of the previous run must not be
      // stranded forever waiting for a new file to arrive.
      if (!closed && queued.length) startWorker();
    });
  }

  function offer(frame: PhotoFrame) {
    if (closed || controller.signal.aborted || !cache.usable ||
        queued.length >= MAX_QUEUED || seen.has(frame.id) ||
        frame.decision !== 'unreviewed' || frame.isDemo || frame.virtualCopy || frame.removedAt != null ||
        !provider.originalInfo(frame.stableKey)) return;
    const info = provider.originalInfo(frame.stableKey);
    if (!info || !Number.isSafeInteger(info.size) || info.size <= 0 ||
        !Number.isFinite(info.lastModified)) return;
    seen.add(frame.id);
    queued.push(frame);
    startWorker();
  }

  return {
    offer,
    abort,
    async finish() {
      closed = true;
      queued.length = 0;
      // A started worker must settle before the final scan resets detector
      // health; otherwise both scans could race over the model singleton.
      await worker;
      importSignal.removeEventListener('abort', abort);
      return !importSignal.aborted && !controller.signal.aborted && cache.usable && cache.size > 0 ? cache : undefined;
    },
  };
}
