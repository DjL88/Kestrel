import { BIREFNET_LITE, optionalModelFitsDevice } from '../core/optionalModels';
import { BIREFNET_INPUT, birefnetInput, birefnetMask, compareSubjectMasks, preferFineMask, type MaskComparison, type SoftMask } from '../core/birefnet';
import type { SubjectDetail, SubjectGrid } from '../core/maskTypes';
import { detailSizeFor } from '../core/subjectModel';
import { createOffThreadSession, type OffThreadSession } from './offThreadSession';
import { freeMemoryBytes } from './nativeResourceSample';
import { measureStep } from './previewTiming';
import { samMaskSize } from '../core/efficientSam';
import { friendlyToolError } from '../core/toolErrors';
import { isDesktopApp, isMobileShell } from './desktopShell';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * Fine-edge subject masks with BiRefNet-lite: a desktop "fine detail" pack (it needs several GB of memory at
 * 1024 px, so it is never offered on a phone or in a browser tab). Without it, the built-in U²-Netp subject mask
 * stays exactly as it is.
 *
 * It runs only in a background worker, never on the page: on the page one refinement held every click for over a
 * minute (owner's Windows test, 27 Nov). The model's input is fixed at 1024 px, so its working memory cannot be made
 * smaller; instead it starts only when that much memory is free, runs one refinement at a time, and its worker is ended
 * as soon as the answer is back, so the memory comes straight back to the machine.
 */
/** About what one refinement uses at its peak (measured near 5 GB in the app), plus room for everything else. */
export const FINE_EDGE_FREE_MEMORY_BYTES = 6 * 1024 ** 3;
let loading: Promise<Uint8Array> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Unknown free memory (no measurement: an older desktop build) runs as before; a measured shortage never starts it. */
export const fineEdgeMayRun = (freeBytes: number | null) => freeBytes === null || freeBytes >= FINE_EDGE_FREE_MEMORY_BYTES;

/** Why a refinement did not run, so the caller can say so in plain words. */
export class FineEdgeSkipped extends Error {
  constructor(readonly reason: 'memory') { super('Not enough free memory for the fine-edge mask right now.'); }
}

const offeredHere = () => optionalModelFitsDevice(BIREFNET_LITE, isDesktopApp() && !isMobileShell() ? 'desktop' : 'phone');

export async function fineEdgeStatus(): Promise<OptionalModelStatus> {
  return offeredHere() ? optionalModelStatus(BIREFNET_LITE) : 'unavailable';
}
export async function downloadFineEdge(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (!offeredHere()) throw new Error(`${BIREFNET_LITE.name} is offered in the desktop app only.`);
  await downloadOptionalModel(BIREFNET_LITE, onProgress, signal);
}
export async function removeFineEdge(): Promise<void> { loading = null; await removeOptionalModel(BIREFNET_LITE); }

/** The model file, read once per session of the app (about 90 MB); the model itself is started fresh for each run. */
function load(): Promise<Uint8Array> {
  loading ??= readOptionalModelFile(BIREFNET_LITE, 'model').catch((error) => {
    loading = null;
    console.warn('Fine-edge mask model failed to load', error);
    throw new Error(friendlyToolError(error, 'fine-edge mask model'));
  });
  return loading;
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

/**
 * A soft subject mask at the photo's shape (long edge at most 1024), or null when the pack is not ready here. Throws
 * FineEdgeSkipped when there is not enough free memory to run it now. One at a time.
 */
export function fineEdgeMask(source: Source, signal?: AbortSignal, free: () => Promise<number | null> = freeMemoryBytes): Promise<SoftMask | null> {
  const run = () => fineEdgeMaskNow(source, signal, free);
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

async function fineEdgeMaskNow(source: Source, signal: AbortSignal | undefined, free: () => Promise<number | null>): Promise<SoftMask | null> {
  if (await fineEdgeStatus() !== 'ready') return null;
  signal?.throwIfAborted();
  const memory = await free();
  if (!fineEdgeMayRun(memory)) throw new FineEdgeSkipped('memory');
  const bytes = await load();
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
  const started = performance.now();
  let session: OffThreadSession | null = null;
  try {
    // Worker only: never on the page, whatever happens.
    session = await createOffThreadSession(BIREFNET_LITE.id, bytes, { onThisThreadFallback: false });
    signal?.throwIfAborted();
    const out = await session.run({ input_image: { data: input, dims: [1, 3, BIREFNET_INPUT, BIREFNET_INPUT] } });
    signal?.throwIfAborted();
    if (!out.output_image) throw new Error('The fine-edge mask model returned an unexpected result.');
    return birefnetMask(out.output_image.data as Float32Array, size.w, size.h);
  } finally {
    session?.release();
    measureStep('fine-edge:run', started, { memoryBefore: memory });
  }
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
