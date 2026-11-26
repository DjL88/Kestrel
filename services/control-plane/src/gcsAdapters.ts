/**
 * Google Cloud Storage and Cloud Run Job adapters for the cloud gate and safe copy. The Google clients are reached only
 * through the small structural types below, so tests use fakes and nothing imports @google-cloud/storage unless a bucket
 * is configured. Nothing here is created or called until the owner applies the Terraform and sets the environment.
 * Object layout in the cloud-processing bucket: inputs/<jobId> (uploaded), results/<jobId> and failed/<jobId> (written by
 * the runner job: a result file on success, an empty marker on failure). No file names ever appear in a key.
 */
import type { CloudKind, CloudRunner, RecipeInputKind } from './cloudJobs.ts';
import type { SafeCopyStorage } from './safeCopy.ts';
import type { ComplianceObject, ComplianceStorage } from './complianceDocs.ts';

export interface GcsFileLike {
  getSignedUrl(opts: { version: 'v4'; action: 'read' | 'write'; expires: number; extensionHeaders?: Record<string, string>; responseDisposition?: string }): Promise<[string]>;
  exists(): Promise<[boolean]>;
  delete(opts?: { ignoreNotFound?: boolean }): Promise<unknown>;
  /** Used by the sharing safety checks (contentSafety.ts). */
  getMetadata?(): Promise<[{ size?: string | number }]>;
  download?(): Promise<[Buffer]>;
  copy?(destination: string): Promise<unknown>;
  /** Used by compliance documents: write once, never overwrite. */
  save?(data: Buffer, opts: { contentType: string; resumable: false; metadata: { metadata: Record<string, string> }; preconditionOpts: { ifGenerationMatch: 0 } }): Promise<unknown>;
}
export interface GcsBucketLike { file(name: string): GcsFileLike }

const UPLOAD_TTL_MS = 15 * 60_000;
const DOWNLOAD_TTL_MS = 10 * 60_000;

/** The real bucket, loaded on demand so local runs and tests never need the Google package. */
export async function openGcsBucket(name: string): Promise<GcsBucketLike> {
  const moduleName = '@google-cloud/storage';
  const { Storage } = (await import(moduleName)) as { Storage: new () => { bucket(n: string): GcsBucketLike } };
  return new Storage().bucket(name);
}

const bounded = (bytes: number) => ({ 'x-goog-content-length-range': `0,${Math.floor(bytes)}` });

export class GcsSafeCopyStorage implements SafeCopyStorage {
  constructor(private readonly bucket: GcsBucketLike, private readonly now: () => number = Date.now) {}
  async signUpload(key: string, bytes: number, _sha256?: string) {
    return (await this.bucket.file(key).getSignedUrl({ version: 'v4', action: 'write', expires: this.now() + UPLOAD_TTL_MS, extensionHeaders: bounded(bytes) }))[0];
  }
  async signDownload(key: string) {
    return (await this.bucket.file(key).getSignedUrl({ version: 'v4', action: 'read', expires: this.now() + DOWNLOAD_TTL_MS }))[0];
  }
  async delete(key: string) { await this.bucket.file(key).delete({ ignoreNotFound: true }); }
  /** Reads a stored picture for the sharing checks; checks the size first so nothing large is downloaded. */
  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    const file = this.bucket.file(key);
    if (!(await file.exists())[0]) return null;
    const [meta] = await file.getMetadata!();
    if (Number(meta.size ?? Infinity) > maxBytes) throw new Error('too large to check');
    return (await file.download!())[0];
  }
  async copy(from: string, to: string) { await this.bucket.file(from).copy!(to); }
}

/** A bucket that can also list its objects (compliance documents only). */
export interface GcsListingBucketLike extends GcsBucketLike {
  getFiles(opts: { prefix: string }): Promise<[{ name: string; metadata: { size?: string | number; timeCreated?: string; contentType?: string; metadata?: Record<string, string> } }[]]>;
}

/** The private, versioned compliance bucket (infra/gcp/compliance.tf). Writes refuse to replace an existing object. */
export class GcsComplianceStorage implements ComplianceStorage {
  constructor(private readonly bucket: GcsListingBucketLike, private readonly now: () => number = Date.now) {}
  async list(prefix: string): Promise<ComplianceObject[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => ({
      name: f.name, bytes: Number(f.metadata.size ?? 0), createdAtMs: Date.parse(f.metadata.timeCreated ?? '') || 0,
      contentType: f.metadata.contentType ?? 'application/octet-stream', metadata: { ...(f.metadata.metadata ?? {}) },
    }));
  }
  async exists(name: string) { return (await this.bucket.file(name).exists())[0]; }
  async create(name: string, body: Buffer, contentType: string, metadata: Record<string, string>) {
    await this.bucket.file(name).save!(body, { contentType, resumable: false, metadata: { metadata }, preconditionOpts: { ifGenerationMatch: 0 } });
  }
  async signDownload(name: string, fileName: string) {
    const expiresAtMs = this.now() + DOWNLOAD_TTL_MS;
    const [url] = await this.bucket.file(name).getSignedUrl({ version: 'v4', action: 'read', expires: expiresAtMs, responseDisposition: `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"` });
    return { url, expiresAtMs };
  }
}

export interface RunnerTrigger { trigger(jobId: string, kind: CloudKind, inputKind?: RecipeInputKind): Promise<void> }

export class GcsCloudRunner implements CloudRunner {
  constructor(private readonly bucket: GcsBucketLike, private readonly runner: RunnerTrigger, private readonly now: () => number = Date.now) {}
  async createUpload(jobId: string, maxBytes: number) {
    const expires = this.now() + UPLOAD_TTL_MS;
    const [uploadUrl] = await this.bucket.file(`inputs/${jobId}`).getSignedUrl({ version: 'v4', action: 'write', expires, extensionHeaders: bounded(maxBytes) });
    return { uploadUrl, expiresAtMs: expires };
  }
  async inputPresent(jobId: string) { return (await this.bucket.file(`inputs/${jobId}`).exists())[0]; }
  async start(jobId: string, kind: CloudKind, inputKind?: RecipeInputKind) { await this.runner.trigger(jobId, kind, inputKind); }
  async poll(jobId: string) {
    if ((await this.bucket.file(`results/${jobId}`).exists())[0]) {
      const [resultUrl] = await this.bucket.file(`results/${jobId}`).getSignedUrl({ version: 'v4', action: 'read', expires: this.now() + DOWNLOAD_TTL_MS });
      return { state: 'ready' as const, resultUrl };
    }
    if ((await this.bucket.file(`failed/${jobId}`).exists())[0]) return { state: 'failed' as const };
    return { state: 'running' as const };
  }
  async deleteInput(jobId: string) { await this.bucket.file(`inputs/${jobId}`).delete({ ignoreNotFound: true }); }
  async deleteResult(jobId: string) {
    await this.bucket.file(`results/${jobId}`).delete({ ignoreNotFound: true });
    await this.bucket.file(`failed/${jobId}`).delete({ ignoreNotFound: true });
  }
}

/**
 * Starts one execution of the runner as a Cloud Run JOB (it keeps running after this call returns, which a request to the
 * CPU-throttled control plane could not). Passes only the job id and kind; the job reads its input from the bucket.
 * The access token comes from the metadata server in production. UNVERIFIED: the IAM role needed for overrides.
 */
export class CloudRunJobTrigger implements RunnerTrigger {
  constructor(private readonly jobName: string, private readonly token: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {
    if (!/^projects\/[a-z][a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z][a-z0-9-]*$/.test(jobName)) throw new Error('KCP_CLOUD_RUNNER_JOB must be a Cloud Run job name: projects/<p>/locations/<l>/jobs/<name>');
  }
  async trigger(jobId: string, kind: CloudKind, inputKind?: RecipeInputKind) {
    const env = [{ name: 'KCR_JOB_ID', value: jobId }, { name: 'KCR_KIND', value: kind }];
    if (kind === 'recipe' && inputKind) env.push({ name: 'KCR_INPUT_KIND', value: inputKind });
    const response = await this.fetcher(`https://run.googleapis.com/v2/${this.jobName}:run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.token()}` },
      body: JSON.stringify({ overrides: { containerOverrides: [{ env }] } }),
    });
    if (!response.ok) throw new Error(`run job ${response.status}`);
  }
}

/** Access token for the service's own account from the Cloud Run metadata server. */
export async function metadataAccessToken(fetcher: typeof fetch = fetch): Promise<string> {
  const r = await fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'metadata-flavor': 'Google' } });
  if (!r.ok) throw new Error(`metadata token ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}
