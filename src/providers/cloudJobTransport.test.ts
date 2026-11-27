import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudJobError } from '../core/cloudJobProblem.ts';
import { runCloudJob } from './cloudJobTransport.ts';

const base = 'https://api.inflight.studio';
const job = { kind: 'recipe' as const, inputKind: 'smart-preview' as const, input: new Blob([new Uint8Array(10)]), userConsent: true, maxResultBytes: 1000 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a refused start shows the control plane\'s reason in plain words, with a top-up when that would help', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL) => {
    calls.push(String(url));
    return json(429, { error: { code: 'CLOUD_QUOTA_EXHAUSTED', message: 'server words' } });
  }) as typeof fetch;
  await assert.rejects(runCloudJob({ baseUrl: base, session: 's', fetch: fetcher }, job), (error: unknown) => {
    assert.ok(error instanceof CloudJobError);
    assert.equal(error.problem.topUp, true);
    assert.doesNotMatch(error.message, /429|CLOUD_/);
    return true;
  });
  assert.equal(calls.length, 1, 'nothing is uploaded when the start is refused');
});

test('a failed run, a lost network and a switched-off server each say what happened, never a status number', async () => {
  const id = 'job-1';
  const upload = `https://storage.googleapis.com/kestrel-cloud/inputs/${id}?X-Goog-Signature=x`;
  let finished = 0;
  const failing = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/v1/cloud/jobs') && init?.method === 'POST') return json(200, { jobId: id, uploadUrl: upload, expiresAtMs: 0 });
    if (u.startsWith('https://storage.googleapis.com/')) return new Response(null, { status: 200 });
    if (u.endsWith('/start')) return json(200, { jobId: id, status: 'running' });
    if (u.endsWith('/finish')) { finished++; return json(200, { jobId: id, inputDeleted: true }); }
    return json(200, { jobId: id, status: 'failed', kind: 'recipe', failure: 'CLOUD_JOB_FAILED' });
  }) as typeof fetch;
  await assert.rejects(runCloudJob({ baseUrl: base, session: 's', fetch: failing, pollIntervalMs: 1 }, job), /could not finish this photo\. You were not charged/);
  assert.equal(finished, 1, 'the cloud copy is deleted even when the job fails');

  const offline = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  await assert.rejects(runCloudJob({ baseUrl: base, session: 's', fetch: offline }, job), /could not reach its cloud/);

  const off = (async () => json(503, { error: { code: 'CLOUD_RECIPE_DISABLED' } })) as typeof fetch;
  await assert.rejects(runCloudJob({ baseUrl: base, session: 's', fetch: off }, job), /switched off for now\. Nothing was sent/);
});

test('a cancel by the person stays a cancel', async () => {
  const controller = new AbortController();
  const fetcher = (async (_url: string | URL, init?: RequestInit) => {
    controller.abort();
    init?.signal?.throwIfAborted();
    return json(200, {});
  }) as typeof fetch;
  await assert.rejects(runCloudJob({ baseUrl: base, session: 's', fetch: fetcher }, { ...job, signal: controller.signal }), (error: unknown) => !(error instanceof CloudJobError));
});
