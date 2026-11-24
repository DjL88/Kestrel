import { engineScheduler, type SchedulerTicket } from '../../core/engineScheduler';
import { isHeifFile, isRawPreviewFile, fullResolutionRasterFormat } from '../../core/rawFormats';
import { DEFAULT_FRAMING, framedSize } from '../../core/photoFraming';
import { ORIGINAL_FORMAT_ID } from './formatOps';
import { toProfile } from '../../core/exportFormats';
import { renderV2Export, type OverlayDraw } from './renderV2Export';
import { loadExportSource, loadVerifiedRasterOriginalForExport, saveExportFile } from '../../providers/browserExport';
import { chooseDesktopExportFolder } from '../../providers/desktopShell';
import { uniqueExportFilename } from '../../core/exportNaming';
import { verifyExactOriginalCopy } from './verifiedOriginalCopy';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import type { ExportRequest } from '../ui/contract';
import type { ExportJob, ExportPlan } from './exportOps';

/** Each photo/format/edit-group is one restartable-at-a-boundary scheduler unit.
 * Split formats remain one atomic unit containing 2-3 delivered panels. */
export type ScheduledPhotoUnit =
  | { id: string; label: string; frameId: string; kind: 'developed'; jobIndex: number; variantIndex: number }
  | { id: string; label: string; frameId: string; kind: 'original' };

export type ConfirmedExportPlan = Extract<ExportPlan, { jobs: ExportJob[] }>;
export function photoExportUnits(plan: ConfirmedExportPlan, frames: readonly Pick<PhotoFrame, 'id' | 'filename'>[]): ScheduledPhotoUnit[] {
  const names = new Map(frames.map(frame => [frame.id, frame.filename]));
  return [
    ...plan.jobs.flatMap((job, jobIndex) =>
      job.variants.map((variant, variantIndex): ScheduledPhotoUnit => ({
        id: `developed:${jobIndex}:${variantIndex}`,
        frameId: job.frameId, kind: 'developed', jobIndex, variantIndex,
        label: `${names.get(job.frameId) ?? job.frameId} · ${job.format.label} · ${variant.kind === 'unedited' ? 'Unedited' : 'Edited'}${variant.suffix}`,
      }))),
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
  if (input.request.destination !== 'local-individual' && input.request.destination !== 'local-folder')
    throw new Error('Per-photo background export needs Download each or a desktop folder.');
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
  const names = new Set<string>();
  const started = new Date();
  const provider = input.provider;
  return engineScheduler.submit({
    title: `Exporting ${input.plan.summary}`,
    kind: 'export',
    location: 'local',
    resource: 'gpu', // full-resolution canvas / denoise must not allocate concurrently
    priority: 1,
    pauseable: units.length > 1,
    items: units,
    snapshot,
    itemId: item => item.id,
    itemLabel: item => item.label,
    runItem: async (item, submitted, ctx) => {
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
        const longest = nativeSize ? Math.max(nativeSize.width * (job.sections ?? 1), nativeSize.height) : 0;
        const limit = submitted.request.maxLongestEdgePx;
        const scale = nativeSize && limit && limit > 0 ? Math.min(1, limit / longest) : 1;
        const outputSize = nativeSize
          ? { width: Math.max(1, Math.floor(nativeSize.width * scale)), height: Math.max(1, Math.floor(nativeSize.height * scale)) }
          : job.size;
        const outputFormat = nativeSize ? { ...job.format, ...outputSize } : job.format;
        const overlay = variant.kind === 'unedited' ? null : await input.buildOverlay(frame, submitted.request);
        ctx.checkCancelled();
        ctx.stage('Rendering complete edit, masks, crop and overlays');
        const result = await renderV2Export(
          image, { ...frame, edit: variant.edit }, outputSize, job.crop, toProfile(outputFormat),
          overlay, started, ctx.signal, job.sections ?? 1,
        );
        ctx.checkCancelled();
        files = (result.sections ?? [result.file]).map(rendered => {
          const base = rendered.name.replace(/(\.[^.]+)?$/, extension => variant.suffix + extension);
          return new File([rendered], base, { type: rendered.type, lastModified: rendered.lastModified });
        });
      }
      for (const file of files) {
        ctx.checkCancelled();
        const name = uniqueExportFilename(file.name, names);
        const output = name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
        ctx.stage(`Saving ${name}`);
        if (folder) await folder.save(output, '', ctx.signal);
        else if (!await saveExportFile(output, output.name, ctx.signal))
          throw new DOMException('Save cancelled. Previously saved outputs remain unchanged.', 'AbortError');
        // Each item is only marked done AFTER the destination acknowledged its write.
      }
      ctx.checkCancelled();
    },
  });
}
