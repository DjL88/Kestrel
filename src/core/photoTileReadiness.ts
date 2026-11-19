import { isEdited } from './editedState';
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
  edited: boolean;
  summary: string;
}

export function photoTileMilestones(
  frame: Pick<PhotoFrame, 'cullScore' | 'edit' | 'framing'>,
  preview: PhotoPreviewReadiness,
): PhotoTileMilestones {
  // An absent, corrupt or out-of-range score is not evidence of a completed scan. Zero is valid.
  const cullScanned = typeof frame.cullScore === 'number' &&
    Number.isFinite(frame.cullScore) && frame.cullScore >= 0 && frame.cullScore <= 100;
  const edited = isEdited(frame);
  const previewText = preview === 'ready' ? 'Preview ready to open'
    : preview === 'unavailable' ? 'Preview unavailable; original may need reconnecting'
    : 'Preview loading';
  return {
    preview,
    cullScanned,
    edited,
    summary: `${previewText}. ${cullScanned ? 'Cull scan recorded' : 'No cull scan recorded'}. ${edited ? 'Saved edits' : 'No saved edits'}.`,
  };
}
