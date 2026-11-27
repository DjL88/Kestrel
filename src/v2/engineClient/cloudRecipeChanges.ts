import type { CloudRecipeSettings, RecipeSetting } from '../../core/cloudRecipe';
import type { EditRecipe } from '../ui/contract';

/**
 * What the cloud's edit settings changed, in plain words (Dave, 27 Nov: the card said only "Applied the cloud's edit
 * settings", so he thought the cloud had not been used). Each setting the cloud set to a new value, against what the
 * photo had: "Exposure +0.3", "Highlights −20". A setting it left where it was is not listed. `before` holds the old
 * values of the changed settings, so the photo can be shown as it was for a quick compare.
 */
export interface CloudRecipeChanges {
  /** In the order the Adjust panel lists them. Empty when nothing meaningful changed. */
  lines: string[];
  /** The changed settings at their old values. */
  before: Partial<EditRecipe>;
}

/** The Adjust panel's order. */
const ORDER: RecipeSetting[] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation',
  'clarity', 'dehaze', 'sharpen', 'denoiseLuminance', 'denoiseColour',
];

/** Smaller than this is not a change anyone would see. */
const SMALLEST: Partial<Record<RecipeSetting, number>> = { exposure: 0.05 };

const MINUS = '−';
const signed = (value: number, decimals: number) => {
  const text = Math.abs(value).toFixed(decimals);
  return value < 0 ? `${MINUS}${text}` : `+${text}`;
};

export function cloudRecipeChanges(was: Partial<EditRecipe>, settings: CloudRecipeSettings, names: Partial<Record<RecipeSetting, string>>): CloudRecipeChanges {
  const lines: string[] = [];
  const before: Partial<EditRecipe> = {};
  for (const key of ORDER) {
    const next = settings[key];
    if (next === undefined) continue;
    const old = Number((was as Record<string, unknown>)[key] ?? 0);
    const from = Number.isFinite(old) ? old : 0;
    const delta = next - from;
    if (Math.abs(delta) < (SMALLEST[key] ?? 1)) continue;
    lines.push(`${names[key] ?? key} ${key === 'exposure' ? signed(Math.round(delta * 10) / 10, 1) : signed(Math.round(delta), 0)}`);
    (before as Record<string, number>)[key] = from;
  }
  return { lines, before };
}
