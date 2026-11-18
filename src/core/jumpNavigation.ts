import type { PhotoFrame } from './types';

export type JumpRequest =
  | { kind: 'first' | 'last' | 'last-edited' }
  | { kind: 'frame'; number: number }
  | { kind: 'captured-at'; timestamp: number };

/** Resolve navigation from catalogue metadata alone, without loading intermediate photos. */
export function jumpTarget(frames: readonly PhotoFrame[], request: JumpRequest): PhotoFrame | null {
  if (!frames.length) return null;
  if (request.kind === 'first') return frames[0];
  if (request.kind === 'last') return frames[frames.length - 1];
  if (request.kind === 'frame') {
    if (!Number.isSafeInteger(request.number) || request.number < 1) return null;
    return frames.find((frame) => frame.sequenceIndex === request.number) ?? null;
  }
  if (request.kind === 'captured-at') {
    if (!Number.isFinite(request.timestamp)) return null;
    let nearest: PhotoFrame | null = null;
    let distance = Infinity;
    for (const frame of frames) {
      const taken = frame.exif.capturedAtMs;
      if (typeof taken !== 'number' || !Number.isFinite(taken)) continue;
      const delta = Math.abs(taken - request.timestamp);
      if (delta < distance) { nearest = frame; distance = delta; }
    }
    return nearest;
  }
  let mostRecent: PhotoFrame | null = null;
  let lastChange = -Infinity;
  for (const frame of frames) {
    const history = frame.editHistory;
    if (!history?.steps.length) continue;
    const step = history.steps.reduce((max, item) =>
      Number.isFinite(item.at) ? Math.max(max, item.at) : max, -Infinity);
    if (step > lastChange) { lastChange = step; mostRecent = frame; }
  }
  return mostRecent;
}
