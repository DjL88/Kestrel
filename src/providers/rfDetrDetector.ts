import { RFDETR_NANO } from '../core/optionalModels';
import { RFDETR_INPUT, decodeRfDetr, rfDetrInput, tandemDetections, type TandemDetection } from '../core/rfDetr';
import { mergeDetections, tilePlan, type Box, type Detection } from '../core/objectDetection';
import { friendlyToolError } from '../core/toolErrors';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * RF-DETR Nano on this device, as an optional download that runs in tandem with YOLOX-tiny. With the pack missing,
 * not offered, or failing to load, `findSubjectsTandem` returns YOLOX's answer alone, so nothing gets worse.
 * Runs through the same onnxruntime-web WASM runtime as the other models. No network unless the photographer
 * chooses `downloadRfDetr`.
 */
type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
let loading: Promise<Loaded> | null = null;

export const rfDetrStatus = (): Promise<OptionalModelStatus> => optionalModelStatus(RFDETR_NANO);
export const downloadRfDetr = (onProgress: (fraction: number) => void, signal?: AbortSignal) =>
  downloadOptionalModel(RFDETR_NANO, onProgress, signal);
export async function removeRfDetr(): Promise<void> { loading = null; await removeOptionalModel(RFDETR_NANO); }

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const bytes = await readOptionalModelFile(RFDETR_NANO, 'model');
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((error) => {
    loading = null;
    console.warn('RF-DETR failed to load', error);
    throw new Error(friendlyToolError(error, 'RF-DETR subject detector'));
  });
  return loading;
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

async function lookIn(loaded: Loaded, source: Source, tile: Box): Promise<Detection[]> {
  const canvas = document.createElement('canvas');
  canvas.width = RFDETR_INPUT;
  canvas.height = RFDETR_INPUT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, tile.x, tile.y, tile.w, tile.h, 0, 0, RFDETR_INPUT, RFDETR_INPUT);
  const input = rfDetrInput(context.getImageData(0, 0, RFDETR_INPUT, RFDETR_INPUT).data);
  const { ort, session } = loaded;
  const out = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, RFDETR_INPUT, RFDETR_INPUT]) });
  return decodeRfDetr(out.logits.data as Float32Array, out.pred_boxes.data as Float32Array, tile);
}

/** RF-DETR's own answer over the same whole-photo-then-tiles plan YOLOX uses. Throws when the pack is not usable. */
export async function findSubjectsRfDetr(source: Source, signal?: AbortSignal): Promise<Detection[]> {
  const loaded = await load();
  const { w, h } = dims(source);
  if (!(w > 0 && h > 0)) return [];
  const found: Detection[] = [];
  for (const tile of tilePlan(w, h)) {
    signal?.throwIfAborted();
    found.push(...await lookIn(loaded, source, tile));
  }
  return mergeDetections(found);
}

/** The same bar YOLOX's subject list uses (0.5), so the two answers are compared like for like. */
export const RFDETR_KEEP_SCORE = 0.5;

/**
 * Both detectors, compared (`tandemDetections`), given YOLOX's own answer for the same photo. RF-DETR runs only when
 * its pack is downloaded; when it is missing or fails, the YOLOX answer comes back unchanged in meaning (no review
 * flags). Every subject is kept separately. objectDetector.ts calls this, so every subject scan gets the tandem.
 */
export async function tandemWithRfDetr(source: Source, yolox: readonly Detection[], signal?: AbortSignal): Promise<TandemDetection[]> {
  let rfdetr: Detection[] | null = null;
  if (await rfDetrStatus().catch(() => 'unavailable') === 'ready') {
    try { rfdetr = (await findSubjectsRfDetr(source, signal)).filter((d) => d.score >= RFDETR_KEEP_SCORE); } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      console.warn('RF-DETR unavailable for this photo; using YOLOX alone', error);
    }
  }
  return tandemDetections(rfdetr, yolox);
}
