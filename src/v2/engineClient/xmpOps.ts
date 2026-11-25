// XMP sidecars in V2: save ratings, flags and confirmed tags beside the originals' names, and read them back.
// Shared with V1 (core/xmpSidecars, core/xmpImportPlan, core/photoSidecar). Never reads or writes edits, pixels or
// the camera's own EXIF, and never changes an original.
import { applyDecisionWithHistory } from '../../core/cullingEngine';
import { addTags } from '../../core/subjectTags';
import { rawJpegPairs, withPartners } from '../../core/rawJpegPairs';
import { makeXmpDownload } from '../../core/xmpSidecars';
import { planXmpImports, SidecarImportError, type SidecarImport } from '../../core/xmpImportPlan';
import type { CullingState, PhotoFrame } from '../../core/types';
import { STRINGS } from '../ui/strings';

/** Which photos a File menu XMP action covers: the selection when two or more are selected, otherwise the whole project. */
export function xmpScope(frames: readonly PhotoFrame[], selectedIds: readonly string[]): PhotoFrame[] {
  // A paired JPEG shares its RAW's name and decisions, so the RAW's sidecar speaks for both.
  const paired = rawJpegPairs(frames).rawOf;
  const live = frames.filter((frame) => !frame.removedAt && !frame.isDemo && !frame.virtualCopy && !paired.has(frame.id));
  if (selectedIds.length < 2) return live;
  const chosen = new Set(selectedIds);
  return live.filter((frame) => chosen.has(frame.id));
}

/** Apply already-validated sidecars: rating, flag or set aside (with undo history) and confirmed keywords. */
export function applySidecarImports(state: CullingState, planned: readonly SidecarImport[]): CullingState {
  let next = state;
  const pairs = rawJpegPairs(state.frames);
  const expanded = planned.flatMap((entry) => withPartners([entry.frameId], pairs).map((frameId) => ({ ...entry, frameId })));
  for (const { frameId, metadata } of expanded) {
    const matches = next.frames.filter((frame) => frame.id === frameId);
    if (matches.length !== 1 || matches[0].removedAt != null) continue;
    if (metadata.decision && metadata.decision !== matches[0].decision) {
      next = applyDecisionWithHistory(next, frameId, metadata.decision, { allowAdvance: false });
    }
    const accepted = new Set(metadata.keywords.map((word) => word.toLowerCase()));
    next = {
      ...next,
      frames: next.frames.map((frame) => frame.id !== frameId ? frame : {
        ...frame,
        ...(metadata.rating !== undefined ? { rating: metadata.rating } : {}),
        ...(metadata.keywords.length ? {
          tags: addTags(frame.tags ?? [], metadata.keywords),
          autoTags: frame.autoTags?.filter((tag) => !accepted.has(tag.toLowerCase())),
        } : {}),
      }),
    };
  }
  return { ...next, shoot: { ...next.shoot, lastUpdatedAt: Date.now() } };
}

/** Plain words for why reading sidecars changed nothing. */
export function sidecarFailureText(error: unknown): string {
  const reason = error instanceof SidecarImportError ? error.reason : 'unsafe';
  return STRINGS.xmp.failed[reason];
}

export { planXmpImports };

/** Save the sidecars for these photos: one .xmp, or a .zip of them. Returns what happened, in words. */
export async function saveSidecars(frames: readonly PhotoFrame[]): Promise<string | null> {
  const output = makeXmpDownload(frames);
  if (!output) return frames.length ? STRINGS.xmp.sameName : STRINGS.xmp.nothingToSave;
  const { isDesktopApp, isMobileShell, saveWithDialog } = await import('../../providers/desktopShell');
  const { downloadInBrowser } = await import('../../providers/browserExport');
  try {
    if (isMobileShell()) {
      const shared = { files: [new File([output.blob], output.name, { type: output.blob.type })] };
      if (navigator.canShare?.(shared)) await navigator.share(shared);
      else downloadInBrowser(output.blob, output.name);
    } else if (isDesktopApp()) {
      if (!await saveWithDialog(output.blob, output.name, true)) return null;
    } else {
      downloadInBrowser(output.blob, output.name);
    }
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError') return null;
    return STRINGS.xmp.saveFailed;
  }
  return STRINGS.xmp.saved(frames.length, output.name);
}
