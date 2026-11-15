import { sha256Hex } from '../core/sha256';
import { friendlyToolError } from '../core/toolErrors';
import modelUrl from '../assets/models/u2netp.onnx?url';
import { SUBJECT_MODEL, assessSubject, gridSizeFor, normaliseMap, preprocess, toGrid, type SubjectAssessment } from '../core/subjectModel';
import type { SubjectGrid } from '../core/maskTypes';

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }

let loading: Promise<Loaded> | null = null;


/** Loads the runtime and the bundled model once. The model is checked against its recorded checksum first. */
function load(): Promise<Loaded> {
  loading ??= (async () => {
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error('The subject model could not be loaded.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== SUBJECT_MODEL.bytes || (await sha256Hex(bytes)) !== SUBJECT_MODEL.sha256) {
      throw new Error('The subject model file does not match its checksum, so it was not used.');
    }
    // The runtime loads on demand, and a hosted dev server can fail to serve it the first time. Try once more before giving up.
    const ort = await import('onnxruntime-web/wasm').catch(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return import('onnxruntime-web/wasm');
    });
    ort.env.wasm.numThreads = 1; // Avoids needing cross-origin isolation, so it works on any host and offline.
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((error) => {
    loading = null; // Allow a retry after a failure.
    console.warn('Subject tools failed to load', error);
    throw new Error(friendlyToolError(error));
  });
  return loading;
}

export interface DetectedSubject { grid: SubjectGrid; assessment: SubjectAssessment }

/** Find the most prominent subject in an unedited preview. Runs entirely on this device. */
export async function detectSubject(preview: HTMLCanvasElement): Promise<DetectedSubject> {
  const { ort, session } = await load();
  const size = SUBJECT_MODEL.inputSize;
  const small = document.createElement('canvas');
  small.width = size;
  small.height = size;
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(preview, 0, 0, size, size);
  const input = preprocess(context.getImageData(0, 0, size, size).data, size);
  const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const output = results[session.outputNames[0]].data as Float32Array;
  const map = normaliseMap(output);
  const { w, h } = gridSizeFor(preview.height / preview.width);
  return { grid: toGrid(map, size, w, h), assessment: assessSubject(map) };
}
