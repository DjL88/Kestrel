import { sha256Hex } from '../core/sha256';
import { SPECIES_MODEL, centreSquare, preprocessSpecies } from '../core/speciesModel';
import { decodeVector, normalise, type SpeciesLabel } from '../core/speciesMatch';
import { friendlyToolError } from '../core/toolErrors';

export type SpeciesStatus = 'unavailable' | 'not-downloaded' | 'ready';

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
interface Labels { labels: SpeciesLabel[]; vectors: Float32Array[] }

let loading: Promise<Loaded> | null = null;
let labelsLoading: Promise<Labels> | null = null;

async function cached(): Promise<Response | undefined> {
  if (!SPECIES_MODEL.url || typeof caches === 'undefined') return undefined;
  try { return await (await caches.open(SPECIES_MODEL.cache)).match(SPECIES_MODEL.url); } catch { return undefined; }
}

/** Is the feature set up, and has the model been downloaded to this device? Never throws. */
export async function speciesStatus(): Promise<SpeciesStatus> {
  if (!SPECIES_MODEL.url) return 'unavailable';
  return (await cached()) ? 'ready' : 'not-downloaded';
}

/** Download the model once, check it, and keep it on this device for offline use. */
export async function downloadSpeciesModel(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (!SPECIES_MODEL.url) throw new Error('Species suggestions are not set up in this copy of Kestrel.');
  try {
    const response = await fetch(SPECIES_MODEL.url, { signal });
    if (!response.ok || !response.body) throw new Error('The model could not be downloaded.');
    const total = Number(response.headers.get('content-length')) || SPECIES_MODEL.bytes;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(1, received / total));
    }
    const bytes = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    if (bytes.byteLength !== SPECIES_MODEL.bytes || (await sha256Hex(bytes.buffer)) !== SPECIES_MODEL.sha256) {
      throw new Error('The downloaded model does not match its checksum, so it was not kept. Try again.');
    }
    const store = await caches.open(SPECIES_MODEL.cache);
    await store.put(SPECIES_MODEL.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    onProgress(1);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    console.warn('Species model download failed', error);
    const text = error instanceof Error ? error.message : '';
    throw new Error(/checksum|could not be downloaded|not set up/.test(text) ? text : friendlyToolError(error, 'species model'));
  }
}

export async function removeSpeciesModel(): Promise<void> {
  loading = null;
  try { await caches.delete(SPECIES_MODEL.cache); } catch { /* Nothing was stored. */ }
}

function loadSession(): Promise<Loaded> {
  loading ??= (async () => {
    const response = await cached();
    if (!response) throw new Error('The species model has not been downloaded.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const ort = await import('onnxruntime-web/wasm').catch(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return import('onnxruntime-web/wasm');
    });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((error) => {
    loading = null;
    console.warn('Species model failed to load', error);
    throw new Error(friendlyToolError(error, 'species model'));
  });
  return loading;
}

/** The names the model can match, with their vectors ready to compare. Loaded on demand, about 0.1 MB. */
export function loadSpeciesLabels(): Promise<Labels> {
  labelsLoading ??= import('../assets/species/uk.json').then((file) => {
    const labels = file.default.labels as SpeciesLabel[];
    return { labels, vectors: labels.map(decodeVector) };
  });
  return labelsLoading;
}

/** What the model "sees" in a picture, as a unit-length vector. Runs on this device. */
export async function embedPicture(picture: CanvasImageSource & { width: number; height: number }): Promise<Float32Array> {
  const { ort, session } = await loadSession();
  const size = SPECIES_MODEL.size;
  const square = centreSquare(picture.width, picture.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, square.x, square.y, square.size, square.size, 0, 0, size, size);
  const input = preprocessSpecies(context.getImageData(0, 0, size, size).data, size);
  const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
  return normalise(Float32Array.from(results[session.outputNames[0]].data as Float32Array));
}
