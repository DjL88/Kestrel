import { observeCullImage } from './cullPreviewObservation';
import { DETECTOR_MODEL } from '../core/objectDetection';
import type { ImportCullCache } from '../core/importCullCache';
import { collectCullEvidence, finaliseCullEvidence } from '../core/cullEvidenceFinal';
import type { CullScanStage } from '../core/cullScanProgress';
import { scanExactDuplicates } from '../core/cullDuplicateScan';
import { countOriginalKeepers, limitAutoKeepers, type CullSuggestion } from '../core/autoCull';
import { detectorParallelism, resetDetectorFailure } from './objectDetector';
import { bundledModelUrl } from './bundledModelAssets';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function scanForCulling(
  candidates: PhotoFrame[], all: PhotoFrame[], provider: BrowserPreviewProvider, goal: number | null,
  signal: AbortSignal, onProgress: (count: number) => void,
  onDetectorUnavailable?: () => void,
  onFrameStage?: (frameId: string, stage: CullScanStage) => void,
  preflight?: { cache: ImportCullCache; projectId: string },
) {
  const baseById = new Map<string, CullSuggestion>();
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
  const identifyDuplicates = () => scanExactDuplicates(candidates, all,
    key => provider.originalInfo(key)?.size, key => provider.ensureOriginal(key), signal);
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
  // The V2 caller applies the limit once, against the live catalogue at commit.
  if (goal === null) return fallbackResults;
  return limitAutoKeepers(fallbackResults, all, Math.max(0, goal - countOriginalKeepers(all)));
}
