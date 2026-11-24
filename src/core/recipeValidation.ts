import { validMasks } from './maskTypes';
import { validCurve, validMixer } from './curveMixer';
import { validWhiteBalance } from './asShotWhite';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function number(value: unknown, min = -Infinity, max = Infinity): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** The same persisted recipe contract applies to portable backups and device sync. */
export function recipeIsValid(value: unknown): boolean {
  if (!record(value)) return false;
  const edit = value.edit;
  if (edit !== undefined && (!record(edit) || !number(edit.exposure, -12.5, 12.5) ||
    !number(edit.warmth, -2, 2) || !number(edit.colour, -2, 2) ||
    ['brightness', 'tint', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'texture', 'clarity', 'sharpen'].some((key) =>
      edit[key] !== undefined && !number(edit[key], -2, 2)) ||
    (edit.denoise !== undefined && !number(edit.denoise, 0, 2)) ||
    (edit.denoiseLuminance !== undefined && !number(edit.denoiseLuminance, 0, 2)) ||
    (edit.curve !== undefined && !validCurve(edit.curve)) || (edit.mixer !== undefined && !validMixer(edit.mixer)) ||
    (edit.whiteBalance !== undefined && !validWhiteBalance(edit.whiteBalance)) ||
    (edit.masks !== undefined && !validMasks(edit.masks)))) return false;
  const framing = value.framing;
  if (framing !== undefined && (!record(framing) || (framing.ratio !== null && !number(framing.ratio, 0.01, 100)) ||
    !number(framing.turns, 0, 3) || !Number.isInteger(framing.turns) || !number(framing.straighten, -12, 12) ||
    !number(framing.x, 0, 1) || !number(framing.y, 0, 1) || (framing.size !== undefined && !number(framing.size, 0.05, 1)))) return false;
  return true;
}

