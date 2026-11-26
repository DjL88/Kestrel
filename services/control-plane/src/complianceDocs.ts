/**
 * Compliance documents (owner, 26 Nov 2026): signed copies of the Online Safety Act risk assessments and similar records
 * (docs/safety/), kept in their own private, versioned UK bucket (infra/gcp/compliance.tf) and reached only from /admin.
 *
 * The bucket itself is the list: every object under documents/ is one document, with its title and uploader in the
 * object's own metadata. So a copy put there by hand (the one-off seed, docs/safety/compliance-documents.md) shows up
 * too. Nothing here deletes or overwrites: each upload gets a new name, and the bucket keeps old versions.
 * Downloads are short-lived signed links. Every upload and download is audited by the admin routes (app.ts).
 */
import { createHash } from 'node:crypto';
import { randomId } from './crypto.ts';

export const COMPLIANCE_PREFIX = 'documents/';
export const COMPLIANCE_MAX_BYTES = 8_000_000;
export const COMPLIANCE_TYPES = { 'application/pdf': '.pdf', 'text/markdown': '.md' } as const;
export type ComplianceType = keyof typeof COMPLIANCE_TYPES;
/** One document's name inside documents/: letters, digits, dot, dash and underscore only, so it is safe in a URL path. */
export const COMPLIANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export interface ComplianceObject {
  /** The full object name, documents/<id>. */
  name: string; bytes: number; createdAtMs: number; contentType: string;
  metadata: Record<string, string>;
}
export interface ComplianceStorage {
  list(prefix: string): Promise<ComplianceObject[]>;
  exists(name: string): Promise<boolean>;
  /** Writes a new object; refuses if the name is taken (nothing is ever overwritten). */
  create(name: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<void>;
  /** A short-lived link that downloads the object as `fileName`. */
  signDownload(name: string, fileName: string): Promise<{ url: string; expiresAtMs: number }>;
}

export interface ComplianceDocument {
  id: string; title: string; fileName: string; contentType: string; bytes: number; uploadedAtMs: number;
  /** Account id of the admin who uploaded it, or null for a copy put in the bucket by hand. */
  uploadedBy: string | null; sha256: string | null;
}

export class ComplianceRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const slug = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100) || 'document';
const typeFor = (fileName: string) => (Object.entries(COMPLIANCE_TYPES).find(([, ext]) => fileName.toLowerCase().endsWith(ext))?.[0] ?? null) as ComplianceType | null;

/** A PDF starts with %PDF-; Markdown must be UTF-8 text. Anything else is refused. */
export function checkContent(contentType: ComplianceType, body: Buffer): boolean {
  if (contentType === 'application/pdf') return body.subarray(0, 5).toString('latin1') === '%PDF-';
  if (body.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(body); return true; } catch { return false; }
}

export class ComplianceDocuments {
  constructor(readonly storage: ComplianceStorage, private readonly newId: () => string = () => randomId(6)) {}

  async list(): Promise<ComplianceDocument[]> {
    const objects = await this.storage.list(COMPLIANCE_PREFIX);
    return objects
      .filter((o) => COMPLIANCE_ID.test(o.name.slice(COMPLIANCE_PREFIX.length)))
      .map((o) => {
        const id = o.name.slice(COMPLIANCE_PREFIX.length);
        return {
          id, title: o.metadata.title || id, fileName: o.metadata.fileName || id, contentType: o.contentType, bytes: o.bytes,
          uploadedAtMs: o.createdAtMs, uploadedBy: o.metadata.uploadedBy || null, sha256: o.metadata.sha256 || null,
        };
      })
      .sort((a, b) => b.uploadedAtMs - a.uploadedAtMs || a.id.localeCompare(b.id));
  }

  async upload(input: { title: string; fileName: string; contentType: ComplianceType; body: Buffer; by: string; atMs: number }): Promise<ComplianceDocument> {
    const { title, fileName, contentType, body } = input;
    if (body.length === 0) throw new ComplianceRefusal(400, 'EMPTY_DOCUMENT', 'That file is empty.');
    if (body.length > COMPLIANCE_MAX_BYTES) throw new ComplianceRefusal(413, 'DOCUMENT_TOO_LARGE', `Documents must be ${COMPLIANCE_MAX_BYTES / 1_000_000} MB or less.`);
    if (typeFor(fileName) !== contentType) throw new ComplianceRefusal(400, 'DOCUMENT_TYPE', 'Upload a PDF (.pdf) or a Markdown file (.md).');
    if (!checkContent(contentType, body)) throw new ComplianceRefusal(400, 'DOCUMENT_TYPE', contentType === 'application/pdf' ? 'That file is not a PDF.' : 'That file is not plain text Markdown.');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const id = `${new Date(input.atMs).toISOString().slice(0, 10)}-${this.newId().replace(/[^A-Za-z0-9]/g, 'x')}-${slug(fileName)}`;
    if (!COMPLIANCE_ID.test(id)) throw new ComplianceRefusal(400, 'DOCUMENT_NAME', 'Use a shorter file name.');
    await this.storage.create(COMPLIANCE_PREFIX + id, body, contentType, { title: title.trim(), fileName: slug(fileName), uploadedBy: input.by, sha256 });
    return { id, title: title.trim(), fileName: slug(fileName), contentType, bytes: body.length, uploadedAtMs: input.atMs, uploadedBy: input.by, sha256 };
  }

  async download(id: string): Promise<{ url: string; expiresAtMs: number; fileName: string }> {
    if (!COMPLIANCE_ID.test(id)) throw new ComplianceRefusal(404, 'NOT_FOUND', 'No such document.');
    const doc = (await this.list()).find((d) => d.id === id);
    if (!doc) throw new ComplianceRefusal(404, 'NOT_FOUND', 'No such document.');
    return { ...(await this.storage.signDownload(COMPLIANCE_PREFIX + id, doc.fileName)), fileName: doc.fileName };
  }
}

/** For tests and local runs. */
export class MemoryComplianceStorage implements ComplianceStorage {
  readonly objects = new Map<string, ComplianceObject & { body: Buffer }>();
  constructor(private readonly now: () => number = Date.now) {}
  async list(prefix: string) { return [...this.objects.values()].filter((o) => o.name.startsWith(prefix)).map(({ body: _b, ...o }) => o); }
  async exists(name: string) { return this.objects.has(name); }
  async create(name: string, body: Buffer, contentType: string, metadata: Record<string, string>) {
    if (this.objects.has(name)) throw new Error('object exists');
    this.objects.set(name, { name, body, bytes: body.length, contentType, createdAtMs: this.now(), metadata });
  }
  async signDownload(name: string, fileName: string) { return { url: `memory://${name}?as=${encodeURIComponent(fileName)}`, expiresAtMs: this.now() + 600_000 }; }
}
