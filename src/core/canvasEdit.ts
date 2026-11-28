import { applyDetail, applyPhotoEdit, hasDetail, isNeutralEdit, isNeutralGlobal, isNeutralTone, type PhotoEdit } from './photoEdits';
import { applyMasks, fullContext, type MaskContext } from './masks';
import { applyFinishing, hasFinishing } from './finishing';
import { applyDehaze } from './dehaze';
import { applyCaptureDetail, deconvolutionParams } from './captureSharpen';
import { applyFringe, hasFringeEdit } from './fringe';
import { applyLensCorrection, hasLensCorrection } from './lensCorrection';
import { applyHeal, hasHeal } from './heal';

/** Spot healing runs after lens corrections, on the picture's own pixels, so spots sit where the person placed them. */
function applyCanvasHeal(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void {
  if (!hasHeal(edit.heal)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyHeal(pixels.data, canvas.width, canvas.height, 4, 255, edit.heal, mask, mask.imageEdge ?? imageEdge);
  context.putImageData(pixels, 0, 0);
}

/** Lens corrections and colour fringe removal run first, on the picture's own pixels, centred on the lens. */
function applyCanvasFringe(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void {
  if (!hasFringeEdit(edit) && !hasLensCorrection(edit.lens)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyLensCorrection(pixels.data, canvas.width, canvas.height, 4, edit.lens, mask);
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
import { applyCanvasTrueDetailAi, preloadTrueDetailAi, trueDetailAiReady, TRUEDETAIL_AI_MISSING } from './trueDetailAiCanvas';
import type { StageCacheUse } from './stageCache';

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

/**
 * The stages before tone, in order, each with the settings it reads. They only read these settings, the canvas pixels,
 * imageEdge and the mask context, so a key built from them names their output exactly (src/core/stageCache.ts).
 */
interface EarlyStage {
  name: string;
  /** The stage's own inputs, or null when it would leave the picture untouched. */
  inputs(edit: PhotoEdit, imageEdge: number): unknown;
  run(canvas: HTMLCanvasElement, edit: PhotoEdit, mask: MaskContext, imageEdge: number): void;
}

const EARLY_STAGES: readonly EarlyStage[] = [
  // The stored AI result was made from the photo's own pixels, so it goes in before anything else. It blends by the
  // subject masks, so they are part of its inputs, and it only draws once the result is decoded on this device.
  { name: 'ai', inputs: (e) => e.trueDetailAi && trueDetailAiReady(e) ? [e.trueDetailAi, e.masks ?? null] : null,
    run: (c, e, m) => applyCanvasTrueDetailAi(c, e, m, false) },
  { name: 'lens', inputs: (e) => hasFringeEdit(e) || hasLensCorrection(e.lens) ? [e.lens ?? null, e.lateralCa ?? null, e.defringe ?? null] : null,
    run: applyCanvasFringe },
  { name: 'heal', inputs: (e) => hasHeal(e.heal) ? e.heal : null, run: applyCanvasHeal },
  { name: 'noise', inputs: (e) => hasNoiseReduction(e) ? [e.denoise ?? 0, e.denoiseLuminance ?? 0, e.denoiseZones ?? null] : null,
    run: (c, e) => applyCanvasNoiseReduction(c, e) },
  { name: 'dehaze', inputs: (e) => e.dehaze ? e.dehaze : null, run: (c, e, _m, edge) => applyCanvasDehaze(c, e, edge) },
  { name: 'capture', inputs: (e, edge) => deconvolutionParams(e, edge) ? [e.captureSharpen ?? null, e.deblur ?? 0] : null,
    run: (c, e, _m, edge) => applyCanvasCapture(c, e, edge) },
];

/**
 * Run the early stages, starting from the deepest one a previous render already left in the stage cache, and keep the
 * picture after each stage that ran. Without a cache every stage runs, exactly as before.
 */
function applyEarlyStages(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number, mask: MaskContext, use?: StageCacheUse): void {
  const active = EARLY_STAGES.map((stage) => ({ stage, inputs: stage.inputs(edit, imageEdge) })).filter(({ inputs }) => inputs !== null);
  if (!use || !active.length) {
    for (const { stage } of active) stage.run(canvas, edit, mask, imageEdge);
    return;
  }
  const keys: string[] = [];
  let key = JSON.stringify([use.sourceKey, canvas.width, canvas.height, imageEdge, mask]);
  for (const { stage, inputs } of active) {
    key += `|${stage.name}:${JSON.stringify(inputs)}`;
    keys.push(key);
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  let start = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const snapshot = use.cache.get(keys[i]);
    if (snapshot && snapshot.width === canvas.width && snapshot.height === canvas.height) {
      context.putImageData(snapshot as ImageData, 0, 0);
      start = i + 1;
      break;
    }
  }
  for (let i = start; i < active.length; i++) {
    active[i].stage.run(canvas, edit, mask, imageEdge);
    use.cache.set(keys[i], context.getImageData(0, 0, canvas.width, canvas.height));
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
  stageCache?: StageCacheUse,
): void {
  if (isNeutralEdit(edit)) return;
  applyEarlyStages(canvas, edit, imageEdge, maskContext, stageCache);
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
  applyCanvasHeal(canvas, edit, maskContext, edge);
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
