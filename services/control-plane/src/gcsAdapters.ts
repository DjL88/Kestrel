/**
 * Google Cloud Storage and Cloud Run Job adapters for the cloud gate and safe copy. The Google clients are reached only
 * through the small structural types below, so tests use fakes and nothing imports @google-cloud/storage unless a bucket
 * is configured. Nothing here is created or called until the owner applies the Terraform and sets the environment.
 * Object layout in the cloud-processing bucket: inputs/<jobId> (uploaded), results/<jobId> and failed/<jobId> (written by
 * the runner job: a result file on success, an empty marker on failure). No file names ever appear in a key.
 */
import type { CloudKind, CloudRunner } from './cloudJobs.ts';
import type { SafeCopyStorage } from './safeCopy.ts';

export interface GcsFileLike {
  getSignedUrl(opts: { version: 'v4'; action: 'read' | 'write'; expires: number; extensionHeaders?: Record<string, string> }): Promise<[string]>;
  exists(): Promise<[boolean]>;
  delete(opts?: { ignoreNotFound?: boolean }): Promise<unknown>;
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
}

export interface RunnerTrigger { trigger(jobId: string, kind: CloudKind): Promise<void> }

export class GcsCloudRunner implements CloudRunner {
  constructor(private readonly bucket: GcsBucketLike, private readonly runner: RunnerTrigger, private readonly now: () => number = Date.now) {}
  async createUpload(jobId: string, maxBytes: number) {
    const expires = this.now() + UPLOAD_TTL_MS;
    const [uploadUrl] = await this.bucket.file(`inputs/${jobId}`).getSignedUrl({ version: 'v4', action: 'write', expires, extensionHeaders: bounded(maxBytes) });
    return { uploadUrl, expiresAtMs: expires };
  }
  async inputPresent(jobId: string) { return (await this.bucket.file(`inputs/${jobId}`).exists())[0]; }
  async start(jobId: string, kind: CloudKind) { await this.runner.trigger(jobId, kind); }
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
 * The access token comes from the metadata server. Terraform grants the executor-with-overrides role on this job.
 */
export class CloudRunJobTrigger implements RunnerTrigger {
  constructor(private readonly jobName: string, private readonly token: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {
    if (!/^projects\/[a-z][a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z][a-z0-9-]*$/.test(jobName)) throw new Error('KCP_CLOUD_RUNNER_JOB must be a Cloud Run job name: projects/<p>/locations/<l>/jobs/<name>');
  }
  async trigger(jobId: string, kind: CloudKind) {
    const response = await this.fetcher(`https://run.googleapis.com/v2/${this.jobName}:run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.token()}` },
      body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: 'KCR_JOB_ID', value: jobId }, { name: 'KCR_KIND', value: kind }] }] } }),
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
