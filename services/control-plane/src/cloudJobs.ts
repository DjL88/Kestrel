/**
 * Cloud Processing Engine, server side gate (backend item 1). The runner (signed upload URL into a private, encrypted,
 * short-expiry bucket, job execution, input deletion) and the ledger sit behind interfaces. Only in-memory fakes exist:
 * no Google Cloud is touched. Production wiring (Terraform plan, GCS, Firestore) is a later PR the owner must approve.
 * Nothing here stores or logs photo bytes, file names or EXIF: only ids, the job kind and a byte count.
 */
export const CLOUD_KINDS = ['denoise', 'upscale', 'subject-mask'] as const;
export type CloudKind = typeof CLOUD_KINDS[number];
export type CloudStatus = 'awaiting-upload' | 'finished';

export interface CloudJobRecord { jobId: string; accountId: string; kind: CloudKind; inputBytes: number; status: CloudStatus; createdAtMs: number }

export interface CloudRunner {
  /** A short-lived signed upload URL into the private bucket. Throws if the job cannot be started. */
  createUpload(jobId: string, maxBytes: number): Promise<{ uploadUrl: string; expiresAtMs: number }>;
  /** Idempotent. Must delete the input object; the bucket's lifecycle rule is only the backstop. */
  deleteInput(jobId: string): Promise<void>;
}

export interface CloudLedger {
  /** Atomically takes one job from the account's allowance for the period. False when exhausted. */
  reserve(accountId: string, nowMs: number, limit: number, periodMs: number): Promise<boolean>;
  refund(accountId: string): Promise<void>;
  put(record: CloudJobRecord): Promise<void>;
  get(jobId: string): Promise<CloudJobRecord | undefined>;
}

export interface CloudOptions { runner: CloudRunner; ledger: CloudLedger; jobsPerPeriod: number; maxInputBytes: number }

export class MemoryCloudRunner implements CloudRunner {
  uploadsCreated = 0; failNext = false;
  private inputs = new Set<string>();
  async createUpload(jobId: string) {
    if (this.failNext) { this.failNext = false; throw new Error('runner unavailable'); }
    this.uploadsCreated++; this.inputs.add(jobId);
    return { uploadUrl: `memory://uploads/${jobId}`, expiresAtMs: 0 };
  }
  async deleteInput(jobId: string) { this.inputs.delete(jobId); }
  hasInput(jobId: string) { return this.inputs.has(jobId); }
}

export class MemoryCloudLedger implements CloudLedger {
  private counts = new Map<string, { start: number; used: number }>();
  private jobs = new Map<string, CloudJobRecord>();
  async reserve(accountId: string, nowMs: number, limit: number, periodMs: number) {
    let c = this.counts.get(accountId);
    if (!c || nowMs >= c.start + periodMs) { c = { start: nowMs, used: 0 }; this.counts.set(accountId, c); }
    if (c.used >= limit) return false;
    c.used++; return true;
  }
  async refund(accountId: string) { const c = this.counts.get(accountId); if (c && c.used > 0) c.used--; }
  async put(record: CloudJobRecord) { this.jobs.set(record.jobId, { ...record }); }
  async get(jobId: string) { const r = this.jobs.get(jobId); return r ? { ...r } : undefined; }
  used(accountId: string) { return this.counts.get(accountId)?.used ?? 0; }
  record(jobId: string) { return this.jobs.get(jobId); }
}
