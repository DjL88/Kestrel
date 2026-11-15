import { applyDetail, applyPhotoEdit, hasDetail, isNeutralEdit, isNeutralGlobal, isNeutralTone, type PhotoEdit } from './photoEdits';
import { applyMasks, fullContext, type MaskContext } from './masks';
import { hasActiveMasks, usesDetail } from './maskTypes';

function applyCanvasDetail(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyDetail(pixels.data, canvas.width, canvas.height, edit, imageEdge);
  context.putImageData(pixels, 0, 0);
}

/** Masks run in bands so a full-size export never holds several whole-image buffers at once. */
function applyCanvasMasks(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void {
  if (!hasActiveMasks(edit.masks)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  // Detail controls look at neighbouring pixels, so a mask that uses them is processed in one piece to avoid seams.
  const rows = usesDetail(edit.masks) ? canvas.height : Math.max(1, Math.floor(1_000_000 / canvas.width));
  for (let y = 0; y < canvas.height; y += rows) {
    const band = Math.min(rows, canvas.height - y);
    const pixels = context.getImageData(0, y, canvas.width, band);
    applyMasks(pixels.data, canvas.width, band, edit.masks, {
      aspect: mask.aspect, imageEdge,
      view: { x: mask.view.x, y: mask.view.y + mask.view.h * (y / canvas.height), w: mask.view.w, h: mask.view.h * (band / canvas.height) },
    });
    context.putImageData(pixels, 0, y);
  }
}

function* editCanvasStrips(canvas: HTMLCanvasElement, edit: PhotoEdit): Generator<void> {
  if (isNeutralTone(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const rows = Math.max(1, Math.floor(262144 / canvas.width));
  for (let y = 0; y < canvas.height; y += rows) {
    const pixels = context.getImageData(0, y, canvas.width, Math.min(rows, canvas.height - y));
    applyPhotoEdit(pixels.data, edit);
    context.putImageData(pixels, 0, y);
    yield;
  }
}

type GpuRenderer = (canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number) => boolean;
let gpuRenderer: GpuRenderer | null = null;
/** Register a GPU renderer. It returns false when it cannot handle the canvas, and the CPU path runs instead. */
export function setGpuRenderer(renderer: GpuRenderer | null): void {
  gpuRenderer = renderer;
}

/**
 * imageEdge is the whole image's long edge in this canvas's pixels. maskContext says which part of the framed
 * photo the canvas shows, and both default to a canvas that holds the whole framed photo.
 */
export function applyCanvasPhotoEdit(
  canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge = Math.max(canvas.width, canvas.height),
  maskContext: MaskContext = fullContext(canvas.width, canvas.height),
): void {
  if (isNeutralEdit(edit)) return;
  if (!isNeutralGlobal(edit) && !gpuRenderer?.(canvas, edit, imageEdge)) {
    for (const _ of editCanvasStrips(canvas, edit)) {
      // The fit preview has a bounded raster, so render it in one pass.
    }
    applyCanvasDetail(canvas, edit, imageEdge);
  }
  applyCanvasMasks(canvas, edit, maskContext, imageEdge);
}

/**
 * Apply an edit to an export canvas. When the canvas holds only part of the framed photo (a crop made for a social
 * format), pass the whole photo's long edge in this canvas's pixels and which part is shown, so detail scales and
 * masks land where they should. Both default to a canvas that holds the whole framed photo.
 */
export async function applyCanvasExportEdit(
  canvas: HTMLCanvasElement, edit: PhotoEdit, signal?: AbortSignal,
  imageEdge = Math.max(canvas.width, canvas.height), maskContext: MaskContext = fullContext(canvas.width, canvas.height),
): Promise<void> {
  if (isNeutralEdit(edit)) return;
  const edge = imageEdge;
  if (!isNeutralGlobal(edit) && !gpuRenderer?.(canvas, edit, edge)) {
    let lastYield = performance.now();
    for (const _ of editCanvasStrips(canvas, edit)) {
      signal?.throwIfAborted();
      if (performance.now() - lastYield < 16) continue;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
    applyCanvasDetail(canvas, edit, edge);
  }
  signal?.throwIfAborted();
  applyCanvasMasks(canvas, edit, maskContext, edge);
}
