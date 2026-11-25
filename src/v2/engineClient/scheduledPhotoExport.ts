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
import { renderRaw16 } from '../../providers/rawMaster16';

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
}): Promise<SchedulerTicket | null> {
  if (!['local-zip', 'local-individual', 'local-folder'].includes(input.request.destination))
    throw new Error('Choose a supported local export destination.');
  // Ask once, before queuing hundreds of photographs. The exclusive-write
  // destination creates a separate run folder and removes incomplete files.
  const folder = input.request.destination === 'local-folder' ? await chooseDesktopExportFolder() : null;
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
          `${item.jobIndex}:${item.variantIndex}`, job.sections ?? 1, item.panelIndex, async () => {
          // JPEG/PNG source pixels are read from the SHA-verified original, for
          // every size (not just Original); review previews cannot be exported.
          const verifiedRaster = !frame.isDemo && Boolean(fullResolutionRasterFormat(frame.filename));
          if (!frame.isDemo && isHeifFile(frame.filename))
            throw new Error(`Cannot verify full-resolution HEIF pixels for ${frame.filename} in this export path. Use a supported source; no preview was substituted.`);
          const image = verifiedRaster
            ? await loadVerifiedRasterOriginalForExport(frame, provider, ctx.signal)
            : await loadExportSource(frame, provider);
          ctx.checkCancelled();
          if (!frame.isDemo && isRawPreviewFile(frame.filename) &&
              (!provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey))) {
            throw new Error(`${frame.filename} has no verified sensor-developed source. Embedded RAW previews cannot be exported as full-quality photographs.`);
          }
          const nativeSize = verifiedRaster && job.format.id === ORIGINAL_FORMAT_ID
            ? framedSize(image.naturalWidth, image.naturalHeight, frame.framing ?? DEFAULT_FRAMING) : null;
          // Original follows the edit's Output scale (2× doubles it); other formats keep their size and the renderer only
          // enlarges to fill them. Unedited variants never enlarge.
          const upscale = job.format.id === ORIGINAL_FORMAT_ID && variant.kind === 'edited' ? variant.edit.upscale : undefined;
          const scaledOriginal = nativeSize || upscale === 2 || upscale === 4;
          const outputSize = scaledOriginal
            ? originalExportSize(nativeSize ?? job.size, upscale, job.sections ?? 1, submitted.request.maxLongestEdgePx)
            : job.size;
          const outputFormat = scaledOriginal ? { ...job.format, ...outputSize } : job.format;
          const overlay = variant.kind === 'unedited' ? null : await input.buildOverlay(frame, submitted.request);
          ctx.checkCancelled();
          // A RAW is edited at 16 bits from its sensor data and rounded to 8 bits once, at the very end. An edit the
          // 16-bit renderer cannot carry yet keeps the 8-bit path, and the task says so rather than hiding it.
          let precise: Awaited<ReturnType<typeof renderRaw16>> | undefined;
          if (!frame.isDemo && isRawPreviewFile(frame.filename) && canDevelopRaw()) {
            const blocker = master16Blocker(variant.edit ?? DEFAULT_EDIT, frame.framing);
            if (blocker) {
              ctx.stage(`8-bit export for ${frame.filename}: ${blocker}`);
            } else {
              ctx.stage('Developing RAW sensor data at 16 bits');
              const original = await provider.ensureOriginal(frame.stableKey, 'selected');
              ctx.checkCancelled();
              if (!original) throw new Error(`Reconnect ${frame.filename} before exporting. The original RAW file is not available.`);
              const originalSha256 = frame.originalSha256 && /^[a-f0-9]{64}$/.test(frame.originalSha256) ? frame.originalSha256 : undefined;
              // Bound to the recorded fingerprint when there is one, so a changed file is refused rather than exported.
              try {
                precise = await renderRaw16(original, frame.filename, image, variant.edit ?? DEFAULT_EDIT, frame.framing, { originalSha256, signal: ctx.signal });
              } catch (reason) {
                // Only a refusal of the 16-bit path itself falls back; a changed or unreadable original still stops the export.
                if (!(reason instanceof RawPrecisionUnavailableError)) throw reason;
                ctx.stage(`8-bit export for ${frame.filename}: ${reason.message}`);
              }
              ctx.checkCancelled();
            }
          }
          ctx.stage(precise ? 'Rendering the 16-bit edit, crop and overlays' : 'Rendering complete edit, masks, crop and overlays');
          const result = await renderV2Export(
            image, { ...frame, edit: variant.edit }, outputSize, job.crop, toProfile(outputFormat),
            overlay, started, ctx.signal, job.sections ?? 1, precise,
          );
          ctx.checkCancelled();
            return result.sections ?? [result.file];
          });
        ctx.checkCancelled();
        files = [selectedPanel].map(rendered => {
          const base = rendered.name.replace(/(\.[^.]+)?$/, extension => variant.suffix + extension);
          return new File([rendered], base, { type: rendered.type, lastModified: rendered.lastModified });
        });
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
  void ticket.finished.then(() => splitCache.clear());
  return ticket;
}
