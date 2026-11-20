/** Owner-managed photographs for the public demonstration.
 * Drafts: private Google Cloud Storage; publication snapshots: Firestore;
 * published JPEGs: a separate public-read Cloud Storage bucket.
 * Never accept camera RAW or EXIF/GPS in this service. Never give a visitor write access.
 */
import crypto from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
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

/** Signed only by the Cloud Run metadata server's short-lived IAM identity.
 * REST GCS avoids static JSON keys and introducing a second cloud SDK.
 * The service account has object access only to the two demo buckets.
 */
async function gcsToken(): Promise<string> {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!response.ok) throw new ApiError(503,'DEMO_STORAGE_UNAVAILABLE','Demo storage authentication is unavailable.');
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new ApiError(503,'DEMO_STORAGE_UNAVAILABLE','Demo storage authentication is unavailable.');
  return payload.access_token;
}
async function gcs(method: 'GET'|'POST'|'DELETE', path: string, data?: Buffer, allowMissing = false): Promise<Response> {
  const token = await gcsToken();
  const response = await fetch('https://storage.googleapis.com'+path, {
    method,
    headers: { Authorization:'Bearer '+token, ...(data?{'Content-Type':'image/jpeg'}:{}) },
    ...(data?{body:new Uint8Array(data)}:{}),
  });
  if (allowMissing && response.status === 404) return response;
  if (!response.ok) throw new ApiError(503,'DEMO_STORAGE_ERROR','The photograph could not be saved in Cloud Storage.');
  return response;
}
const obj = (name: string) => encodeURIComponent(name);
async function put(bucket: string, name: string, jpeg: Buffer) {
  await gcs('POST','/upload/storage/v1/b/'+obj(bucket)+'/o?uploadType=media&name='+obj(name),jpeg);
}
async function copy(fromBucket: string, from: string, toBucket: string, to: string) {
  await gcs('POST','/storage/v1/b/'+obj(fromBucket)+'/o/'+obj(from)+'/copyTo/b/'+obj(toBucket)+'/o/'+obj(to));
}
async function removeGcs(bucket: string, name: string) {
  await gcs('DELETE','/storage/v1/b/'+obj(bucket)+'/o/'+obj(name),undefined,true);
}
async function getGcs(bucket: string, name: string): Promise<Buffer> {
  const response = await gcs('GET','/storage/v1/b/'+obj(bucket)+'/o/'+obj(name)+'?alt=media');
  return Buffer.from(await response.arrayBuffer());
}
/** Firestore keeps private drafts and immutable approved edit snapshots; GCS keeps JPEG bytes. */
export class CloudDemoStudio implements DemoStudioStore {
  constructor(private readonly firestore: Firestore,
    private readonly draftsBucket: string, private readonly publicBucket: string) {}
  private doc(id: string) {
    if (!idPattern.test(id)) throw notFound();
    return this.firestore.collection('demo_photos').doc(id);
  }
  private draft(id: string) { return 'drafts/'+id+'.jpg'; }
  private publishedPath(id: string, digest: string) { return 'published/'+id+'/'+digest+'.jpg'; }
  async list() {
    const result = await this.firestore.collection('demo_photos').limit(MAX_ITEMS+1).get();
    return result.docs.map((d) => d.data() as Example).sort((a,b) => a.createdAtMs-b.createdAtMs);
  }
  async get(id: string) { const result = await this.doc(id).get(); return result.exists ? result.data() as Example : null; }
  async image(id: string) {
    const photo = await this.get(id); if (!photo) throw notFound();
    return getGcs(this.draftsBucket, this.draft(id));
  }
  async create(jpeg: Buffer, fields: Pick<ExampleFields,'title'|'subject'|'credit'|'alt'>, at: number) {
    const photo = build(jpeg,fields,at);
    if ((await this.list()).length >= MAX_ITEMS) throw new ApiError(409,'DEMO_LIMIT','Delete an older photograph before adding more (40 maximum).');
    await put(this.draftsBucket,this.draft(photo.id),jpeg);
    try { await this.doc(photo.id).create(photo); }
    catch (error) { await removeGcs(this.draftsBucket,this.draft(photo.id)).catch(() => {}); throw error; }
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
    const path=this.publishedPath(id,current.sha256);
    // Upload the explicitly approved bytes before the Firestore manifest points to them.
    if (published) await copy(this.draftsBucket,this.draft(id),this.publicBucket,path);
    const result = await this.firestore.runTransaction(async (tx) => {
      const doc=await tx.get(ref); if(!doc.exists)throw notFound();
      const p=doc.data() as Example; present(p,revision);
      const updated: Example = { ...p, published, revision:revision+1, updatedAtMs:at,
        publicPath:published?path:null,
        publicSnapshot:published?{title:p.title,subject:p.subject,credit:p.credit,alt:p.alt,edit:p.edit,framing:p.framing,revision:revision+1}:null };
      tx.update(ref,updated); return updated;
    });
    if (!published && current.publicPath) await removeGcs(this.publicBucket,current.publicPath).catch(() => {});
    return result;
  }
  async remove(id: string, revision: number) {
    const ref=this.doc(id); const photo=await this.get(id); if(!photo)throw notFound(); present(photo,revision);
    if (photo.publicPath) await removeGcs(this.publicBucket,photo.publicPath);
    await this.firestore.runTransaction(async(tx)=>{
      const doc=await tx.get(ref);if(!doc.exists)throw notFound();
      present(doc.data() as Example,revision);tx.delete(ref);
    });
    await removeGcs(this.draftsBucket,this.draft(id)).catch(() => {});
  }
  imageUrl(p: Example) {
    return p.published && p.publicPath
      ? 'https://storage.googleapis.com/'+encodeURIComponent(this.publicBucket)+'/'+p.publicPath
      : null;
  }
}
