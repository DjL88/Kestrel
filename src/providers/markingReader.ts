import { Sha256Stream } from '../core/sha256';
import { OCR_RECOGNISE, decodeText, detectorSize, recogniserWidth, textBoxes, type TextBox } from '../core/textOcr';
import { friendlyToolError } from '../core/toolErrors';
import { getModel, hasModel, putModel, removeModel } from './modelStore';

/**
 * Reads painted text (registrations, military serials) on an aircraft, on this device, with PP-OCRv5 mobile from
 * PaddleOCR (Apache-2.0): a 4.8 MB text finder and a 7.8 MB English recogniser. Opt-in: nothing is downloaded until the
 * person asks, each file is pinned by address, length and SHA-256 and refused if it does not match, and once kept it works
 * offline. Not in git. Shaped like the optional packs of src/core/optionalModels.ts (#1445), to join that list later.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const HF = 'https://huggingface.co/PaddlePaddle';
export const MARKING_PACK = {
  id: 'pp-ocrv5-mobile-en',
  name: 'Aircraft markings reader',
  licence: 'Apache-2.0',
  source: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx (revision e6f4fa85) and PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx (revision 3fafbc3b)',
  cache: 'kestrel-markings-v1',
  files: {
    detect: {
      url: env?.VITE_MARKING_DETECT_URL ?? `${HF}/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx`,
      sha256: env?.VITE_MARKING_DETECT_SHA256 ?? 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
      bytes: Number(env?.VITE_MARKING_DETECT_BYTES ?? 4826518),
    },
    recognise: {
      url: env?.VITE_MARKING_RECOGNISE_URL ?? `${HF}/en_PP-OCRv5_mobile_rec_onnx/resolve/3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b/inference.onnx`,
      sha256: env?.VITE_MARKING_RECOGNISE_SHA256 ?? 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f',
      bytes: Number(env?.VITE_MARKING_RECOGNISE_BYTES ?? 7848423),
    },
  },
} as const;
type FileKey = keyof typeof MARKING_PACK.files;
const KEYS: FileKey[] = ['detect', 'recognise'];
export const MARKING_PACK_BYTES = KEYS.reduce((sum, key) => sum + MARKING_PACK.files[key].bytes, 0);

export async function markingReaderReady(): Promise<boolean> {
  try { return (await Promise.all(KEYS.map((key) => hasModel(MARKING_PACK.cache, MARKING_PACK.files[key].url)))).every(Boolean); } catch { return false; }
}

/** Download both files, check each as it arrives, and keep them. Only ever called from the person's own action. */
export async function downloadMarkingReader(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  let done = 0;
  for (const key of KEYS) {
    const file = MARKING_PACK.files[key];
    if (await hasModel(MARKING_PACK.cache, file.url)) { done += file.bytes; continue; }
    const response = await fetch(file.url, { signal });
    if (!response.ok || !response.body) throw new Error('The aircraft markings reader could not be downloaded.');
    const reader = response.body.getReader();
    const hash = new Sha256Stream();
    const pieces: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      hash.update(value);
      pieces.push(value);
      received += value.length;
      onProgress(Math.min(0.98, (done + received) / MARKING_PACK_BYTES));
    }
    if (received !== file.bytes || hash.digest() !== file.sha256) {
      throw new Error('The downloaded markings reader does not match its checksum, so it was not kept. Try again.');
    }
    await putModel(MARKING_PACK.cache, file.url, new Blob(pieces as BlobPart[], { type: 'application/octet-stream' }));
    done += file.bytes;
  }
  onProgress(1);
}

export async function removeMarkingReader(): Promise<void> {
  loading = null;
  await Promise.all(KEYS.map((key) => removeModel(MARKING_PACK.cache, MARKING_PACK.files[key].url)));
}

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;
interface Loaded { ort: Ort; detect: Session; recognise: Session; characters: string[] }
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const bytes: Partial<Record<FileKey, Uint8Array>> = {};
    for (const key of KEYS) {
      const file = MARKING_PACK.files[key];
      const stored = await getModel(MARKING_PACK.cache, file.url);
      if (!stored) throw new Error('The aircraft markings reader has not been downloaded.');
      const data = new Uint8Array(await stored.arrayBuffer());
      const hash = new Sha256Stream();
      hash.update(data);
      if (data.byteLength !== file.bytes || hash.digest() !== file.sha256) throw new Error('The markings reader failed its integrity check, so it was not used.');
      bytes[key] = data;
    }
    const [ort, dictionary] = await Promise.all([import('onnxruntime-web/wasm'), import('../assets/registers/ocr-characters.json')]);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const options = { executionProviders: ['wasm'] };
    const detect = await ort.InferenceSession.create(bytes.detect!, options);
    const recognise = await ort.InferenceSession.create(bytes.recognise!, options);
    return { ort, detect, recognise, characters: dictionary.default.characters };
  })().catch((error) => {
    loading = null;
    console.warn('Markings reader failed to load', error);
    throw new Error(friendlyToolError(error, 'aircraft markings reader'));
  });
  return loading;
}

function planar(data: Uint8ClampedArray, width: number, height: number, mean: readonly number[], std: readonly number[]): Float32Array {
  const out = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) out[c * plane + i] = (data[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  return out;
}

function draw(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export interface ReadText { text: string; confidence: number; box: TextBox }

/**
 * Every line of text found inside `area` of `picture` (the aircraft's box, never the whole street), with how sure the
 * recogniser was. The caller decides what counts as a marking; nothing here is stored.
 */
export async function readText(picture: HTMLCanvasElement, area = { x: 0, y: 0, width: picture.width, height: picture.height }): Promise<ReadText[]> {
  const { ort, detect, recognise, characters } = await load();
  const size = detectorSize(area.width, area.height);
  const image = draw(picture, area.x, area.y, area.width, area.height, size.width, size.height);
  const detected = await detect.run({ [detect.inputNames[0]]: new ort.Tensor('float32', planar(image.data, size.width, size.height, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]), [1, 3, size.height, size.width]) });
  const map = detected[detect.outputNames[0]];
  const [mapHeight, mapWidth] = map.dims.slice(-2) as number[];
  const out: ReadText[] = [];
  for (const box of textBoxes(map.data as Float32Array, mapWidth, mapHeight, area.width, area.height)) {
    const width = recogniserWidth(box.width, box.height);
    const crop = draw(picture, area.x + box.x, area.y + box.y, box.width, box.height, width, OCR_RECOGNISE.height);
    const result = await recognise.run({ [recognise.inputNames[0]]: new ort.Tensor('float32', planar(crop.data, width, OCR_RECOGNISE.height, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), [1, 3, OCR_RECOGNISE.height, width]) });
    const scores = result[recognise.outputNames[0]];
    const [, steps, classes] = scores.dims as number[];
    const read = decodeText(scores.data as Float32Array, steps, classes, characters);
    if (read.text.trim()) out.push({ ...read, box: { ...box, x: area.x + box.x, y: area.y + box.y } });
  }
  return out;
}
