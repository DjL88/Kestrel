import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';
import { Kite44ResearchLedger } from '../src/kite44ResearchLedger.ts';
import {
  APPROVED_MONTHLY_PENCE, DEFAULT_CONFIG, EMPTY_STATE, VertexLearningLedger, VertexRest, checkConfig, configFromEnv, decide, reservationPence, tick,
  type RunRecord, type VertexClient,
} from '../src/vertexLearning.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 25, 12);
const cfg = DEFAULT_CONFIG;

test('defaults: 1,000 photos, the £20 approval, a 2-hour e2-standard-4 run in London reserving 34p', () => {
  assert.equal(cfg.photoThreshold, 1000);
  assert.equal(cfg.ceilingPence, 2000);
  assert.equal(APPROVED_MONTHLY_PENCE, 2000);
  assert.equal(cfg.region, 'europe-west2');
  assert.equal(reservationPence(cfg), 34);
  assert.throws(() => checkConfig({ ...cfg, ceilingPence: 2001 }), /ceilingPence/, 'the ceiling cannot be set above the owner approval');
  assert.equal(configFromEnv({ KCP_VERTEX_PHOTO_THRESHOLD: '250' }).photoThreshold, 250, 'the photo count is one setting');
  assert.throws(() => configFromEnv({ KCP_VERTEX_CEILING_PENCE: '5000' }));
});

test('decide: whichever trigger comes first, never with nothing new, never past the ceiling', () => {
  const s = (over: Partial<typeof EMPTY_STATE>) => ({ ...EMPTY_STATE, lastRunAtMs: T0, lastWeeklyAtMs: T0, ...over });
  assert.deepEqual(decide(s({ newPhotos: 999 }), T0 + HOUR, 0, cfg), { run: false, reason: 'nothing-due' });
  assert.deepEqual(decide(s({ newPhotos: 1000 }), T0 + HOUR, 0, cfg), { run: true, trigger: 'count', reservePence: 34 });
  assert.deepEqual(decide(s({ newPhotos: 3 }), T0 + 7 * DAY, 0, cfg), { run: true, trigger: 'weekly', reservePence: 34 });
  assert.deepEqual(decide(s({ newPhotos: 0 }), T0 + 7 * DAY, 0, cfg), { run: false, reason: 'nothing-new', trigger: 'weekly', weeklyChecked: true });
  assert.deepEqual(decide(s({ newPhotos: 1, manualRequestedAtMs: T0 }), T0 + HOUR, 0, cfg), { run: true, trigger: 'manual', reservePence: 34 });
  assert.equal((decide(s({ newPhotos: 0, manualRequestedAtMs: T0 }), T0 + HOUR, 0, cfg) as { reason: string }).reason, 'nothing-new');
  assert.deepEqual(decide(s({ newPhotos: 5000 }), T0 + HOUR, 1966, cfg), { run: true, trigger: 'count', reservePence: 34 }, '1966 + 34 = 2000 is allowed');
  assert.deepEqual(decide(s({ newPhotos: 5000 }), T0 + HOUR, 1967, cfg), { run: false, reason: 'ceiling', trigger: 'count' });
  assert.equal((decide(s({ newPhotos: 5000, manualRequestedAtMs: T0 }), T0 + HOUR, 1990, cfg) as { reason: string }).reason, 'ceiling', 'Learn now obeys the ceiling too');
  const running = s({ newPhotos: 5000, runningRunId: 'r', runningSinceMs: T0 });
  assert.equal((decide(running, T0 + 2 * HOUR, 0, cfg) as { reason: string }).reason, 'run-in-progress');
  assert.equal(decide(running, T0 + 3 * HOUR, 0, cfg).run, true, 'after the time limit and grace, Vertex has stopped it');
});

function fakeVertex(over: Partial<VertexClient> = {}) {
  const created: RunRecord[] = [];
  const states = new Map<string, 'running' | 'succeeded' | 'failed'>();
  const v: VertexClient & { created: RunRecord[]; states: typeof states } = {
    created, states,
    hasDeployedEndpoint: async () => false,
    createCustomJob: async (run) => { created.push(run); const n = `projects/1/locations/europe-west2/customJobs/${created.length}`; states.set(n, 'running'); return n; },
    jobState: async (n) => states.get(n) ?? 'running',
    ...over,
  };
  return v;
}

async function count(db: MemoryFirestore, ledger: VertexLearningLedger, photos: string[]) {
  for (const p of photos) await db.runTransaction(async (tx) => { (await ledger.prepareCount(tx, p)).commit(); });
}

function rig(vertex?: VertexClient, on = true) {
  const db = new MemoryFirestore();
  const ledger = new VertexLearningLedger(db);
  const clock = { now: T0 };
  const deps = { ledger, config: cfg, vertex, switchedOn: async () => on, now: () => clock.now };
  return { db, ledger, clock, deps };
}

test('each edited photo counts once per run, and 1,000 start a run that reserves its worst case first', async () => {
  const vertex = fakeVertex();
  const { db, ledger, deps } = rig(vertex);
  await count(db, ledger, ['a', 'a', 'b']);
  assert.equal((await ledger.state()).newPhotos, 2);
  assert.deepEqual(await tick(deps), { skipped: 'nothing-due' });
  await count(db, ledger, Array.from({ length: 998 }, (_, i) => `p${i}`));
  const r = await tick(deps);
  assert.ok('started' in r);
  assert.equal(r.started.trigger, 'count'); assert.equal(r.started.newPhotos, 1000); assert.equal(r.started.reservedPence, 34);
  assert.equal(await ledger.monthReservedPence('2026-11'), 34);
  const s = await ledger.state();
  assert.equal(s.newPhotos, 0); assert.equal(s.generation, 1);
  await count(db, ledger, ['a']);
  assert.equal((await ledger.state()).newPhotos, 1, 'a photo edited again after a run is new for the next one');
});

test('gates come before any reservation: switched off, no trainer, a deployed endpoint', async () => {
  for (const [vertex, on, reason] of [
    [fakeVertex(), false, 'switched-off'], [undefined, true, 'trainer-not-set-up'], [fakeVertex({ hasDeployedEndpoint: async () => true }), true, 'endpoint-deployed'],
  ] as const) {
    const { db, ledger, deps } = rig(vertex, on);
    await count(db, ledger, Array.from({ length: 1000 }, (_, i) => `p${i}`));
    assert.deepEqual(await tick(deps), { skipped: reason });
    assert.equal(await ledger.monthReservedPence('2026-11'), 0, `${reason}: nothing reserved`);
    assert.equal((await ledger.state()).newPhotos, 1000, `${reason}: photos still waiting`);
  }
});

test('the month stops at the £20 ceiling however runs are asked for; the next month starts again', async () => {
  const vertex = fakeVertex();
  const { db, ledger, clock, deps } = rig(vertex);
  let started = 0;
  for (let i = 0; i < 70; i++) {
    await count(db, ledger, [`x${i}`]);
    await ledger.requestManualRun(clock.now);
    const r = await tick(deps);
    if ('started' in r) { started++; vertex.states.set(r.started.customJob!, 'succeeded'); await tick(deps); }
    else assert.deepEqual(r, { skipped: 'ceiling' });
    clock.now += HOUR;
  }
  assert.equal(started, 58, '58 × 34p = £19.72; the 59th would pass £20');
  assert.ok(await ledger.monthReservedPence('2026-11') <= 2000);
  clock.now = Date.UTC(2026, 11, 1, 1);
  await ledger.requestManualRun(clock.now);
  assert.ok('started' in (await tick(deps)), 'December has its own £20');
});

test('the weekly trigger skips an empty week and runs when something is new', async () => {
  const vertex = fakeVertex();
  const { db, ledger, clock, deps } = rig(vertex);
  assert.deepEqual(await tick(deps), { skipped: 'nothing-due' }, 'the first tick starts the weekly clock');
  clock.now = T0 + 8 * DAY;
  assert.deepEqual(await tick(deps), { skipped: 'nothing-new' });
  clock.now += 3 * DAY;
  await count(db, ledger, ['one']);
  assert.deepEqual(await tick(deps), { skipped: 'nothing-due' }, 'the empty week reset the weekly clock');
  clock.now += 4 * DAY;
  const r = await tick(deps);
  assert.ok('started' in r); assert.equal(r.started.trigger, 'weekly');
});

test('a job Vertex never accepted releases its reservation and its photos; a finished job is recorded', async () => {
  const vertex = fakeVertex({ createCustomJob: async () => { throw new Error('Vertex POST /customJobs 400'); } });
  const { db, ledger, deps } = rig(vertex);
  await count(db, ledger, Array.from({ length: 1000 }, (_, i) => `p${i}`));
  await assert.rejects(tick(deps), /400/);
  assert.equal(await ledger.monthReservedPence('2026-11'), 0);
  const s = await ledger.state();
  assert.equal(s.newPhotos, 1000); assert.equal(s.runningRunId, null);
  assert.equal((await ledger.recentRuns())[0].status, 'not-started');

  const ok = fakeVertex();
  const r2 = rig(ok);
  await count(r2.db, r2.ledger, Array.from({ length: 1000 }, (_, i) => `p${i}`));
  const started = await tick(r2.deps);
  assert.ok('started' in started);
  assert.deepEqual(await tick(r2.deps), { skipped: 'run-in-progress' });
  ok.states.set(started.started.customJob!, 'failed');
  assert.deepEqual(await tick(r2.deps), { finished: started.started.runId, ok: false });
  assert.equal(await r2.ledger.monthReservedPence('2026-11'), 34, 'a run that started keeps its full reservation');
});

test('Vertex REST: a London batch CustomJob with a hard time limit; only endpoints are listed, never created or used', async () => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.includes('/endpoints') ? { endpoints: [{ name: 'e1', deployedModels: [] }] }
      : init?.method === 'POST' ? { name: 'projects/1/locations/europe-west2/customJobs/9' } : { state: 'JOB_STATE_SUCCEEDED' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const v = new VertexRest({ project: 'kestrel-hosting', config: cfg, trainerImage: 'europe-west2-docker.pkg.dev/kestrel-hosting/kestrel/trainer:1', serviceAccount: 'trainer@kestrel-hosting.iam.gserviceaccount.com', token: async () => 't', fetcher });
  assert.equal(await v.hasDeployedEndpoint(), false);
  const run = { runId: 'r1', month: '2026-11', trigger: 'count', reservedPence: 34, newPhotos: 1000, generation: 3, status: 'reserved', startedAtMs: T0 } as RunRecord;
  assert.equal(await v.createCustomJob(run), 'projects/1/locations/europe-west2/customJobs/9');
  assert.equal(await v.jobState('projects/1/locations/europe-west2/customJobs/9'), 'succeeded');
  for (const c of calls) assert.ok(c.url.startsWith('https://europe-west2-aiplatform.googleapis.com/v1/projects/kestrel-hosting/locations/europe-west2/'), c.url);
  const posts = calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(posts.map((c) => c.url.split('/locations/europe-west2')[1]), ['/customJobs']);
  const spec = posts[0].body.jobSpec;
  assert.equal(spec.scheduling.timeout, '7200s');
  assert.equal(spec.workerPoolSpecs[0].machineSpec.machineType, 'e2-standard-4');
  assert.equal(spec.workerPoolSpecs[0].machineSpec.acceleratorType, undefined, 'CPU only');
  assert.ok(!calls.some((c) => /deployModel|:predict|endpoints\/[^?]/.test(c.url)));
  const deployed = new VertexRest({ project: 'kestrel-hosting', config: cfg, trainerImage: 'europe-west2-docker.pkg.dev/kestrel-hosting/kestrel/trainer:1', serviceAccount: 's', token: async () => 't',
    fetcher: (async () => new Response(JSON.stringify({ endpoints: [{ deployedModels: [{ id: 'm' }] }] }))) as typeof fetch });
  assert.equal(await deployed.hasDeployedEndpoint(), true);
});

test('shadow files count their photo once, inside the same consented write', async () => {
  const db = new MemoryFirestore();
  const learning = new VertexLearningLedger(db);
  const shadows = new Kite44ResearchLedger(db, 'test-secret-32-characters-minimum-123', learning);
  const record = { schemaVersion: 1 as const, kind: 'edit' as const, modelFamily: 'Kite44' as const, modelVersion: '0.1.0', outcome: 'modified' as const, metrics: { eyeSharpness: 0.8 }, adjustments: { exposure: 0.3 } };
  assert.equal(await shadows.appendShadow('u', 'wild', 'bird', record), false);
  assert.equal((await learning.state()).newPhotos, 0, 'no consent, no count');
  await db.collection('learning_consent').doc('u').set({ consent: true });
  await shadows.setProjectSharing('u', 'wild', true);
  assert.equal(await shadows.appendShadow('u', 'wild', 'bird', record), true);
  assert.equal(await shadows.appendShadow('u', 'wild', 'bird', { ...record, kind: 'mask' as const }), true);
  assert.equal(await shadows.appendShadow('u', 'wild', 'owl', record), true);
  assert.equal((await learning.state()).newPhotos, 2);
});

test('admin: status and Learn now, switch first, the ceiling still applies, audited', async () => {
  const bare = await startHarness(undefined, undefined, { requireAdminSwitch: true });
  try {
    assert.equal((await bare.call('GET', '/v1/admin/learning', { token: bare.adminToken })).status, 503);
    const sw = (await bare.call('GET', '/v1/admin/switches', { token: bare.adminToken })).body.switches.find((s: any) => s.key === 'vertex-learning');
    assert.equal(sw.configured, false, 'not set up until the job exists');
  } finally { await bare.close(); }
  const db = new MemoryFirestore();
  const ledger = new VertexLearningLedger(db);
  let started = 0;
  const h = await startHarness(undefined, undefined, { requireAdminSwitch: true, vertexLearning: { ledger, config: cfg, startJob: async () => { started++; } } });
  try {
    assert.equal((await h.call('POST', '/v1/admin/learning/run', { token: h.user.token })).status, 403);
    const off = await h.call('POST', '/v1/admin/learning/run', { token: h.adminToken });
    assert.equal(off.status, 409); assert.equal(off.body.error.code, 'LEARNING_SWITCHED_OFF');
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'vertex-learning', on: true } })).status, 200);
    const r = await h.call('POST', '/v1/admin/learning/run', { token: h.adminToken });
    assert.equal(r.status, 200); assert.equal(r.body.startedNow, true); assert.equal(started, 1);
    const status = (await h.call('GET', '/v1/admin/learning', { token: h.adminToken })).body;
    assert.equal(status.on, true); assert.equal(status.manualRequested, true);
    assert.equal(status.ceilingPence, 2000); assert.equal(status.runReservePence, 34); assert.equal(status.photoThreshold, 1000);
    assert.ok(JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body).includes('learning.run'));
  } finally { await h.close(); }
});
