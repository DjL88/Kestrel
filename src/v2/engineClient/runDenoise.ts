import { runEngineCapability } from '../../engine/engineApi';
import { createCloudProcessingAttempt, type CloudConnection } from '../../providers/cloudProcessingAttempt';
import { fullContext, maskAlpha } from '../../core/masks';
import { isAutoDenoiseLayer } from './denoiseRecipe';
import { findEye, lumaOf } from '../../core/eyeFinder';
import type { RegionChoice } from '../../core/trueDetailHybrid';
import type { TrueDetailAi } from '../../core/trueDetailAi';
import { saveLayerAsset } from '../../core/layerAssetVault';
import type { LearnedBlend } from '../../engine/denoiseAction';
import { runLearnedOnSubject } from './trueDetailLearned';
import { isNeutralEdit, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { createSubjectMask, framingKey, isCombined, MAX_MASKS, type Mask } from '../../core/maskTypes';
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
import { luminanceStrengthFor } from '../../core/noiseEstimate';
import { engineText } from '../../i18n/areas/engine';
import { createDenoiseCompute, MAIN_THREAD_DENOISE_NOTE, type DenoiseCompute } from '../../providers/denoiseOffThread';

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Noise at full size, measured off the interface thread: nine crops drawn 1:1 from across the whole picture (a 3x3
 * grid), side by side in one mosaic. Only the centre used to be measured, so noise in the shadows or the background
 * round a clean, sharp subject went unseen (Dave, 27 Nov: DJL3766). Each crop is a whole number of the estimator's
 * 16 px blocks, so no block spans two crops.
 */
async function measureFullSizeNoise(source: HTMLImageElement, compute: DenoiseCompute): Promise<number | null> {
  const width = source.naturalWidth;
  const height = source.naturalHeight;
  const tile = Math.floor(Math.min(512, width / 3, height / 3) / 16) * 16;
  if (tile < 64) {
    // A small picture: measure all of it.
    const size = Math.min(width, height);
    if (size < 64) return null;
    const whole = document.createElement('canvas');
    whole.width = width; whole.height = height;
    const ctx = whole.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    return compute.measureNoise(ctx.getImageData(0, 0, width, height).data, width, height);
  }
  const mosaic = document.createElement('canvas');
  mosaic.width = tile * 3; mosaic.height = tile * 3;
  const ctx = mosaic.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      // The middle of each third of the picture.
      const sx = Math.round(((col + 0.5) * width) / 3 - tile / 2);
      const sy = Math.round(((row + 0.5) * height) / 3 - tile / 2);
      ctx.drawImage(source, sx, sy, tile, tile, col * tile, row * tile, tile, tile);
    }
  }
  return compute.measureNoise(ctx.getImageData(0, 0, tile * 3, tile * 3).data, tile * 3, tile * 3);
}

/** Lets the editor handle input between the two canvas reads denoise still does on this thread. */
const yieldToInterface = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** The most likely eye inside each subject (at most `limit`), for TrueDetail's gentlest denoise region. */
function findSubjectEyes(original: Pixels, subjects: readonly Mask[], combined: Float32Array, limit: number): { x: number; y: number; radius: number }[] {
  const luma = lumaOf(original.data, original.width, original.height);
  const context = fullContext(original.width, original.height);
  const eyes: { x: number; y: number; radius: number }[] = [];
  const alphas = subjects.length > 1 ? subjects.map(mask => maskAlpha(mask, original.width, original.height, context)) : [combined];
  for (const alpha of alphas) {
    if (eyes.length >= limit) break;
    const eye = findEye({ luma, subject: alpha, width: original.width, height: original.height });
    if (eye) eyes.push({ x: eye.x, y: eye.y, radius: eye.radius });
  }
  return eyes;
}

/** One plain sentence on what each region received. */
export function trueDetailNote(regions: readonly RegionChoice[] | undefined, subjects: number, eyes: number): string {
  const who = `${subjects} subject${subjects === 1 ? '' : 's'}`;
  if (!regions?.length) return `Denoised on this device with combined subject protection (${who}).`;
  const part = (region: RegionChoice['region'], name: string) => {
    const choice = regions.find(r => r.region === region);
    if (!choice) return null;
    if (choice.strength <= 0) return `${name} kept as it was (${choice.kept})`;
    return choice.source === 'conventional' ? `${name} ${choice.strength.toFixed(2)}` : `${name} learned denoise (${choice.source}) at ${Math.round(choice.strength * 100)}%`;
  };
  const parts = [part('background', 'background'), part('subject', 'subjects'), eyes ? part('eyes', eyes === 1 ? 'eye' : 'eyes') : null].filter(Boolean);
  return `TrueDetail regional denoise on this device (${who}${eyes ? `, ${eyes} eye${eyes === 1 ? '' : 's'} protected` : ''}): ${parts.join('; ')}.`;
}

/** Longest edge of the picture denoise works on, and the only thing ever sent to the cloud (never the original). */
export const DENOISE_WORKING_EDGE = 1600;
/** A first-cut strength used when the photo has none yet (same 0 to 2 range as `PhotoEdit.denoise`). Not calibrated on real photos. */
export const DEFAULT_DENOISE_STRENGTH = 0.8;
/** The blend strengths the guardian may try for a learned result in subjects and eyes. */
export const LEARNED_STRENGTHS = [1, 0.6] as const;

export interface DenoiseOutcome {
  /** Who produced the result: the cloud runner, or this device. */
  runner: 'cloud-processing' | 'device';
  /** The strength that passed the quality check (it may be lower than asked). */
  strength: number;
  /** Luminance (grain) denoise that passed with it, 0-2. */
  luminance: number;
  masks: Mask[];
  verified: boolean;
  /** The learned denoiser's stored result, when the guardian chose it for the subject or eyes. */
  trueDetailAi?: TrueDetailAi;
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
  progress?: (done: number, total: number, label: string) => void,
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
  // The pixel work (noise, every candidate render and check) runs in a Web Worker so the editor keeps responding.
  const compute = createDenoiseCompute({ signal });
  try {
    const outcome = await denoiseVerifiedSource(frame, source, cloud, compute, signal, progress);
    if (outcome && compute.onMainThread) outcome.notes.push(MAIN_THREAD_DENOISE_NOTE);
    return outcome;
  } finally {
    compute.dispose();
  }
}

/** Everything after the source passed its provenance checks. */
async function denoiseVerifiedSource(
  frame: PhotoFrame, source: HTMLImageElement, cloud: CloudAccess, compute: DenoiseCompute, signal?: AbortSignal,
  progress?: (done: number, total: number, label: string) => void,
): Promise<DenoiseOutcome | null> {
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const edge = Math.max(source.naturalWidth, source.naturalHeight);
  const canvas = document.createElement('canvas');
  // Decode off the interface thread first: drawing an undecoded full-size picture decodes it synchronously.
  await source.decode?.().catch(() => undefined);
  signal?.throwIfAborted();
  drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, DENOISE_WORKING_EDGE / edge) });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || canvas.width < 16 || canvas.height < 16) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const original: Pixels = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
  // Noise is judged at full size (a 1:1 centre crop), where the photographer sees it; the downscaled working copy hides it.
  await yieldToInterface();
  signal?.throwIfAborted();
  const sigma = await measureFullSizeNoise(source, compute);
  signal?.throwIfAborted();
  const luminance = luminanceStrengthFor(sigma);
  if (sigma !== null && luminance === 0) {
    return { runner: 'device', strength: 0, luminance: 0, masks: [], verified: false, notes: [engineText.denoise.noVisibleNoise] };
  }
  const existing = frame.edit?.masks ?? [];
  const id = `auto-denoise-${frame.id}`;
  const previousBackground = existing.find(mask => mask.id === `${id}-background`);
  const asked = previousBackground?.edit.denoise ?? (frame.edit?.denoise && frame.edit.denoise > 0 ? frame.edit.denoise : DEFAULT_DENOISE_STRENGTH);
  const lumaPerStrength = asked > 0 ? luminance / asked : 0;
  const remaining = existing.filter(mask => !isAutoDenoiseLayer(mask.id, id));
  let subjects = remaining.filter((mask): mask is Extract<Mask, { kind: 'subject' }> =>
    mask.kind === 'subject' && !mask.hidden && !mask.invert && !isCombined(mask) &&
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
  const combinedAlpha = combined ? maskAlpha(combined, original.width, original.height, fullContext(original.width, original.height)) : undefined;
  // TrueDetail eye protection: one likely eye per subject, while the mask limit allows.
  const eyeRoom = MAX_MASKS - remaining.length - newLayers.length - 2;
  const eyes = combined && eyeRoom > 0 ? findSubjectEyes(original, subjects, combinedAlpha!, eyeRoom) : [];
  const subject = combined ? {
    maskId: id, grid: combined.grid, framingKey: combined.framingKey, confidence: combined.confidence, detail: combined.detail,
    alpha: combinedAlpha!, eyes,
  } : undefined;
  if (!subject && (previousBackground || subjects.length)) {
    // Do not replace an established protected recipe with global smoothing.
    return { runner: 'device', strength: 0, luminance: 0, masks: [], verified: false, notes: [engineText.denoise.protectionLost] };
  }
  // TrueDetail: when the opt-in NAFNet pack is on this device, run it on the subject's area at full size, so the
  // guardian can compare it with the built-in denoise region by region.
  const learnedOutcome = subject ? await runLearnedOnSubject(source, framing, original, subject.alpha, signal,
    (done, total) => progress?.(done, total, `Learned denoise ${done} of ${total}`)) : { kind: 'unavailable' as const };
  signal?.throwIfAborted();
  // Judge the learned result where it was made, too: the working copy is scaled down and hides the fine detail a
  // learned denoiser can smooth away. Only the blend strengths that pass at full size are offered to the guardian.
  const ran = learnedOutcome.kind === 'ready' ? learnedOutcome.result : null;
  const learnedStrengths = ran
    ? (await compute.qualifyLearned(ran.fullSize.original, ran.fullSize.learned, ran.fullSize.alpha, [...LEARNED_STRENGTHS]))
      .filter(verdict => verdict.reason === null).map(verdict => verdict.strength)
    : [];
  signal?.throwIfAborted();
  const learned = ran && learnedStrengths.length ? ran : null;
  const session = await compute.open({
    original, baseEdit: frame.edit, recipeId: id, newLayers, lumaPerStrength, subjects, subjectAlpha: subject?.alpha,
    ...(learned ? { learned: learned.working } : {}),
  });
  const baseline = session.baseline;
  const render = async (edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): Promise<Pixels> => {
    signal?.throwIfAborted();
    return session.render(edit, masks, blend);
  };
  // Remote filtering of already edited pixels is not equivalent to applying a
  // reversible denoise recipe to the original. Keep composed recipes local.
  const attempt = cloud && !subject && (!frame.edit || isNeutralEdit(frame.edit))
    ? createCloudProcessingAttempt(cloud.connection, { online: cloud.online, signedIn: true, userConsent: true }, signal)
    : undefined;
  // Each attempt is rendered and checked in the worker by the same rules runDenoiseAction applies in-thread.
  const request = { capability: 'denoise' as const, backgroundDenoise: asked, render, original: baseline, subject, signal,
    luminancePerStrength: lumaPerStrength,
    ...(learned ? { learned: { source: learned.model, strengths: learnedStrengths } } : {}),
    assess: (edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend) => session.assess(edit, masks, blend) };
  let response = await runEngineCapability(request, attempt);
  // Even a verified remote raster is not the recipe the editor will save.
  // Verify the actual local rendering, and retry on-device if it differs.
  if (response.capability === 'denoise' && response.runner === 'cloud-processing' &&
      !(await session.composedOk(response.result.edit, response.result.masks))) {
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
  if (subject) notes.unshift(trueDetailNote(result.regions, subjects.length, eyes.length));
  if (learnedOutcome.kind === 'skipped') notes.push(learnedOutcome.note);
  if (ran && !learned) notes.push(engineText.denoise.learnedLostDetail);
  let trueDetailAi: TrueDetailAi | undefined;
  if (result.verification.ok && result.learned && learned) {
    // Stored once, on this device only, beside the original (never over it); the recipe points at it.
    const asset = await saveLayerAsset(await learned.png());
    signal?.throwIfAborted();
    trueDetailAi = { model: learned.model, modelSha256: learned.modelSha256, asset, framingKey: framingKey(framing), rect: learned.rect,
      maskId: id, subject: round3(result.learned.subject), eyes: round3(result.learned.eyes) };
  }
  else if (detectionUnavailable) notes.unshift(engineText.denoise.global);
  if (!result.verification.ok) notes.push(engineText.denoise.failedCheck);
  return { runner: response.runner === 'cloud-processing' ? 'cloud-processing' : 'device', strength, luminance: Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4, masks: subject ? [...newLayers, ...result.masks] : result.masks, verified: result.verification.ok, notes, ...(trueDetailAi ? { trueDetailAi } : {}) };
}
