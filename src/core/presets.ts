import { DETAIL_CONTROLS, TONE_CONTROLS, type PhotoEdit } from './photoEdits';

export interface Preset {
  id: string;
  name: string;
  edit: PhotoEdit;
  builtIn?: boolean;
}

const KEYS = ['exposure', 'warmth', 'tint', 'colour', ...TONE_CONTROLS.map(({ key }) => key), ...DETAIL_CONTROLS.map(({ key }) => key), 'denoise'] as const;
/** Exposure runs to +/-5 EV (12.5 on the slider); noise reduction only goes up, to 2. Everything else is -2 to 2. */
const RANGE = (key: string): [number, number] => key === 'exposure' ? [-12.5, 12.5] : key === 'denoise' ? [0, 2] : [-2, 2];

/** Keep only known numeric controls, clamped to the slider range. Masks are never stored in presets. */
export function sanitiseEdit(value: unknown): PhotoEdit {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const edit: Record<string, number> = { exposure: 0, warmth: 0, colour: 0 };
  for (const key of KEYS) {
    const number = raw[key];
    if (typeof number === 'number' && Number.isFinite(number) && number !== 0) { const [low, high] = RANGE(key); const kept = Math.max(low, Math.min(high, number)); if (kept !== 0) edit[key] = kept; }
  }
  return edit as unknown as PhotoEdit;
}

/** A recipe only keeps the controls that differ from neutral, so presets stay readable. */
export const BUILT_IN_PRESETS: Preset[] = [
  { id: 'natural', name: 'Natural', builtIn: true, edit: sanitiseEdit({ contrast: 0.3, vibrance: 0.4, shadows: 0.3, sharpen: 0.4 }) },
  { id: 'wildlife', name: 'Wildlife pop', builtIn: true, edit: sanitiseEdit({ contrast: 0.5, shadows: 0.6, highlights: -0.4, vibrance: 0.7, clarity: 0.4, sharpen: 0.6 }) },
  { id: 'soft', name: 'Soft light', builtIn: true, edit: sanitiseEdit({ exposure: 0.2, contrast: -0.4, shadows: 0.7, highlights: -0.6, texture: -0.2 }) },
  { id: 'moody', name: 'Deep and moody', builtIn: true, edit: sanitiseEdit({ exposure: -0.3, contrast: 0.8, blacks: -0.5, colour: -0.3, clarity: 0.5 }) },
  { id: 'warm', name: 'Golden warmth', builtIn: true, edit: sanitiseEdit({ warmth: 0.8, vibrance: 0.4, shadows: 0.3, contrast: 0.2 }) },
  { id: 'cool', name: 'Cool and crisp', builtIn: true, edit: sanitiseEdit({ warmth: -0.7, contrast: 0.4, clarity: 0.4, sharpen: 0.6 }) },
  // Approximations only. They are not Nikon's colour science or Picture Control data.
  { id: 'vivid-ish', name: 'Vivid-style', builtIn: true, edit: sanitiseEdit({ contrast: 0.6, colour: 1.2, vibrance: 0.4, sharpen: 0.5 }) },
  { id: 'landscape-ish', name: 'Landscape-style', builtIn: true, edit: sanitiseEdit({ contrast: 0.4, colour: 0.7, vibrance: 0.5, clarity: 0.5, highlights: -0.3, shadows: 0.3 }) },
  { id: 'portrait-ish', name: 'Portrait-style', builtIn: true, edit: sanitiseEdit({ contrast: -0.1, colour: 0.1, warmth: 0.2, texture: -0.3, shadows: 0.3 }) },
  // Full desaturation at Colour -2 is rendered as grayscale on CPU and GPU.
  // Three distinct tonal recipes, not a colour overlay or Nikon Picture Control.
  { id: 'mono-natural', name: 'Mono natural', builtIn: true, edit: sanitiseEdit({ colour: -2, contrast: 0.15, highlights: -0.2, shadows: 0.25, sharpen: 0.35 }) },
  { id: 'mono-bold', name: 'Mono bold', builtIn: true, edit: sanitiseEdit({ colour: -2, contrast: 1.1, blacks: -0.6, clarity: 0.6, sharpen: 0.5 }) },
  { id: 'mono-soft', name: 'Mono soft', builtIn: true, edit: sanitiseEdit({ colour: -2, contrast: -0.3, highlights: -0.45, shadows: 0.5, texture: -0.2 }) },
];

/** A selected look is identified by its actual global slider values, not a stale button click. */
export function matchesPresetEdit(current: PhotoEdit, preset: PhotoEdit): boolean {
  const a = sanitiseEdit(current);
  const b = sanitiseEdit(preset);
  return KEYS.every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

export function parsePresets(json: string | null): Preset[] {
  if (!json) return [];
  try {
    const list: unknown = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const { id, name, edit } = item as Record<string, unknown>;
      if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) return [];
      return [{ id, name: name.trim().slice(0, 40), edit: sanitiseEdit(edit) }];
    });
  } catch {
    return [];
  }
}

export function addPreset(list: Preset[], name: string, edit: PhotoEdit, id: string): Preset[] {
  const clean = name.trim().slice(0, 40);
  if (!clean) return list;
  const saved: Preset = { id, name: clean, edit: sanitiseEdit(edit) };
  const index = list.findIndex((preset) => preset.name.toLowerCase() === clean.toLowerCase());
  return index === -1 ? [...list, saved] : list.map((preset, at) => (at === index ? { ...saved, id: preset.id } : preset));
}

export function removePreset(list: Preset[], id: string): Preset[] {
  return list.filter((preset) => preset.id !== id);
}
