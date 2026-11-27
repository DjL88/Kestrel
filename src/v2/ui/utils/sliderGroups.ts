import type { EditRecipe } from '../contract';
import { NEUTRAL_RECIPE } from '../../engineClient/recipeMap';
import { isNeutralCurve, isNeutralMixer } from '../../../core/curveMixer';
import { isNeutralChannelCurves, isNeutralGrade } from '../../../core/colourGrade';
import { isNeutralCalibration } from '../../../core/calibration';

/**
 * The groups Adjust › Advanced Edits lists its controls in (Dave, 27 Nov: "group the edit sliders more distinctly"):
 * which recipe values each group holds, whether any is off its default, and the change that puts them back. Only the
 * grouping lives here; every slider's own maths is unchanged.
 */
export type SliderGroupId = 'light' | 'colour' | 'detail' | 'effects' | 'curve' | 'mixer' | 'grading';

type Key = keyof EditRecipe;

/** Values that, when off their default, mean the group changes the photo. */
const MEASURED: Record<SliderGroupId, Key[]> = {
  light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  colour: ['temperature', 'tint', 'vibrance', 'saturation', 'whiteBalance'],
  detail: ['clarity', 'sharpen', 'captureSharpen', 'deblur'],
  // Vignette and grain shape values do nothing while their amount is 0, so the amounts decide.
  effects: ['dehaze', 'vignette', 'grain', 'lensDistortion', 'lensVignetting', 'lensProfile', 'caRed', 'caBlue', 'defringePurple', 'defringeGreen'],
  curve: ['toneCurve', 'channelCurves'],
  mixer: ['colourMixer'],
  grading: ['colourGrade', 'calibration'],
};

/** Everything Reset puts back for the group, including the shape values the amounts above switch on. */
const RESET: Record<SliderGroupId, Key[]> = {
  ...MEASURED,
  effects: [...MEASURED.effects, 'vignetteSize', 'vignetteBlur', 'vignetteColour', 'vignetteRoundness', 'vignetteFeather', 'vignetteHighlights', 'grainSize', 'grainRoughness'],
};

const neutralOf = (key: Key): unknown => (NEUTRAL_RECIPE as Partial<EditRecipe>)[key];

function isDefault(key: Key, value: unknown): boolean {
  switch (key) {
    case 'toneCurve': return isNeutralCurve(value);
    case 'channelCurves': return isNeutralChannelCurves(value);
    case 'colourMixer': return isNeutralMixer(value);
    case 'colourGrade': return isNeutralGrade(value);
    case 'calibration': return isNeutralCalibration(value);
    default: {
      if (value === undefined || value === null) return true;
      const neutral = neutralOf(key);
      if (neutral !== undefined) return value === neutral;
      return value === 0 || value === false || value === '';
    }
  }
}

/** Whether any value in this group is off its default: the group heading then says "Changed". */
export function groupChanged(recipe: EditRecipe, id: SliderGroupId): boolean {
  return MEASURED[id].some((key) => !isDefault(key, recipe[key]));
}

/** The recipe change that puts this group back to its defaults, and nothing else. */
export function groupResetPatch(id: SliderGroupId): Partial<EditRecipe> {
  const patch: Partial<Record<Key, unknown>> = {};
  for (const key of RESET[id]) patch[key] = neutralOf(key);
  return patch as Partial<EditRecipe>;
}

const KEY = 'inflight.v2.adjustGroupsClosed';
const IDS: readonly SliderGroupId[] = ['light', 'colour', 'detail', 'effects', 'curve', 'mixer', 'grading'];

/** Which groups this person has closed, on this device. Every group starts open. */
export function readClosedGroups(store: Pick<Storage, 'getItem'> | null | undefined): Set<SliderGroupId> {
  try {
    const value = JSON.parse(store?.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is SliderGroupId => IDS.includes(id as SliderGroupId)) : []);
  } catch {
    return new Set();
  }
}

export function writeClosedGroups(store: Pick<Storage, 'setItem'> | null | undefined, closed: ReadonlySet<SliderGroupId>): void {
  try { store?.setItem(KEY, JSON.stringify([...closed])); } catch { /* not kept: groups open again next time */ }
}
