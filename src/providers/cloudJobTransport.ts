import { parseControlPlaneUrl } from '../core/licenceOnline';

const JOBS_PATH = '/v1/cloud/jobs';
const CLEANUP_TIMEOUT_MS = 5_000;
const MAX_JOB_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const privateFetch = { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' } as const;

interface CloudJob {
  kind: 'denoise' | 'upscale' | 'mask';
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
  if (!response.ok || !response.body) throw new Error('Cloud processing result could not be downloaded.');
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

/** Transfer one explicitly approved job. The engine must verify its result before applying it. */
export async function runCloudJob(connection: CloudJobConnection, job: CloudJob): Promise<Blob> {
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
    kind: job.kind, inputBytes: job.input.size, userConsent: true,
  }));
  if (!created.ok) throw new Error(`Cloud processing could not start (${created.status}).`);
  const upload = object(await created.json());
  const id = upload.jobId;
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error('Invalid cloud processing job.');
  const path = `${JOBS_PATH}/${id}`;
  try {
    const input = storageObject(upload.uploadUrl, `inputs/${id}`);
    const uploaded = await fetcher(input.url, {
      ...privateFetch,
      method: 'PUT',
      headers: { 'x-goog-content-length-range': `0,${job.input.size}` },
      body: job.input,
      signal,
    });
    if (!uploaded.ok) throw new Error('Cloud processing upload failed.');
    let start = await request(`${path}/start`, 'POST', signal);
    if (start.status === 409 && (await start.json())?.error?.code === 'CLOUD_INPUT_MISSING') {
      await waitForNextPoll(interval, signal);
      start = await request(`${path}/start`, 'POST', signal);
    }
    if (!start.ok) throw new Error('Cloud processing did not start.');
    for (;;) {
      const response = await request(path, 'GET', signal);
      if (!response.ok) throw new Error('Cloud processing status is unavailable.');
      const status = object(await response.json());
      if (status.jobId !== id || status.kind !== job.kind) throw new Error('Cloud processing returned a different job.');
      if (status.status === 'ready') {
        const result = storageObject(status.resultUrl, `results/${id}`);
        if (result.bucket !== input.bucket) throw new Error('Cloud processing result came from a different bucket.');
        const download = await fetcher(result.url, { ...privateFetch, signal });
        return await readResult(download, job.maxResultBytes, signal);
      }
      if (status.status !== 'running') throw new Error('Cloud processing failed.');
      await waitForNextPoll(interval, signal);
    }
  } finally {
    // Use a separate bounded deadline so even a cancelled upload can be cleaned up.
    await request(`${path}/finish`, 'POST', AbortSignal.timeout(CLEANUP_TIMEOUT_MS)).catch(() => undefined);
  }
}
