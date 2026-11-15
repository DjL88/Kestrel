import { isNeutralEdit } from './photoEdits';
import { DEFAULT_FRAMING } from './photoFraming';
import type { PhotoFrame } from './types';

/** True when a photo carries adjustments, local masks or a crop, so it can show an "edited" marker and be reset. */
export function isEdited(frame: Pick<PhotoFrame, 'edit' | 'framing'>): boolean {
  const { edit, framing } = frame;
  if (edit && !isNeutralEdit(edit)) return true;
  if (!framing) return false;
  return framing.ratio !== DEFAULT_FRAMING.ratio || framing.turns !== DEFAULT_FRAMING.turns ||
    framing.straighten !== DEFAULT_FRAMING.straighten || framing.x !== DEFAULT_FRAMING.x || framing.y !== DEFAULT_FRAMING.y;
}
