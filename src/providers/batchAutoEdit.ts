import { autoEnhance } from '../core/autoEnhance';
import { assessAutoQuality } from '../core/autoQualityGate';
import { applyPhotoEdit } from '../core/photoEdits';
import { DEFAULT_EDIT, isEmptyEdit, type PhotoEdit } from '../core/photoEdits';
import { recordEdit } from '../core/editHistory';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { loadImage } from './loadImage';

/** Preview-sized local analysis for each keeper, never uploaded or written to the original. */
export async function suggestKeeperAutoEdits(
  frames: PhotoFrame[], provider: BrowserPreviewProvider, signal: AbortSignal, onProgress: (done: number) => void,
  targetIds?: ReadonlySet<string>,
): Promise<Map<string, PhotoEdit>> {
  const candidates = frames.filter((frame) =>
    (targetIds ? targetIds.has(frame.id) : frame.decision === 'keep') && !frame.removedAt && !frame.virtualCopy &&
    !frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit)));
  const edits = new Map<string, PhotoEdit>();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Image analysis is unavailable on this device.');
  for (let i = 0; i < candidates.length; i += 1) {
    signal.throwIfAborted();
    const frame = candidates[i];
    try {
      const url = await provider.getFullPreviewUrl(frame);
      signal.throwIfAborted();
      if (url) {
        const image = await loadImage(url);
        signal.throwIfAborted();
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const source = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const { edit } = autoEnhance(source);
        const suggestion = { ...DEFAULT_EDIT, ...edit };
        if (!isEmptyEdit(suggestion)) {
          // A suggestion is not proof of improvement. Render it locally and refuse
          // automatic application if it blows highlights or radically shifts colour.
          // It remains available as a manual preview in Auto > Suggest a look.
          const proposed = new Uint8ClampedArray(source);
          applyPhotoEdit(proposed, suggestion);
          if (assessAutoQuality(source, proposed).safe) edits.set(frame.id, suggestion);
        }
      }
    } catch {
      signal.throwIfAborted();
      // One damaged or unavailable preview must not block the other keepers.
    }
    onProgress(i + 1);
    // Let the interface repaint and the user cancel between photographs.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return edits;
}

/** Stale scan results cannot overwrite an existing edit, a changed decision or a removed photograph. */
export function applyKeeperAutoEdits(
  frames: PhotoFrame[], edits: ReadonlyMap<string, PhotoEdit>, at: number, targetIds?: ReadonlySet<string>,
): PhotoFrame[] {
  return frames.map((frame) => {
    const suggested = edits.get(frame.id);
    if (!suggested || !(targetIds ? targetIds.has(frame.id) : frame.decision === 'keep') || frame.removedAt || frame.virtualCopy ||
        frame.editHistory?.steps.length || (frame.edit && !isEmptyEdit(frame.edit))) return frame;
    return recordEdit(frame, { edit: suggested }, at);
  });
}
