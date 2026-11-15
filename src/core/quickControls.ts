import { DETAIL_CONTROLS, EDIT_CHOICES, TONE_CONTROLS, type PhotoEdit } from './photoEdits';

export type QuickKey = (typeof EDIT_CHOICES)[number]['key'] | (typeof TONE_CONTROLS)[number]['key'] | (typeof DETAIL_CONTROLS)[number]['key'];

export interface QuickControl {
  key: QuickKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Every adjustment, in the order a person usually reaches for them: light and colour first, then tone, then detail. */
export const QUICK_CONTROLS: readonly QuickControl[] = [
  ...EDIT_CHOICES.map(({ key, label }) => ({ key, label, min: -2, max: 2, step: 0.1 })),
  ...TONE_CONTROLS.map(({ key, label }) => ({ key, label, min: -2, max: 2, step: 0.05 })),
  ...DETAIL_CONTROLS.map(({ key, label }) => ({ key, label, min: key === 'sharpen' ? 0 : -2, max: 2, step: 0.05 })),
];

export const controlFor = (key: QuickKey): QuickControl => QUICK_CONTROLS.find((entry) => entry.key === key) ?? QUICK_CONTROLS[0];

/** The value as the sliders show it: Light in stops, Warmth and Colour in percent, the rest on a -100 to 100 scale. */
export function valueText(key: QuickKey, value: number): string {
  if (key === 'exposure') return `${(value * 0.4).toFixed(2)} EV`;
  if (key === 'warmth') return `${Math.round(value * 8)}%`;
  if (key === 'colour') return `${Math.round(value * 20)}%`;
  return String(Math.round(value * 50));
}

/** Move a value one step up or down, without floating point drift and never outside its range. */
export function nudge(control: QuickControl, value: number, direction: -1 | 1): number {
  const next = Math.round((value + direction * control.step) / control.step) * control.step;
  return Math.min(control.max, Math.max(control.min, Number(next.toFixed(4))));
}

export const valueOf = (edit: PhotoEdit, key: QuickKey): number => edit[key] ?? 0;

/** Which controls have been moved, so they can be marked and the next one found quickly. */
export function changedKeys(edit: PhotoEdit): QuickKey[] {
  return QUICK_CONTROLS.filter(({ key }) => valueOf(edit, key) !== 0).map(({ key }) => key);
}
