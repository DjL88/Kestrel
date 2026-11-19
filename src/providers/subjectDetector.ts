import { sha256Hex } from '../core/sha256';
import { friendlyToolError } from '../core/toolErrors';
import { bundledModelUrl } from './bundledModelAssets';
import { SUBJECT_MODEL, assessSubject, detailSizeFor, encodeValues, gridSizeFor, readSubjectMap, preprocess, toGrid, type SubjectAssessment } from '../core/subjectModel';
import { guidedFilter, resampleMap } from '../core/guidedFilter';
import { lumaOf } from '../core/eyeFinder';
import type { SubjectDetail, SubjectGrid } from '../core/maskTypes';
import { guideRegion, guidedGridSize } from '../core/subjectGuide';
import { placeInRegion, sampledRegion } from '../core/subjectRegion';

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }

let loading: Promise<Loaded> | null = null;


/** Loads the runtime and the bundled model once. The model is checked against its recorded checksum first. */
function load(): Promise<Loaded> {
  loading ??= (async () => {
    const modelUrl = bundledModelUrl('u2netp.onnx');
    if (!modelUrl) throw new Error('The optional subject mask model is not installed in this preview. Manual masks and editing remain available.');
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
export async function detectSubject(preview: HTMLCanvasElement, options: { maxCoverage?: number } = {}): Promise<DetectedSubject> {
  const map = await subjectMap(preview);
  const size = SUBJECT_MODEL.inputSize;
  const { w, h } = gridSizeFor(preview.height / preview.width);
  return { grid: toGrid(map, size, w, h), assessment: assessSubject(map, options.maxCoverage) };
}

/** The model's subject map (inputSize × inputSize, 0 to 1) for a picture. */
async function subjectMap(preview: HTMLCanvasElement): Promise<Float32Array> {
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
  return readSubjectMap(results[session.outputNames[0]]?.data, size);
}

/**
 * The subject's outline in a cut-out at up to DETAIL_EDGE cells, refined against the cut-out's own pixels so the edge
 * follows feathers and fur rather than the model's 320-pixel view. Null if the cut-out can't be read.
 */
function refinedDetail(map: Float32Array, piece: HTMLCanvasElement, region: SubjectDetail['region']): SubjectDetail | null {
  const { w, h } = detailSizeFor(piece.width, piece.height);
  const sample = document.createElement('canvas');
  sample.width = w;
  sample.height = h;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(piece, 0, 0, w, h);
  const guide = lumaOf(context.getImageData(0, 0, w, h).data, w, h);
  const coarse = resampleMap(map, SUBJECT_MODEL.inputSize, w, h);
  // A window of about one model pixel: enough to move the edge onto the photo's edge, not enough to invent shapes.
  const radius = Math.max(2, Math.round(Math.max(w, h) / SUBJECT_MODEL.inputSize * 2));
  const refined = guidedFilter(guide, coarse, w, h, radius, 1e-3) ?? coarse;
  return { region, grid: encodeValues(refined, w, h) };
}

/** How long the subject detector may take to steer a mask before the whole-photo search is used instead. */
const GUIDE_BUDGET_MS = 4000;

export interface GuidedSubject extends DetectedSubject {
  /** What the detector found and steered the mask by, or null when the whole photo was searched instead. */
  guide: { label: string; score: number } | null;
  /** The fine, edge-refined outline around the subject, when a cut-out was used. */
  detail: SubjectDetail | null;
}

/**
 * Find the subject's outline with the subject detector's help. `framed` is the unedited, framed photo drawn at up to
 * GUIDED_RENDER_EDGE pixels on its long side. The detector (searched in tiles, so small subjects are found) gives a box;
 * the outline is then found in a cut-out around it at the photo's own detail and laid on a finer grid. Without a
 * trustworthy box, or when the cut-out gives no clear subject, this is exactly the whole-photo search.
 */
export async function detectSubjectGuided(framed: HTMLCanvasElement, options: { maxCoverage?: number; signal?: AbortSignal } = {}): Promise<GuidedSubject> {
  const whole = async (): Promise<GuidedSubject> => {
    const scale = Math.min(1, 640 / Math.max(framed.width, framed.height));
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(framed.width * scale));
    preview.height = Math.max(1, Math.round(framed.height * scale));
    const context = preview.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.imageSmoothingQuality = 'high';
    context.drawImage(framed, 0, 0, preview.width, preview.height);
    return { ...(await detectSubject(preview, options)), guide: null, detail: null };
  };

  // The outline model is the one that must work; if it can't load, say so now rather than after the detector runs.
  await load();
  let found: Awaited<ReturnType<typeof import('./objectDetector').findSubject>> = null;
  let budget: number | undefined;
  try {
    const { findSubject } = await import('./objectDetector');
    // The detector only steers; it never holds the mask up. Past its budget the whole-photo search is used.
    found = await Promise.race([
      findSubject(framed, options.signal),
      new Promise<null>((resolve) => { budget = window.setTimeout(() => resolve(null), GUIDE_BUDGET_MS); }),
    ]);
  } catch {
    // A missing or broken detector must not take subject masks away; the whole-photo search still works.
    return whole();
  } finally {
    if (budget !== undefined) window.clearTimeout(budget);
  }
  const region = guideRegion(found?.detection.box, found?.detection.score ?? 0, framed.width, framed.height);
  if (!found || !region) return whole();

  const { box, bounds } = sampledRegion(region, framed.width, framed.height);
  const piece = document.createElement('canvas');
  piece.width = box.w;
  piece.height = box.h;
  const context = piece.getContext('2d');
  if (!context) return whole();
  context.drawImage(framed, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const map = await subjectMap(piece);
  const assessment = assessSubject(map, 0.98);
  if (!assessment.usable) return whole();
  const localSize = gridSizeFor(piece.height / piece.width);
  const local = toGrid(map, SUBJECT_MODEL.inputSize, localSize.w, localSize.h);
  const detail = refinedDetail(map, piece, bounds);
  // With a fine outline the whole-photo grid is only the fallback, so it stays at the ordinary size; without one it
  // carries the detail itself.
  const full = detail ? gridSizeFor(framed.height / framed.width) : guidedGridSize(framed.height / framed.width, bounds);
  return {
    grid: placeInRegion(local, bounds, full.w, full.h),
    assessment,
    guide: { label: found.detection.label, score: found.detection.score },
    detail,
  };
}

/**
 * Find the subject inside a cut-out the person chose (Select an area). The same as the guided search after its
 * detector step: the outline is traced in the cut-out and refined against its pixels.
 */
export async function detectSubjectInArea(piece: HTMLCanvasElement, bounds: SubjectDetail['region'], framedAspect: number): Promise<{ grid: SubjectGrid; assessment: SubjectAssessment; detail: SubjectDetail | null }> {
  const map = await subjectMap(piece);
  const assessment = assessSubject(map, 0.98);
  const localSize = gridSizeFor(piece.height / piece.width);
  const local = toGrid(map, SUBJECT_MODEL.inputSize, localSize.w, localSize.h);
  const detail = assessment.usable ? refinedDetail(map, piece, bounds) : null;
  const full = gridSizeFor(framedAspect);
  return { grid: placeInRegion(local, bounds, full.w, full.h), assessment, detail };
}
