import { parseControlPlaneUrl } from '../core/licenceOnline';
import { CloudJobError, cloudJobProblem, type CloudJobStep } from '../core/cloudJobProblem';

const JOBS_PATH = '/v1/cloud/jobs';
const CLEANUP_TIMEOUT_MS = 5_000;
const MAX_JOB_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const privateFetch = { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' } as const;

interface CloudJob {
  /** `recipe` sends a picture and gets back a few KB of edit settings (x-std-cloud-recipe), never pixels. */
  kind: 'denoise' | 'upscale' | 'mask' | 'recipe';
  /** For `recipe`: which picture was sent, so the service can say what it worked on. */
  inputKind?: 'smart-preview' | 'original';
  /** Told the job's id as soon as the control plane gives one, so the result can be matched to this job. */
  onJobId?: (id: string) => void;
  /** Told, once the job has ended, whether the service confirmed it deleted its copy of the upload. */
  onFinished?: (inputDeleted: boolean) => void;
  /** Capability-specific bytes prepared for the upload the user just approved. */
  input: Blob;
  userConsent: boolean;
  signal?: AbortSignal;
  /** Cap memory before passing any returned bytes to the capability's local verifier. */
  maxResultBytes: number;
}

interface CloudJobConnection {
  baseUrl: string;
  session: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cloud processing response.');
  return value as Record<string, unknown>;
}

/** The control plane signs a specific object through its GCS Storage adapter. */
function storageObject(value: unknown, key: string) {
  if (typeof value !== 'string') throw new Error('Invalid cloud storage link.');
  const url = new URL(value);
  const bucket = url.pathname.split('/')[1] ?? '';
  if (url.origin !== 'https://storage.googleapis.com' || url.username || url.password || url.hash || !url.search
    || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) || url.pathname !== `/${bucket}/${key}`) {
    throw new Error('Invalid cloud storage link.');
  }
  return { url, bucket };
}

function waitForNextPoll(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function readResult(response: Response, maxBytes: number, signal: AbortSignal): Promise<Blob> {
  if (!response.ok || !response.body) throw fail('result', response.status);
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Cloud processing result exceeded its size limit.');
      parts.push(new Uint8Array(value));
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (bytes === 0) throw new Error('Cloud processing returned an empty result.');
  return new Blob(parts);
}

/** The control plane's error code from a refused request, or '' when it sent none. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    return typeof body?.error?.code === 'string' ? body.error.code : '';
  } catch { return ''; }
}

const fail = (step: CloudJobStep, status = 0, code = '') => new CloudJobError(cloudJobProblem(step, status, code));

/**
 * Transfer one explicitly approved job. The engine must verify its result before applying it. Every failure the person
 * could act on is a `CloudJobError` in plain words (src/core/cloudJobProblem.ts); a cancel by the caller stays an abort.
 */
export async function runCloudJob(connection: CloudJobConnection, job: CloudJob): Promise<Blob> {
  try {
    return await runCloudJobSteps(connection, job);
  } catch (error) {
    if (error instanceof CloudJobError || job.signal?.aborted) throw error;
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw fail('timeout');
    if (error instanceof TypeError) throw fail('network');
    throw error;
  }
}

async function runCloudJobSteps(connection: CloudJobConnection, job: CloudJob): Promise<Blob> {
  const base = parseControlPlaneUrl(connection.baseUrl);
  if (!base || !connection.session.trim() || job.userConsent !== true || job.input.size === 0
    || !Number.isSafeInteger(job.maxResultBytes) || job.maxResultBytes < 1) {
    throw new Error('Cloud processing requires a signed-in session and approval for this job.');
  }
  const fetcher = connection.fetch ?? fetch;
  const deadline = AbortSignal.timeout(connection.timeoutMs ?? MAX_JOB_WAIT_MS);
  const signal = job.signal ? AbortSignal.any([job.signal, deadline]) : deadline;
  signal.throwIfAborted();
  const interval = connection.pollIntervalMs ?? POLL_INTERVAL_MS;
  const authorization = `Bearer ${connection.session}`;
  const request = (path: string, method: 'GET' | 'POST', requestSignal: AbortSignal, body?: string) =>
    fetcher(base + path, {
      ...privateFetch,
      method,
      signal: requestSignal,
      headers: body === undefined ? { authorization } : { authorization, 'content-type': 'application/json' },
      body,
    });

  const created = await request(JOBS_PATH, 'POST', signal, JSON.stringify({
    kind: job.kind, inputBytes: job.input.size, userConsent: true, ...(job.inputKind ? { inputKind: job.inputKind } : {}),
  }));
  if (!created.ok) throw fail('start', created.status, await errorCode(created));
  const upload = object(await created.json());
  const id = upload.jobId;
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error('Invalid cloud processing job.');
  const path = `${JOBS_PATH}/${id}`;
  job.onJobId?.(id);
  try {
    const input = storageObject(upload.uploadUrl, `inputs/${id}`);
    const uploaded = await fetcher(input.url, {
      ...privateFetch,
      method: 'PUT',
      headers: { 'x-goog-content-length-range': `0,${job.input.size}` },
      body: job.input,
      signal,
    });
    if (!uploaded.ok) throw fail('upload', uploaded.status);
    let start = await request(`${path}/start`, 'POST', signal);
    let startCode = start.ok ? '' : await errorCode(start);
    if (start.status === 409 && startCode === 'CLOUD_INPUT_MISSING') {
      await waitForNextPoll(interval, signal);
      start = await request(`${path}/start`, 'POST', signal);
      startCode = start.ok ? '' : await errorCode(start);
    }
    if (!start.ok) throw fail('start', start.status, startCode);
    let canRetryStatus = true;
    for (;;) {
      const response = await request(path, 'GET', signal);
      if (response.status >= 500 && canRetryStatus) {
        canRetryStatus = false;
        void response.body?.cancel().catch(() => undefined);
        await waitForNextPoll(interval, signal);
        continue;
      }
      if (!response.ok) throw fail('status', response.status, await errorCode(response));
      const status = object(await response.json());
      if (status.jobId !== id || status.kind !== job.kind) throw new Error('Cloud processing returned a different job.');
      if (status.status === 'ready') {
        const result = storageObject(status.resultUrl, `results/${id}`);
        if (result.bucket !== input.bucket) throw new Error('Cloud processing result came from a different bucket.');
        const download = await fetcher(result.url, { ...privateFetch, signal });
        return await readResult(download, job.maxResultBytes, signal);
      }
      if (status.status !== 'running') throw fail('failed');
      await waitForNextPoll(interval, signal);
    }
  } finally {
    // Use a separate bounded deadline so even a cancelled upload can be cleaned up.
    const finished = await request(`${path}/finish`, 'POST', AbortSignal.timeout(CLEANUP_TIMEOUT_MS)).catch(() => undefined);
    let inputDeleted = false;
    if (finished?.ok) {
      try { inputDeleted = object(await finished.json()).inputDeleted === true; } catch { /* not confirmed */ }
    }
    job.onFinished?.(inputDeleted);
  }
}
