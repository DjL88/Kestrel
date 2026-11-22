import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { DEFAULT_EDIT, type PhotoEdit } from '../core/photoEdits';
import type { Mask } from '../core/maskTypes';
import type { Pixels } from '../core/colourCheck';

/**
 * The real `render` callback the engine layer's actions need (today: `src/engine/denoiseAction.ts`'s
 * `runDenoiseAction`), backed by the actual canvas pipeline the live editor already uses
 * (`applyCanvasPhotoEdit` in `src/core/canvasEdit.ts`) - not a separate render implementation. This is
 * the "platform adapter" half of that split (CLAUDE.md: pure logic in src/core and src/engine, platform
 * differences only in src/providers); the engine action stays pure and testable with a fake renderer,
 * this is the one real implementation of it for the browser.
 *
 * DOM-dependent (HTMLCanvasElement, ImageData, CanvasRenderingContext2D): it can only run in a real
 * browser. It is type-checked in this repo but NOT executable or unit-testable in a plain Node sandbox,
 * the same limitation as `canvasEdit.ts` itself (covered by Playwright, not `node --test`).
 */
export function canvasPhotoRenderer(
  original: Pixels,
  imageEdge: number = Math.max(original.width, original.height),
): (edit: Partial<PhotoEdit>, masks: Mask[]) => Promise<Pixels> {
  return async (edit, masks) => {
    const canvas = document.createElement('canvas');
    canvas.width = original.width;
    canvas.height = original.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    // A fresh copy: the original Pixels must never be mutated by the edit we are about to try.
    context.putImageData(new ImageData(new Uint8ClampedArray(original.data), original.width, original.height), 0, 0);
    const fullEdit: PhotoEdit = { ...DEFAULT_EDIT, ...edit, masks: masks.length ? masks : undefined };
    applyCanvasPhotoEdit(canvas, fullEdit, imageEdge);
    const result = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data: result.data, width: result.width, height: result.height };
  };
}
