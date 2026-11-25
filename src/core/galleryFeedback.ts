/**
 * What clients said in a gallery (#1387 C07), summarised per photo for the photographer. Pure: the control plane
 * returns the raw events, oldest first, and this turns them into counts and the latest decision for each visitor.
 * A later "request changes" replaces that visitor's earlier approval, and the other way round.
 */
export type GalleryFeedbackKind = 'favourite' | 'unfavourite' | 'comment' | 'approve' | 'request-changes' | 'approve-all';

export interface GalleryFeedbackEvent { visitor: string; photoId: string | null; kind: GalleryFeedbackKind; text: string | null; atMs: number }

export interface PhotoFeedback {
  photoId: string;
  favourites: number;
  approvals: number;
  changeRequests: number;
  /** Comments and change requests with text, oldest first. */
  notes: { kind: 'comment' | 'request-changes'; text: string; atMs: number }[];
}

export interface GallerySummary { photos: PhotoFeedback[]; visitors: number; total: { favourites: number; approvals: number; changeRequests: number; notes: number } }

export function summariseGalleryFeedback(events: readonly GalleryFeedbackEvent[], photoIds: readonly string[]): GallerySummary {
  const favourite = new Map<string, Set<string>>();
  const decision = new Map<string, Map<string, 'approve' | 'request-changes'>>();
  const notes = new Map<string, PhotoFeedback['notes']>();
  const visitors = new Set<string>();
  const inGallery = new Set(photoIds);
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const decide = (photoId: string, visitor: string, value: 'approve' | 'request-changes') => {
    const map = decision.get(photoId) ?? new Map();
    map.set(visitor, value); decision.set(photoId, map);
  };
  for (const event of sorted) {
    visitors.add(event.visitor);
    if (event.kind === 'approve-all') { photoIds.forEach((id) => decide(id, event.visitor, 'approve')); continue; }
    if (!event.photoId || !inGallery.has(event.photoId)) continue;
    const id = event.photoId;
    if (event.kind === 'favourite' || event.kind === 'unfavourite') {
      const set = favourite.get(id) ?? new Set<string>();
      if (event.kind === 'favourite') set.add(event.visitor); else set.delete(event.visitor);
      favourite.set(id, set);
    } else if (event.kind === 'approve' || event.kind === 'request-changes') {
      decide(id, event.visitor, event.kind);
    }
    if ((event.kind === 'comment' || event.kind === 'request-changes') && event.text?.trim()) {
      const list = notes.get(id) ?? [];
      list.push({ kind: event.kind, text: event.text.trim(), atMs: event.atMs }); notes.set(id, list);
    }
  }
  const photos = photoIds.map((photoId): PhotoFeedback => {
    const values = [...(decision.get(photoId)?.values() ?? [])];
    return {
      photoId, favourites: favourite.get(photoId)?.size ?? 0,
      approvals: values.filter((v) => v === 'approve').length, changeRequests: values.filter((v) => v === 'request-changes').length,
      notes: notes.get(photoId) ?? [],
    };
  });
  const sum = (pick: (p: PhotoFeedback) => number) => photos.reduce((n, p) => n + pick(p), 0);
  return { photos, visitors: visitors.size, total: { favourites: sum((p) => p.favourites), approvals: sum((p) => p.approvals), changeRequests: sum((p) => p.changeRequests), notes: sum((p) => p.notes.length) } };
}
