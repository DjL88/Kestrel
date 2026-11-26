/**
 * Cloud jobs that send back edit settings (x-std-cloud-recipe). Pure rules, no network.
 *
 * By default a job uploads the photo's 2,560 px smart preview (the desktop disk cache from x-std-disk-previews) and the
 * cloud answers with a few KB of edit settings, the same sliders the person can move. Nothing the cloud returns is a
 * picture: the device applies the settings to its own edit as one ordinary, undoable step.
 *
 * The full original may leave the device only with its own opt-in (owner's rule, 26 Nov 2026). That opt-in is off by
 * default, can be withdrawn at any time, and even when it is on the full file is offered only when it is estimated to
 * be faster than the preview. The size of whatever would be sent is shown before anything is sent, and the cloud copy
 * is deleted when the job ends, whether it worked or not.
 */

/** Longest edge of the smart preview a cloud recipe job works on. */
export const CLOUD_RECIPE_PREVIEW_EDGE = 2560;
/** A recipe is a few numbers. Anything bigger than this is refused unread. */
export const CLOUD_RECIPE_MAX_BYTES = 8 * 1024;
export const CLOUD_RECIPE_PROTOCOL = 1;

export type CloudRecipeInputKind = 'smart-preview' | 'original';

/** The person's separate choice to let full originals leave the device. Off until they turn it on. */
export interface FullFileConsent { on: boolean; changedAtMs?: number }
export const FULL_FILE_CONSENT_OFF: FullFileConsent = { on: false };

export function grantFullFileConsent(nowMs: number): FullFileConsent { return { on: true, changedAtMs: nowMs }; }
export function withdrawFullFileConsent(nowMs: number): FullFileConsent { return { on: false, changedAtMs: nowMs }; }

/** Reads a stored consent. Anything that is not exactly an "on" record counts as off. */
export function parseFullFileConsent(value: unknown): FullFileConsent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return FULL_FILE_CONSENT_OFF;
  const record = value as Record<string, unknown>;
  const changedAtMs = typeof record.changedAtMs === 'number' && Number.isSafeInteger(record.changedAtMs) && record.changedAtMs >= 0 ? record.changedAtMs : undefined;
  return record.on === true ? { on: true, ...(changedAtMs !== undefined ? { changedAtMs } : {}) } : { on: false, ...(changedAtMs !== undefined ? { changedAtMs } : {}) };
}

/**
 * Rough timings for the choice between preview and original. They are estimates and are always labelled as such; they
 * only decide which option is offered first, never whether anything is sent.
 */
export interface TransferEstimate {
  /** Upload speed. Unknown upload speeds use a cautious 10 Mbit/s. */
  uplinkBytesPerSecond?: number;
  /** Cloud processing time per megapixel of input. */
  processMsPerMegapixel?: number;
  /** Fixed cost of a job (queue, start, clean-up). */
  jobOverheadMs?: number;
}

export const DEFAULT_UPLINK_BYTES_PER_SECOND = 1_250_000;
const DEFAULT_PROCESS_MS_PER_MEGAPIXEL = 120;
const DEFAULT_JOB_OVERHEAD_MS = 1_500;

export interface RecipeSourceFacts {
  /** The smart preview's size and pixel count when it is on this device now. */
  preview?: { bytes: number; megapixels: number } | null;
  /** When the preview is not ready but this device can make it, how long that is expected to take. */
  previewBuildMs?: number | null;
  /** The original's size and pixel count when it can be read now. */
  original?: { bytes: number; megapixels: number } | null;
}

export interface RecipeUploadOption { kind: CloudRecipeInputKind; bytes: number; estimatedMs: number }

export type RecipeUploadPlan =
  | {
    status: 'ready';
    /** What would be sent if the person says yes. */
    send: RecipeUploadOption;
    /** The full original, offered only with the opt-in on and only when it is estimated faster than the preview. */
    alternative?: RecipeUploadOption;
    /** True when the preview still has to be made on this device before it can be sent. */
    previewNeedsBuild: boolean;
  }
  | { status: 'unavailable'; reason: 'no-preview' | 'empty' };

function estimateMs(bytes: number, megapixels: number, extraMs: number, estimate: TransferEstimate): number {
  const uplink = estimate.uplinkBytesPerSecond && estimate.uplinkBytesPerSecond > 0 ? estimate.uplinkBytesPerSecond : DEFAULT_UPLINK_BYTES_PER_SECOND;
  const perMp = estimate.processMsPerMegapixel ?? DEFAULT_PROCESS_MS_PER_MEGAPIXEL;
  const overhead = estimate.jobOverheadMs ?? DEFAULT_JOB_OVERHEAD_MS;
  return Math.round(extraMs + (bytes / uplink) * 1000 + Math.max(0, megapixels) * perMp + overhead);
}

const usable = (value: { bytes: number; megapixels: number } | null | undefined): value is { bytes: number; megapixels: number } =>
  Boolean(value && Number.isFinite(value.bytes) && value.bytes > 0 && Number.isFinite(value.megapixels));

/** A 2,560 px preview of a 3:2 photo: roughly 4.4 megapixels and, as a good JPEG, about 1.5 MB. */
const BUILT_PREVIEW_GUESS = { bytes: 1_500_000, megapixels: 4.4 };

/**
 * Decide what a recipe job would send. The smart preview is the default. The original is a choice only with the
 * opt-in on, and is put first only when the preview does not exist and cannot be made.
 */
export function planRecipeUpload(facts: RecipeSourceFacts, fullFile: FullFileConsent, estimate: TransferEstimate = {}): RecipeUploadPlan {
  const original = fullFile.on && usable(facts.original) ? facts.original : null;
  const originalOption: RecipeUploadOption | null = original
    ? { kind: 'original', bytes: original.bytes, estimatedMs: estimateMs(original.bytes, original.megapixels, 0, estimate) } : null;

  let previewOption: RecipeUploadOption | null = null;
  let previewNeedsBuild = false;
  if (usable(facts.preview)) {
    previewOption = { kind: 'smart-preview', bytes: facts.preview.bytes, estimatedMs: estimateMs(facts.preview.bytes, facts.preview.megapixels, 0, estimate) };
  } else if (typeof facts.previewBuildMs === 'number' && Number.isFinite(facts.previewBuildMs) && facts.previewBuildMs >= 0) {
    previewNeedsBuild = true;
    previewOption = { kind: 'smart-preview', bytes: BUILT_PREVIEW_GUESS.bytes, estimatedMs: estimateMs(BUILT_PREVIEW_GUESS.bytes, BUILT_PREVIEW_GUESS.megapixels, facts.previewBuildMs, estimate) };
  }

  if (!previewOption && !originalOption) return { status: 'unavailable', reason: 'no-preview' };
  if (!previewOption) return { status: 'ready', send: originalOption!, previewNeedsBuild: false };
  const alternative = originalOption && originalOption.estimatedMs < previewOption.estimatedMs ? originalOption : undefined;
  return { status: 'ready', send: previewOption, ...(alternative ? { alternative } : {}), previewNeedsBuild };
}

/** "1.4 MB", "830 KB": the size shown before sending, in decimal units like a file manager. */
export function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KB';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/**
 * The edit settings a recipe may carry: the ordinary sliders in the units the editor shows them in. Each has the same
 * range as its slider. Masks, crops, pictures and anything else are refused: the cloud can suggest settings, never pixels.
 */
export const RECIPE_RANGES = {
  exposure: [-5, 5], highlights: [-100, 100], shadows: [-100, 100], contrast: [-100, 100], whites: [-100, 100],
  blacks: [-100, 100], temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100],
  clarity: [-100, 100], dehaze: [-100, 100], sharpen: [0, 100], denoiseLuminance: [0, 100], denoiseColour: [0, 100],
} as const satisfies Record<string, readonly [number, number]>;

export type RecipeSetting = keyof typeof RECIPE_RANGES;
export type CloudRecipeSettings = Partial<Record<RecipeSetting, number>>;

export interface CloudRecipe {
  protocol: typeof CLOUD_RECIPE_PROTOCOL;
  jobId: string;
  settings: CloudRecipeSettings;
  /** What produced it, as the service reports it. Shown, never assumed. */
  producer?: { name: string; version: string };
  /** Plain-language reasons from the service, at most four short lines. */
  notes?: string[];
  /** What the service says it worked on. Must match what was sent. */
  input: CloudRecipeInputKind;
}

const SHORT_TEXT = /^[^\u0000-\u001f]{1,200}$/;

/**
 * Read a recipe the cloud sent back. Returns null for anything that is not exactly a small, well-formed recipe for the
 * job that was sent: too big, wrong job, unknown setting, out-of-range value, or a different input than was uploaded.
 * A refused recipe changes nothing.
 */
export function parseCloudRecipe(bytes: Uint8Array, expected: { jobId: string; input: CloudRecipeInputKind }): CloudRecipe | null {
  if (bytes.byteLength === 0 || bytes.byteLength > CLOUD_RECIPE_MAX_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['protocol', 'jobId', 'settings', 'producer', 'notes', 'input'].includes(key))) return null;
  if (record.protocol !== CLOUD_RECIPE_PROTOCOL || record.jobId !== expected.jobId || record.input !== expected.input) return null;
  const raw = record.settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const settings: CloudRecipeSettings = {};
  for (const [key, number] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.hasOwn(RECIPE_RANGES, key)) return null;
    const [min, max] = RECIPE_RANGES[key as RecipeSetting];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) return null;
    settings[key as RecipeSetting] = Math.round(number * 100) / 100;
  }
  const recipe: CloudRecipe = { protocol: CLOUD_RECIPE_PROTOCOL, jobId: expected.jobId, settings, input: expected.input };
  if (record.producer !== undefined) {
    const producer = record.producer as Record<string, unknown> | null;
    if (!producer || typeof producer !== 'object' || typeof producer.name !== 'string' || typeof producer.version !== 'string'
      || !SHORT_TEXT.test(producer.name) || !SHORT_TEXT.test(producer.version) || Object.keys(producer).length !== 2) return null;
    recipe.producer = { name: producer.name, version: producer.version };
  }
  if (record.notes !== undefined) {
    if (!Array.isArray(record.notes) || record.notes.length > 4 || !record.notes.every((note) => typeof note === 'string' && SHORT_TEXT.test(note))) return null;
    recipe.notes = record.notes as string[];
  }
  return recipe;
}

/** True when a recipe carries no settings at all: the device then says so and records no step. */
export function recipeIsEmpty(recipe: CloudRecipe): boolean {
  return Object.keys(recipe.settings).length === 0;
}
