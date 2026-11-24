import { runEngineCapability } from '../../engine/engineApi';
import { createCloudProcessingAttempt, type CloudConnection } from '../../providers/cloudProcessingAttempt';
import { applyNoiseReduction } from '../../core/noiseReduction';
import { applyMasks, fullContext, maskAlpha } from '../../core/masks';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { createSubjectMask, framingKey, MAX_MASKS, type Mask } from '../../core/maskTypes';
import type { Pixels } from '../../core/colourCheck';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import { unionSubjectGrid } from '../../core/subjectUnion';
import { detectSubjectInstances } from '../../providers/multiSubjectDetector';

/** Longest edge of the picture denoise works on, and the only thing ever sent to the cloud (never the original). */
export const DENOISE_WORKING_EDGE = 1600;
/** A first-cut strength used when the photo has none yet (same 0 to 2 range as `PhotoEdit.denoise`). Not calibrated on real photos. */
export const DEFAULT_DENOISE_STRENGTH = 0.8;

export interface DenoiseOutcome {
  /** Who produced the result: the cloud runner, or this device. */
  runner: 'cloud-processing' | 'device';
  /** The strength that passed the quality check (it may be lower than asked). */
  strength: number;
  masks: Mask[];
  verified: boolean;
  notes: string[];
}

/** The signed-in account's session, or null. Cloud is attempted only with one: signing in and pressing the button is the consent for that job. */
export type CloudAccess = { connection: CloudConnection; online: boolean } | null;

/**
 * Denoise one photo: asks the cloud first when the person is signed in and online (their press of the button is the
 * consent for this one job), and otherwise, or on any failure or unverified result, runs on this device. Uses only a
 * working-size preview, never the original. Nothing is applied here: the caller stores the returned recipe.
 */
export async function runV2Denoise(
  frame: PhotoFrame, provider: BrowserPreviewProvider, cloud: CloudAccess, signal?: AbortSignal,
): Promise<DenoiseOutcome | null> {
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted) return null;
  const source = await loadImage(url);
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const edge = Math.max(source.naturalWidth, source.naturalHeight);
  const canvas = document.createElement('canvas');
  drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, DENOISE_WORKING_EDGE / edge) });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || canvas.width < 16 || canvas.height < 16) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const original: Pixels = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
  const render = async (edit: Partial<PhotoEdit>, masks: Mask[]): Promise<Pixels> => {
    const full: PhotoEdit = { ...DEFAULT_EDIT, ...edit };
    const data = full.denoise ? new Uint8ClampedArray(applyNoiseReduction(new Uint8ClampedArray(original.data), original.width, original.height, full)) : new Uint8ClampedArray(original.data);
    applyMasks(data, original.width, original.height, masks, fullContext(original.width, original.height));
    return { data, width: original.width, height: original.height };
  };
  const existing = frame.edit?.masks ?? [];
  const id = `auto-denoise-${frame.id}`;
  const previousBackground = existing.find(mask => mask.id === `${id}-background`);
  const asked = previousBackground?.edit.denoise ?? (frame.edit?.denoise && frame.edit.denoise > 0 ? frame.edit.denoise : DEFAULT_DENOISE_STRENGTH);
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
    return { runner: 'device', strength: 0, masks: [], verified: false, notes: ['Subject protection could not be rebuilt safely. Existing edits were kept.'] };
  }
  const attempt = cloud && !subject
    ? createCloudProcessingAttempt(cloud.connection, { online: cloud.online, signedIn: true, userConsent: true }, signal)
    : undefined;
  const response = await runEngineCapability({ capability: 'denoise', backgroundDenoise: asked, render, original, subject }, attempt);
  if (response.capability !== 'denoise') return null;
  const result = response.result;
  const strength = result.edit.denoise ?? 0;
  const notes = response.runner === 'cloud-processing'
    ? ['Denoised in the InFlight cloud from a working-size copy, checked on this device.']
    : [cloud ? 'The cloud was not used for this one, so it ran on this device.' : 'Denoised on this device.'];
  if (subject && subjects.length > 0 && !newLayers.length && !remaining.some(mask => subjects.includes(mask as typeof subjects[number]))) notes.push('Individual layers could not fit; combined protection is available.');
  if (subject) notes.unshift(`Denoised on this device with combined subject protection (${subjects.length} mask${subjects.length === 1 ? '' : 's'}).`);
  else if (detectionUnavailable) notes.unshift('No reliable subject masks were available; denoise used a global setting.');
  if (!result.verification.ok) notes.push('It could not be made to pass the quality check, so the gentlest setting tried is shown.');
  return { runner: response.runner === 'cloud-processing' ? 'cloud-processing' : 'device', strength, masks: subject ? [...newLayers, ...result.masks] : result.masks, verified: result.verification.ok, notes };
}
