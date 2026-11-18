import {
  applyDetail,
  applyDetailFloat,
  applyPhotoEdit,
  applyPhotoEditLinearInPlace,
  displayFloatToRgbaBytes,
  hasDetail,
  isNeutralEdit,
  isNeutralGlobal,
  isNeutralTone,
  rgbaBytesToLinearFloat,
  type PhotoEdit,
} from './photoEdits';
import { applyMasks, applyMasksFloat, fullContext, type MaskContext } from './masks';
import { hasActiveMasks, usesDetail } from './maskTypes';
import { applyNoiseReduction, applyNoiseReductionLinearRGBA, hasNoiseReduction } from './noiseReduction';

/** Colour noise reduction runs first, on the original pixels, before tone, sharpening and masks. */
function applyCanvasNoiseReduction(canvas: HTMLCanvasElement, edit: PhotoEdit): void {
  if (!hasNoiseReduction(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const cleaned = applyNoiseReduction(pixels.data, canvas.width, canvas.height, edit);
  if (cleaned === pixels.data) return;
  context.putImageData(new ImageData(cleaned as Uint8ClampedArray<ArrayBuffer>, canvas.width, canvas.height), 0, 0);
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

/**
 * Full continuous Float32 CPU reference pipeline:
 * sRGB bytes -> scene-linear Float32 -> linear chroma denoise -> scene-linear tone/WB/filmic/curve ->
 * display-float luminance-ratio detail -> guided-filter local masks -> single final 8-bit encode.
 */
function runContinuousFloatPipeline(
  canvas: HTMLCanvasElement,
  edit: PhotoEdit,
  imageEdge: number,
  maskContext: MaskContext,
): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  let floatBuf = rgbaBytesToLinearFloat(imageData.data);
  if (hasNoiseReduction(edit)) {
    floatBuf = applyNoiseReductionLinearRGBA(floatBuf, canvas.width, canvas.height, edit);
  }
  applyPhotoEditLinearInPlace(floatBuf, edit);
  if (hasDetail(edit)) {
    applyDetailFloat(floatBuf, canvas.width, canvas.height, edit, imageEdge);
  }
  if (hasActiveMasks(edit.masks)) {
    applyMasksFloat(floatBuf, canvas.width, canvas.height, edit.masks, {
      aspect: maskContext.aspect,
      imageEdge,
      view: maskContext.view,
    });
  }
  displayFloatToRgbaBytes(floatBuf, imageData.data);
  context.putImageData(imageData, 0, 0);
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

const FLOAT_PREVIEW_MAX_PIXELS = 8_000_000;

/**
 * imageEdge is the whole image's long edge in this canvas's pixels. maskContext says which part of the framed
 * photo the canvas shows, and both default to a canvas that holds the whole framed photo.
 */
export function applyCanvasPhotoEdit(
  canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge = Math.max(canvas.width, canvas.height),
  maskContext: MaskContext = fullContext(canvas.width, canvas.height),
): void {
  if (isNeutralEdit(edit)) return;
  const pixelCount = canvas.width * canvas.height;
  if (!gpuRenderer && pixelCount <= FLOAT_PREVIEW_MAX_PIXELS) {
    runContinuousFloatPipeline(canvas, edit, imageEdge, maskContext);
    return;
  }
  applyCanvasNoiseReduction(canvas, edit);
  if (!isNeutralGlobal(edit) && !gpuRenderer?.(canvas, edit, imageEdge)) {
    if (pixelCount <= FLOAT_PREVIEW_MAX_PIXELS) {
      runContinuousFloatPipeline(canvas, { ...edit, denoise: 0, masks: undefined }, imageEdge, maskContext);
    } else {
      for (const _ of editCanvasStrips(canvas, edit)) {
        // Large canvases without GPU use bounded strips.
      }
      if (hasDetail(edit)) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
          applyDetail(px.data, canvas.width, canvas.height, edit, imageEdge);
          ctx.putImageData(px, 0, 0);
        }
      }
    }
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
  const pixelCount = canvas.width * canvas.height;
  if (!gpuRenderer && pixelCount <= FLOAT_PREVIEW_MAX_PIXELS) {
    runContinuousFloatPipeline(canvas, edit, edge, maskContext);
    return;
  }
  applyCanvasNoiseReduction(canvas, edit);
  signal?.throwIfAborted();
  if (!isNeutralGlobal(edit) && !gpuRenderer?.(canvas, edit, edge)) {
    let lastYield = performance.now();
    for (const _ of editCanvasStrips(canvas, edit)) {
      signal?.throwIfAborted();
      if (performance.now() - lastYield < 16) continue;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
    if (hasDetail(edit)) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
        applyDetail(px.data, canvas.width, canvas.height, edit, edge);
        ctx.putImageData(px, 0, 0);
      }
    }
  }
  signal?.throwIfAborted();
  applyCanvasMasks(canvas, edit, maskContext, edge);
}

/**
 * Evaluates a scene-linear Float32 RGB buffer directly through the continuous Float32 pipeline
 * and quantizes once directly to 16-bit unsigned display RGB (0..65535), zero 8-bit banding.
 */
export function exportLinearRgbToRgb16(
  linearRgb: Float32Array,
  width: number,
  height: number,
  edit: PhotoEdit,
  imageEdge = Math.max(width, height),
  maskContext: MaskContext = fullContext(width, height),
): Uint16Array {
  const count = width * height;
  let floatRgba: Float32Array = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    floatRgba[i * 4] = linearRgb[i * 3];
    floatRgba[i * 4 + 1] = linearRgb[i * 3 + 1];
    floatRgba[i * 4 + 2] = linearRgb[i * 3 + 2];
    floatRgba[i * 4 + 3] = 1;
  }
  if (hasNoiseReduction(edit)) {
    floatRgba = applyNoiseReductionLinearRGBA(floatRgba, width, height, edit);
  }
  applyPhotoEditLinearInPlace(floatRgba, edit);
  if (hasDetail(edit)) {
    applyDetailFloat(floatRgba, width, height, edit, imageEdge);
  }
  if (hasActiveMasks(edit.masks)) {
    applyMasksFloat(floatRgba, width, height, edit.masks, {
      aspect: maskContext.aspect,
      imageEdge,
      view: maskContext.view,
    });
  }
  const rgb16 = new Uint16Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    rgb16[i * 3] = Math.round(Math.min(1, Math.max(0, floatRgba[i * 4])) * 65535);
    rgb16[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, floatRgba[i * 4 + 1])) * 65535);
    rgb16[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, floatRgba[i * 4 + 2])) * 65535);
  }
  return rgb16;
}

/**
 * Evaluates a canvas image through Kestrel's continuous Float32 pipeline straight into 16-bit RGB,
 * preventing intermediate 8-bit quantization across tonal curves, highlight roll-off, and gradients.
 */
export function exportCanvasRgb16(
  canvas: HTMLCanvasElement,
  edit: PhotoEdit,
  imageEdge = Math.max(canvas.width, canvas.height),
  maskContext: MaskContext = fullContext(canvas.width, canvas.height),
): Uint16Array {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  let floatBuf: Float32Array = rgbaBytesToLinearFloat(imageData.data);
  if (hasNoiseReduction(edit)) {
    floatBuf = applyNoiseReductionLinearRGBA(floatBuf, canvas.width, canvas.height, edit);
  }
  applyPhotoEditLinearInPlace(floatBuf, edit);
  if (hasDetail(edit)) {
    applyDetailFloat(floatBuf, canvas.width, canvas.height, edit, imageEdge);
  }
  if (hasActiveMasks(edit.masks)) {
    applyMasksFloat(floatBuf, canvas.width, canvas.height, edit.masks, {
      aspect: maskContext.aspect,
      imageEdge,
      view: maskContext.view,
    });
  }
  const count = canvas.width * canvas.height;
  const rgb16 = new Uint16Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    rgb16[i * 3] = Math.round(Math.min(1, Math.max(0, floatBuf[i * 4])) * 65535);
    rgb16[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, floatBuf[i * 4 + 1])) * 65535);
    rgb16[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, floatBuf[i * 4 + 2])) * 65535);
  }
  return rgb16;
}

