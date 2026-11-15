import { loadImage } from './loadImage';
import { sha256Hex } from '../core/sha256';
import { limitAutoKeepers, scorePreview, type CullSuggestion } from '../core/autoCull';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function scanForCulling(
  candidates: PhotoFrame[], all: PhotoFrame[], provider: BrowserPreviewProvider, goal: number,
  signal: AbortSignal, onProgress: (count: number) => void,
) {
  const results: CullSuggestion[] = [];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas');
  const sizes = new Map<number, number>();
  for (const frame of candidates) {
    const blob = provider.getOriginal(frame.stableKey);
    if (blob) sizes.set(blob.size, (sizes.get(blob.size) ?? 0) + 1);
  }
  const seenHashes = new Set<string>();
  for (const frame of candidates) {
    signal.throwIfAborted();
    const missing: CullSuggestion = { frameId: frame.id, decision: null, confidence: 'low', score: 0, reason: 'unavailable' };
    try {
      const blob = provider.getOriginal(frame.stableKey);
      if (blob && blob.size <= 32 * 1024 * 1024 && (sizes.get(blob.size) ?? 0) > 1 && (globalThis.crypto?.subtle || blob.size <= 8 * 1024 * 1024)) {
        const hash = await sha256Hex(await blob.arrayBuffer());
        if (seenHashes.has(hash)) {
          results.push({ frameId: frame.id, decision: 'reject', confidence: 'high', score: 100, reason: 'duplicate' });
          onProgress(results.length);
          continue;
        }
        seenHashes.add(hash);
      }
      const url = await provider.getFullPreviewUrl(frame);
      if (!url) {
        results.push(missing);
      } else {
        const image = await loadImage(url);
        signal.throwIfAborted();
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        results.push(scorePreview(frame.id, context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
      }
    } catch {
      signal.throwIfAborted();
      results.push(missing);
    }
    onProgress(results.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return limitAutoKeepers(results, all, Math.max(0, goal - all.filter((frame) => frame.decision === 'keep').length));
}
