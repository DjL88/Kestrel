import type { PhotoFrame } from './types';

/**
 * What follows a photo between devices through a sync folder: the decision, rating, tags and edit, matched by the photo's
 * stable key (name, size and modified time), never by where the file is. No pixels and no original files.
 */
type Synced = Pick<PhotoFrame, 'decision' | 'rating' | 'tags' | 'autoTags' | 'declinedTags' | 'subjectKind' | 'edit' | 'framing' | 'focusPoint'>;
export interface SyncedPhoto extends Synced { key: string }
export interface ProjectSnapshot { format: 'kestrel-project-sync'; version: 1; title: string; savedAt: string; photos: SyncedPhoto[] }

const FIELDS = ['decision', 'rating', 'tags', 'autoTags', 'declinedTags', 'subjectKind', 'edit', 'framing', 'focusPoint'] as const;

export function buildSnapshot(title: string, frames: PhotoFrame[], now: Date): ProjectSnapshot {
  const photos: SyncedPhoto[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    if (frame.removedAt || frame.virtualCopy || frame.isDemo || seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    const photo: SyncedPhoto = { key: frame.stableKey, decision: frame.decision };
    for (const field of FIELDS) if (frame[field] !== undefined) (photo as unknown as Record<string, unknown>)[field] = frame[field];
    photos.push(photo);
  }
  return { format: 'kestrel-project-sync', version: 1, title, savedAt: now.toISOString(), photos };
}

export function parseSnapshot(text: string): ProjectSnapshot | null {
  try {
    const value = JSON.parse(text) as Partial<ProjectSnapshot>;
    if (value?.format !== 'kestrel-project-sync' || value.version !== 1 || !Array.isArray(value.photos)) return null;
    const photos = value.photos.filter((photo): photo is SyncedPhoto => typeof photo?.key === 'string' && typeof photo.decision === 'string');
    return { format: value.format, version: 1, title: String(value.title ?? ''), savedAt: String(value.savedAt ?? ''), photos };
  } catch {
    return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What loading a snapshot would do, counted before anything changes. */
export function planApply(frames: PhotoFrame[], snapshot: ProjectSnapshot) {
  const byKey = new Map(snapshot.photos.map((photo) => [photo.key, photo]));
  let matching = 0, changed = 0;
  for (const frame of frames) {
    const photo = !frame.removedAt && !frame.virtualCopy ? byKey.get(frame.stableKey) : undefined;
    if (!photo) continue;
    matching += 1;
    if (FIELDS.some((field) => !same(frame[field], photo[field]))) changed += 1;
  }
  return { matching, changed, missingHere: snapshot.photos.length - new Set(frames.filter((f) => !f.removedAt && byKey.has(f.stableKey)).map((f) => f.stableKey)).size };
}

/** Apply a snapshot to the photos it matches. Photos not in it are left exactly as they are. */
export function applySnapshot(frames: PhotoFrame[], snapshot: ProjectSnapshot): PhotoFrame[] {
  const byKey = new Map(snapshot.photos.map((photo) => [photo.key, photo]));
  return frames.map((frame) => {
    const photo = !frame.removedAt && !frame.virtualCopy ? byKey.get(frame.stableKey) : undefined;
    if (!photo) return frame;
    const next: PhotoFrame = { ...frame };
    for (const field of FIELDS) {
      if (photo[field] === undefined) delete (next as unknown as Record<string, unknown>)[field];
      else (next as unknown as Record<string, unknown>)[field] = photo[field];
    }
    return next;
  });
}

/** A plain file name for a project's sync file, the same on every device that has a project with this title. */
export const syncNameFor = (title: string) => (title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project');
