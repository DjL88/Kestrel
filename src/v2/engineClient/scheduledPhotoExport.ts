import { engineScheduler, type SchedulerTicket } from '../../core/engineScheduler';
import { isHeifFile, isRawPreviewFile, fullResolutionRasterFormat } from '../../core/rawFormats';
import { DEFAULT_FRAMING, framedSize } from '../../core/photoFraming';
import { ORIGINAL_FORMAT_ID } from './formatOps';
import { toProfile } from '../../core/exportFormats';
import { renderV2Export, type OverlayDraw } from './renderV2Export';
import { archiveExports, loadExportSource, loadVerifiedRasterOriginalForExport, saveExportFile } from '../../providers/browserExport';
import { chooseDesktopExportFolder } from '../../providers/desktopShell';
import { uniqueExportFilename } from '../../core/exportNaming';
import { verifyExactOriginalCopy } from './verifiedOriginalCopy';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import type { ExportRequest } from '../ui/contract';
import { originalExportSize, type ExportJob, type ExportPlan } from './exportOps';
import { createSplitRenderCache } from './splitRenderCache';
import { master16Blocker } from '../../core/master16';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { canDevelopRaw, RawPrecisionUnavailableError } from '../../providers/rawDevelop';
import { editRaw16, openRaw16, ShownPictureMismatchError } from '../../providers/rawMaster16';
import type { Rgb16Image } from '../../core/master16';
import { hasNativeRaw } from '../../providers/desktopShell';
import { createRawSourceCache, rawSourceBudget } from './rawSourceCache';
import { captionMetadataFor } from '../../core/captionTemplate';
import { embedRasterXmp } from '../../core/rasterXmp';

/** Each photo/format/edit-group/panel is one independently tracked scheduler unit.
 * Completed files are never re-rendered on an ordinary pause/resume. */
export type ScheduledPhotoUnit =
  | { id: string; label: string; frameId: string; kind: 'developed'; jobIndex: number; variantIndex: number; panelIndex: number }
  | { id: string; label: string; frameId: string; kind: 'original' }
  | { id: string; label: string; frameId: string; kind: 'archive' };

export type ConfirmedExportPlan = Extract<ExportPlan, { jobs: ExportJob[] }>;
export function photoExportUnits(plan: ConfirmedExportPlan, frames: readonly Pick<PhotoFrame, 'id' | 'filename'>[]): ScheduledPhotoUnit[] {
  const names = new Map(frames.map(frame => [frame.id, frame.filename]));
  return [
    ...plan.jobs.flatMap((job, jobIndex) =>
      job.variants.flatMap((variant, variantIndex) =>
        Array.from({ length: job.sections ?? 1 }, (_, panelIndex): ScheduledPhotoUnit => ({
          id: `developed:${jobIndex}:${variantIndex}:${panelIndex}`,
          frameId: job.frameId, kind: 'developed', jobIndex, variantIndex, panelIndex,
          label: `${names.get(job.frameId) ?? job.frameId} · ${job.format.label} · ${variant.kind === 'unedited' ? 'Unedited' : 'Edited'}${variant.suffix}${job.sections ? ` · panel ${panelIndex + 1} of ${job.sections}` : ''}`,
        })))),
    ...plan.originals.map((frameId, index): ScheduledPhotoUnit => ({
      id: `original:${index}`, kind: 'original', frameId,
      label: `${names.get(frameId) ?? frameId} · exact original`,
    })),
  ];
}

interface ExportSnapshot {
  request: ExportRequest;
  plan: ConfirmedExportPlan;
  frames: PhotoFrame[];
}

/** Write a file only after rendering the full selected edit recipe and verifying the source.
 * A failed/aborted native save is not marked delivered. No downgrade to an embedded RAW preview. */
export async function scheduleV2PhotoExports(input: {
  request: ExportRequest;
  plan: ConfirmedExportPlan;
  frames: readonly PhotoFrame[];
  provider: BrowserPreviewProvider;
  buildOverlay: (frame: PhotoFrame, request: ExportRequest) => Promise<OverlayDraw | null>;
  /** When the person pressed Save files, for the folder picker's local timing record. */
  clickedAt?: number;
}): Promise<SchedulerTicket | null> {
  if (!['local-zip', 'local-individual', 'local-folder'].includes(input.request.destination))
    throw new Error('Choose a supported local export destination.');
  // Ask once, before queuing hundreds of photographs. The exclusive-write
  // destination creates a separate run folder and removes incomplete files.
  const folder = input.request.destination === 'local-folder' ? await chooseDesktopExportFolder(input.clickedAt) : null;
  if (input.request.destination === 'local-folder' && !folder) return null;
  const snapshot: ExportSnapshot = {
    request: structuredClone(input.request),
    plan: structuredClone(input.plan),
    frames: input.frames.filter(frame => input.request.photoIds.includes(frame.id)).map(frame => structuredClone(frame)),
  };
  const units = photoExportUnits(snapshot.plan, snapshot.frames);
  if (!units.length) throw new Error('No export outputs were selected.');
  const isZip = snapshot.request.destination === 'local-zip';
  const scheduledUnits: ScheduledPhotoUnit[] = isZip
    ? [...units, { id: 'archive:delivery', frameId: '', kind: 'archive', label: 'Assemble and save complete ZIP' }]
    : units;
  const zipFiles = new Map<string, File>();
  const names = new Set<string>();
  const reservedNames = new Map<string, string>();
  const started = new Date();
  const provider = input.provider;
  // Only one composition's encoded sections are retained; never cache decoded canvases.
  const splitCache = createSplitRenderCache<File>();
  // One RAW decode per photo, shared by its formats and variants while memory allows (rawSourceCache.ts).
  const rawSources = createRawSourceCache(rawSourceBudget({
    nativeDesktop: hasNativeRaw(),
    deviceMemoryGb: (globalThis.navigator as unknown as { deviceMemory?: number } | undefined)?.deviceMemory,
  }));
  // A relinked original is a different Blob: it never reuses the previous decode.
  const blobIds = new WeakMap<Blob, number>();
  let nextBlobId = 0;
  const blobId = (blob: Blob) => { let id = blobIds.get(blob); if (id === undefined) { id = ++nextBlobId; blobIds.set(blob, id); } return id; };
  const ticket = await engineScheduler.submit({
    title: `Exporting ${input.plan.summary}`,
    kind: 'export',
    location: 'local',
    resource: 'gpu', // full-resolution canvas / denoise must not allocate concurrently
    priority: 1,
    pauseable: units.length > 1,
    items: scheduledUnits,
    snapshot,
    itemId: item => item.id,
    itemLabel: item => item.label,
    runItem: async (item, submitted, ctx) => {
      if (item.kind === 'archive') {
        ctx.stage('Preparing complete ZIP archive');
        if (zipFiles.size !== units.length)
          throw new Error(`The archive is missing ${units.length - zipFiles.size} output files. Retry failed render items before delivering the ZIP.`);
        const files = units.map(unit => zipFiles.get(unit.id)!);
        const blob = await archiveExports(files);
        ctx.checkCancelled();
        ctx.stage('Saving the complete ZIP archive');
        if (!await saveExportFile(blob, `inflight-export-${started.toISOString().slice(0, 10)}.zip`, ctx.signal))
          throw new DOMException('ZIP save cancelled.', 'AbortError');
        ctx.acknowledgeCommitted();
        return;
      }
      ctx.stage('Checking original and output settings');
      const frame = submitted.frames.find(candidate => candidate.id === item.frameId);
      if (!frame) throw new Error('The selected photograph is missing from this export snapshot.');
      let files: File[];
      if (item.kind === 'original') {
        if (frame.isDemo) throw new Error('Demo photographs do not have verified original bytes.');
        const bytes = await provider.ensureOriginal(frame.stableKey, 'selected');
        ctx.checkCancelled();
        if (!bytes) throw new Error(`Reconnect ${frame.filename} before exporting its exact original.`);
        const verified = await verifyExactOriginalCopy(bytes, frame.originalSha256, ctx.signal);
        files = [new File([verified], frame.filename, { type: verified.type || 'application/octet-stream', lastModified: Date.now() })];
      } else {
        const job = submitted.plan.jobs[item.jobIndex];
        const variant = job?.variants[item.variantIndex];
        if (!job || !variant) throw new Error('The selected export recipe was not found.');
        const selectedPanel = await splitCache.get(
          `${item.jobIndex}:${item.variantIndex}`, job.sections ?? 1, item.panelIndex, () => renderExportJob({
            frame, job, variant, request: submitted.request, provider, buildOverlay: input.buildOverlay, started, signal: ctx.signal,
            stage: (message) => ctx.stage(message), checkCancelled: () => ctx.checkCancelled(),
            // The ticket's cache: a RAW is decoded once for all its formats and edit groups, and released when the ticket ends.
            openRawSource: (target, original, originalSha256, signal) => rawSources.get(`${target.stableKey}|${originalSha256 ?? ''}|${blobId(original)}`,
              () => openRaw16(original, target.filename, { originalSha256, signal })),
          }));
        ctx.checkCancelled();
        // Captions and credits (IPTC), only when the photographer switched them on (captionTemplate.ts).
        const captions = submitted.request.captions ? captionMetadataFor(frame, submitted.request.captions) : null;
        files = await Promise.all([selectedPanel].map(async rendered => {
          const base = rendered.name.replace(/(\.[^.]+)?$/, extension => variant.suffix + extension);
          const body = captions ? await embedRasterXmp(rendered, rendered.type === 'image/png' ? 'png' : 'jpeg', captions) : rendered;
          return new File([body], base, { type: rendered.type, lastModified: rendered.lastModified });
        }));
      }
      for (const file of files) {
        ctx.checkCancelled();
        // Reserve the output name once for this exact item. A failed native
        // save must retry the SAME filename, not make an accidental -2 copy.
        let name = reservedNames.get(item.id);
        if (!name) { name = uniqueExportFilename(file.name, names); reservedNames.set(item.id, name); }
        const output = name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
        if (isZip) {
          // A ZIP is one destination write. Intermediate images are rendered,
          // not falsely labelled as individually saved or recoverable.
          zipFiles.set(item.id, output);
        } else {
          ctx.stage(`Saving ${name}`);
          if (folder) await folder.save(output, '', ctx.signal);
          else if (!await saveExportFile(output, output.name, ctx.signal))
            throw new DOMException('Save cancelled. Previously saved outputs remain unchanged.', 'AbortError');
          // The destination confirmed this output before the next item starts.
          ctx.acknowledgeCommitted();
        }
      }
      ctx.checkCancelled();
    },
  });
  void ticket.finished.then(() => { splitCache.clear(); rawSources.clear(); });
  return ticket;
}

/** A RAW's decoded 16-bit picture. `shared` is true when others use the same picture, so it must not be edited in place. */
export type OpenRawSource = (frame: PhotoFrame, original: Blob, originalSha256: string | undefined, signal: AbortSignal) => Promise<{ image: Rgb16Image; shared: boolean }>;

/** Without a cache (the enlargement preview): decode the RAW for this one render; nothing else holds the picture. */
export const openRawSourceOnce: OpenRawSource = async (frame, original, originalSha256, signal) =>
  ({ image: await openRaw16(original, frame.filename, { originalSha256, signal }), shared: false });

/**
 * Render one export job: the verified source, the RAW check, the output size (Original follows Output scale), the
 * overlay, the 16-bit RAW path and `renderV2Export`. The export scheduler and the enlargement preview both call this,
 * so the preview is the exported picture, never an approximation of it.
 */
export async function renderExportJob({ frame, job, variant, request, provider, buildOverlay, started, signal, stage, checkCancelled, openRawSource = openRawSourceOnce }: {
  frame: PhotoFrame;
  job: ExportJob;
  variant: ExportJob['variants'][number];
  request: ExportRequest;
  provider: BrowserPreviewProvider;
  buildOverlay: (frame: PhotoFrame, request: ExportRequest) => Promise<OverlayDraw | null>;
  started: Date;
  signal: AbortSignal;
  stage: (message: string) => void;
  checkCancelled: () => void;
  /** How to get a RAW's decoded picture; the scheduler passes its per-ticket cache. */
  openRawSource?: OpenRawSource;
}): Promise<File[]> {
    // JPEG/PNG source pixels are read from the SHA-verified original, for
    // every size (not just Original); review previews cannot be exported.
    const verifiedRaster = !frame.isDemo && Boolean(fullResolutionRasterFormat(frame.filename));
    if (!frame.isDemo && isHeifFile(frame.filename))
      throw new Error(`Cannot verify full-resolution HEIF pixels for ${frame.filename} in this export path. Use a supported source; no preview was substituted.`);
    // A RAW on the 16-bit path takes its pixels, and its output size, from the 16-bit sensor develop below; the picture
    // passed with it is only checked for shape and turn (editRaw16). The stored screen-size develop does that as well as
    // a full-size 8-bit develop, which took about 25 s per Nikon Z 8 photo and was then not used. Anything else (no
    // stored develop, an edit the 16-bit path cannot carry, a 16-bit refusal) loads the full develop as before.
    const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
    const sixteen = raw && canDevelopRaw() && !master16Blocker(variant.edit ?? DEFAULT_EDIT, frame.framing);
    const guide = sixteen ? await loadDevelopedGuide(frame, provider) : null;
    checkCancelled();
    const fullSource = async () => {
      const loaded = verifiedRaster
        ? await loadVerifiedRasterOriginalForExport(frame, provider, signal)
        : await loadExportSource(frame, provider);
      checkCancelled();
      if (raw && (!provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey))) {
        throw new Error(`${frame.filename} has no verified sensor-developed source. Embedded RAW previews cannot be exported as full-quality photographs.`);
      }
      return loaded;
    };
    try {
    let image = guide?.image ?? await fullSource();
    const nativeSize = verifiedRaster && job.format.id === ORIGINAL_FORMAT_ID
      ? framedSize(image.naturalWidth, image.naturalHeight, frame.framing ?? DEFAULT_FRAMING) : null;
    // Original follows the edit's Output scale (2× doubles it); other formats keep their size and the renderer only
    // enlarges to fill them. Unedited variants never enlarge.
    const upscale = job.format.id === ORIGINAL_FORMAT_ID && variant.kind === 'edited' ? variant.edit.upscale : undefined;
    const scaledOriginal = nativeSize || upscale === 2 || upscale === 4;
    const outputSize = scaledOriginal
      ? originalExportSize(nativeSize ?? job.size, upscale, job.sections ?? 1, request.maxLongestEdgePx)
      : job.size;
    const outputFormat = scaledOriginal ? { ...job.format, ...outputSize } : job.format;
    const overlay = variant.kind === 'unedited' ? null : await buildOverlay(frame, request);
    checkCancelled();
    // A RAW is edited at 16 bits from its sensor data and rounded to 8 bits once, at the very end. An edit the
    // 16-bit renderer cannot carry yet keeps the 8-bit path, and the task says so rather than hiding it.
    let precise: Rgb16Image | undefined;
    if (!frame.isDemo && isRawPreviewFile(frame.filename) && canDevelopRaw()) {
      const blocker = master16Blocker(variant.edit ?? DEFAULT_EDIT, frame.framing);
      if (blocker) {
        stage(`8-bit export for ${frame.filename}: ${blocker}`);
      } else {
        stage('Developing RAW sensor data at 16 bits');
        const original = await provider.ensureOriginal(frame.stableKey, 'selected');
        checkCancelled();
        if (!original) throw new Error(`Reconnect ${frame.filename} before exporting. The original RAW file is not available.`);
        const originalSha256 = frame.originalSha256 && /^[a-f0-9]{64}$/.test(frame.originalSha256) ? frame.originalSha256 : undefined;
        // Bound to the recorded fingerprint when there is one, so a changed file is refused rather than exported.
        try {
          const source = await openRawSource(frame, original, originalSha256, signal);
          checkCancelled();
          try {
            precise = await editRaw16(source.image, image, variant.edit ?? DEFAULT_EDIT, frame.framing, { shared: source.shared, signal: signal });
          } catch (reason) {
            // A stored screen develop that does not match the sensor picture's shape: check against the full develop instead.
            if (!(reason instanceof ShownPictureMismatchError) || !guide) throw reason;
            image = await fullSource();
            precise = await editRaw16(source.image, image, variant.edit ?? DEFAULT_EDIT, frame.framing, { shared: source.shared, signal: signal });
          }
        } catch (reason) {
          // Only a refusal of the 16-bit path itself (compression that cannot be classified) falls back; a changed or
          // unreadable original still stops the export.
          if (!(reason instanceof RawPrecisionUnavailableError)) throw reason;
          stage(`8-bit export for ${frame.filename}: ${reason.message}`);
        }
        checkCancelled();
      }
    }
    // The 8-bit path draws the picture itself, so it needs the full develop, never the screen-size one.
    if (!precise && image === guide?.image) image = await fullSource();
    stage(precise ? 'Rendering the 16-bit edit, crop and overlays' : 'Rendering complete edit, masks, crop and overlays');
    const result = await renderV2Export(
      image, { ...frame, edit: variant.edit }, outputSize, job.crop, toProfile(outputFormat),
      overlay, started, signal, job.sections ?? 1, precise,
    );
    checkCancelled();
    return result.sections ?? [result.file];
    } finally {
      guide?.release();
    }
}

/**
 * The stored screen-size develop of a RAW (made from its sensor data after import), as a picture, or null when there is
 * none yet. Only for checking the 16-bit picture's shape and turn, never for its pixels or size.
 */
async function loadDevelopedGuide(frame: PhotoFrame, provider: BrowserPreviewProvider): Promise<{ image: HTMLImageElement; release: () => void } | null> {
  const pair = await provider.developedReview(frame).catch(() => null);
  if (!pair?.review) return null;
  const url = URL.createObjectURL(pair.review);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  return { image, release: () => URL.revokeObjectURL(url) };
}
