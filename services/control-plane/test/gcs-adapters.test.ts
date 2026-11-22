import test from 'node:test';
import assert from 'node:assert/strict';
import { GcsCloudRunner, GcsSafeCopyStorage, CloudRunJobTrigger, type GcsBucketLike } from '../src/gcsAdapters.ts';

function fakeBucket() {
  const objects = new Set<string>(); const signed: Array<{ name: string; opts: any }> = []; const deleted: string[] = [];
  const bucket: GcsBucketLike = {
    file: (name) => ({
      async getSignedUrl(opts) { signed.push({ name, opts }); return [`https://storage.example/${name}?sig=1&action=${opts.action}`]; },
      async exists() { return [objects.has(name)] as [boolean]; },
      async delete() { deleted.push(name); objects.delete(name); },
    }),
  };
  return { bucket, objects, signed, deleted };
}

test('safe copy: signed URLs are V4, short-lived and size-bounded; delete removes the object', async () => {
  const f = fakeBucket(); const s = new GcsSafeCopyStorage(f.bucket, () => 1_000_000);
  const up = await s.signUpload('accounts/h/previews/abc', 2_000_000, 'a'.repeat(64));
  assert.match(up, /action=write/);
  const o = f.signed[0]!.opts;
  assert.equal(o.version, 'v4'); assert.equal(o.action, 'write');
  assert.ok(o.expires > 1_000_000 && o.expires <= 1_000_000 + 20 * 60_000, 'expires within 20 minutes');
  assert.equal(o.extensionHeaders['x-goog-content-length-range'], '0,2000000');
  assert.match(await s.signDownload('accounts/h/previews/abc'), /action=read/);
  await s.delete('accounts/h/previews/abc'); assert.deepEqual(f.deleted, ['accounts/h/previews/abc']);
});

test('cloud runner: upload, presence, trigger, poll ready/failed/running, deletes', async () => {
  const f = fakeBucket(); const triggers: any[] = [];
  const r = new GcsCloudRunner(f.bucket, { trigger: async (jobId, kind) => { triggers.push({ jobId, kind }); } }, () => 5_000);
  const up = await r.createUpload('j1', 3_000_000);
  assert.match(up.uploadUrl, /inputs\/j1/); assert.ok(up.expiresAtMs > 5_000);
  assert.equal(f.signed[0]!.opts.extensionHeaders['x-goog-content-length-range'], '0,3000000');
  assert.equal(await r.inputPresent('j1'), false);
  f.objects.add('inputs/j1'); assert.equal(await r.inputPresent('j1'), true);
  await r.start('j1', 'denoise'); assert.deepEqual(triggers, [{ jobId: 'j1', kind: 'denoise' }]);
  assert.deepEqual(await r.poll('j1'), { state: 'running' });
  f.objects.add('results/j1');
  const ready = await r.poll('j1'); assert.equal(ready.state, 'ready'); assert.match((ready as any).resultUrl, /results\/j1.*action=read/);
  f.objects.delete('results/j1'); f.objects.add('failed/j1');
  assert.deepEqual(await r.poll('j1'), { state: 'failed' });
  f.objects.add('results/j1');
  await r.deleteInput('j1'); await r.deleteResult('j1');
  assert.ok(f.deleted.includes('inputs/j1') && f.deleted.includes('results/j1') && f.deleted.includes('failed/j1'));
});

test('Cloud Run Job trigger: authorised POST to the :run endpoint with only the job id and kind as overrides', async () => {
  const calls: any[] = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ name: 'op' }), { status: 200 }); }) as unknown as typeof fetch;
  const t = new CloudRunJobTrigger('projects/proj/locations/europe-west2/jobs/kestrel-cloud-runner', async () => 'tok', fetcher);
  await t.trigger('job-1', 'mask');
  assert.equal(calls[0].url, 'https://run.googleapis.com/v2/projects/proj/locations/europe-west2/jobs/kestrel-cloud-runner:run');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.overrides.containerOverrides[0].env, [{ name: 'KCR_JOB_ID', value: 'job-1' }, { name: 'KCR_KIND', value: 'mask' }]);
  const bad = new CloudRunJobTrigger('projects/proj/locations/loc/jobs/job', async () => 'tok', (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch);
  await assert.rejects(() => bad.trigger('j', 'denoise'), /403/);
  assert.throws(() => new CloudRunJobTrigger('not-a-job-name', async () => 't'), /job name/);
});
