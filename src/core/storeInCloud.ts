import { MONTHLY_PHOTO_ALLOWANCE, TYPICAL_PHOTO_BYTES, freeStorageBytes, type CloudUsage } from './cloudPlan';
import { shootTiers } from './shootTiers';

/**
 * "Store in the cloud" (Dave, 27 Nov): a cloud COPY of chosen photos, so you can open and edit them on your other
 * devices. It is not cloud processing (Cloud edits: runs and deletes) and not a backup of originals (Safe copy). Only
 * sized previews go up, with the project's decisions and edit settings; originals stay on this device.
 *
 * Sharing with other people is paused: the app's own switch below keeps every invite and share-with-people entry point
 * out of the interface. A shared project someone already has still opens and stays viewable; nothing is removed.
 */
export const COLLABORATION_UI = false;

export type StoreFilter = 'all' | 'best' | 'flagged' | 'top' | 'selected';
export const STORE_FILTERS: readonly StoreFilter[] = ['all', 'best', 'flagged', 'top', 'selected'];
export const STORE_TOP_DEFAULT = 50;

interface Storable { id: string; cullScore?: number; decision?: string | null; removedAt?: number | null }

/** The photos a filter covers, best first where the filter ranks them. Removed photos are never included. */
export function photosToStore(filter: StoreFilter, photos: readonly Storable[], options: { selectedIds?: readonly string[]; top?: number } = {}): string[] {
  const kept = photos.filter((photo) => photo.removedAt == null);
  if (filter === 'all') return kept.map((photo) => photo.id);
  if (filter === 'flagged') return kept.filter((photo) => photo.decision === 'keep').map((photo) => photo.id);
  if (filter === 'selected') { const chosen = new Set(options.selectedIds ?? []); return kept.filter((photo) => chosen.has(photo.id)).map((photo) => photo.id); }
  // Best and Top N follow Auto pick's own ranking; a photo it has not scored is never guessed in.
  const scored = kept.filter((photo) => typeof photo.cullScore === 'number' && Number.isFinite(photo.cullScore))
    .map((photo, order) => ({ photo, order })).sort((a, b) => b.photo.cullScore! - a.photo.cullScore! || a.order - b.order).map(({ photo }) => photo);
  if (filter === 'top') return scored.slice(0, Math.max(1, Math.min(5000, Math.floor(options.top ?? STORE_TOP_DEFAULT) || STORE_TOP_DEFAULT))).map((photo) => photo.id);
  const tiers = shootTiers(kept);
  return scored.filter((photo) => tiers.get(photo.id) === 'best').map((photo) => photo.id);
}

/**
 * About how much storing `count` previews would use, against what the account includes and holds now. An estimate
 * (a typical preview is about 1 MB), said as one before anything is sent. `fits` is false when it would go past the
 * included storage, so the person is told before they confirm.
 */
export function storeEstimate(count: number, usage: Pick<CloudUsage, 'plan' | 'storedBytes'>): { bytes: number; included: number; storedNow: number | null; fits: boolean } {
  const bytes = Math.max(0, Math.floor(count)) * TYPICAL_PHOTO_BYTES.preview;
  const included = freeStorageBytes(usage.plan);
  const storedNow = typeof usage.storedBytes === 'number' && Number.isFinite(usage.storedBytes) ? Math.max(0, usage.storedBytes) : null;
  return { bytes, included, storedNow, fits: (storedNow ?? 0) + bytes <= included };
}

/** Shown beside the button from this share of a limit upwards. Below it, nothing is shown. */
export const LIMIT_NOTE_FROM = 0.8;

export interface CloudLimitNote {
  kind: 'storage' | 'edits';
  used: number;
  included: number;
  /** 0 to 100, for the meter. */
  percent: number;
  /** At or past the limit: "Full · Top up". */
  full: boolean;
}

/**
 * The limit the account is closest to, from the same numbers Settings › Account shows: cloud storage (bytes) or this
 * month's cloud edits (photos). Null below 80% of both, or when the numbers are not known. A full limit comes first.
 */
export function cloudLimitNote(usage: CloudUsage | null | undefined): CloudLimitNote | null {
  if (!usage) return null;
  const notes: CloudLimitNote[] = [];
  const add = (kind: CloudLimitNote['kind'], used: number | undefined, included: number) => {
    if (typeof used !== 'number' || !Number.isFinite(used) || !(included > 0)) return;
    const share = Math.max(0, used) / included;
    if (share >= LIMIT_NOTE_FROM) notes.push({ kind, used: Math.max(0, used), included, percent: Math.min(100, Math.round(share * 100)), full: share >= 1 });
  };
  add('storage', usage.storedBytes, freeStorageBytes(usage.plan));
  add('edits', usage.photosUsed, MONTHLY_PHOTO_ALLOWANCE[usage.plan] ?? 0);
  notes.sort((a, b) => Number(b.full) - Number(a.full) || b.used / b.included - a.used / a.included);
  return notes[0] ?? null;
}
