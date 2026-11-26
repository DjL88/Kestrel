import { BIREFNET_LITE, optionalModelFitsDevice } from '../core/optionalModels';
import { BIREFNET_INPUT, birefnetInput, birefnetMask, compareSubjectMasks, preferFineMask, type MaskComparison, type SoftMask } from '../core/birefnet';
import type { SubjectDetail, SubjectGrid } from '../core/maskTypes';
import { detailSizeFor } from '../core/subjectModel';
import { createTimedSession } from './modelTiming';
import { samMaskSize } from '../core/efficientSam';
import { friendlyToolError } from '../core/toolErrors';
import { isDesktopApp, isMobileShell } from './desktopShell';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';
import { loadOrt, ortOptions } from './ortRuntime';

/**
 * Fine-edge subject masks with BiRefNet-lite: a desktop "fine detail" pack (it needs several GB of memory at
 * 1024 px, so it is never offered on a phone or in a browser tab). Without it, the built-in U²-Netp subject mask
 * stays exactly as it is.
 */
type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
let loading: Promise<Loaded> | null = null;

const offeredHere = () => optionalModelFitsDevice(BIREFNET_LITE, isDesktopApp() && !isMobileShell() ? 'desktop' : 'phone');

export async function fineEdgeStatus(): Promise<OptionalModelStatus> {
  return offeredHere() ? optionalModelStatus(BIREFNET_LITE) : 'unavailable';
}
export async function downloadFineEdge(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (!offeredHere()) throw new Error(`${BIREFNET_LITE.name} is offered in the desktop app only.`);
  await downloadOptionalModel(BIREFNET_LITE, onProgress, signal);
}
export async function removeFineEdge(): Promise<void> { loading = null; await removeOptionalModel(BIREFNET_LITE); }

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const bytes = await readOptionalModelFile(BIREFNET_LITE, 'model');
    const ort = await loadOrt();
    const session = await createTimedSession(ort, BIREFNET_LITE.id, bytes, ortOptions());
    return { ort, session };
  })().catch((error) => {
    loading = null;
    console.warn('Fine-edge mask model failed to load', error);
    throw new Error(friendlyToolError(error, 'fine-edge mask model'));
  });
  return loading;
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

/** A soft subject mask at the photo's shape (long edge at most 1024), or null when the pack is not ready here. */
export async function fineEdgeMask(source: Source, signal?: AbortSignal): Promise<SoftMask | null> {
  if (await fineEdgeStatus() !== 'ready') return null;
  const { ort, session } = await load();
  signal?.throwIfAborted();
  const { w, h } = dims(source);
  const size = samMaskSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = BIREFNET_INPUT;
  canvas.height = BIREFNET_INPUT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, w, h, 0, 0, BIREFNET_INPUT, BIREFNET_INPUT);
  const input = birefnetInput(context.getImageData(0, 0, BIREFNET_INPUT, BIREFNET_INPUT).data);
  const out = await session.run({ input_image: new ort.Tensor('float32', input, [1, 3, BIREFNET_INPUT, BIREFNET_INPUT]) });
  signal?.throwIfAborted();
  return birefnetMask(out.output_image.data as Float32Array, size.w, size.h);
}

const decodeGrid = (grid: SubjectGrid): Uint8Array => Uint8Array.from(atob(grid.data), (c) => c.charCodeAt(0));
const encodeGrid = (alpha: Uint8Array, w: number, h: number): SubjectGrid => {
  let binary = '';
  for (let i = 0; i < alpha.length; i += 1) binary += String.fromCharCode(alpha[i]);
  return { w, h, data: btoa(binary) };
};

/** Nearest-cell samples of the soft mask over a normalised region of the frame, at w x h. */
function sampleRegion(fine: SoftMask, region: { x: number; y: number; w: number; h: number }, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(fine.h - 1, Math.floor((region.y + ((y + 0.5) / h) * region.h) * fine.h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(fine.w - 1, Math.floor((region.x + ((x + 0.5) / w) * region.w) * fine.w));
      out[y * w + x] = fine.alpha[sy * fine.w + sx];
    }
  }
  return out;
}

/**
 * On the desktop with the fine-edge pack installed: BiRefNet's soft mask as the subject grid (same size as the built-in
 * one) and as the fine outline over the same subject region (up to 384 cells), used only when both models found the
 * same subject (compareSubjectMasks). Null otherwise, so the built-in U²-Netp mask stays the default and a
 * disagreement never swaps the subject. The comparison goes back with it for the guardian's whole-subject check.
 */
export async function refineSubjectGrid(framed: HTMLCanvasElement, coarse: SubjectGrid, coarseDetail: SubjectDetail | null | undefined,
  signal?: AbortSignal): Promise<{ grid: SubjectGrid; detail: SubjectDetail; comparison: MaskComparison } | null> {
  const fine = await fineEdgeMask(framed, signal);
  if (!fine) return null;
  const whole = { x: 0, y: 0, w: 1, h: 1 };
  const alpha = sampleRegion(fine, whole, coarse.w, coarse.h);
  const comparison = compareSubjectMasks(decodeGrid(coarse), alpha);
  if (!preferFineMask(comparison)) return null;
  const region = coarseDetail?.region ?? whole;
  const size = detailSizeFor(Math.max(1, region.w * fine.w), Math.max(1, region.h * fine.h));
  return {
    grid: encodeGrid(alpha, coarse.w, coarse.h),
    detail: { region, grid: encodeGrid(sampleRegion(fine, region, size.w, size.h), size.w, size.h) },
    comparison,
  };
}
