import { isEdited } from './editedState';
import type { CullScanStage } from './cullScanProgress';
import type { PhotoFrame } from './types';

/**
 * Facts for the three independent markers below a library photo.
 * This is NOT a percent-complete pipeline: scanning and editing are optional,
 * and a photo is usable as soon as its image actually loaded.
 */
export type PhotoPreviewReadiness = 'loading' | 'ready' | 'unavailable';

export interface PhotoTileMilestones {
  preview: PhotoPreviewReadiness;
  cullScanned: boolean;
  /** Provisional in-memory work stage; 'recorded' requires a persisted valid score. */
  analysis: CullScanStage | 'recorded' | 'idle';
  edited: boolean;
  summary: string;
}

export function photoTileMilestones(
  frame: Pick<PhotoFrame, 'cullScore' | 'edit' | 'framing'>,
  preview: PhotoPreviewReadiness,
  currentStage?: CullScanStage,
): PhotoTileMilestones {
  // An absent, corrupt or out-of-range score is not evidence of a completed scan. Zero is valid.
  const cullScanned = typeof frame.cullScore === 'number' &&
    Number.isFinite(frame.cullScore) && frame.cullScore >= 0 && frame.cullScore <= 100;
  const analysis = cullScanned ? 'recorded' : currentStage ?? 'idle';
  const analysisText = analysis === 'recorded' ? 'Cull scan recorded'
    : analysis === 'queued' ? 'Waiting for local analysis'
    : analysis === 'analysing' ? 'Analysing this photo'
    : analysis === 'analysed' ? 'Photo analysed; finishing shoot comparison'
    : analysis === 'unavailable' ? 'Could not analyse this photo; manual review available'
    : 'No cull scan recorded';
  const edited = isEdited(frame);
  const previewText = preview === 'ready' ? 'Preview ready to open'
    : preview === 'unavailable' ? 'Preview unavailable; original may need reconnecting'
    : 'Preview loading';
  return {
    preview,
    cullScanned,
    analysis,
    edited,
    summary: `${previewText}. ${analysisText}. ${edited ? 'Saved edits' : 'No saved edits'}.`,
  };
}

/**
 * How each marker state looks, colour aside: CLAUDE.md allows no colour-only cues, so every state a segment can show
 * has its own shape. `pattern` names a CSS class in index.css (or none); `full` is the full-height bar, otherwise a
 * thin line. Colours are added by the component and are a second cue only.
 */
export type SegmentState = PhotoPreviewReadiness | PhotoTileMilestones['analysis'] | 'done' | 'not-yet';
export function segmentShape(state: SegmentState): { pattern: '' | 'tile-dotted' | 'tile-dashed' | 'tile-hatched'; full: boolean } {
  switch (state) {
    case 'ready': case 'recorded': case 'done': return { pattern: '', full: true };
    case 'loading': case 'analysing': return { pattern: 'tile-dotted', full: true };
    case 'analysed': return { pattern: 'tile-dashed', full: true };
    case 'unavailable': return { pattern: 'tile-hatched', full: true };
    case 'queued': case 'idle': case 'not-yet': return { pattern: '', full: false };
  }
}
