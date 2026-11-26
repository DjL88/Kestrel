import { createTimedSession } from './modelTiming';
import { Sha256Stream } from '../core/sha256';
import { installedModel } from './modelUpdater';
import { GATE_MODEL, gateVectors } from '../core/categoryGate';
import { preprocessSpecies } from '../core/speciesModel';
import { normalise } from '../core/speciesMatch';
import { routeSubject, type RouteResult, type SubjectCategory } from '../core/subjectRouter';
import type { SquareCrop } from '../core/subjectCrop';
import { friendlyToolError } from '../core/toolErrors';
import { isDesktopApp } from './desktopShell';
import { getModel, hasModel, putModel, removeModel } from './modelStore';
import { loadOrt, ortOptions } from './ortRuntime';

/**
 * Runs the category gate's image model (CLIP ViT-B/32, MIT, public/models) on this device and routes the picture.
 * The desktop app and the phone/tablet shells carry the file with the app. In a browser it comes with the species model,
 * in the same opt-in download, and is kept on the device for offline use.
 */
export async function gateAvailable(): Promise<boolean> {
  if (isDesktopApp()) return true;
  return hasModel(GATE_MODEL.cache, GATE_MODEL.url).catch(() => false);
}

/** Download the gate model in a browser, check it as it arrives, and keep it. Progress is 0 to 1. */
export async function downloadGateModel(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (isDesktopApp() || await hasModel(GATE_MODEL.cache, GATE_MODEL.url)) { onProgress(1); return; }
  const response = await fetch(GATE_MODEL.url, { signal });
  if (!response.ok || !response.body) throw new Error('The subject checker could not be downloaded.');
  const reader = response.body.getReader();
  const hash = new Sha256Stream();
  const pieces: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    hash.update(value);
    pieces.push(value);
    received += value.length;
    onProgress(Math.min(0.98, received / GATE_MODEL.bytes));
  }
  if (received !== GATE_MODEL.bytes || hash.digest() !== GATE_MODEL.sha256) {
    throw new Error('The downloaded subject checker does not match its checksum, so it was not kept. Try again.');
  }
  await putModel(GATE_MODEL.cache, GATE_MODEL.url, new Blob(pieces as BlobPart[], { type: 'application/octet-stream' }));
  onProgress(1);
}

export async function removeGateModel(): Promise<void> {
  loading = null;
  await removeModel(GATE_MODEL.cache, GATE_MODEL.url);
}

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession; categories: SubjectCategory[]; vectors: Float32Array[] }
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    let bytes: Uint8Array;
    // A same-contract update from the signed manifest (already checked against its signed checksum) comes first.
    const updated = await installedModel('clip-vit-b32-vision-uint8');
    const stored = updated || isDesktopApp() ? undefined : await getModel(GATE_MODEL.cache, GATE_MODEL.url);
    if (updated) {
      bytes = new Uint8Array(updated.bytes);
    } else if (stored) {
      bytes = new Uint8Array(await stored.arrayBuffer());
    } else if (isDesktopApp()) {
      const response = await fetch(GATE_MODEL.url);
      if (!response.ok) throw new Error('The subject category model is missing. Reinstall InFlight.');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      throw new Error('The subject checker has not been downloaded.');
    }
    const hash = new Sha256Stream();
    hash.update(bytes);
    if (!updated && (bytes.byteLength !== GATE_MODEL.bytes || hash.digest() !== GATE_MODEL.sha256)) {
      throw new Error('The subject category model failed its integrity check, so it was not used.');
    }
    const [taxonomy, vectorFile] = await Promise.all([import('../assets/subject/taxonomy.json'), import('../assets/subject/vectors.json')]);
    const categories = taxonomy.default.categories as SubjectCategory[];
    const vectors = gateVectors(vectorFile.default, categories);
    const ort = await loadOrt();
    const session = await createTimedSession(ort, 'clip-gate', bytes, ortOptions());
    return { ort, session, categories, vectors };
  })().catch((error) => {
    loading = null;
    console.warn('Subject category model failed to load', error);
    throw new Error(friendlyToolError(error, 'subject category model'));
  });
  return loading;
}

/**
 * What kind of thing the picture shows, by category, with how sure the gate is. `crop` is the square to look at (the
 * same one the species step uses, around the subject); without it, the centre square. Runs on this device.
 */
export async function routePicture(picture: HTMLCanvasElement, crop: SquareCrop): Promise<RouteResult> {
  return (await routeAndEmbedPicture(picture, crop)).route;
}

/** The image model's unit-length embedding of one square of the picture, on this device: the scene tags use it on the
 * whole picture's centre square, so one model and one session serve the gate, vehicles and scene tags. */
export async function embedSquare(picture: HTMLCanvasElement, crop: SquareCrop): Promise<Float32Array> {
  return (await routeAndEmbedPicture(picture, crop)).embedding;
}

/** The gate's answer and the CLIP picture embedding it came from, so vehicle recognition can reuse it without running again. */
export async function routeAndEmbedPicture(picture: HTMLCanvasElement, crop: SquareCrop): Promise<{ route: RouteResult; embedding: Float32Array }> {
  const { ort, session, categories, vectors } = await load();
  const size = GATE_MODEL.size;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
  // CLIP and BioCLIP share the same input recipe: 224 × 224, planar, OpenAI CLIP mean and standard deviation.
  const input = preprocessSpecies(context.getImageData(0, 0, size, size).data, size);
  const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const output = results.image_embeds ?? results[session.outputNames[0]];
  const embedding = normalise(Float32Array.from(output.data as Float32Array));
  return { route: routeSubject(embedding, vectors, categories), embedding };
}
