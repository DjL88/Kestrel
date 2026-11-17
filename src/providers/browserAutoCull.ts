import { loadImage } from './loadImage';
import { missingDetectorReviewFallback, restoreNoSubjectFallback } from '../core/cullFallback';
import { sha256Hex } from '../core/sha256';
import { duplicateAnchorKeys } from '../core/duplicateAnchors';
import { limitAutoKeepers, scorePreview, scoreWithSubject, type CullSuggestion, type SubjectFinding } from '../core/autoCull';
import { detectorParallelism, findSubject } from './objectDetector';
import { bundledModelUrl } from './bundledModelAssets';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function scanForCulling(
  candidates: PhotoFrame[], all: PhotoFrame[], provider: BrowserPreviewProvider, goal: number,
  signal: AbortSignal, onProgress: (count: number) => void,
  onDetectorUnavailable?: () => void,
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
  let detectorHealthy = Boolean(bundledModelUrl('yolox_tiny.onnx'));
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

  // Pass 2: look at the photos, several at once. Each lane has its own canvas; the detector runs in background workers.
  const outcome = new Map<string, CullSuggestion>();
  let finished = 0;
  const analyse = async (frame: PhotoFrame, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): Promise<CullSuggestion> => {
    const missing: CullSuggestion = { frameId: frame.id, decision: null, confidence: 'low', score: 0, reason: 'unavailable' };
    if (duplicates.has(frame.id)) return { frameId: frame.id, decision: 'reject', confidence: 'high', score: 100, reason: 'duplicate' };
    try {
      const url = await provider.getFullPreviewUrl(frame);
      if (!url) return missing;
      const image = await loadImage(url);
      signal.throwIfAborted();
      const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const base = scorePreview(frame.id, context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      // Judge the photo by its subject: its presence and sharpness, not the texture of the whole frame.
      let finding: SubjectFinding | null | undefined;
      try {
        if (detectorHealthy) {
          const found = await findSubject(image, signal);
          finding = found && { label: found.detection.label, score: found.detection.score, size: Math.max(found.detection.box.w, found.detection.box.h), sharpness: found.sharpness };
        }
      } catch {
        signal.throwIfAborted();
        // Several photos can fail together: notify the user once, not once per photo, without exposing a stack trace.
        if (detectorHealthy) {
          detectorHealthy = false;
          onDetectorUnavailable?.();
        }
        finding = undefined;
      }
      baseById.set(frame.id, base);
      return finding === undefined ? base : scoreWithSubject(base, finding);
    } catch {
      signal.throwIfAborted();
      return missing;
    }
  };
  const lanes = detectorHealthy ? Math.max(1, await detectorParallelism().catch(() => 1)) : 1;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(lanes, Math.max(1, candidates.length)) }, async () => {
    const laneCanvas = document.createElement('canvas');
    const laneContext = laneCanvas.getContext('2d', { willReadFrequently: true });
    if (!laneContext) throw new Error('canvas');
    while (cursor < candidates.length) {
      signal.throwIfAborted();
      const frame = candidates[cursor++];
      outcome.set(frame.id, await analyse(frame, laneCanvas, laneContext));
      onProgress(++finished);
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the interface breathe between photos
    }
  }));
  // Keep the order the photos were given in, whichever finished first.
  const results: CullSuggestion[] = candidates.map((frame) => outcome.get(frame.id)!);
  // A shoot with no people, animals or vehicles in it (landscapes, buildings, abstracts) has nothing for the detector to find.
  // When it finds a subject in very few photos, judge by overall detail as before instead of calling every photo subject-less.
  const withSubject = results.filter((result) => result.reason !== 'noSubject' && baseById.has(result.frameId)).length;
  const judged = results.filter((result) => baseById.has(result.frameId)).length;
  const fallbackResults = !detectorHealthy
    ? missingDetectorReviewFallback(results, baseById)
    : judged > 0 && withSubject / judged < 0.15
      ? restoreNoSubjectFallback(results, baseById)
      : results;
  return limitAutoKeepers(fallbackResults, all, Math.max(0, goal - all.filter((frame) => !frame.removedAt && frame.decision === 'keep').length));
}
