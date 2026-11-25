import { runEngineCapability } from '../../engine/engineApi';
import { createCloudProcessingAttempt, type CloudConnection } from '../../providers/cloudProcessingAttempt';
import { fullContext, maskAlpha } from '../../core/masks';
import { composeDenoiseRecipe, renderDenoiseRecipe, verifyDenoiseRecipe } from './denoiseRecipe';
import { isNeutralEdit, DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { createSubjectMask, framingKey, MAX_MASKS, type Mask } from '../../core/maskTypes';
import type { Pixels } from '../../core/colourCheck';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import { loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import { fullResolutionRasterFormat, isRawPreviewFile } from '../../core/rawFormats';
import { decodeHeifForDisplay } from '../../providers/heifDecode';
import { loadDenoiseSource, loadVerifiedAdditionalDenoiseSource } from './denoiseSource';
import { unionSubjectGrid } from '../../core/subjectUnion';
import { detectSubjectInstances } from '../../providers/multiSubjectDetector';
import { estimateNoiseSigma, luminanceStrengthFor } from '../../core/noiseEstimate';
import { engineText } from '../../i18n/areas/engine';

/** Noise at full size: a centre crop of up to 1024 px drawn 1:1 from the picture being edited. */
function measureFullSizeNoise(source: HTMLImageElement): number | null {
  const size = Math.min(1024, source.naturalWidth, source.naturalHeight);
  if (size < 64) return null;
  const crop = document.createElement('canvas');
  crop.width = size; crop.height = size;
  const ctx = crop.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, (source.naturalWidth - size) / 2, (source.naturalHeight - size) / 2, size, size, 0, 0, size, size);
  return estimateNoiseSigma(ctx.getImageData(0, 0, size, size).data, size, size);
}

/** Longest edge of the picture denoise works on, and the only thing ever sent to the cloud (never the original). */
export const DENOISE_WORKING_EDGE = 1600;
/** A first-cut strength used when the photo has none yet (same 0 to 2 range as `PhotoEdit.denoise`). Not calibrated on real photos. */
export const DEFAULT_DENOISE_STRENGTH = 0.8;

export interface DenoiseOutcome {
  /** Who produced the result: the cloud runner, or this device. */
  runner: 'cloud-processing' | 'device';
  /** The strength that passed the quality check (it may be lower than asked). */
  strength: number;
  /** Luminance (grain) denoise that passed with it, 0-2. */
  luminance: number;
  masks: Mask[];
  verified: boolean;
  notes: string[];
}

/** The signed-in account's session, or null. Cloud is attempted only with one: signing in and pressing the button is the consent for that job. */
export type CloudAccess = { connection: CloudConnection; online: boolean } | null;

/**
 * Denoise one photo: asks the cloud first when the person is signed in and online (their press of the button is the
 * consent for this one job), and otherwise, or on any failure or unverified result, runs on this device. Uses a sensor-developed RAW source when required, then reduces it to a
 * working-size preview; never sends original bytes. Nothing is applied here: the caller stores the returned recipe.
 */
export async function runV2Denoise(
  frame: PhotoFrame, provider: BrowserPreviewProvider, cloud: CloudAccess, signal?: AbortSignal,
): Promise<DenoiseOutcome | null> {
  const source = await loadDenoiseSource(frame, provider,
    () => fullResolutionRasterFormat(frame.filename)
      ? loadVerifiedRasterOriginalForExport(frame, provider, signal)
      : isRawPreviewFile(frame.filename) ? loadExportSource(frame, provider)
      : loadVerifiedAdditionalDenoiseSource(frame, provider.verifiedOriginalReader(frame.stableKey), async (bytes, kind) => {
          const picture = kind === 'heif' ? await decodeHeifForDisplay(bytes) : bytes.slice(0, bytes.size, 'image/webp');
          signal?.throwIfAborted();
          const url = URL.createObjectURL(picture);
          try { return await loadImage(url); }
          finally { URL.revokeObjectURL(url); }
        }, signal), loadImage, signal);
  if (!source || !Number.isSafeInteger(source.naturalWidth) || !Number.isSafeInteger(source.naturalHeight) ||
      source.naturalWidth <= 0 || source.naturalHeight <= 0) return null;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const edge = Math.max(source.naturalWidth, source.naturalHeight);
  const canvas = document.createElement('canvas');
  drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, DENOISE_WORKING_EDGE / edge) });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || canvas.width < 16 || canvas.height < 16) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const original: Pixels = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
  // Noise is judged at full size (a 1:1 centre crop), where the photographer sees it; the downscaled working copy hides it.
  const sigma = measureFullSizeNoise(source);
  const luminance = luminanceStrengthFor(sigma);
  if (sigma !== null && luminance === 0) {
    return { runner: 'device', strength: 0, luminance: 0, masks: [], verified: false, notes: [engineText.denoise.noVisibleNoise] };
  }
  const existing = frame.edit?.masks ?? [];
  const id = `auto-denoise-${frame.id}`;
  const previousBackground = existing.find(mask => mask.id === `${id}-background`);
  const asked = previousBackground?.edit.denoise ?? (frame.edit?.denoise && frame.edit.denoise > 0 ? frame.edit.denoise : DEFAULT_DENOISE_STRENGTH);
  const lumaPerStrength = asked > 0 ? luminance / asked : 0;
  const remaining = existing.filter(mask => mask.id !== id && mask.id !== `${id}-background`);
  let subjects = remaining.filter((mask): mask is Extract<Mask, { kind: 'subject' }> =>
    mask.kind === 'subject' && !mask.hidden && !mask.invert && !mask.limit &&
    mask.confidence !== 'low' && mask.framingKey === framingKey(framing));
  let detectionUnavailable = false;
  let newLayers: Mask[] = [];
  if (!subjects.length && remaining.length + 2 <= MAX_MASKS) {
    try {
      const instances = await detectSubjectInstances(canvas, framingKey(framing), signal);
      subjects = instances.map((instance, index) => ({ ...instance.mask,
        id: `${id}-instance-${index + 1}-${instance.label.replace(/[^a-zA-Z0-9]/g, '')}`,
      }));
      // Never displace existing edits or exceed the persisted mask schema limit.
      if (remaining.length + subjects.length + 2 <= MAX_MASKS) {
        // Old framing may leave instance IDs occupied. Never duplicate them.
        const occupied = new Set(remaining.map(mask => mask.id));
        newLayers = subjects.map(mask => {
          let unique = mask.id;
          while (occupied.has(unique)) unique = unique.replace(/-instance-(\d+)-/, (_, n) => `-instance-${Number(n) + 1}-`);
          occupied.add(unique);
          return { ...mask, id: unique };
        });
      }
      detectionUnavailable = !subjects.length;
    } catch {
      signal?.throwIfAborted();
      detectionUnavailable = true;
    }
  }
  signal?.throwIfAborted();
  const aspect = original.height / original.width;
  const single = subjects.length === 1 && subjects[0].strokes.length === 0 && subjects[0].feather === 0.5;
  const combined = subjects.length && remaining.length + 2 <= MAX_MASKS
    ? single ? subjects[0] : createSubjectMask(id, unionSubjectGrid(subjects, aspect), framingKey(framing),
      subjects.every(mask => mask.confidence === 'high') ? 'high' : 'medium')
    : undefined;
  const subject = combined ? {
    maskId: id, grid: combined.grid, framingKey: combined.framingKey, confidence: combined.confidence, detail: combined.detail,
    alpha: maskAlpha(combined, original.width, original.height, fullContext(original.width, original.height)),
  } : undefined;
  if (!subject && (previousBackground || subjects.length)) {
    // Do not replace an established protected recipe with global smoothing.
    return { runner: 'device', strength: 0, luminance: 0, masks: [], verified: false, notes: [engineText.denoise.protectionLost] };
  }
  const baseline = renderDenoiseRecipe(original, frame.edit ?? DEFAULT_EDIT);
  const render = async (edit: Partial<PhotoEdit>, masks: Mask[]): Promise<Pixels> => {
    signal?.throwIfAborted();
    return renderDenoiseRecipe(original, composeDenoiseRecipe(frame.edit, id, edit.denoise ?? 0, [...newLayers, ...masks], lumaPerStrength));
  };
  // Remote filtering of already edited pixels is not equivalent to applying a
  // reversible denoise recipe to the original. Keep composed recipes local.
  const attempt = cloud && !subject && (!frame.edit || isNeutralEdit(frame.edit))
    ? createCloudProcessingAttempt(cloud.connection, { online: cloud.online, signedIn: true, userConsent: true }, signal)
    : undefined;
  const request = { capability: 'denoise' as const, backgroundDenoise: asked, render, original: baseline, subject, signal,
    verifyCandidate: (after: Pixels) => verifyDenoiseRecipe(baseline, after, subjects) };
  let response = await runEngineCapability(request, attempt);
  // Even a verified remote raster is not the recipe the editor will save.
  // Verify the actual local rendering, and retry on-device if it differs.
  if (response.capability === 'denoise' && response.runner === 'cloud-processing' &&
      !request.verifyCandidate(await render(response.result.edit, response.result.masks)).ok) {
    response = await runEngineCapability(request);
  }
  signal?.throwIfAborted();
  if (response.capability !== 'denoise') return null;
  const result = response.result;
  const strength = result.edit.denoise ?? 0;
  const notes = response.runner === 'cloud-processing'
    ? [engineText.denoise.cloud]
    : [cloud ? engineText.denoise.cloudNotUsed : engineText.denoise.device];
  if (subject && subjects.length > 0 && !newLayers.length && !remaining.some(mask => subjects.includes(mask as typeof subjects[number]))) notes.push(engineText.denoise.layersFull);
  if (subject) notes.unshift(engineText.denoise.protected(subjects.length));
  else if (detectionUnavailable) notes.unshift(engineText.denoise.global);
  if (!result.verification.ok) notes.push(engineText.denoise.failedCheck);
  return { runner: response.runner === 'cloud-processing' ? 'cloud-processing' : 'device', strength, luminance: Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4, masks: subject ? [...newLayers, ...result.masks] : result.masks, verified: result.verification.ok, notes };
}
