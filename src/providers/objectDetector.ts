import { sha256Hex } from '../core/sha256';
import { friendlyToolError } from '../core/toolErrors';
import { bundledModelUrl } from './bundledModelAssets';
import { DETECTOR_MODEL, boxSharpness, decodeTile, mergeDetections, tilePlan, tileScale, toInput, type Box, type Detection } from '../core/objectDetection';

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const modelUrl = bundledModelUrl(DETECTOR_MODEL.file);
    if (!modelUrl) throw new Error('The optional subject detector is not installed in this preview. Original photos and manual editing remain available.');
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error('The subject detector could not be loaded.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== DETECTOR_MODEL.bytes || (await sha256Hex(bytes)) !== DETECTOR_MODEL.sha256) {
      throw new Error('The subject detector file does not match its checksum, so it was not used.');
    }
    const ort = await import('onnxruntime-web/wasm').catch(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return import('onnxruntime-web/wasm');
    });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((error) => {
    loading = null;
    console.warn('Subject detector failed to load', error);
    throw new Error(friendlyToolError(error));
  });
  return loading;
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

async function lookIn(source: Source, tile: Box, loaded: Loaded): Promise<Detection[]> {
  const scale = tileScale(tile);
  const w = Math.max(1, Math.round(tile.w * scale));
  const h = Math.max(1, Math.round(tile.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, tile.x, tile.y, tile.w, tile.h, 0, 0, w, h);
  const input = toInput(context.getImageData(0, 0, w, h).data, w, h);
  const size = DETECTOR_MODEL.inputSize;
  const results = await loaded.session.run({ [loaded.session.inputNames[0]]: new loaded.ort.Tensor('float32', input, [1, 3, size, size]) });
  const data = results[loaded.session.outputNames[0]]?.data;
  if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
  return decodeTile(data, tile);
}

export interface FoundSubject { detection: Detection; sharpness: number; /** Share of the photo the subject covers. */ coverage: number }

/**
 * The most likely subject of a photo, and how sharp it is. The whole photo is looked at first; only when nothing clear is found
 * is a big photo searched in tiles, so ordinary photos stay fast. Returns null when no subject is found.
 */
export async function findSubject(source: Source, signal?: AbortSignal): Promise<FoundSubject | null> {
  const loaded = await load();
  const { w, h } = dims(source);
  const plan = tilePlan(w, h);
  let detections = await lookIn(source, plan[0], loaded);
  if (!detections.some((d) => d.score >= 0.5)) {
    for (const tile of plan.slice(1)) {
      signal?.throwIfAborted();
      detections = detections.concat(await lookIn(source, tile, loaded));
    }
  }
  const best = mergeDetections(detections).sort((a, b) => b.score * Math.sqrt(b.box.w * b.box.h) - a.score * Math.sqrt(a.box.w * a.box.h))[0];
  if (!best) return null;
  return { detection: best, sharpness: sharpnessOf(source, best.box), coverage: (best.box.w * best.box.h) / (w * h) };
}

/** Sharpness inside the box, measured at a fixed size so a big subject and a small one compare fairly. */
function sharpnessOf(source: Source, box: Box): number {
  const pad = 0.1;
  const { w, h } = dims(source);
  const x = Math.max(0, box.x - box.w * pad);
  const y = Math.max(0, box.y - box.h * pad);
  const cw = Math.min(w - x, box.w * (1 + 2 * pad));
  const ch = Math.min(h - y, box.h * (1 + 2 * pad));
  const scale = Math.min(1, 160 / Math.max(cw, ch));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(cw * scale));
  canvas.height = Math.max(4, Math.round(ch * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  context.drawImage(source, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
  return boxSharpness(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
