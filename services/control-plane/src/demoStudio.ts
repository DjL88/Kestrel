/** Owner-managed photographs for the public demonstration.
 * Drafts: private Google Cloud Storage; publication snapshots: Firestore;
 * published JPEGs: a separate public-read Cloud Storage bucket.
 * Never accept camera RAW or EXIF/GPS in this service. Never give a visitor write access.
 */
import crypto from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { Storage } from '@google-cloud/storage';
import type { PhotoEdit } from '../../../src/core/photoEdits.ts';
import type { PhotoFraming } from '../../../src/core/photoFraming.ts';
import { inspectJpeg } from '../../../src/core/jpegInspect.ts';
import { ApiError } from './http.ts';

export const DEMO_MAX_IMAGE_BYTES = 1_600_000;
const MAX_ITEMS = 40;
export interface ExampleFields {
  title: string; subject: string; credit: string; alt: string;
  edit: PhotoEdit; framing: PhotoFraming;
}
export interface Example extends ExampleFields {
  id: string; revision: number; published: boolean;
  sha256: string; width: number; height: number;
  createdAtMs: number; updatedAtMs: number;
  publicPath: string | null;
  /** Latest explicitly approved copy; editing a draft never changes a public version. */
  publicSnapshot: (ExampleFields & { revision: number }) | null;
}
export interface DemoStudioStore {
  list(): Promise<Example[]>;
  get(id: string): Promise<Example | null>;
  image(id: string): Promise<Buffer>;
  create(jpeg: Buffer, fields: Pick<ExampleFields, 'title'|'subject'|'credit'|'alt'>, at: number): Promise<Example>;
  save(id: string, revision: number, changes: ExampleFields, at: number): Promise<Example>;
  publish(id: string, revision: number, published: boolean, at: number): Promise<Example>;
  remove(id: string, revision: number): Promise<void>;
  imageUrl(photo: Example): string | null;
}
const notFound = () => new ApiError(404, 'DEMO_NOT_FOUND', 'That demonstration photograph was not found.');
const changed = () => new ApiError(409, 'DEMO_CHANGED', 'This photograph changed since you opened it. Reload and try again.');
const idPattern = /^demo_[0-9a-f]{24}$/;
export function checkJpeg(jpeg: Buffer) {
  if (jpeg.length < 100 || jpeg.length > DEMO_MAX_IMAGE_BYTES) throw new ApiError(413, 'DEMO_SIZE', 'The uploaded photograph must be smaller than 1.6 MB.');
  const info = inspectJpeg(jpeg);
  if (!info || info.width < 320 || info.height < 320 || info.width > 2400 || info.height > 2400) {
    throw new ApiError(400, 'DEMO_JPEG', 'Upload a valid JPEG from 320 to 2400 pixels per side.');
  }
  if (info.hasMetadata) throw new ApiError(400, 'DEMO_EXIF', 'Remove camera metadata first. The admin page redraws images before uploading.');
  return { sha256: crypto.createHash('sha256').update(jpeg).digest('hex'), width: info.width, height: info.height };
}
const clone = (x: Example) => structuredClone(x);
const build = (jpeg: Buffer, fields: Pick<ExampleFields, 'title'|'subject'|'credit'|'alt'>, at: number): Example => ({
  id: 'demo_' + crypto.randomBytes(12).toString('hex'),
  revision: 1, published: false, publicPath: null, publicSnapshot: null,
  ...checkJpeg(jpeg), createdAtMs: at, updatedAtMs: at,
  ...fields,
  edit: { exposure: 0, warmth: 0, colour: 0 },
  framing: { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 },
});
function present(p: Example, revision: number) {
  if (p.revision !== revision) throw changed();
}
export function publicExamples(photos: Example[], url: (p: Example) => string | null) {
  return photos.filter((p) => p.published && p.publicSnapshot && url(p)).slice(0, 10).map((p) => ({
    id: p.id,
    ...p.publicSnapshot,
    published: true,
    imageUrl: url(p),
  }));
}
export function adminExamples(photos: Example[], url: (p: Example) => string | null) {
  return photos.map((p) => ({
    id: p.id, revision: p.revision, title: p.title, subject: p.subject,
    credit: p.credit, alt: p.alt, edit: p.edit, framing: p.framing,
    published: p.published, publishedRevision: p.publicSnapshot?.revision ?? null,
    imageUrl: p.published ? url(p) : null,
  }));
}

/** SQLite/local testing: works without GCP and discards photographs when the dev server exits. */
export class MemoryDemoStudio implements DemoStudioStore {
  private photos = new Map<string, Example>();
  private files = new Map<string, Buffer>();
  async list() { return [...this.photos.values()].map(clone).sort((a,b) => a.createdAtMs - b.createdAtMs); }
  async get(id: string) { return this.photos.has(id) ? clone(this.photos.get(id)!) : null; }
  async image(id: string) { const file = this.files.get(id); if (!file) throw notFound(); return Buffer.from(file); }
  async create(jpeg: Buffer, fields: Pick<ExampleFields, 'title'|'subject'|'credit'|'alt'>, at: number) {
    if (this.photos.size >= MAX_ITEMS) throw new ApiError(409,'DEMO_LIMIT','Delete an older photograph before adding more (40 maximum).');
    const photo = build(jpeg, fields, at);
    this.photos.set(photo.id,photo); this.files.set(photo.id,Buffer.from(jpeg)); return clone(photo);
  }
  async save(id: string, revision: number, changes: ExampleFields, at: number) {
    const previous = this.photos.get(id); if (!previous) throw notFound(); present(previous,revision);
    const photo = { ...previous, ...changes, revision: revision+1, updatedAtMs:at };
    this.photos.set(id,photo); return clone(photo);
  }
  async publish(id: string, revision: number, published: boolean, at: number) {
    const previous = this.photos.get(id); if (!previous) throw notFound(); present(previous,revision);
    const photo: Example = { ...previous, published, revision: revision+1, updatedAtMs:at,
      publicPath:published ? 'public/'+id+'/'+previous.sha256+'.jpg' : null,
      publicSnapshot:published ? { title:previous.title,subject:previous.subject,credit:previous.credit,alt:previous.alt,edit:previous.edit,framing:previous.framing,revision:revision+1 } : null };
    this.photos.set(id,photo); return clone(photo);
  }
  async remove(id: string, revision: number) {
    const previous = this.photos.get(id); if (!previous) throw notFound(); present(previous,revision);
    this.photos.delete(id); this.files.delete(id);
  }
  imageUrl(p: Example) { return p.published ? 'data:image/jpeg;base64,'+this.files.get(p.id)?.toString('base64') : null; }
}

/** Cloud Run uses its IAM service account, not a bucket credential in the browser or repository. */
export class CloudDemoStudio implements DemoStudioStore {
  constructor(private readonly firestore: Firestore, private readonly storage: Storage,
    private readonly draftsBucket: string, private readonly publicBucket: string) {}
  private doc(id: string) {
    if (!idPattern.test(id)) throw notFound();
    return this.firestore.collection('demo_photos').doc(id);
  }
  private draft(id: string) { return this.storage.bucket(this.draftsBucket).file('drafts/'+id+'.jpg'); }
  private published(id: string, hash: string) {
    return this.storage.bucket(this.publicBucket).file('published/'+id+'/'+hash+'.jpg');
  }
  async list() {
    const result = await this.firestore.collection('demo_photos').limit(MAX_ITEMS+1).get();
    return result.docs.map((d) => d.data() as Example).sort((a,b) => a.createdAtMs-b.createdAtMs);
  }
  async get(id: string) { const result = await this.doc(id).get(); return result.exists ? result.data() as Example : null; }
  async image(id: string) {
    const photo = await this.get(id); if (!photo) throw notFound();
    const [bytes] = await this.draft(id).download();
    return bytes;
  }
  async create(jpeg: Buffer, fields: Pick<ExampleFields,'title'|'subject'|'credit'|'alt'>, at: number) {
    const photo = build(jpeg,fields,at);
    if ((await this.list()).length >= MAX_ITEMS) throw new ApiError(409,'DEMO_LIMIT','Delete an older photograph before adding more (40 maximum).');
    const file = this.draft(photo.id);
    await file.save(jpeg, { resumable: false, contentType: 'image/jpeg', validation: 'crc32c',
      metadata: { cacheControl:'private, no-store' } });
    try { await this.doc(photo.id).create(photo); }
    catch (error) { await file.delete({ignoreNotFound:true}).catch(() => {}); throw error; }
    return photo;
  }
  async save(id: string, revision: number, changes: ExampleFields, at: number) {
    const ref=this.doc(id);
    return this.firestore.runTransaction(async (tx) => {
      const doc = await tx.get(ref); if(!doc.exists)throw notFound();
      const previous=doc.data() as Example; present(previous,revision);
      const next = { ...previous, ...changes, revision:revision+1, updatedAtMs:at };
      tx.update(ref, next); return next;
    });
  }
  async publish(id: string, revision: number, published: boolean, at: number) {
    const ref=this.doc(id);
    const current=await this.get(id); if(!current)throw notFound(); present(current,revision);
    const path='published/'+id+'/'+current.sha256+'.jpg';
    // Content-addressed object, not an unreviewed draft. This copy happens before the public
    // manifest is updated, so the public never points to a missing file.
    if (published) {
      await this.draft(id).copy(this.published(id,current.sha256));
      await this.published(id,current.sha256).setMetadata({ contentType:'image/jpeg', cacheControl:'public, max-age=300' });
    }
    const result = await this.firestore.runTransaction(async (tx) => {
      const doc=await tx.get(ref); if(!doc.exists)throw notFound();
      const p=doc.data() as Example; present(p,revision);
      const updated: Example = { ...p, published, revision:revision+1, updatedAtMs:at,
        publicPath:published?path:null,
        publicSnapshot:published?{title:p.title,subject:p.subject,credit:p.credit,alt:p.alt,edit:p.edit,framing:p.framing,revision:revision+1}:null };
      tx.update(ref,updated); return updated;
    });
    if (!published && current.publicPath) await this.published(id,current.sha256).delete({ignoreNotFound:true}).catch(() => {});
    return result;
  }
  async remove(id: string, revision: number) {
    const ref=this.doc(id); const photo=await this.get(id); if(!photo)throw notFound(); present(photo,revision);
    // Remove the public object before removing the Firestore pointer; a deletion failure
    // must not silently claim the photograph is private.
    if (photo.publicPath) await this.published(id,photo.sha256).delete({ignoreNotFound:true});
    await this.firestore.runTransaction(async(tx)=>{
      const doc=await tx.get(ref);if(!doc.exists)throw notFound();
      present(doc.data() as Example,revision);tx.delete(ref);
    });
    await this.draft(id).delete({ignoreNotFound:true}).catch(() => {});
  }
  imageUrl(p: Example) {
    return p.published && p.publicPath
      ? 'https://storage.googleapis.com/'+encodeURIComponent(this.publicBucket)+'/'+p.publicPath
      : null;
  }
}
