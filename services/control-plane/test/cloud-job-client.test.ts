import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { runCloudJob } from '../../../src/providers/cloudJobTransport.ts';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { startHarness } from './helpers.ts';

const STORAGE = 'https://storage.googleapis.com';
const BUCKET = 'inflight-fixture';
const objectUrl = (kind: 'inputs' | 'results', id: string) => `${STORAGE}/${BUCKET}/${kind}/${id}?fixture=signature`;
const input = new Blob(['synthetic input']);
const job = { kind: 'denoise', input, userConsent: true, maxResultBytes: 64 } as const;

class FixtureRunner extends MemoryCloudRunner {
  jobId = '';
  polls = 0;
  checks = 0;
  uploadUrl?: string;
  resultUrl?: string;

  async createUpload(id: string) {
    await super.createUpload(id);
    this.jobId = id;
    return { uploadUrl: this.uploadUrl ?? objectUrl('inputs', id), expiresAtMs: Date.now() + 60_000 };
  }

  async inputPresent(id: string) {
    this.checks++;
    return this.checks > 1 && super.inputPresent(id);
  }

  async poll(id: string) {
    this.polls++;
    if (this.polls === 2) this.completeJob(id);
    const status = await super.poll(id);
    return status.state === 'ready' ? { state: 'ready' as const, resultUrl: this.resultUrl ?? objectUrl('results', id) } : status;
  }
}

async function setup(t: TestContext) {
  const runner = new FixtureRunner();
  const ledger = new MemoryCloudLedger();
  const server = await startHarness(null, undefined, { cloud: { runner, ledger, jobsPerPeriod: 5, maxInputBytes: 1_024 } });
  t.after(() => server.close());
  const transfers: string[] = [];
  let afterUpload: (() => void) | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    const address = new URL(String(url));
    if (address.origin === server.url) return fetch(url, init);
    assert.equal(address.origin, STORAGE);
    assert.ok(init);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    const headers = new Headers(init.headers);
    assert.equal(headers.has('authorization'), false);
    if (init.method === 'PUT') {
      assert.equal(address.href, objectUrl('inputs', runner.jobId));
      assert.equal(headers.get('x-goog-content-length-range'), `0,${input.size}`);
      assert.equal(await (init.body as Blob).text(), await input.text());
      runner.simulateUpload(runner.jobId);
      transfers.push('upload');
      afterUpload?.();
      return new Response(null, { status: 200 });
    }
    assert.equal(address.href, objectUrl('results', runner.jobId));
    assert.equal(runner.hasInput(runner.jobId), false);
    assert.equal(runner.hasResult(runner.jobId), true);
    transfers.push('download');
    return new Response('fixture result');
  };
  const connection = { baseUrl: server.url, session: server.user.token, fetch: fetcher, pollIntervalMs: 1 };
  return { server, runner, ledger, transfers, connection, onUpload: (callback: () => void) => { afterUpload = callback; } };
}

test('the client uses the real job API and removes temporary objects after collecting a result', async (t) => {
  const { runner, ledger, transfers, connection } = await setup(t);
  assert.equal(await (await runCloudJob(connection, job)).text(), 'fixture result');
  assert.deepEqual(transfers, ['upload', 'download']);
  assert.equal(runner.checks, 2, 'retry once when the uploaded file is not yet visible');
  assert.equal(runner.starts, 1);
  assert.equal(runner.polls, 2);
  assert.equal(runner.hasResult(runner.jobId), false);
  assert.equal(ledger.record(runner.jobId)?.status, 'finished');
});

test('a switched-off cloud or an invalid session sends no bytes to storage', async (t) => {
  const { server, runner, transfers, connection } = await setup(t);
  await assert.rejects(runCloudJob(connection, { ...job, userConsent: false }), /approval/);
  await assert.rejects(runCloudJob({ ...connection, session: 'expired' }, job), /401/);
  await server.app.store.setSetting('cloud_disabled', '1');
  await assert.rejects(runCloudJob(connection, job), /503/);
  assert.equal(runner.uploadsCreated, 0);
  assert.deepEqual(transfers, []);
});

test('a cancelled transfer still requests cleanup and never starts a runner', async (t) => {
  const { runner, ledger, transfers, connection, onUpload } = await setup(t);
  const abort = new AbortController();
  onUpload(() => abort.abort());
  await assert.rejects(runCloudJob(connection, { ...job, signal: abort.signal }), { name: 'AbortError' });
  assert.deepEqual(transfers, ['upload']);
  assert.equal(runner.starts, 0);
  assert.equal(runner.hasInput(runner.jobId), false);
  assert.equal(ledger.record(runner.jobId)?.status, 'finished');
});

test('the client refuses foreign storage and still finishes the job', async (t) => {
  const { ledger, runner, transfers, connection } = await setup(t);
  runner.uploadUrl = 'https://example.test/inputs/another-job?fixture=signature';
  await assert.rejects(runCloudJob(connection, job), /invalid cloud storage link/i);
  assert.deepEqual(transfers, []);
  assert.equal(ledger.record(runner.jobId)?.status, 'finished');
});

test('a result larger than its capability limit is discarded and removed from storage', async (t) => {
  const { ledger, runner, transfers, connection } = await setup(t);
  await assert.rejects(runCloudJob(connection, { ...job, maxResultBytes: 5 }), /size limit/);
  assert.deepEqual(transfers, ['upload', 'download']);
  assert.equal(runner.hasResult(runner.jobId), false);
  assert.equal(ledger.record(runner.jobId)?.status, 'finished');
});
