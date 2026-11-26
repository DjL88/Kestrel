import { DETAIL_CONTROLS, TONE_CONTROLS, type PhotoEdit } from './photoEdits';

export interface Preset {
  id: string;
  name: string;
  edit: PhotoEdit;
  builtIn?: boolean;
}

const KEYS = ['exposure', 'warmth', 'tint', 'colour', ...TONE_CONTROLS.map(({ key }) => key), ...DETAIL_CONTROLS.map(({ key }) => key), 'denoise', 'denoiseLuminance'] as const;
/** Exposure runs to +/-5 EV (12.5 on the slider); noise reduction only goes up, to 2. Everything else is -2 to 2. */
const RANGE = (key: string): [number, number] => key === 'exposure' ? [-12.5, 12.5] : (key === 'denoise' || key === 'denoiseLuminance') ? [0, 2] : [-2, 2];

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

/*
 * Your own looks in the V2 editor. A look is a reversible recipe of the global sliders only: no masks, crop, curves,
 * lens profile or AI layers, and never pixels. Applying one is the same single undoable step as a built-in look.
 * Values use the V2 slider scales (exposure in stops, the rest -100 to 100 or 0 to 100).
 */
export const USER_LOOK_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  exposure: [-5, 5],
  highlights: [-100, 100], shadows: [-100, 100], contrast: [-100, 100], whites: [-100, 100], blacks: [-100, 100],
  temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100], clarity: [-100, 100],
  dehaze: [-100, 100],
  sharpen: [0, 100], captureSharpen: [0, 100], deblur: [0, 100],
  denoiseLuminance: [0, 100], denoiseColour: [0, 100], detailRecovery: [0, 100],
  vignette: [-100, 100], vignetteSize: [0, 100], vignetteBlur: [0, 100], vignetteRoundness: [-100, 100], vignetteFeather: [0, 100],
};
export const USER_LOOK_KEYS = Object.keys(USER_LOOK_RANGES);
export const MAX_USER_LOOKS = 60;
const LOOK_NAME_LIMIT = 40;
export const USER_LOOKS_FORMAT = 'kestrel-looks';
export const USER_LOOKS_VERSION = 1;

export type UserLookRecipe = Record<string, number>;
export interface UserLook { id: string; name: string; recipe: UserLookRecipe; savedAt: number }

const cleanName = (name: unknown) => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, LOOK_NAME_LIMIT) : '');
const sameName = (a: string, b: string) => a.toLocaleLowerCase('en-GB') === b.toLocaleLowerCase('en-GB');

/**
 * Keep only known global sliders, each a finite number clamped to its range. Zeros are kept on purpose: a saved look
 * records where every slider sat, so applying it to another photo gives the same look rather than a partial one.
 */
export function userLookRecipe(value: unknown): UserLookRecipe {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const recipe: UserLookRecipe = {};
  for (const key of USER_LOOK_KEYS) {
    const number = raw[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    const [low, high] = USER_LOOK_RANGES[key];
    recipe[key] = Math.round(Math.max(low, Math.min(high, number)) * 100) / 100;
  }
  return recipe;
}

function readLook(item: unknown): UserLook | null {
  if (typeof item !== 'object' || item === null) return null;
  const { id, name, recipe, savedAt } = item as Record<string, unknown>;
  const clean = cleanName(name);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !clean) return null;
  const kept = userLookRecipe(recipe);
  if (!Object.keys(kept).length) return null;
  return { id, name: clean, recipe: kept, savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0 };
}

/** Looks kept on this device. Anything corrupt, duplicated or past the limit is left out rather than crashing. */
export function parseUserLooks(json: string | null): UserLook[] {
  if (!json) return [];
  try {
    const list: unknown = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    const kept: UserLook[] = [];
    for (const item of list) {
      const look = readLook(item);
      if (look && kept.length < MAX_USER_LOOKS && !kept.some((other) => other.id === look.id || sameName(other.name, look.name))) kept.push(look);
    }
    return kept;
  } catch {
    return [];
  }
}

/** Save a look. The same name (any case) replaces that look's settings and keeps its id. Null: no name, nothing to keep, or full. */
export function saveUserLook(list: UserLook[], name: string, recipe: unknown, id: string, now: number): UserLook[] | null {
  const clean = cleanName(name);
  const kept = userLookRecipe(recipe);
  if (!clean || !Object.keys(kept).length) return null;
  const index = list.findIndex((look) => sameName(look.name, clean));
  if (index !== -1) return list.map((look, at) => (at === index ? { id: look.id, name: clean, recipe: kept, savedAt: now } : look));
  if (list.length >= MAX_USER_LOOKS) return null;
  return [...list, { id, name: clean, recipe: kept, savedAt: now }];
}

/** Rename a look. Refused (null) when the name is empty or another of your looks already has it. */
export function renameUserLook(list: UserLook[], id: string, name: string): UserLook[] | null {
  const clean = cleanName(name);
  if (!clean || !list.some((look) => look.id === id)) return null;
  if (list.some((look) => look.id !== id && sameName(look.name, clean))) return null;
  return list.map((look) => (look.id === id ? { ...look, name: clean } : look));
}

export function removeUserLook(list: UserLook[], id: string): UserLook[] {
  return list.filter((look) => look.id !== id);
}

/** A small, readable file to share looks between devices or people. It holds slider numbers and names only. */
export function exportUserLooks(list: UserLook[]): string {
  return JSON.stringify({ format: USER_LOOKS_FORMAT, version: USER_LOOKS_VERSION, looks: list.map(({ name, recipe }) => ({ name, recipe })) }, null, 2);
}

export interface UserLookImport { looks: UserLook[]; added: number; replaced: number; skipped: number; error?: 'unreadable' | 'not-looks' | 'newer' }

/**
 * Read a looks file into your list. Every value is checked and clamped; unknown keys are dropped. A look with the name
 * of one you already have replaces its settings (it is the same look, updated). Nothing changes on any error.
 */
export function importUserLooks(list: UserLook[], text: string, makeId: () => string, now: number): UserLookImport {
  const none = (error: UserLookImport['error']): UserLookImport => ({ looks: list, added: 0, replaced: 0, skipped: 0, error });
  let data: unknown;
  try { data = JSON.parse(text); } catch { return none('unreadable'); }
  if (typeof data !== 'object' || data === null) return none('not-looks');
  const { format, version, looks } = data as Record<string, unknown>;
  if (format !== USER_LOOKS_FORMAT || !Array.isArray(looks)) return none('not-looks');
  if (typeof version !== 'number' || version > USER_LOOKS_VERSION) return none('newer');
  let next = list;
  let added = 0, replaced = 0, skipped = 0;
  for (const item of looks) {
    const name = cleanName((item as Record<string, unknown> | null)?.name);
    const existed = next.some((look) => sameName(look.name, name));
    const saved = typeof item === 'object' && item !== null ? saveUserLook(next, name, (item as Record<string, unknown>).recipe, makeId(), now) : null;
    if (!saved) { skipped += 1; continue; }
    next = saved;
    if (existed) replaced += 1; else added += 1;
  }
  return { looks: next, added, replaced, skipped };
}
