import type { PhotoFrame } from './types';

export type Confidence = 'high' | 'medium' | 'low';
export type CullReason = 'duplicate' | 'clearDetail' | 'someDetail' | 'limitedDetail' | 'flat' | 'unavailable';

export interface CullSuggestion {
  frameId: string;
  decision: 'keep' | 'reject' | null;
  confidence: Confidence;
  score: number;
  reason: CullReason;
}

export function scorePreview(frameId: string, pixels: Uint8ClampedArray, width: number, height: number): CullSuggestion {
  // A truncated or malformed preview must never produce a confident culling decision.
  // Check dimensions before allocating the luminance buffer (including overflow).
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 64 || height < 64 || width * height > 16_777_216 ||
      pixels.length !== width * height * 4) {
    return { frameId, decision: null, confidence: 'low', score: 0, reason: 'unavailable' };
  }
  // Transparent pixels are not photographic exposure data. A fully transparent
  // canvas can otherwise look like a confidently flat, black photograph.
  let visible = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) visible += 1;
  }
  if (visible === 0) {
    return { frameId, decision: null, confidence: 'low', score: 0, reason: 'unavailable' };
  }
  const luma = new Float32Array(width * height);
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < luma.length; i += 1) {
    const j = i * 4;
    luma[i] = 0.213 * pixels[j] + 0.715 * pixels[j + 1] + 0.072 * pixels[j + 2];
    if (luma[i] < 12) dark += 1;
    if (luma[i] > 246) bright += 1;
  }

  // Use the strongest local regions so soft wildlife backgrounds do not dominate.
  const cells = new Float32Array(16);
  const counts = new Uint32Array(16);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const cell = Math.floor(y * 4 / height) * 4 + Math.floor(x * 4 / width);
      cells[cell] += Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width]);
      counts[cell] += 1;
    }
  }
  const regions = [...cells].map((sum, index) => sum / Math.max(1, counts[index])).sort((a, b) => b - a);
  const detail = (regions[0] + regions[1] + regions[2]) / 3;
  const clipped = (dark + bright) / luma.length;
  if (Math.max(dark, bright) / luma.length > 0.97 && detail < 2) {
    return { frameId, decision: 'reject', confidence: 'medium', score: 72, reason: 'flat' };
  }
  if (detail >= 12 && clipped < 0.12) {
    return { frameId, decision: 'keep', confidence: 'high', score: Math.min(98, Math.round(90 + detail / 6)), reason: 'clearDetail' };
  }
  if (detail >= 4 && clipped < 0.40) {
    return { frameId, decision: 'keep', confidence: 'medium', score: Math.min(84, Math.round(62 + detail)), reason: 'someDetail' };
  }
  return { frameId, decision: null, confidence: 'low', score: 40, reason: 'limitedDetail' };
}

export function limitAutoKeepers(
  suggestions: CullSuggestion[], frames: PhotoFrame[], remainingKeepers: number,
): CullSuggestion[] {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const occupied = new Set(frames.filter((frame) => !frame.removedAt && frame.decision === 'keep' && frame.burstGroupId)
    .map((frame) => frame.burstGroupId!));
  const accepted = new Set<string>();
  for (const result of [...suggestions].sort((a, b) => b.score - a.score)) {
    if (result.decision !== 'keep' || result.confidence !== 'high' || accepted.size >= remainingKeepers) continue;
    // A stale scan result cannot reserve keeper headroom for a photo that was
    // removed or manually reviewed while the scan was running.
    const frame = byId.get(result.frameId);
    if (!frame || frame.removedAt || frame.decision !== 'unreviewed' || frame.isDemo || frame.virtualCopy) continue;
    const burst = frame.burstGroupId;
    if (burst && occupied.has(burst)) continue;
    accepted.add(result.frameId);
    if (burst) occupied.add(burst);
  }
  return suggestions.map((result) => result.decision === 'keep' && result.confidence === 'high' && !accepted.has(result.frameId)
    ? { ...result, confidence: 'medium', score: 79 } : result);
}
