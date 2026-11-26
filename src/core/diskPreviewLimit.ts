import type { MemoryBudget } from './memoryBudget';

/**
 * The desktop preview folder's size limit (x-std-disk-previews). The default comes from the device tier in the memory
 * budget (src/core/memoryBudget.ts); the person can choose another in Settings → Storage. When the folder is fuller
 * than the limit, the least recently used previews are removed. Only previews: originals, projects and edits are never
 * part of it, and a removed preview is simply made again when the photo is next seen with its drive connected.
 */
const GB = 1024 ** 3;

/** The choices Settings offers, in GB. */
export const DISK_PREVIEW_LIMIT_CHOICES_GB = [2, 5, 10, 20, 50, 100] as const;

/** Never less than one shoot's worth, never more than a person would plausibly give a cache. */
export const DISK_PREVIEW_LIMIT_MIN_GB = 1;
export const DISK_PREVIEW_LIMIT_MAX_GB = 500;

/** Roughly what one photo's three previews take (400 px, 2,200 px and the 2,560 px smart preview), for the hint. */
export const DISK_PREVIEW_BYTES_PER_PHOTO = 2 * 1024 * 1024;

/** A stored choice in GB, or undefined when there is none or it is not a sensible number. */
export function parseDiskPreviewLimitGB(stored: unknown): number | undefined {
  const value = typeof stored === 'string' && stored.trim() !== '' ? Number(stored) : stored;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < DISK_PREVIEW_LIMIT_MIN_GB || value > DISK_PREVIEW_LIMIT_MAX_GB) return undefined;
  return value;
}

/** The limit in bytes: the person's choice when valid, otherwise this device tier's default. */
export function diskPreviewLimitBytes(stored: unknown, budget: Pick<MemoryBudget, 'diskPreviewBytes'>): number {
  const chosen = parseDiskPreviewLimitGB(stored);
  return chosen === undefined ? budget.diskPreviewBytes : Math.round(chosen * GB);
}

/** The default, in whole GB, for showing beside the choices. */
export const defaultDiskPreviewLimitGB = (budget: Pick<MemoryBudget, 'diskPreviewBytes'>) => Math.round(budget.diskPreviewBytes / GB);

/**
 * How many photos are developed into the folder at once. Each RAW develop holds a half-size sensor picture in memory,
 * so this is half the culling workers the tier allows (1 on a low tier, 2 standard, 3 high), and at least one.
 */
export function diskPreviewThreads(budget: Pick<MemoryBudget, 'cullWorkers'>): number {
  return Math.max(1, Math.min(4, Math.floor(budget.cullWorkers / 2)));
}

/** About how many photos fit, for the plain-words hint in Settings. */
export const photosThatFit = (limitBytes: number) => Math.max(0, Math.floor(limitBytes / DISK_PREVIEW_BYTES_PER_PHOTO));

/** Plain size for Settings: "740 MB", "3.4 GB". */
export function formatPreviewBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < GB) return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
  const gb = bytes / GB;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}
