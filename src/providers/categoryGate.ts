import { Sha256Stream } from '../core/sha256';
import { GATE_MODEL, gateVectors } from '../core/categoryGate';
import { preprocessSpecies } from '../core/speciesModel';
import { normalise } from '../core/speciesMatch';
import { routeSubject, type RouteResult, type SubjectCategory } from '../core/subjectRouter';
import type { SquareCrop } from '../core/subjectCrop';
import { friendlyToolError } from '../core/toolErrors';
import { isDesktopApp } from './desktopShell';

/**
 * Runs the category gate's image model (CLIP ViT-B/32, MIT, public/models) on this device and routes the picture.
 * The desktop app carries the file in its installer, so the gate is on there. In a browser it stays off for now: the file
 * is another 89 MB, and browsers only download models the person asks for. Then the species step behaves as before.
 */
export const gateAvailable = () => isDesktopApp();

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession; categories: SubjectCategory[]; vectors: Float32Array[] }
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const response = await fetch(GATE_MODEL.url);
    if (!response.ok) throw new Error('The subject category model is missing. Reinstall Kestrel.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = new Sha256Stream();
    hash.update(bytes);
    if (bytes.byteLength !== GATE_MODEL.bytes || hash.digest() !== GATE_MODEL.sha256) {
      throw new Error('The subject category model failed its integrity check, so it was not used.');
    }
    const [taxonomy, vectorFile] = await Promise.all([import('../assets/subject/taxonomy.json'), import('../assets/subject/vectors.json')]);
    const categories = taxonomy.default.categories as SubjectCategory[];
    const vectors = gateVectors(vectorFile.default, categories);
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
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
  return routeSubject(normalise(Float32Array.from(output.data as Float32Array)), vectors, categories);
}
