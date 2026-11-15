import type { PhotoFrame } from './types';

/**
 * What follows a photo between devices through a sync folder: the decision, rating, tags and edit, matched by the photo's
 * stable key (name, size and modified time), never by where the file is. No pixels and no original files.
 */
type Synced = Pick<PhotoFrame, 'decision' | 'rating' | 'tags' | 'autoTags' | 'declinedTags' | 'subjectKind' | 'edit' | 'framing' | 'focusPoint'>;
export interface SyncedPhoto extends Synced {
  key: string;
  /** Name and capture time, which stay the same however the photo was imported (the key can differ between a file and a folder import). */
  identity?: string;
}
export interface ProjectSnapshot { format: 'kestrel-project-sync'; version: 1; title: string; savedAt: string; projectId?: string; photos: SyncedPhoto[] }

/** What makes a photo the same photo on another device: its file name and when it was taken. Null when the camera recorded no time. */
export function identityOf(frame: Pick<PhotoFrame, 'filename' | 'exif'>): string | null {
  const taken = frame.exif?.capturedAtMs;
  return typeof taken === 'number' && Number.isFinite(taken) ? `${frame.filename.toLowerCase()}|${taken}` : null;
}

const FIELDS = ['decision', 'rating', 'tags', 'autoTags', 'declinedTags', 'subjectKind', 'edit', 'framing', 'focusPoint'] as const;

export function buildSnapshot(title: string, frames: PhotoFrame[], now: Date, projectId?: string): ProjectSnapshot {
  const photos: SyncedPhoto[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    if (frame.removedAt || frame.virtualCopy || frame.isDemo || seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    const photo: SyncedPhoto = { key: frame.stableKey, decision: frame.decision };
    const identity = identityOf(frame);
    if (identity) photo.identity = identity;
    for (const field of FIELDS) if (frame[field] !== undefined) (photo as unknown as Record<string, unknown>)[field] = frame[field];
    photos.push(photo);
  }
  return { format: 'kestrel-project-sync', version: 1, title, savedAt: now.toISOString(), ...(projectId ? { projectId } : {}), photos };
}

/** An imported folder file is untrusted. Reject the whole snapshot if malformed. */
export function parseSnapshot(text: string): ProjectSnapshot | null {
  if (text.length > 8_000_000) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (source.format !== 'kestrel-project-sync' || source.version !== 1 ||
      typeof source.title !== 'string' || source.title.length > 300 ||
      typeof source.savedAt !== 'string' || !Number.isFinite(Date.parse(source.savedAt)) ||
      !Array.isArray(source.photos) || source.photos.length > 100_000) return null;

    const seen = new Set<string>();
    const photos: SyncedPhoto[] = [];
    for (const row of source.photos) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const photo = row as Record<string, unknown>;
      if (typeof photo.key !== 'string' || !photo.key || photo.key.length > 1024 ||
        seen.has(photo.key) || !['keep', 'reject', 'unreviewed'].includes(String(photo.decision)) ||
        Object.keys(photo).some((field) => field !== 'key' && field !== 'identity' && !FIELDS.includes(field as typeof FIELDS[number]))) return null;
      if (photo.identity !== undefined && (typeof photo.identity !== 'string' || photo.identity.length > 400)) return null;
      if (photo.rating !== undefined &&
        (!Number.isInteger(photo.rating) || (photo.rating as number) < 0 || (photo.rating as number) > 5)) return null;
      for (const field of ['tags', 'autoTags', 'declinedTags'] as const) {
        const v = photo[field];
        if (v !== undefined && (!Array.isArray(v) || v.length > 100 ||
          !v.every((tag) => typeof tag === 'string' && tag.length <= 160))) return null;
      }
      // Edits are structured data, not executable code; reject dangerous depth
      // and non-JSON values before reaching the editor state.
      function safeJson(value: unknown, depth = 0): boolean {
        if (depth > 24) return false;
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
        if (typeof value === 'number') return Number.isFinite(value);
        if (Array.isArray(value)) return value.length <= 10000 && value.every((x) => safeJson(x, depth + 1));
        if (!value || typeof value !== 'object') return false;
        const record = value as Record<string, unknown>;
        return Object.keys(record).length <= 120 &&
          Object.keys(record).every((key) => key !== '__proto__' && key !== 'constructor' &&
            key !== 'prototype' && safeJson(record[key], depth + 1));
      }
      if (!safeJson(photo)) return null;
      seen.add(photo.key);
      photos.push(photo as unknown as SyncedPhoto);
    }
    return {
      format: 'kestrel-project-sync', version: 1,
      title: source.title, savedAt: source.savedAt,
      ...(typeof source.projectId === 'string' && source.projectId.length <= 120 ? { projectId: source.projectId } : {}), photos,
    };
  } catch { return null; }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Finds the snapshot's entry for a photo here: by key first, then by name and capture time. */
function matcher(snapshot: ProjectSnapshot) {
  const byKey = new Map(snapshot.photos.map((photo) => [photo.key, photo]));
  const byIdentity = new Map<string, SyncedPhoto>();
  for (const photo of snapshot.photos) if (photo.identity && !byIdentity.has(photo.identity)) byIdentity.set(photo.identity, photo);
  return (frame: PhotoFrame): SyncedPhoto | undefined => {
    if (frame.removedAt || frame.virtualCopy) return undefined;
    const identity = identityOf(frame);
    return byKey.get(frame.stableKey) ?? (identity ? byIdentity.get(identity) : undefined);
  };
}

/** What loading a snapshot would do, counted before anything changes. */
export function planApply(frames: PhotoFrame[], snapshot: ProjectSnapshot) {
  const find = matcher(snapshot);
  let matching = 0, changed = 0;
  const used = new Set<SyncedPhoto>();
  for (const frame of frames) {
    const photo = find(frame);
    if (!photo) continue;
    matching += 1;
    used.add(photo);
    if (FIELDS.some((field) => !same(frame[field], photo[field]))) changed += 1;
  }
  return { matching, changed, missingHere: snapshot.photos.length - used.size };
}

/** Apply a snapshot to the photos it matches. Photos not in it are left exactly as they are. */
export function applySnapshot(frames: PhotoFrame[], snapshot: ProjectSnapshot): PhotoFrame[] {
  const find = matcher(snapshot);
  return frames.map((frame) => {
    const photo = find(frame);
    if (!photo) return frame;
    const next: PhotoFrame = { ...frame };
    for (const field of FIELDS) {
      if (photo[field] === undefined) delete (next as unknown as Record<string, unknown>)[field];
      else (next as unknown as Record<string, unknown>)[field] = photo[field];
    }
    return next;
  });
}

/**
 * A saved copy that probably belongs to a different project: another project id, and few of its photos are here.
 * Two projects with the same title share a file name, so this is what stops one overwriting the other.
 */
export function looksLikeAnotherProject(frames: PhotoFrame[], snapshot: ProjectSnapshot, projectId: string): boolean {
  if (snapshot.projectId === projectId || snapshot.photos.length === 0) return false;
  const { matching } = planApply(frames, snapshot);
  return matching / snapshot.photos.length < 0.5;
}

/** True when this device changed the project after the saved copy was made, so bringing it would undo newer work here. */
export const isNewerHere = (lastUpdatedAt: number | undefined, snapshot: ProjectSnapshot) =>
  typeof lastUpdatedAt === 'number' && lastUpdatedAt > Date.parse(snapshot.savedAt) + 1000;

/** A plain file name for a project's sync file, the same on every device that has a project with this title. */
export const syncNameFor = (title: string) => (title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project');
