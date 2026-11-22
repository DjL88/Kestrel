import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import type { PhotoFrame } from '../../core/types';

/** The frames and preview provider the engine's canvas renderer draws from. The store hook publishes them here, so the
 * renderer is one stable component (it never remounts when a photo changes) and the UI stays free of engine objects. */
export interface SurfaceSnapshot { frames: ReadonlyMap<string, PhotoFrame>; provider: BrowserPreviewProvider | null }

let snapshot: SurfaceSnapshot = { frames: new Map(), provider: null };
const listeners = new Set<() => void>();

export const surfaceBridge = {
  get: (): SurfaceSnapshot => snapshot,
  set(frames: readonly PhotoFrame[], provider: BrowserPreviewProvider | null) {
    snapshot = { frames: new Map(frames.map((frame) => [frame.id, frame])), provider };
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
