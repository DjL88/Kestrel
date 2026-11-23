/**
 * Cloud Processing Engine, server side gate (backend item 1). The runner (signed upload URL into a private, encrypted,
 * short-expiry bucket, job execution, input deletion) and the ledger sit behind interfaces.
 * Nothing here stores or logs photo bytes, file names or EXIF: only ids, the job kind and a byte count.
 */
/** The names are the engine's own capability names (src/engine/types.ts `EngineCapability`), so a cloud runner is a drop-in. */
export const CLOUD_KINDS = ['denoise', 'upscale', 'mask'] as const;
export type CloudKind = typeof CLOUD_KINDS[number];
export type CloudStatus = 'awaiting-upload' | 'running' | 'ready' | 'failed' | 'finished';

export interface CloudJobRecord { jobId: string; accountId: string; kind: CloudKind; inputBytes: number; status: CloudStatus; createdAtMs: number;
  /** When the person said yes to this upload (every job carries its own consent, never a standing one). */
  consentAtMs: number;
  /** Estimated spend reserved for this job. Older job records did not store it. */
  spendPence?: number }

export interface CloudRunner {
  /** A short-lived signed upload URL into the private bucket. Throws if the job cannot be started. */
  createUpload(jobId: string, maxBytes: number): Promise<{ uploadUrl: string; expiresAtMs: number }>;
  /** Whether the person's upload has arrived. */
  inputPresent(jobId: string): Promise<boolean>;
  /** Begin processing. Called once the input is present. */
  start(jobId: string, kind: CloudKind): Promise<void>;
  /** Progress. A failure carries no text: runner messages can contain file names, so only a code reaches the client. */
  poll(jobId: string): Promise<{ state: 'running' } | { state: 'ready'; resultUrl: string } | { state: 'failed' }>;
  /** Idempotent. Must delete the input object; the bucket's lifecycle rule is only the backstop. */
  deleteInput(jobId: string): Promise<void>;
  /** Idempotent. Removes the result once collected. */
  deleteResult(jobId: string): Promise<void>;
}

export interface CloudLedger {
  /** Atomically takes one job from the account's allowance for the period. False when exhausted. */
  reserve(accountId: string, nowMs: number, limit: number, periodMs: number): Promise<boolean>;
  /** Refund the period that held the reservation, if it is still tracked. */
  refund(accountId: string, reservedAtMs: number): Promise<void>;
  put(record: CloudJobRecord): Promise<void>;
  get(jobId: string): Promise<CloudJobRecord | undefined>;
  /** Atomically update the status only if it still matches the caller's expected status. */
  transition(jobId: string, from: CloudStatus, to: CloudStatus): Promise<boolean>;
}

export interface CloudOptions {
  runner: CloudRunner; ledger: CloudLedger; jobsPerPeriod: number; maxInputBytes: number;
  /** A shared store can commit the failed status and both refunds in one transaction. */
  settleFailed?: (jobId: string, legacySpendPence: number) => Promise<boolean>;
  /** A job still running this long after it was created is treated as failed (a crashed runner writes no marker). Default 30 minutes. */
  maxJobMs?: number;
}
export const DEFAULT_MAX_JOB_MS = 30 * 60_000;

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
  // Test controls: the real runner does these on its own.
  starts = 0;
  private uploaded = new Set<string>(); private states = new Map<string, 'running' | 'ready' | 'failed'>(); private results = new Set<string>();
  simulateUpload(jobId: string) { this.uploaded.add(jobId); }
  completeJob(jobId: string) { this.states.set(jobId, 'ready'); this.results.add(jobId); }
  failJob(jobId: string, _internalMessage: string) { this.states.set(jobId, 'failed'); }
  hasResult(jobId: string) { return this.results.has(jobId); }
  async inputPresent(jobId: string) { return this.uploaded.has(jobId) && this.inputs.has(jobId); }
  async start(jobId: string) { this.starts++; this.states.set(jobId, 'running'); }
  async poll(jobId: string) {
    const s = this.states.get(jobId) ?? 'running';
    return s === 'ready' ? { state: 'ready' as const, resultUrl: `memory://result/${jobId}` } : { state: s };
  }
  async deleteResult(jobId: string) { this.results.delete(jobId); }
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
  async refund(accountId: string, reservedAtMs: number) {
    const c = this.counts.get(accountId);
    if (c && reservedAtMs >= c.start && c.used > 0) c.used--;
  }
  async put(r: CloudJobRecord) {
    const { jobId, accountId, kind, inputBytes, status, createdAtMs, consentAtMs, spendPence } = r;
    this.jobs.set(jobId, { jobId, accountId, kind, inputBytes, status, createdAtMs, consentAtMs, ...(spendPence === undefined ? {} : { spendPence }) });
  }
  async get(jobId: string) { const r = this.jobs.get(jobId); return r ? { ...r } : undefined; }
  async transition(jobId: string, from: CloudStatus, to: CloudStatus) {
    const record = this.jobs.get(jobId);
    if (record?.status !== from) return false;
    this.jobs.set(jobId, { ...record, status: to });
    return true;
  }
  used(accountId: string) { return this.counts.get(accountId)?.used ?? 0; }
  record(jobId: string) { return this.jobs.get(jobId); }
}
