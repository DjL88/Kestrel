import { runEngineCapability } from '../../engine/engineApi';
import { createCloudProcessingAttempt, type CloudConnection } from '../../providers/cloudProcessingAttempt';
import { applyNoiseReduction } from '../../core/noiseReduction';
import { applyMasks, fullContext } from '../../core/masks';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import type { Mask } from '../../core/maskTypes';
import type { Pixels } from '../../core/colourCheck';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';

/** Longest edge of the picture denoise works on, and the only thing ever sent to the cloud (never the original). */
export const DENOISE_WORKING_EDGE = 1600;
/** A first-cut strength used when the photo has none yet (same 0 to 2 range as `PhotoEdit.denoise`). Not calibrated on real photos. */
export const DEFAULT_DENOISE_STRENGTH = 0.8;

export interface DenoiseOutcome {
  /** Who produced the result: the cloud runner, or this device. */
  runner: 'cloud-processing' | 'device';
  /** The strength that passed the quality check (it may be lower than asked). */
  strength: number;
  verified: boolean;
  notes: string[];
}

/** The signed-in account's session, or null. Cloud is attempted only with one: signing in and pressing the button is the consent for that job. */
export type CloudAccess = { connection: CloudConnection; online: boolean } | null;

/**
 * Denoise one photo: asks the cloud first when the person is signed in and online (their press of the button is the
 * consent for this one job), and otherwise, or on any failure or unverified result, runs on this device. Uses only a
 * working-size preview, never the original. Nothing is applied here: the caller stores the returned strength.
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
  const asked = frame.edit?.denoise && frame.edit.denoise > 0 ? frame.edit.denoise : DEFAULT_DENOISE_STRENGTH;
  const attempt = cloud
    ? createCloudProcessingAttempt(cloud.connection, { online: cloud.online, signedIn: true, userConsent: true }, signal)
    : undefined;
  const response = await runEngineCapability({ capability: 'denoise', backgroundDenoise: asked, render, original }, attempt);
  if (response.capability !== 'denoise') return null;
  const result = response.result;
  const strength = result.edit.denoise ?? 0;
  const notes = response.runner === 'cloud-processing'
    ? ['Denoised in the InFlight cloud from a working-size copy, checked on this device.']
    : [cloud ? 'The cloud was not used for this one, so it ran on this device.' : 'Denoised on this device.'];
  if (!result.verification.ok) notes.push('It could not be made to pass the quality check, so the gentlest setting tried is shown.');
  return { runner: response.runner === 'cloud-processing' ? 'cloud-processing' : 'device', strength, verified: result.verification.ok, notes };
}
