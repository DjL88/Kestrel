/**
 * The cloud photo store for shared projects (#1387). A project kept "in the cloud" holds, per photo, a sized preview
 * and a small filmstrip picture, and the original only when the owner chose to store originals. Friends who do not have
 * the files open the previews; an original is fetched only on demand (export, or looking closer than the preview
 * allows), and each device keeps what it fetched so a photo is downloaded once. Every download is metered against the
 * project owner's monthly allowance before a signed URL is issued (usageMeter.ts).
 *
 * Objects live in the UK project bucket under projects/{hash}/{photoKey}/; the gallery lifecycle rule (galleries/ only)
 * never deletes them. Keys carry no names: the project part is a hash and the photo key is the original's fingerprint.
 */
import { sha256Hex } from './crypto.ts';
import type { FirestoreLike, FsData } from './firestoreStore.ts';
import type { SafeCopyStorage } from './safeCopy.ts';

export const CLOUD_VARIANTS = ['thumb', 'preview', 'original'] as const;
export type CloudVariant = typeof CLOUD_VARIANTS[number];
export const CLOUD_MAX_BYTES: Record<CloudVariant, number> = { thumb: 200_000, preview: 8_000_000, original: 500_000_000 };
export const CLOUD_MAX_PHOTOS = 5000;

export interface CloudObject { sha256: string; bytes: number; committed: boolean }
export interface CloudPhotoRecord {
  projectId: string; photoKey: string; name: string; addedBy: string; addedAtMs: number;
  thumb?: CloudObject; preview?: CloudObject; original?: CloudObject;
}

export class CloudRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export const cloudKey = (projectId: string, photoKey: string, variant: CloudVariant) =>
  `projects/${sha256Hex(`cloud:${projectId}`).slice(0, 32)}/${photoKey}/${variant}${variant === 'original' ? '' : '.jpg'}`;

const clean = <T extends object>(value: T): FsData => JSON.parse(JSON.stringify(value)) as FsData;

export class CloudPhotoStore {
  constructor(private readonly db: FirestoreLike, readonly storage: SafeCopyStorage) {}
  private ref(projectId: string, photoKey: string) { return this.db.collection('collab_cloud_photos').doc(`${sha256Hex(projectId).slice(0, 24)}_${photoKey}`); }

  async list(projectId: string) {
    const snap = await this.db.collection('collab_cloud_photos').where('projectId', '==', projectId).get();
    return snap.docs.map((d) => d.data()! as unknown as CloudPhotoRecord)
      .filter((p) => p.preview?.committed)
      .sort((a, b) => a.addedAtMs - b.addedAtMs || a.photoKey.localeCompare(b.photoKey))
      .map((p) => ({ photoKey: p.photoKey, name: p.name, previewBytes: p.preview!.bytes, thumbBytes: p.thumb?.committed ? p.thumb.bytes : null, originalBytes: p.original?.committed ? p.original.bytes : null }));
  }

  /** Every photo record of a project, committed or not, with who added it (account data download, account deletion). */
  async records(projectId: string): Promise<CloudPhotoRecord[]> {
    const snap = await this.db.collection('collab_cloud_photos').where('projectId', '==', projectId).get();
    return snap.docs.map((d) => d.data()! as unknown as CloudPhotoRecord).sort((a, b) => a.addedAtMs - b.addedAtMs || a.photoKey.localeCompare(b.photoKey));
  }

  /** Account deletion: every stored preview, filmstrip picture and original of a project, then its records. */
  async removeProject(projectId: string): Promise<number> {
    const all = await this.records(projectId);
    for (const p of all) await this.remove(projectId, p.photoKey);
    return all.length;
  }

  /** Every project with something in the cloud store (for the daily storage settlement). */
  async projectIds(): Promise<string[]> {
    const snap = await this.db.collection('collab_cloud_photos').get();
    return [...new Set(snap.docs.map((d) => String(d.data()!.projectId)))];
  }

  async storedBytes(projectId: string) {
    const snap = await this.db.collection('collab_cloud_photos').where('projectId', '==', projectId).get();
    return snap.docs.reduce((sum, d) => {
      const p = d.data()! as unknown as CloudPhotoRecord;
      return sum + CLOUD_VARIANTS.reduce((n, v) => n + (p[v]?.committed ? p[v]!.bytes : 0), 0);
    }, 0);
  }

  async signUpload(projectId: string, photoKey: string, accountId: string, input: { variant: CloudVariant; sha256: string; bytes: number; name: string }, atMs: number, maxProjectBytes: number) {
    if (input.bytes > CLOUD_MAX_BYTES[input.variant]) throw new CloudRefusal(413, 'CLOUD_TOO_LARGE', 'That file is larger than the cloud store takes.');
    const count = (await this.db.collection('collab_cloud_photos').where('projectId', '==', projectId).get()).docs.length;
    if ((await this.storedBytes(projectId)) + input.bytes > maxProjectBytes) throw new CloudRefusal(507, 'CLOUD_FULL', 'This project has used its cloud storage. Remove photos or originals to add more.');
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(projectId, photoKey);
      const snap = await tx.get(ref);
      if (!snap.exists && count >= CLOUD_MAX_PHOTOS) throw new CloudRefusal(507, 'CLOUD_FULL', 'This project holds as many cloud photos as it can.');
      const record: CloudPhotoRecord = snap.exists ? snap.data()! as unknown as CloudPhotoRecord : { projectId, photoKey, name: input.name, addedBy: accountId, addedAtMs: atMs };
      if (record[input.variant]?.committed && record[input.variant]!.sha256 === input.sha256) return { alreadyStored: true as const };
      tx.set(ref, clean({ ...record, name: record.name || input.name, [input.variant]: { sha256: input.sha256, bytes: input.bytes, committed: false } }));
      return { alreadyStored: false as const, uploadUrl: await this.storage.signUpload(cloudKey(projectId, photoKey, input.variant), input.bytes, input.sha256) };
    });
  }

  async commit(projectId: string, photoKey: string, variant: CloudVariant) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.ref(projectId, photoKey);
      const snap = await tx.get(ref);
      const record = snap.exists ? snap.data()! as unknown as CloudPhotoRecord : null;
      if (!record?.[variant]) throw new CloudRefusal(404, 'NOT_FOUND', 'Upload it first.');
      tx.set(ref, clean({ ...record, [variant]: { ...record[variant], committed: true } }));
    });
  }

  /** The stored size of one object, for metering before a download is signed. */
  async objectFor(projectId: string, photoKey: string, variant: CloudVariant): Promise<CloudObject> {
    const snap = await this.ref(projectId, photoKey).get();
    const object = snap.exists ? (snap.data()! as unknown as CloudPhotoRecord)[variant] : undefined;
    if (!object?.committed) throw new CloudRefusal(404, 'NOT_FOUND', variant === 'original' ? 'The original of this photo is not stored in the cloud.' : 'This photo is not in the cloud.');
    return object;
  }

  async signDownload(projectId: string, photoKey: string, variant: CloudVariant) { return this.storage.signDownload(cloudKey(projectId, photoKey, variant)); }

  async remove(projectId: string, photoKey: string, variants: readonly CloudVariant[] = CLOUD_VARIANTS) {
    const ref = this.ref(projectId, photoKey);
    const snap = await ref.get();
    if (!snap.exists) return;
    await Promise.all(variants.map((v) => this.storage.delete(cloudKey(projectId, photoKey, v))));
    if (variants.length === CLOUD_VARIANTS.length) await this.db.runTransaction(async (tx) => { tx.delete(ref); });
    else {
      const record = snap.data()! as unknown as Record<string, unknown>;
      for (const v of variants) delete record[v];
      await this.db.runTransaction(async (tx) => { tx.set(ref, clean(record)); });
    }
  }
}
