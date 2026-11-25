/**
 * Client galleries (#1387 C06/C07): a photographer publishes chosen photos as sized previews behind an unguessable
 * link. The client needs no account or app. They see only those previews, never the project, RAW files, team comments,
 * recipes or other galleries. Comments, favourites and approval appear only when the photographer allows them.
 *
 * Only the SHA-256 of the link token is stored (it is the gallery id), so a database read cannot open a gallery.
 * Previews live in their own private UK bucket (infra/gcp/gallery.tf) under galleries/{id}/; the bucket deletes
 * anything older than 90 days and revoking or expiring a gallery deletes its previews. Downloads are short-lived signed
 * URLs. Viewers can always save what they can see: "allow downloads" only offers a download button.
 */
import { sha256Hex, randomId, uuid, hashPassword, verifyPassword } from './crypto.ts';
import type { FirestoreLike, FsData } from './firestoreStore.ts';
import type { SafeCopyStorage } from './safeCopy.ts';
import type { FeedbackReview } from '../../../src/core/clientFeedback.ts';

export type GalleryStorage = SafeCopyStorage;
export const GALLERY_MAX_PHOTOS = 200;
export const GALLERY_MAX_PREVIEW_BYTES = 8_000_000;
export const GALLERY_MAX_DAYS = 90;

export interface GalleryOptions { allowComments: boolean; allowFavourites: boolean; allowApproval: boolean; allowDownloads: boolean; watermark: boolean }

export interface GalleryRecord extends GalleryOptions {
  galleryId: string;
  projectId: string;
  name: string;
  photoIds: string[];
  createdBy: string;
  createdAtMs: number;
  expiresAtMs: number;
  passwordHash: string | null;
  /** photoId -> committed preview */
  previews: Record<string, { sha256: string; bytes: number; committed: boolean; thumb?: { sha256: string; bytes: number } }>;
}

export type FeedbackKind = 'favourite' | 'unfavourite' | 'comment' | 'approve' | 'request-changes' | 'approve-all';
export interface FeedbackRecord { galleryId: string; visitor: string; photoId: string | null; kind: FeedbackKind; text: string | null; atMs: number }

export class GalleryRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export const galleryIdFor = (linkToken: string) => sha256Hex(`gallery:${linkToken}`);
export const previewKey = (galleryId: string, photoId: string, variant: GalleryVariant = 'preview') => `galleries/${galleryId}/${photoId}${variant === 'thumb' ? '.thumb' : ''}.jpg`;
/** A small filmstrip picture, so opening a gallery fetches kilobytes per photo, not the full preview. */
export const GALLERY_MAX_THUMB_BYTES = 200_000;
export type GalleryVariant = 'preview' | 'thumb';
const clean = (value: object): FsData => JSON.parse(JSON.stringify(value)) as FsData;
const G = { galleries: 'collab_galleries', feedback: 'collab_gallery_feedback', reviews: 'collab_gallery_reviews' };

export class GalleryStore {
  constructor(private readonly db: FirestoreLike, readonly storage: GalleryStorage, private readonly newToken: () => string = () => randomId(32)) {}
  private ref(id: string) { return this.db.collection(G.galleries).doc(id); }

  async create(input: { projectId: string; createdBy: string; name: string; photoIds: string[]; days: number; password?: string } & GalleryOptions, atMs: number) {
    const linkToken = this.newToken();
    const galleryId = galleryIdFor(linkToken);
    const { password, days, ...rest } = input;
    const record: GalleryRecord = {
      ...rest, galleryId, photoIds: [...new Set(input.photoIds)], createdAtMs: atMs, expiresAtMs: atMs + Math.min(Math.max(days, 1), GALLERY_MAX_DAYS) * 86_400_000,
      passwordHash: password ? hashPassword(password) : null, previews: {},
    };
    await this.ref(galleryId).create(clean(record));
    return { galleryId, linkToken, expiresAtMs: record.expiresAtMs };
  }

  async get(galleryId: string): Promise<GalleryRecord> {
    const snap = await this.ref(galleryId).get();
    if (!snap.exists) throw new GalleryRefusal(404, 'NOT_FOUND', 'No such gallery.');
    return snap.data()! as unknown as GalleryRecord;
  }

  async list(projectId: string) {
    const snap = await this.db.collection(G.galleries).where('projectId', '==', projectId).get();
    return snap.docs.map((d) => d.data()! as unknown as GalleryRecord).map((g) => ({
      galleryId: g.galleryId, name: g.name, expiresAtMs: g.expiresAtMs, photos: g.photoIds.length, photoIds: g.photoIds,
      published: Object.values(g.previews ?? {}).filter((p) => p.committed).length, password: g.passwordHash !== null,
    }));
  }

  async signPreviewUpload(galleryId: string, photoId: string, sha256: string, bytes: number, variant: GalleryVariant = 'preview') {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(galleryId));
      if (!snap.exists) throw new GalleryRefusal(404, 'NOT_FOUND', 'No such gallery.');
      const g = snap.data()! as unknown as GalleryRecord;
      if (!g.photoIds.includes(photoId)) throw new GalleryRefusal(404, 'NOT_FOUND', 'That photo is not in this gallery.');
      if (variant === 'thumb' && bytes > GALLERY_MAX_THUMB_BYTES) throw new GalleryRefusal(413, 'GALLERY_THUMB_TOO_LARGE', 'That filmstrip picture is too large.');
      const existing = g.previews?.[photoId];
      const entry = variant === 'thumb'
        ? { sha256: existing?.sha256 ?? '', bytes: existing?.bytes ?? 0, committed: false, thumb: { sha256, bytes } }
        : { sha256, bytes, committed: false, ...(existing?.thumb ? { thumb: existing.thumb } : {}) };
      tx.update(this.ref(galleryId), { previews: { ...(g.previews ?? {}), [photoId]: entry } });
      return this.storage.signUpload(previewKey(galleryId, photoId, variant), bytes, sha256);
    });
  }

  async commitPreview(galleryId: string, photoId: string) {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(galleryId));
      const g = snap.exists ? snap.data()! as unknown as GalleryRecord : null;
      const preview = g?.previews?.[photoId];
      if (!g || !preview) throw new GalleryRefusal(404, 'NOT_FOUND', 'Upload the preview first.');
      tx.update(this.ref(galleryId), { previews: { ...g.previews, [photoId]: { ...preview, committed: true } } });
    });
  }

  /** Deletes the previews and the gallery. Feedback stays for the photographer. */
  async revoke(galleryId: string) {
    const g = await this.get(galleryId);
    await Promise.all(g.photoIds.flatMap((photoId) => [this.storage.delete(previewKey(galleryId, photoId)), this.storage.delete(previewKey(galleryId, photoId, 'thumb'))]));
    await this.db.runTransaction(async (tx) => { tx.delete(this.ref(galleryId)); });
  }

  /** The anonymous view. Expired galleries are removed on first sight. */
  async open(linkToken: string, password: string | undefined, atMs: number) {
    const galleryId = galleryIdFor(linkToken);
    const g = await this.get(galleryId).catch(() => { throw new GalleryRefusal(404, 'GALLERY_NOT_FOUND', 'This gallery link is not valid.'); });
    if (g.expiresAtMs <= atMs) { await this.revoke(galleryId).catch(() => undefined); throw new GalleryRefusal(410, 'GALLERY_EXPIRED', 'This gallery has expired. Ask the photographer for a new link.'); }
    if (g.passwordHash && !(password && verifyPassword(password, g.passwordHash))) throw new GalleryRefusal(401, 'GALLERY_PASSWORD', 'Enter the gallery password.');
    const photos = [];
    for (const photoId of g.photoIds) {
      if (!g.previews?.[photoId]?.committed) continue;
      const url = await this.storage.signDownload(previewKey(galleryId, photoId));
      const thumbUrl = g.previews[photoId].thumb ? await this.storage.signDownload(previewKey(galleryId, photoId, 'thumb')) : url;
      photos.push({ photoId, url, thumbUrl });
    }
    return {
      g, view: {
        name: g.name, expiresAtMs: g.expiresAtMs, photos,
        allow: { comments: g.allowComments, favourites: g.allowFavourites, approval: g.allowApproval, downloads: g.allowDownloads }, watermark: g.watermark,
      },
    };
  }

  async feedback(linkToken: string, password: string | undefined, input: { visitor: string; photoId: string | null; kind: FeedbackKind; text: string | null }, atMs: number) {
    const { g } = await this.open(linkToken, password, atMs);
    const allowed = input.kind === 'comment' ? g.allowComments : input.kind === 'favourite' || input.kind === 'unfavourite' ? g.allowFavourites : g.allowApproval;
    if (!allowed) throw new GalleryRefusal(403, 'GALLERY_NOT_ALLOWED', 'The photographer has not turned this on for this gallery.');
    if (input.photoId !== null && !g.photoIds.includes(input.photoId)) throw new GalleryRefusal(404, 'NOT_FOUND', 'That photo is not in this gallery.');
    if (input.kind !== 'approve-all' && input.photoId === null) throw new GalleryRefusal(400, 'BAD_REQUEST', 'Choose a photo.');
    const record: FeedbackRecord = { galleryId: g.galleryId, visitor: input.visitor, photoId: input.photoId, kind: input.kind, text: input.kind === 'comment' || input.kind === 'request-changes' ? input.text : null, atMs };
    await this.db.collection(G.feedback).doc(uuid()).create(clean(record));
    return { galleryId: g.galleryId, projectId: g.projectId, name: g.name };
  }

  /** For the photographer: every event, oldest first, plus the favourites each visitor holds now. */
  async feedbackFor(galleryId: string) {
    const [snap, reviewSnap] = await Promise.all([
      this.db.collection(G.feedback).where('galleryId', '==', galleryId).get(),
      this.db.collection(G.reviews).where('galleryId', '==', galleryId).get(),
    ]);
    // The photographer's review of each photo's feedback (src/core/clientFeedback.ts): done or dismissed, by whom, when.
    const reviews = reviewSnap.docs.map((d) => { const { galleryId: _g, ...r } = d.data()! as unknown as FeedbackReview & { galleryId: string }; return r as FeedbackReview; });
    const events = snap.docs.map((d) => d.data()! as unknown as FeedbackRecord).sort((a, b) => a.atMs - b.atMs);
    const favourites = new Map<string, Set<string>>();
    for (const e of events) {
      if (!e.photoId || (e.kind !== 'favourite' && e.kind !== 'unfavourite')) continue;
      const set = favourites.get(e.photoId) ?? new Set<string>();
      if (e.kind === 'favourite') set.add(e.visitor); else set.delete(e.visitor);
      favourites.set(e.photoId, set);
    }
    return { events: events.map(({ galleryId: _g, ...rest }) => rest), favourites: Object.fromEntries([...favourites].map(([photoId, set]) => [photoId, set.size])), reviews };
  }

  /** Marks one photo's client feedback done or dismissed, or back to new. Never touches the project's decisions. */
  async review(galleryId: string, itemId: string, state: 'done' | 'dismissed' | 'new', byName: string, atMs: number): Promise<void> {
    const ref = this.db.collection(G.reviews).doc(`${galleryId}|${itemId}`);
    if (state === 'new') { await this.db.runTransaction(async (tx) => { tx.delete(ref); }); return; }
    await ref.set(clean({ galleryId, itemId, state, byName: byName.slice(0, 80), atMs }));
  }
}
