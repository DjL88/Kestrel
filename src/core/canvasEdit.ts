import { applyDetail, applyPhotoEdit, hasDetail, isNeutralEdit, isNeutralGlobal, isNeutralTone, type PhotoEdit } from './photoEdits';
import { applyMasks, fullContext, type MaskContext } from './masks';
import { applyFinishing, hasFinishing } from './finishing';
import { applyDehaze } from './dehaze';
import { applyCaptureDetail, deconvolutionParams } from './captureSharpen';
import { applyFringe, hasFringeEdit } from './fringe';

/** Colour fringe removal runs first, on the picture's own pixels, centred on the lens. */
function applyCanvasFringe(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void {
  if (!hasFringeEdit(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyFringe(pixels.data, canvas.width, canvas.height, 4, edit, mask, imageEdge);
  context.putImageData(pixels, 0, 0);
}

/** Dehaze runs on the picture's own pixels, after noise reduction and before tone. */
function applyCanvasDehaze(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number): void {
  if (!edit.dehaze) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyDehaze(pixels.data, canvas.width, canvas.height, 4, 255, edit.dehaze, imageEdge);
  context.putImageData(pixels, 0, 0);
}

/** Capture sharpening and deblur run after dehaze, before tone, on the picture's own detail. */
function applyCanvasCapture(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number): void {
  if (!deconvolutionParams(edit, imageEdge)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyCaptureDetail(pixels.data, canvas.width, canvas.height, edit, imageEdge);
  context.putImageData(pixels, 0, 0);
}

/** Vignette and grain run last, after masks, in framed-photo coordinates. */
function applyCanvasFinishing(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void {
  if (!hasFinishing(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyFinishing(pixels.data, canvas.width, canvas.height, edit, mask, imageEdge);
  context.putImageData(pixels, 0, 0);
}
import { hasActiveMasks, usesDetail } from './maskTypes';
import { applyNoiseReduction, hasNoiseReduction } from './noiseReduction';
import { denoiseHalo, originalDenoiseStrips, denoiseOnlyMasks } from './denoiseBands';
import { applyCanvasTrueDetailAi, preloadTrueDetailAi, TRUEDETAIL_AI_MISSING } from './trueDetailAiCanvas';

/** Colour noise reduction runs first, on the original pixels, before tone, sharpening and masks. */
function applyCanvasNoiseReduction(canvas: HTMLCanvasElement, edit: PhotoEdit): void {
  if (!hasNoiseReduction(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const cleaned = applyNoiseReduction(pixels.data, canvas.width, canvas.height, edit);
  if (cleaned === pixels.data) return;
  // Keep the canvas's own colour space (Display P3 on wide-gamut screens), or the pixels would be converted again.
  context.putImageData(new ImageData(cleaned as Uint8ClampedArray<ArrayBuffer>, canvas.width, canvas.height, { colorSpace: pixels.colorSpace }), 0, 0);
}

function applyCanvasDetail(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyDetail(pixels.data, canvas.width, canvas.height, edit, imageEdge);
  context.putImageData(pixels, 0, 0);
}

/** Masks run in bands so a full-size export never holds several whole-image buffers at once. */
function* canvasMaskBands(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): Generator<void> {
  if (!hasActiveMasks(edit.masks)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  // Bound all denoise-only masks, including independent subject overrides.
  // Keep the existing full-frame size guard and mixed-detail path unchanged.
  if (edit.masks && denoiseOnlyMasks(edit.masks) && canvas.width * canvas.height <= 80_000_000) {
    const halo = denoiseHalo(edit.masks);
    for (const { band, pixels } of originalDenoiseStrips(canvas.width, canvas.height, halo,
      band => context.getImageData(0, band.start, canvas.width, band.height))) {
      applyMasks(pixels.data, canvas.width, band.height, edit.masks, {
        aspect: mask.aspect, imageEdge,
        view: { x: mask.view.x, y: mask.view.y + mask.view.h * band.start / canvas.height,
          w: mask.view.w, h: mask.view.h * band.height / canvas.height },
      });
      context.putImageData(pixels, 0, band.start, 0, band.y - band.start, canvas.width, band.rows);
      yield;
    }
    return;
  }
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
    yield;
  }
}

function applyCanvasMasks(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void {
  for (const _ of canvasMaskBands(canvas, edit, mask, imageEdge)) {
    // Interactive preview keeps the existing synchronous pixel path.
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
  // The stored AI result was made from the photo's own pixels, so it goes in before anything else.
  applyCanvasTrueDetailAi(canvas, edit, maskContext, false);
  applyCanvasFringe(canvas, edit, maskContext, imageEdge);
  applyCanvasNoiseReduction(canvas, edit);
  applyCanvasDehaze(canvas, edit, imageEdge);
  applyCanvasCapture(canvas, edit, imageEdge);
  if (!isNeutralGlobal(edit) && !gpuRenderer?.(canvas, edit, imageEdge)) {
    for (const _ of editCanvasStrips(canvas, edit)) {
      // The fit preview has a bounded raster, so render it in one pass.
    }
    applyCanvasDetail(canvas, edit, imageEdge);
  }
  applyCanvasMasks(canvas, edit, maskContext, imageEdge);
  applyCanvasFinishing(canvas, edit, maskContext, imageEdge);
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
  if (edit.trueDetailAi && !await preloadTrueDetailAi(edit)) throw new Error(TRUEDETAIL_AI_MISSING);
  signal?.throwIfAborted();
  applyCanvasTrueDetailAi(canvas, edit, maskContext, true);
  applyCanvasFringe(canvas, edit, maskContext, edge);
  signal?.throwIfAborted();
  applyCanvasNoiseReduction(canvas, edit);
  signal?.throwIfAborted();
  applyCanvasDehaze(canvas, edit, edge);
  signal?.throwIfAborted();
  applyCanvasCapture(canvas, edit, edge);
  signal?.throwIfAborted();
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
  // Mask bands preserve the same pixel maths and coordinates as the preview,
  // but allow cancellation and input events between bands on large exports.
  let lastMaskYield = performance.now();
  for (const _ of canvasMaskBands(canvas, edit, maskContext, edge)) {
    signal?.throwIfAborted();
    if (performance.now() - lastMaskYield < 16) continue;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastMaskYield = performance.now();
  }
  signal?.throwIfAborted();
  applyCanvasFinishing(canvas, edit, maskContext, edge);
}
