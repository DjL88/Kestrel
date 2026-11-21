import { observeCullImage } from './cullPreviewObservation';
import { DETECTOR_MODEL } from '../core/objectDetection';
import type { ImportCullCache } from '../core/importCullCache';
import { collectCullEvidence, finaliseCullEvidence } from '../core/cullEvidenceFinal';
import type { CullScanStage } from '../core/cullScanProgress';
import { sha256Hex } from '../core/sha256';
import { duplicateAnchorKeys } from '../core/duplicateAnchors';
import { limitAutoKeepers, type CullSuggestion } from '../core/autoCull';
import { detectorParallelism, resetDetectorFailure } from './objectDetector';
import { bundledModelUrl } from './bundledModelAssets';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function scanForCulling(
  candidates: PhotoFrame[], all: PhotoFrame[], provider: BrowserPreviewProvider, goal: number,
  signal: AbortSignal, onProgress: (count: number) => void,
  onDetectorUnavailable?: () => void,
  onFrameStage?: (frameId: string, stage: CullScanStage) => void,
  preflight?: { cache: ImportCullCache; projectId: string },
) {
  const baseById = new Map<string, CullSuggestion>();
  const sizes = new Map<number, number>();
  for (const frame of candidates) {
    const info = provider.originalInfo(frame.stableKey);
    if (info) sizes.set(info.size, (sizes.get(info.size) ?? 0) + 1);
  }
  // A cloud IDE may omit large ONNX files. Treat object detection as optional
  // in that preview; preserve the existing conservative detail-only fallback.
  // A bundled asset can still be corrupt, inaccessible at runtime, or unable
  // to initialise ONNX. Stop trying after the first failure in this scan.
  // Scores from a degraded scan must NEVER be automatically accepted.
  resetDetectorFailure();
  let detectorHealthy = Boolean(bundledModelUrl('yolox_tiny.onnx'));
  // One bounded hashing lane runs alongside the detector lanes. Hashing stays
  // in the ORIGINAL candidate order, so first-copy/keeper-anchor precedence
  // never depends on asynchronous preview or model completion.
  const identifyDuplicates = async (): Promise<ReadonlySet<string>> => {
    const seenHashes = new Set<string>();
    const anchorSizes = new Set<number>();
    // A second scan must not select a byte-identical copy of a keeper already
    // accepted in an earlier pass. Only read keeper originals of matching size.
    for (const stableKey of duplicateAnchorKeys(all, new Set(sizes.keys()),
      (key) => provider.originalInfo(key)?.size)) {
      signal.throwIfAborted();
      const anchor = await provider.ensureOriginal(stableKey);
      if (!anchor || (anchor.size > 8 * 1024 * 1024 && !globalThis.crypto?.subtle)) continue;
      try {
        seenHashes.add(await sha256Hex(await anchor.arrayBuffer()));
        anchorSizes.add(anchor.size);
      } catch {
        signal.throwIfAborted();
        // If an anchor cannot be hashed, do not infer that a candidate is a duplicate.
      }
    }
    // Pass 1, in order, so which copy counts as the original never depends on timing: byte-identical duplicates.
    const duplicates = new Set<string>();
    for (const frame of candidates) {
      signal.throwIfAborted();
      try {
        const size = provider.originalInfo(frame.stableKey)?.size ?? 0;
        const blob = size && size <= 32 * 1024 * 1024 && ((sizes.get(size) ?? 0) > 1 || anchorSizes.has(size)) ? await provider.ensureOriginal(frame.stableKey) : undefined;
        if (blob && blob.size <= 32 * 1024 * 1024 && ((sizes.get(blob.size) ?? 0) > 1 || anchorSizes.has(blob.size)) && (globalThis.crypto?.subtle || blob.size <= 8 * 1024 * 1024)) {
          const hash = await sha256Hex(await blob.arrayBuffer());
          if (seenHashes.has(hash)) duplicates.add(frame.id);
          else seenHashes.add(hash);
        }
      } catch {
        signal.throwIfAborted();
        // A file that cannot be hashed is simply not treated as a duplicate.
      }
    }

    return duplicates;
  };
  // Pass 2: look at the photos, several at once. Each lane has its own canvas; the detector runs in background workers.
  const outcome = new Map<string, CullSuggestion>();
  let finished = 0;
  const analyse = async (frame: PhotoFrame, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): Promise<CullSuggestion> => {
    // Reuse only proven, source-version-matched observations from this exact
    // import and detector build. Decisions still wait for all shoot evidence.
    const cached = detectorHealthy && preflight?.cache.get(preflight.projectId, frame,
      provider.originalInfo(frame.stableKey), DETECTOR_MODEL.sha256);
    if (cached) {
      if (cached.base) baseById.set(frame.id, cached.base);
      return cached.result;
    }
    const observation = await observeCullImage(frame, provider, signal, canvas, context, detectorHealthy);
    if (observation.base) baseById.set(frame.id, observation.base);
    if (observation.detectorFailed && detectorHealthy) {
      detectorHealthy = false;
      onDetectorUnavailable?.();
    }
    return observation.result;
  };
  const lanes = detectorHealthy ? Math.max(1, await detectorParallelism().catch(() => 1)) : 1;
  let cursor = 0;
  const analyseInLanes = async () => {
    await Promise.all(Array.from({ length: Math.min(lanes, Math.max(1, candidates.length)) }, async () => {
      const laneCanvas = document.createElement('canvas');
      const laneContext = laneCanvas.getContext('2d', { willReadFrequently: true });
      if (!laneContext) throw new Error('canvas');
      while (cursor < candidates.length) {
        signal.throwIfAborted();
        const frame = candidates[cursor++];
        onFrameStage?.(frame.id, 'analysing');
        const result = await analyse(frame, laneCanvas, laneContext);
        signal.throwIfAborted();
        outcome.set(frame.id, result);
        // This records work on the individual photo, NOT a final keeper decision.
        // The scan-wide detector fallback and keeper limit still run after all lanes.
        onFrameStage?.(frame.id, result.reason === 'unavailable' ? 'unavailable' : 'analysed');
        onProgress(++finished);
        await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the interface breathe between photos
      }
    }));
  };
  // Preview/subject analysis now starts BEFORE the duplicate hash pass completes.
  // Neither result is final until both independent jobs have finished.
  const { duplicates } = await collectCullEvidence(analyseInLanes, identifyDuplicates);
  // Keep the order the photos were given in, whichever finished first.
  const fallbackResults = finaliseCullEvidence(candidates.map((frame) => frame.id),
    outcome, duplicates, baseById, detectorHealthy);
  return limitAutoKeepers(fallbackResults, all, Math.max(0, goal - all.filter((frame) => !frame.removedAt && frame.decision === 'keep').length));
}
