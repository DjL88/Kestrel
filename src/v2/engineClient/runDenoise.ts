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
import { cropRectangle, DEFAULT_FRAMING, drawFramedPhoto, type PhotoFraming } from '../../core/photoFraming';
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
import { ANYWAY_DENOISE_STRENGTH, anywayLuminanceStrength, luminanceStrengthFor, VISIBLE_NOISE_SIGMA, type NoiseMeasurement } from '../../core/noiseEstimate';
import { mosaicExclusion, noiseLayout, type SubjectCoverage } from './noiseSampling';
import { language } from '../../i18n/messages';
import { fullDevelopPossible } from './fullDevelop';
import { canDevelopRaw } from '../../providers/rawDevelop';
import { isDesktopApp } from '../../providers/desktopShell';
import { engineText } from '../../i18n/areas/engine';
import { createDenoiseCompute, MAIN_THREAD_DENOISE_NOTE, type DenoiseCompute } from '../../providers/denoiseOffThread';

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Noise at full size, measured off the interface thread: a grid of crops drawn 1:1 from across the whole framed picture
 * (`noiseLayout`), side by side in one mosaic. Only the centre used to be measured, so noise in the shadows or the
 * background round a clean, sharp subject went unseen (Dave, 27 Nov: DJL3766). When the subject is known, its pixels are
 * left out, so the flattest parts of the background decide (`measureBackgroundNoise`); the estimator falls back to the
 * whole frame, and says so, when the subject leaves too little background.
 */
async function measureFullSizeNoise(source: HTMLImageElement, framing: PhotoFraming, compute: DenoiseCompute, subject?: SubjectCoverage): Promise<NoiseMeasurement> {
  const rotated = framing.turns % 2 !== 0;
  const crop = cropRectangle(rotated ? source.naturalHeight : source.naturalWidth, rotated ? source.naturalWidth : source.naturalHeight, framing);
  const layout = noiseLayout(crop.width, crop.height);
  if (!layout) return { sigma: null, blocks: 0, subjectBlocks: 0, subjectLeftOut: false };
  const width = layout.tileWidth * layout.cols;
  const height = layout.tileHeight * layout.rows;
  const mosaic = document.createElement('canvas');
  mosaic.width = width; mosaic.height = height;
  const ctx = mosaic.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { sigma: null, blocks: 0, subjectBlocks: 0, subjectLeftOut: false };
  // Plain crops of the source are exact; a turned, straightened or cropped picture is drawn through the same framing the editor uses.
  const plain = framing.turns === 0 && framing.straighten === 0 && crop.x === 0 && crop.y === 0 &&
    crop.width === source.naturalWidth && crop.height === source.naturalHeight;
  const tile = plain ? null : document.createElement('canvas');
  layout.tiles.forEach(({ sx, sy }, index) => {
    const dx = (index % layout.cols) * layout.tileWidth;
    const dy = Math.floor(index / layout.cols) * layout.tileHeight;
    if (plain) { ctx.drawImage(source, sx, sy, layout.tileWidth, layout.tileHeight, dx, dy, layout.tileWidth, layout.tileHeight); return; }
    drawFramedPhoto(source, tile!, framing, { region: { x: sx, y: sy, width: layout.tileWidth, height: layout.tileHeight }, scale: 1 });
    ctx.drawImage(tile!, dx, dy);
  });
  const exclude = subject ? mosaicExclusion(layout, crop.width, crop.height, subject) : undefined;
  return compute.measureBackground(ctx.getImageData(0, 0, width, height).data, width, height, exclude);
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
  /** Nothing was changed because no visible noise was found: the panel offers "Denoise anyway". */
  noVisibleNoise?: boolean;
  /** Nothing was measured because the RAW has not been developed from its sensor data yet, and a develop can be made: the panel says to develop it or wait for the develop. */
  notDeveloped?: boolean;
  /** One plain line for a "Denoise anyway" result that was applied: what was measured and the gentle strength used. */
  anywayNote?: string;
}

/** What the person asked for beyond the plain press of the button. */
export interface DenoiseOptions {
  /** Denoise a photo whose noise read as not visible, at a gentle strength, through the same verified recipe. */
  anyway?: boolean;
  /** Said once noise has been measured (the Tasks row detail): the value and the strength chosen. */
  onMeasured?: (text: string) => void;
}

/** A measured value for a sentence, with the decimal mark of the person's language. */
const formatMeasure = (value: number) => new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** The signed-in account's session, or null. Cloud is attempted only with one: signing in and pressing the button is the consent for that job. */
export type CloudAccess = { connection: CloudConnection; online: boolean } | null;

/**
 * Denoise one photo: asks the cloud first when the person is signed in and online (their press of the button is the
 * consent for this one job), and otherwise, or on any failure or unverified result, runs on this device. Uses a sensor-developed RAW source when required, then reduces it to a
 * working-size preview; never sends original bytes. Nothing is applied here: the caller stores the returned recipe.
 */
export async function runV2Denoise(
  frame: PhotoFrame, provider: BrowserPreviewProvider, cloud: CloudAccess, signal?: AbortSignal,
  progress?: (done: number, total: number, label: string) => void, options: DenoiseOptions = {},
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
  if (!source && !frame.isDemo && !signal?.aborted && isRawPreviewFile(frame.filename) &&
      !provider.isOfflineFallback(frame.stableKey) && !provider.isDeveloped(frame.stableKey) &&
      fullDevelopPossible(frame, canDevelopRaw(), provider.hasBlob(frame.stableKey) || frame.sourceKind !== 'file' || isDesktopApp())) {
    // A RAW that has not been developed from its sensor data yet, on a build that can develop it: its small camera
    // preview hides the noise, so say so in plain words (and not "could not read the original") and change nothing.
    // Where no develop can be made (no decoder, original not reachable) this stays the plain "could not read" error,
    // because waiting or developing would never help.
    return { runner: 'device', strength: 0, luminance: 0, masks: [], verified: false, notDeveloped: true, notes: [engineText.denoise.notDeveloped(frame.filename)] };
  }
  if (!source || !Number.isSafeInteger(source.naturalWidth) || !Number.isSafeInteger(source.naturalHeight) ||
      source.naturalWidth <= 0 || source.naturalHeight <= 0) return null;
  // The pixel work (noise, every candidate render and check) runs in a Web Worker so the editor keeps responding.
  const compute = createDenoiseCompute({ signal });
  try {
    const outcome = await denoiseVerifiedSource(frame, source, cloud, compute, signal, progress, options);
    if (outcome && compute.onMainThread) outcome.notes.push(MAIN_THREAD_DENOISE_NOTE);
    return outcome;
  } finally {
    compute.dispose();
  }
}

/** Everything after the source passed its provenance checks. */
async function denoiseVerifiedSource(
  frame: PhotoFrame, source: HTMLImageElement, cloud: CloudAccess, compute: DenoiseCompute, signal?: AbortSignal,
  progress?: (done: number, total: number, label: string) => void, options: DenoiseOptions = {},
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
  await yieldToInterface();
  signal?.throwIfAborted();
  const existing = frame.edit?.masks ?? [];
  const id = `auto-denoise-${frame.id}`;
  const previousBackground = existing.find(mask => mask.id === `${id}-background`);
  const wanted = previousBackground?.edit.denoise ?? (frame.edit?.denoise && frame.edit.denoise > 0 ? frame.edit.denoise : DEFAULT_DENOISE_STRENGTH);
  // "Denoise anyway" is gentle: never above the gentle default, even if an earlier run left a stronger setting.
  const asked = options.anyway ? Math.min(wanted, ANYWAY_DENOISE_STRENGTH) : wanted;
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
  // Noise is judged at full size, where the photographer sees it; the downscaled working copy hides it. The subject is
  // left out when it is known, so the flattest background decides, not a clean sharp subject or a textured one.
  await yieldToInterface();
  signal?.throwIfAborted();
  const measurement = await measureFullSizeNoise(source, framing, compute,
    combinedAlpha ? { alpha: combinedAlpha, width: original.width, height: original.height } : undefined);
  signal?.throwIfAborted();
  const sigma = measurement.sigma;
  const iso = typeof frame.exif?.iso === 'number' && frame.exif.iso > 0 ? frame.exif.iso : undefined;
  // Said whenever the reading may include the subject, so a clean sharp subject never passes for a clean background.
  const wholeFrameWords = sigma === null ? '' : !combinedAlpha ? engineText.denoise.wholeFrameNoSubject
    : measurement.subjectBlocks > 0 && !measurement.subjectLeftOut ? engineText.denoise.wholeFrameLarge : '';
  const measuredWords = sigma !== null
    ? [engineText.denoise.measured(formatMeasure(sigma), formatMeasure(VISIBLE_NOISE_SIGMA), iso ? String(iso) : null), wholeFrameWords].filter(Boolean).join(' ')
    : '';
  const luminance = options.anyway ? anywayLuminanceStrength(sigma, iso) : luminanceStrengthFor(sigma, iso);
  if (sigma !== null && luminance === 0) {
    return { runner: 'device', strength: 0, luminance: 0, masks: [], verified: false, noVisibleNoise: true, notes: [engineText.denoise.noVisibleNoise, measuredWords] };
  }
  if (sigma !== null) options.onMeasured?.([engineText.denoise.measuredStage(formatMeasure(sigma), formatMeasure(luminance)), wholeFrameWords].filter(Boolean).join('. '));
  const lumaPerStrength = asked > 0 ? luminance / asked : 0;
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
  if (response.runner === 'device' && response.cloudSkipped) notes.push(engineText.denoise.cloudWhy[response.cloudSkipped]);
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
  const anywayNote = options.anyway && sigma !== null && result.verification.ok
    ? engineText.denoise.anyway(formatMeasure(sigma), formatMeasure(strength), iso ? String(iso) : null) : undefined;
  return { runner: response.runner === 'cloud-processing' ? 'cloud-processing' : 'device', strength, luminance: Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4, masks: subject ? [...newLayers, ...result.masks] : result.masks, verified: result.verification.ok, notes, ...(trueDetailAi ? { trueDetailAi } : {}), ...(anywayNote ? { anywayNote } : {}) };
}
