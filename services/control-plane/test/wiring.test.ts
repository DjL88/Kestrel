import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOptionalServices } from '../src/wiring.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import type { GcsBucketLike } from '../src/gcsAdapters.ts';

const bucket: GcsBucketLike = { file: () => ({ getSignedUrl: async () => ['https://x'], exists: async () => [false], delete: async () => undefined }) };
const deps = (env: Record<string, string>, withDb = true) => ({ firestore: withDb ? new MemoryFirestore() : undefined, env, openBucket: async () => bucket, token: async () => 't' });
const JOB = 'projects/proj/locations/europe-west2/jobs/kestrel-cloud-runner';

test('nothing optional is on unless its environment variable is set; the spend guard is on with Firestore', async () => {
  const s = await buildOptionalServices(deps({}));
  assert.equal(s.cloud, undefined); assert.equal(s.safeCopy, undefined); assert.equal(s.learning, undefined);
  assert.equal(s.spend?.ceilingPence, 1500, 'default metered ceiling is £15, under the approved £20');
  assert.deepEqual(s.enabled, ['spend-guard']);
});

test('without Firestore (SQLite, development) nothing is wired, even if the environment asks', async () => {
  const s = await buildOptionalServices(deps({ KCP_CLOUD_PROCESSING_BUCKET: 'b', KCP_CLOUD_RUNNER_JOB: JOB, KCP_SAFE_COPY_BUCKET: 's', KCP_LEARNING_ENABLED: '1' }, false));
  assert.deepEqual(s, { enabled: [] });
});

test('cloud processing needs both the bucket and the runner job; safe copy and learning each need their own switch', async () => {
  assert.equal((await buildOptionalServices(deps({ KCP_CLOUD_PROCESSING_BUCKET: 'b' }))).cloud, undefined, 'no runner job, no cloud');
  assert.equal((await buildOptionalServices(deps({ KCP_CLOUD_RUNNER_JOB: JOB }))).cloud, undefined, 'no bucket, no cloud');
  const all = await buildOptionalServices(deps({ KCP_CLOUD_PROCESSING_BUCKET: 'b', KCP_CLOUD_RUNNER_JOB: JOB, KCP_SAFE_COPY_BUCKET: 's', KCP_LEARNING_ENABLED: '1', KCP_MONTHLY_SPEND_CEILING_PENCE: '2000', KCP_CLOUD_JOBS_PER_PERIOD: '7', KCP_SAFE_COPY_BYTES_QUOTA: '123456' }));
  assert.ok(all.cloud && all.safeCopy && all.learning);
  assert.equal(all.cloud!.jobsPerPeriod, 7); assert.equal(all.safeCopy!.bytesQuota, 123456); assert.equal(all.spend!.ceilingPence, 2000);
  assert.deepEqual(all.enabled.sort(), ['cloud-processing', 'learning-signal', 'safe-copy', 'spend-guard']);
});

test('bad numbers or a bad job name stop start-up instead of being ignored', async () => {
  await assert.rejects(() => buildOptionalServices(deps({ KCP_MONTHLY_SPEND_CEILING_PENCE: 'lots' })), /KCP_MONTHLY_SPEND_CEILING_PENCE/);
  await assert.rejects(() => buildOptionalServices(deps({ KCP_MONTHLY_SPEND_CEILING_PENCE: '-5' })), /KCP_MONTHLY_SPEND_CEILING_PENCE/);
  await assert.rejects(() => buildOptionalServices(deps({ KCP_CLOUD_PROCESSING_BUCKET: 'b', KCP_CLOUD_RUNNER_JOB: 'nope' })), /job name/);
});
