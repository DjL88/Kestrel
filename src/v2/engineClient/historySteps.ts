import { MAX_EDIT_HISTORY_STEPS, type EditHistory, type EditKind } from '../../core/editHistory';
import type { PhotoEdit } from '../../core/photoEdits';
import type { EditRecipe } from '../ui/contract';
import { STRINGS } from '../ui/strings';
import { editToRecipe } from './recipeMap';

export interface HistoryChange { label: string; from: string; to: string }
export interface HistoryStepInfo {
  label: string;
  at: number;
  /** Who made the step when it was not the person slider by slider. */
  by?: 'auto' | 'lightroom';
  /** What changed, slider by slider, with real values. */
  changes?: HistoryChange[];
  /** Auto's own reasons, in the person's language, as it gave them. */
  why?: string[];
}
export interface HistoryInfo { steps: HistoryStepInfo[]; cursor: number; /** False if the import baseline was already compacted away. */ originalAvailable: boolean }

const LABEL: Record<EditKind, string> = {
  light: 'Brightness', warmth: 'Warmth', colour: 'Colour', adjustments: 'Several adjustments', tone: 'Tone', detail: 'Detail and noise',
  mask: 'Mask', crop: 'Crop', rotation: 'Rotate', straighten: 'Straighten',
};

type SliderKey = keyof typeof STRINGS.history.sliders;
const SLIDERS: readonly SliderKey[] = ['exposure', 'highlights', 'shadows', 'contrast', 'whites', 'blacks', 'temperature', 'tint', 'vibrance',
  'saturation', 'clarity', 'detailRecovery', 'sharpen', 'captureSharpen', 'deblur', 'denoiseLuminance', 'denoiseColour', 'dehaze', 'vignette', 'grain'];

const show = (key: SliderKey, value: number) => {
  const rounded = key === 'exposure' ? value.toFixed(2) : String(Math.round(value));
  const signed = value > 0 && !['sharpen', 'captureSharpen', 'deblur', 'denoiseLuminance', 'denoiseColour', 'detailRecovery', 'grain'].includes(key) ? `+${rounded}` : rounded;
  return key === 'exposure' ? `${signed} EV` : signed;
};

/** Slider-by-slider differences between two recipes, in the person's language. Only sliders that really moved. */
export function recipeChanges(before: PhotoEdit | undefined, after: PhotoEdit | undefined): HistoryChange[] {
  const from = editToRecipe(before) as unknown as Record<string, unknown>;
  const to = editToRecipe(after) as unknown as Record<string, unknown>;
  const changes: HistoryChange[] = [];
  for (const key of SLIDERS) {
    const a = Number(from[key as keyof EditRecipe] ?? 0);
    const b = Number(to[key as keyof EditRecipe] ?? 0);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < (key === 'exposure' ? 0.005 : 0.5)) continue;
    changes.push({ label: STRINGS.history.sliders[key], from: show(key, a), to: show(key, b) });
  }
  return changes;
}

/** Plain words for each recorded step, in the order they were made. Nothing is invented: only what the history recorded. */
export function describeHistory(history: EditHistory | undefined): HistoryInfo | undefined {
  if (!history || !history.steps.length) return undefined;
  return {
    steps: history.steps.map((step) => {
      const changes = recipeChanges(step.before.edit, step.after.edit);
      return {
        label: step.why ? (step.why.by === 'auto' ? STRINGS.history.byAuto : STRINGS.history.byLightroom)
          : JSON.stringify(step.before.formatSplits) !== JSON.stringify(step.after.formatSplits)
            ? 'Split or rejoin frames'
            : JSON.stringify(step.before.overlay) !== JSON.stringify(step.after.overlay)
              ? 'Text and watermark' : LABEL[step.kind] ?? 'Edit',
        at: step.at,
        ...(step.why ? { by: step.why.by } : {}),
        ...(changes.length ? { changes } : {}),
        ...(step.why?.notes?.length ? { why: step.why.notes } : {}),
      };
    }),
    cursor: history.cursor,
    // Old 60-step catalogues have no counter: assume truncated when full.
    originalAvailable: history.discarded === 0 ||
      (history.discarded === undefined && history.steps.length < MAX_EDIT_HISTORY_STEPS),
  };
}
