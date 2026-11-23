/**
 * Explicit, per-library cloud backup selection.
 *
 * This module only determines consented scope. It does not upload data, create
 * accounts, or change the local library. A server must separately verify
 * ownership, entitlement, hashes and quota before accepting any bytes.
 */
export type BackupSelection =
  | { mode: 'local-only' }
  | { mode: 'selected'; photoIds: string[] }
  | { mode: 'all' };

export type BackupPhoto = { id: string; removedAt?: number | null };

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f]/.test(id);

/** Invalid persisted settings always fail closed: no implicit uploads. */
export function readBackupSelection(value: unknown): BackupSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { mode: 'local-only' };
  const record = value as Record<string, unknown>;
  if (record.mode === 'local-only') return { mode: 'local-only' };
  if (record.mode === 'all') return { mode: 'all' };
  if (record.mode !== 'selected' || !Array.isArray(record.photoIds)) return { mode: 'local-only' };
  if (record.photoIds.length > 100000 || !record.photoIds.every(validId)) return { mode: 'local-only' };
  return { mode: 'selected', photoIds: [...new Set(record.photoIds)] };
}

/** Start with local-only; choosing photos never changes the library-wide setting to all. */
export function selectPhotosForBackup(previous: unknown, photoIds: readonly string[]): BackupSelection {
  const current = readBackupSelection(previous);
  if (current.mode === 'all') return current;
  const valid = photoIds.filter(validId);
  return { mode: 'selected', photoIds: [...new Set([...(current.mode === 'selected' ? current.photoIds : []), ...valid])] };
}

export function stopBackingUpPhotos(previous: unknown, photoIds: readonly string[]): BackupSelection {
  const current = readBackupSelection(previous);
  if (current.mode !== 'selected') return current;
  const removed = new Set(photoIds);
  return { mode: 'selected', photoIds: current.photoIds.filter(id => !removed.has(id)) };
}

/** Only the explicitly allowed, present, non-removed photos may enter a backup job. */
export function photosEligibleForBackup(
  previous: unknown,
  photos: readonly BackupPhoto[],
): string[] {
  const selection = readBackupSelection(previous);
  if (selection.mode === 'local-only') return [];
  const selected = selection.mode === 'selected' ? new Set(selection.photoIds) : null;
  return [...new Set(photos.filter(photo => validId(photo.id) && !photo.removedAt &&
    (selected === null || selected.has(photo.id))).map(photo => photo.id))];
}
