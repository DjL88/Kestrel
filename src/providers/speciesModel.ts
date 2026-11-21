import { Sha256Stream } from '../core/sha256';
import { isDesktopApp } from './desktopShell';
import { getModel, hasModel, putModel, removeModel } from './modelStore';
import { installedModel } from './modelUpdater';
import { SPECIES_MODEL, centreSquare, preprocessSpecies } from '../core/speciesModel';
import { decodeVector, normalise, type SpeciesLabel } from '../core/speciesMatch';
import { readSpeciesRegions, worldLabelsForRegions } from '../core/speciesRegions';
import { friendlyToolError } from '../core/toolErrors';
import { subjectCrop, type SquareCrop } from '../core/subjectCrop';
import type { SubjectGrid } from '../core/maskTypes';
import { detectSubject } from './subjectDetector';
import { downloadGateModel, gateAvailable, removeGateModel } from './categoryGate';
import { GATE_MODEL } from '../core/categoryGate';

/** What the opt-in download fetches: the subject checker (category gate) and the species model. */
export const SPECIES_DOWNLOAD_BYTES = SPECIES_MODEL.bytes + GATE_MODEL.bytes;

export type SpeciesStatus = 'unavailable' | 'not-downloaded' | 'ready';

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
interface Labels { labels: SpeciesLabel[]; vectors: Float32Array[] }

let loading: Promise<Loaded> | null = null;
let labelsLoading: Promise<Labels> | null = null;
let labelsKey = '';
let worldLoading: Promise<SpeciesLabel[]> | null = null;

/** Is the feature set up, and has the model been downloaded to this device? Never throws. */
export async function speciesStatus(): Promise<SpeciesStatus> {
  if (!SPECIES_MODEL.url) return 'unavailable';
  // Desktop builds include the checked ONNX file in their assets. No second
  // download or user permission is necessary after installing the app.
  if (isDesktopApp() && SPECIES_MODEL.bundled) return 'ready';
  // In a browser, names are offered only with the subject checker on the device too: an earlier download without it
  // is offered again, and then only the checker is fetched.
  const [species, gate] = await Promise.all([hasModel(SPECIES_MODEL.cache, SPECIES_MODEL.url), gateAvailable()]);
  return species && gate ? 'ready' : 'not-downloaded';
}

/** Download the model once, check it, and keep it on this device for offline use. */
export async function downloadSpeciesModel(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (!SPECIES_MODEL.url) throw new Error('Species suggestions are not set up in this copy of Kite44.');
  try {
    // The subject checker first: a browser never has species names without the check that keeps aircraft from them.
    const gateShare = GATE_MODEL.bytes / SPECIES_DOWNLOAD_BYTES;
    await downloadGateModel((fraction) => onProgress(fraction * gateShare), signal);
    const speciesProgress = (fraction: number) => onProgress(gateShare + fraction * (1 - gateShare));
    if (await hasModel(SPECIES_MODEL.cache, SPECIES_MODEL.url)) { onProgress(1); return; }
    const response = await fetch(SPECIES_MODEL.url, { signal });
    if (!response.ok || !response.body) throw new Error('The model could not be downloaded.');
    const total = Number(response.headers.get('content-length')) || SPECIES_MODEL.bytes;
    const reader = response.body.getReader();
    // The file is checked as it arrives and kept as a list of pieces, so it is never held in memory a second time.
    const hash = new Sha256Stream();
    const pieces: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      hash.update(value);
      pieces.push(value);
      received += value.length;
      speciesProgress(Math.min(0.98, received / total));
    }
    if (received !== SPECIES_MODEL.bytes || hash.digest() !== SPECIES_MODEL.sha256) {
      throw new Error('The downloaded model does not match its checksum, so it was not kept. Try again.');
    }
    try {
      await putModel(SPECIES_MODEL.cache, SPECIES_MODEL.url, new Blob(pieces as BlobPart[], { type: 'application/octet-stream' }));
    } catch (storage) {
      console.warn('Species model could not be stored', storage);
      throw new Error('There is not enough room on this device to keep the model (about 90 MB). Free some space and try again.');
    }
    onProgress(1);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    console.warn('Species model download failed', error);
    const text = error instanceof Error ? error.message : '';
    throw new Error(/checksum|could not be downloaded|not set up|not enough room/.test(text) ? text : friendlyToolError(error, 'species model'));
  }
}

export async function removeSpeciesModel(): Promise<void> {
  loading = null;
  await removeModel(SPECIES_MODEL.cache, SPECIES_MODEL.url);
  await removeGateModel();
}

function loadSession(): Promise<Loaded> {
  loading ??= (async () => {
    // A same-contract update from the signed manifest (already checked against its signed checksum) comes first.
    const updated = await installedModel('bioclip-image-int8');
    const stored = updated ? undefined : await getModel(SPECIES_MODEL.cache, SPECIES_MODEL.url);
    let bytes: Uint8Array;
    if (updated) {
      bytes = new Uint8Array(updated.bytes);
    } else if (stored) {
      bytes = new Uint8Array(await stored.arrayBuffer());
    } else if (isDesktopApp() && SPECIES_MODEL.bundled && SPECIES_MODEL.url) {
      // Native installer ships this asset: resolve it through the app's own
      // local asset protocol. Verify again before executing any model weights.
      const response = await fetch(SPECIES_MODEL.url);
      if (!response.ok) throw new Error('The packaged species model is missing. Reinstall Kite44.');
      bytes = new Uint8Array(await response.arrayBuffer());
      const hash = new Sha256Stream();
      hash.update(bytes);
      if (bytes.byteLength !== SPECIES_MODEL.bytes || hash.digest() !== SPECIES_MODEL.sha256)
        throw new Error('The packaged species model failed its integrity check. Reinstall Kite44.');
    } else {
      throw new Error('The species model has not been downloaded.');
    }
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

/**
 * The names the model can match, with their vectors ready to compare. Loaded on demand. The shipped list (UK birds and
 * mammals, about 0.1 MB) is always used. The world bird list (about 9 MB, fetched once beside the model) adds the birds
 * that occur in the person's chosen regions. If it is missing the shipped list still works, so this never fails.
 */
export function loadSpeciesLabels(): Promise<Labels> {
  const regions = readSpeciesRegions();
  const key = regions.join(',');
  if (labelsLoading && labelsKey === key) return labelsLoading;
  labelsKey = key;
  labelsLoading = (async () => {
    const shipped = (await import('../assets/species/uk.json')).default.labels as SpeciesLabel[];
    const labels = [...shipped];
    try {
      const world = await loadWorldLabels();
      labels.push(...worldLabelsForRegions(world, regions, new Set(shipped.map((label) => label.scientific.toLowerCase()))));
    } catch (error) { console.warn('World species list unavailable; using the shipped list', error); }
    return { labels, vectors: labels.map(decodeVector) };
  })();
  return labelsLoading;
}

function loadWorldLabels(): Promise<SpeciesLabel[]> {
  worldLoading ??= (async () => {
    const url = SPECIES_MODEL.url.replace(/[^/]*$/, 'species-world.json');
    if (!url || url === 'species-world.json') return [];
    const response = await fetch(url);
    if (!response.ok) throw new Error(`world list ${response.status}`);
    const file = await response.json() as { dimensions?: number; labels?: SpeciesLabel[] };
    if (file.dimensions !== 512 || !Array.isArray(file.labels)) throw new Error('world list is not in the expected format');
    return file.labels;
  })().catch((error) => { worldLoading = null; throw error; });
  return worldLoading;
}

/** What the model "sees" in a picture, as a unit-length vector. Runs on this device. */
export async function embedPicture(picture: CanvasImageSource & { width: number; height: number }, crop?: SquareCrop): Promise<Float32Array> {
  const { ort, session } = await loadSession();
  const size = SPECIES_MODEL.size;
  const square = crop ?? centreSquare(picture.width, picture.height);
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

export interface PictureAnalysis {
  /** Where the subject is, when one was found. Used to show it and to choose what the species model looks at. */
  grid: SubjectGrid | null;
  embedding: Float32Array;
}

/**
 * One source-bound crop shared by the general animal/aircraft category gate
 * and the species embedding. When the local mask model is absent or uncertain,
 * both models use the same centred square instead of analysing different areas.
 * A crop is only a model input, never a keeper decision or confirmed species.
 */
export async function speciesSubjectCrop(picture: HTMLCanvasElement): Promise<{ crop: SquareCrop; grid: SubjectGrid | null }> {
  let grid: SubjectGrid | null = null;
  try {
    const found = await detectSubject(picture);
    if (found.assessment.usable) grid = found.grid;
  } catch { /* No reliable subject: both classifiers use the same centre square. */ }
  return { grid, crop: subjectCrop(picture.width, picture.height, grid) };
}

/** Find the subject once and classify the same pixels used for manual checks. */
export async function analysePicture(picture: HTMLCanvasElement): Promise<PictureAnalysis> {
  const { grid, crop } = await speciesSubjectCrop(picture);
  return { grid, embedding: await embedPicture(picture, crop) };
}
