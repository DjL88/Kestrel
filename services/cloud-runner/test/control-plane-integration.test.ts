import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngineCapability } from '../../../src/engine/engineApi.ts';
import { createCloudProcessingAttempt } from '../../../src/providers/cloudProcessingAttempt.ts';
import { MemoryCloudLedger } from '../../control-plane/src/cloudJobs.ts';
import { CloudRunJobTrigger, GcsCloudRunner } from '../../control-plane/src/gcsAdapters.ts';
import { startHarness } from '../../control-plane/test/helpers.ts';
import { runJob } from '../src/run.ts';

test('the engine verifies a result produced by the runner through the control-plane adapters', async (t) => {
  const storage = 'https://storage.googleapis.com';
  const bucket = 'inflight-fixture';
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const jobName = 'projects/demo-kestrel/locations/europe-west2/jobs/kestrel-cloud-runner';
  const ledger = new MemoryCloudLedger();
  const executions: string[] = [];
  const trigger = new CloudRunJobTrigger(jobName, async () => 'fixture-access-token', async (url, init) => {
    assert.equal(String(url), `https://run.googleapis.com/v2/${jobName}:run`);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-access-token');
    const { env } = JSON.parse(String(init?.body)).overrides.containerOverrides[0];
    const variables = new Map<string, string>(env.map(({ name, value }: { name: string; value: string }) => [name, value]));
    const id = variables.get('KCR_JOB_ID');
    assert.ok(id);
    assert.equal(variables.get('KCR_KIND'), 'upscale');
    executions.push(id);
    const ok = await runJob({
      read: async (key) => {
        const value = objects.get(key);
        assert.ok(value);
        return value;
      },
      write: async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); },
    }, id, 'upscale');
    assert.equal(ok, true);
    return new Response('{}');
  });
  const runner = new GcsCloudRunner({
    file: (key) => ({
      getSignedUrl: async () => [`${storage}/${bucket}/${key}?fixture=signature`],
      exists: async () => [objects.has(key)],
      delete: async () => { objects.delete(key); },
    }),
  }, trigger);
  const h = await startHarness(null, undefined, { cloud: { runner, ledger, jobsPerPeriod: 1, maxInputBytes: 100_000 } });
  t.after(() => h.close());
  const fetcher: typeof fetch = async (url, init) => {
    const address = new URL(String(url));
    if (address.origin === h.url) return fetch(url, init);
    assert.equal(address.origin, storage);
    const key = address.pathname.slice(bucket.length + 2);
    if (init?.method === 'PUT') {
      assert.ok(init.body instanceof Blob);
      objects.set(key, new Uint8Array(await init.body.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    const bytes = objects.get(key);
    assert.ok(bytes);
    assert.equal(objects.has(`inputs/${executions[0]}`), false);
    return new Response(bytes);
  };

  const attempt = createCloudProcessingAttempt(
    { baseUrl: h.url, session: h.user.token, fetch: fetcher, pollIntervalMs: 1 },
    { online: true, signedIn: true, userConsent: true },
  );
  const original = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) };
  const result = await runEngineCapability({ capability: 'upscale', original, scale: 2 }, attempt);
  assert.equal(result.runner, 'cloud-processing');
  assert.equal(result.capability, 'upscale');
  assert.equal(result.result.verification.ok, true);
  assert.equal(result.result.usedModel, false);
  assert.equal(executions.length, 1);
  assert.equal(ledger.record(executions[0])?.status, 'finished');
  assert.equal(objects.size, 0);
});
