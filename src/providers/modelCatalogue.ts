import { DETECTOR_MODEL } from '../core/objectDetection';
import { SUBJECT_MODEL } from '../core/subjectModel';
import { EMBED_MODEL } from '../core/visualSimilarity';
import { GATE_MODEL } from '../core/categoryGate';
import { SPECIES_MODEL, centreSquare } from '../core/speciesModel';
import { PHOTO_CHECK_PACK, PHOTO_CHECK_REVISION } from '../core/photoCheckPack';
import { BIOCLIP2, EFFICIENTSAM_TI, NAFNET_W32, RFDETR_NANO, optionalModelConfigured, type OptionalModel } from '../core/optionalModels';
import { NAFNET_TILE } from '../core/nafnet';
import { bundledModelUrl } from './bundledModelAssets';
import { isDesktopApp } from './desktopShell';
import { hasModel } from './modelStore';
import { optionalModelStatus } from './optionalModels';
import { MARKING_PACK, markingReaderReady } from './markingReader';

/**
 * Every model the app can run, for Settings → Models (P0 #703): what it is, its exact file(s) and checksum, whether
 * it is on this device, and how to time it here. "Measure now" calls each model through its own normal loader on a
 * generated test picture, so the timings (src/core/modelStats.ts) come from the same verified path as real use.
 * Nothing reads, changes or uploads a photo.
 */
export type ModelPlace = 'built-in' | 'downloaded' | 'not-downloaded' | 'not-offered';

export type ModelRole = 'detector' | 'detectorTandem' | 'mask' | 'tapSelect' | 'species' | 'gate' | 'similarity' | 'photoCheck' | 'markings' | 'denoise';

export interface CatalogueFile {
  /** The id its timings are recorded under (modelStats). */
  statId: string;
  file: string;
  sha256: string;
  bytes: number;
}

export interface CatalogueEntry {
  id: string;
  name: string;
  role: ModelRole;
  /** The exact upstream release or revision, when it is recorded. Null when only the checksum identifies it. */
  version: string | null;
  licence: string;
  files: CatalogueFile[];
  /**
   * Peak memory measured with the app's own runtime when the model was converted (the browser engine cannot see the
   * WebAssembly runtime's memory, so it cannot be read live). Null when it was not measured.
   */
  peakMemory: { megabytes: number; where: string } | null;
  place(): Promise<ModelPlace>;
  /** Run the model once on the test picture through its normal path. Absent when it can only be timed in use. */
  measure?: (picture: HTMLCanvasElement, signal?: AbortSignal) => Promise<void>;
  /** An opt-in pack the photographer downloads and removes from Settings. Each file is checked against its pinned digest. */
  pack?: {
    model: OptionalModel;
    download(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
    remove(): Promise<void>;
  };
}

const packFiles = (model: OptionalModel): CatalogueFile[] => {
  const names = Object.keys(model.files);
  return names.map((name) => ({
    statId: names.length === 1 ? model.id : `${model.id}.${name}`,
    file: model.files[name].url.replace(/^.*\//, '') || `${model.id}.${name}`,
    sha256: model.files[name].sha256,
    bytes: model.files[name].bytes,
  }));
};

const packPlace = async (model: OptionalModel): Promise<ModelPlace> => {
  if (!optionalModelConfigured(model)) return 'not-offered';
  return (await optionalModelStatus(model)) === 'ready' ? 'downloaded' : 'not-downloaded';
};

const LAPTOP = 'onnxruntime-web 1.31, Windows laptop, 25 Nov 2026';

export const MODEL_CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'yolox-tiny', name: DETECTOR_MODEL.name, role: 'detector', version: 'release 0.1.1rc0', licence: DETECTOR_MODEL.licence,
    files: [{ statId: 'yolox-tiny', file: DETECTOR_MODEL.file, sha256: DETECTOR_MODEL.sha256, bytes: DETECTOR_MODEL.bytes }],
    peakMemory: null,
    place: async () => (bundledModelUrl('yolox_tiny.onnx') ? 'built-in' : 'not-offered'),
    measure: async (picture) => { const { findSubject, resetDetectorFailure } = await import('./objectDetector'); resetDetectorFailure(); await findSubject(picture); },
  },
  {
    id: 'u2netp', name: SUBJECT_MODEL.name, role: 'mask', version: null, licence: SUBJECT_MODEL.licence,
    files: [{ statId: 'u2netp', file: SUBJECT_MODEL.file, sha256: SUBJECT_MODEL.sha256, bytes: SUBJECT_MODEL.bytes }],
    peakMemory: null,
    place: async () => (bundledModelUrl('u2netp.onnx') ? 'built-in' : 'not-offered'),
    measure: async (picture) => { const { detectSubject } = await import('./subjectDetector'); await detectSubject(picture); },
  },
  {
    id: EMBED_MODEL.id, name: 'DINOv2 ViT-S/14', role: 'similarity', version: null, licence: 'Apache-2.0',
    files: [{ statId: EMBED_MODEL.id, file: EMBED_MODEL.url.replace(/^.*\//, ''), sha256: EMBED_MODEL.sha256, bytes: EMBED_MODEL.bytes }],
    peakMemory: null,
    place: async () => 'built-in',
    measure: async (picture) => { const { embedPicture } = await import('./visualEmbedder'); await embedPicture(picture); },
  },
  {
    id: 'clip-gate', name: 'CLIP ViT-B/32 (8-bit)', role: 'gate', version: null, licence: 'MIT',
    files: [{ statId: 'clip-gate', file: GATE_MODEL.url.replace(/^.*\//, ''), sha256: GATE_MODEL.sha256, bytes: GATE_MODEL.bytes }],
    peakMemory: null,
    place: async () => (isDesktopApp() ? 'built-in' : (await hasModel(GATE_MODEL.cache, GATE_MODEL.url).catch(() => false)) ? 'downloaded' : 'not-downloaded'),
    measure: async (picture) => { const { routePicture } = await import('./categoryGate'); await routePicture(picture, centreSquare(picture.width, picture.height)); },
  },
  {
    id: 'bioclip-image-int8', name: 'BioCLIP (8-bit)', role: 'species', version: null, licence: 'MIT',
    files: [{ statId: 'bioclip-image-int8', file: SPECIES_MODEL.url.replace(/^.*\//, '') || 'bioclip-image-int8.onnx', sha256: SPECIES_MODEL.sha256, bytes: SPECIES_MODEL.bytes }],
    peakMemory: null,
    place: async () => {
      const { speciesStatus } = await import('./speciesModel');
      const status = await speciesStatus();
      if (status === 'unavailable') return 'not-offered';
      if (status !== 'ready') return 'not-downloaded';
      return isDesktopApp() && SPECIES_MODEL.bundled ? 'built-in' : 'downloaded';
    },
    measure: async (picture) => { const { embedPicture } = await import('./speciesModel'); await embedPicture(picture); },
  },
  {
    id: PHOTO_CHECK_PACK.name, name: 'SmolVLM2-256M', role: 'photoCheck', version: PHOTO_CHECK_REVISION.slice(0, 8), licence: 'Apache-2.0',
    files: PHOTO_CHECK_PACK.files.filter((file) => file.key !== 'tokenizer').map((file) => ({
      statId: `${PHOTO_CHECK_PACK.name}.${file.key}`, file: file.path.replace(/^.*\//, ''), sha256: file.sha256, bytes: file.bytes,
    })),
    peakMemory: null,
    // Timed when Check photo runs: a test picture would only time the image half, not the written review.
    place: async () => { const { photoCheckInstalled } = await import('./photoCheckStore'); return (await photoCheckInstalled()) ? 'downloaded' : 'not-downloaded'; },
  },
  {
    id: 'markings-reader', name: 'PP-OCRv5 mobile', role: 'markings', version: 'e6f4fa85 / 3fafbc3b', licence: 'Apache-2.0',
    files: (['detect', 'recognise'] as const).map((key) => ({
      statId: `markings-reader.${key}`, file: `${key}.onnx`, sha256: MARKING_PACK.files[key].sha256, bytes: MARKING_PACK.files[key].bytes,
    })),
    peakMemory: null,
    place: async () => {
      if (!MARKING_PACK.files.detect.url) return 'not-offered';
      return (await markingReaderReady()) ? 'downloaded' : 'not-downloaded';
    },
    measure: async (picture) => { const { readText } = await import('./markingReader'); await readText(picture); },
  },
  {
    id: RFDETR_NANO.id, name: RFDETR_NANO.name, role: 'detectorTandem', version: '9f201577', licence: RFDETR_NANO.licence,
    files: packFiles(RFDETR_NANO), peakMemory: { megabytes: 432, where: LAPTOP },
    place: () => packPlace(RFDETR_NANO),
    pack: {
      model: RFDETR_NANO,
      download: async (onProgress, signal) => (await import('./rfDetrDetector')).downloadRfDetr(onProgress, signal),
      remove: async () => (await import('./rfDetrDetector')).removeRfDetr(),
    },
    measure: async (picture) => { const { findSubjectsRfDetr } = await import('./rfDetrDetector'); await findSubjectsRfDetr(picture); },
  },
  {
    id: EFFICIENTSAM_TI.id, name: 'EfficientSAM-Ti', role: 'tapSelect', version: 'd525f622', licence: EFFICIENTSAM_TI.licence,
    files: packFiles(EFFICIENTSAM_TI), peakMemory: { megabytes: 638, where: LAPTOP },
    place: () => packPlace(EFFICIENTSAM_TI),
    pack: {
      model: EFFICIENTSAM_TI,
      download: async (onProgress, signal) => (await import('./tapSelect')).downloadTapSelect(onProgress, signal),
      remove: async () => (await import('./tapSelect')).removeTapSelect(),
    },
    measure: async (picture) => {
      const { encodePhoto, selectSubjects } = await import('./tapSelect');
      const key = `settings-measure-${Date.now()}`;
      const size = await encodePhoto(picture, key);
      await selectSubjects(key, [{ taps: [{ x: size.w / 2, y: size.h / 2, add: true }] }]);
    },
  },
  {
    id: NAFNET_W32.id, name: 'NAFNet width32', role: 'denoise', version: '2b4af71e', licence: NAFNET_W32.licence,
    files: packFiles(NAFNET_W32), peakMemory: { megabytes: 387, where: LAPTOP },
    place: () => packPlace(NAFNET_W32),
    pack: {
      model: NAFNET_W32,
      download: async (onProgress, signal) => (await import('./nafnetDenoise')).downloadNafnet(onProgress, signal),
      remove: async () => (await import('./nafnetDenoise')).removeNafnet(),
    },
    measure: async () => {
      const { openNafnet } = await import('./nafnetDenoise');
      const nafnet = await openNafnet();
      if (!nafnet) return;
      try { await nafnet.infer(new Float32Array(3 * NAFNET_TILE * NAFNET_TILE).fill(0.5)); } finally { await nafnet.close(); }
    },
  },
  {
    // Desktop second opinion on species. Peak memory was measured only with native ONNX Runtime (1.95 GB, docs/models.md),
    // not with the app's WebAssembly runtime, so it is not shown; timing needs a species to check, so it is not offered here.
    id: BIOCLIP2.id, name: 'BioCLIP 2', role: 'species', version: '2957b322', licence: BIOCLIP2.licence,
    files: packFiles(BIOCLIP2), peakMemory: null,
    place: () => packPlace(BIOCLIP2),
    pack: {
      model: BIOCLIP2,
      download: async (onProgress, signal) => (await import('./speciesValidator')).downloadValidator(onProgress, signal),
      remove: async () => (await import('./speciesValidator')).removeValidator(),
    },
  },
];

/** A test picture: smooth colour, a light block and a dark ring, so models have shapes to look at. Never a photo. */
export function testPicture(width = 1024, height = 768): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#6b8fb3');
  gradient.addColorStop(1, '#c9b48a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#efe9df';
  context.fillRect(width * 0.35, height * 0.3, width * 0.3, height * 0.4);
  context.strokeStyle = '#2b2b2b';
  context.lineWidth = 18;
  context.beginPath();
  context.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.3, 0, Math.PI * 2);
  context.stroke();
  return canvas;
}

/**
 * Time every model that is on this device, one after another, on the test picture. A model that is missing or fails
 * is skipped and named in the result; nothing is retried.
 */
export async function measureModels(onModel: (entry: CatalogueEntry) => void, signal?: AbortSignal): Promise<{ measured: string[]; failed: string[] }> {
  const picture = testPicture();
  const measured: string[] = [];
  const failed: string[] = [];
  for (const entry of MODEL_CATALOGUE) {
    signal?.throwIfAborted();
    if (!entry.measure) continue;
    const place = await entry.place().catch(() => 'not-offered' as const);
    if (place === 'not-downloaded' || place === 'not-offered') continue;
    onModel(entry);
    try { await entry.measure(picture, signal); measured.push(entry.id); } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      console.warn(`Measuring ${entry.name} failed`, error);
      failed.push(entry.id);
    }
  }
  return { measured, failed };
}
