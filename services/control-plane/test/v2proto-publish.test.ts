/**
 * Publish to V2Proto (v2protoPublish.ts, POST /v1/admin/v2proto/publish): owner only, a commit on main with a green `check`,
 * V2Proto's own Cloud Build trigger and nothing else, every attempt audited. Fakes stand in for GitHub and Cloud Build: no
 * real build is started here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudBuildHost, ciFromRuns, githubSource, V2PROTO_TRIGGER_PATTERN, type BuildHost, type CiState, type CommitSource } from '../src/v2protoPublish.ts';
import { startHarness } from './helpers.ts';

const SHA = (n: number) => String(n).repeat(40).slice(0, 40);
const GREEN = SHA(1), RED = SHA(2), PENDING = SHA(3), OFF_MAIN = SHA(4), OLDER_GREEN = SHA(5);

function fakes() {
  const ci: Record<string, CiState> = { [GREEN]: 'green', [RED]: 'red', [PENDING]: 'pending', [OLDER_GREEN]: 'green' };
  const onMain = new Set([GREEN, RED, PENDING, OLDER_GREEN]);
  const started: string[] = [];
  let buildState: 'queued' | 'building' | 'done' | 'failed' = 'queued';
  const source: CommitSource = {
    recentMain: async () => [GREEN, RED, OLDER_GREEN].map((sha) => ({ sha, message: 'A change', committedAtMs: 1, ci: ci[sha] })),
    onMain: async (sha) => (onMain.has(sha) ? { message: 'A change', committedAtMs: 1 } : null),
    ci: async (sha) => ci[sha] ?? 'unknown',
  };
  const builds: BuildHost = {
    start: async (sha) => { started.push(sha); return { buildId: `0000000${started.length}-aaaa-bbbb-cccc-dddddddddddd` }; },
    status: async () => ({ state: buildState, reason: buildState === 'failed' ? 'The build ran but a step failed. The Cloud Build log says which.' : undefined }),
  };
  return { source, builds, started, setBuild: (s: typeof buildState) => { buildState = s; } };
}

const publish = (h: Awaited<ReturnType<typeof startHarness>>, token: string, sha: string, confirmedSha = sha) =>
  h.call('POST', '/v1/admin/v2proto/publish', { token, body: { sha, confirmedSha } });

test('a green commit on main starts exactly one V2Proto build and is audited', async () => {
  const f = fakes();
  const h = await startHarness(undefined, undefined, { appDeps: { v2protoPublish: { source: f.source, builds: f.builds } } });
  try {
    const r = await publish(h, h.adminToken, GREEN);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(f.started, [GREEN]);
    assert.equal(r.body.last.state, 'queued');
    const log = (await h.app.store.listAudit(100)).filter((e) => e.action === 'v2proto.publish');
    assert.equal(log.length, 1);
    assert.equal(log[0].outcome, 'allowed');
    assert.match(log[0].detail, new RegExp(GREEN));
  } finally { await h.close(); }
});

test('a rollback to an earlier green main commit is allowed', async () => {
  const f = fakes();
  const h = await startHarness(undefined, undefined, { appDeps: { v2protoPublish: { source: f.source, builds: f.builds } } });
  try {
    assert.equal((await publish(h, h.adminToken, OLDER_GREEN)).status, 200);
    assert.deepEqual(f.started, [OLDER_GREEN]);
  } finally { await h.close(); }
});

test('refused, and never started: not on main, red or pending checks, unknown commit, bad or unconfirmed id', async () => {
  const f = fakes();
  const h = await startHarness(undefined, undefined, { appDeps: { v2protoPublish: { source: f.source, builds: f.builds } } });
  try {
    const cases: [string, string, number, string][] = [
      [OFF_MAIN, OFF_MAIN, 409, 'V2PROTO_NOT_ON_MAIN'],
      [RED, RED, 409, 'V2PROTO_CI_NOT_GREEN'],
      [PENDING, PENDING, 409, 'V2PROTO_CI_NOT_GREEN'],
      [GREEN, OLDER_GREEN, 400, 'V2PROTO_NOT_CONFIRMED'],
    ];
    for (const [sha, confirmed, status, code] of cases) {
      const r = await publish(h, h.adminToken, sha, confirmed);
      assert.equal(r.status, status, code);
      assert.equal(r.body.error.code, code);
    }
    assert.equal((await publish(h, h.adminToken, 'main')).status, 400, 'a branch name is not a commit');
    assert.equal((await publish(h, h.adminToken, 'abc123')).status, 400, 'a short id is not a commit');
    assert.deepEqual(f.started, []);
    const denied = (await h.app.store.listAudit(100)).filter((e) => e.action === 'v2proto.publish' && e.outcome === 'denied');
    assert.ok(denied.length >= 4, 'refusals are audited too');
  } finally { await h.close(); }
});

test('only the owner: a signed-in non-admin and an anonymous caller are refused and nothing starts', async () => {
  const f = fakes();
  const h = await startHarness(undefined, undefined, { appDeps: { v2protoPublish: { source: f.source, builds: f.builds } } });
  try {
    assert.equal((await publish(h, h.user.token, GREEN)).status, 403);
    assert.equal((await h.call('POST', '/v1/admin/v2proto/publish', { body: { sha: GREEN, confirmedSha: GREEN } })).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/v2proto', { token: h.user.token })).status, 403);
    assert.deepEqual(f.started, []);
  } finally { await h.close(); }
});

test('a second publish waits while a build is running, and shows the build state afterwards', async () => {
  const f = fakes();
  const h = await startHarness(undefined, undefined, { appDeps: { v2protoPublish: { source: f.source, builds: f.builds } } });
  try {
    assert.equal((await publish(h, h.adminToken, GREEN)).status, 200);
    const busy = await publish(h, h.adminToken, OLDER_GREEN);
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, 'V2PROTO_BUSY');
    f.setBuild('failed');
    const view = await h.call('GET', '/v1/admin/v2proto', { token: h.adminToken });
    assert.equal(view.status, 200);
    assert.equal(view.body.latestGreenSha, GREEN);
    assert.equal(view.body.last.state, 'failed');
    assert.match(view.body.last.reason, /step failed/);
    f.setBuild('done');
    assert.equal((await publish(h, h.adminToken, OLDER_GREEN)).status, 200, 'a finished build no longer blocks');
  } finally { await h.close(); }
});

test('not set up: the page gets a plain answer, a publish gets 503, the old automatic update is untouched', async () => {
  const h = await startHarness();
  try {
    const r = await h.call('GET', '/v1/admin/v2proto', { token: h.adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, false);
    assert.equal((await publish(h, h.adminToken, GREEN)).status, 503);
  } finally { await h.close(); }
});

test('the Cloud Build host can only be aimed at a V2Proto trigger, and posts only that trigger and the commit', async () => {
  for (const bad of ['inflight-website', 'control-plane-deploy', 'inflight-v2proto', '../inflight-v2proto-x', 'inflight-v2proto-X']) {
    assert.throws(() => cloudBuildHost({ project: 'kestrel-hosting', triggerId: bad }, async () => 't'), /inflight-v2proto-/, bad);
  }
  assert.ok(V2PROTO_TRIGGER_PATTERN.test('inflight-v2proto-publish'));
  const calls: { url: string; body: string; auth: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body ?? ''), auth: String((init.headers as Record<string, string>).authorization) });
    return new Response(JSON.stringify({ metadata: { build: { id: '12345678-aaaa-bbbb-cccc-dddddddddddd' } } }), { status: 200 });
  }) as unknown as typeof fetch;
  const host = cloudBuildHost({ project: 'kestrel-hosting', triggerId: 'inflight-v2proto-publish' }, async () => 'tok', fetcher);
  assert.deepEqual(await host.start(GREEN), { buildId: '12345678-aaaa-bbbb-cccc-dddddddddddd' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cloudbuild.googleapis.com/v1/projects/kestrel-hosting/locations/global/triggers/inflight-v2proto-publish:run');
  assert.deepEqual(JSON.parse(calls[0].body), { source: { branchName: 'main', commitSha: GREEN } });
});

test('Cloud Build states become calm words, and a failed start publishes nothing', async () => {
  const states: Record<string, string> = { QUEUED: 'queued', WORKING: 'building', SUCCESS: 'done', FAILURE: 'failed', TIMEOUT: 'failed', WHATEVER: 'unknown' };
  for (const [cb, ours] of Object.entries(states)) {
    const host = cloudBuildHost({ project: 'kestrel-hosting', triggerId: 'inflight-v2proto-publish' }, async () => 't',
      (async () => new Response(JSON.stringify({ status: cb, logUrl: 'https://console.cloud.google.com/cloud-build/builds/x' }), { status: 200 })) as unknown as typeof fetch);
    const s = await host.status('12345678-aaaa-bbbb-cccc-dddddddddddd');
    assert.equal(s.state, ours, cb);
    if (ours === 'failed') assert.ok(s.reason && s.reason.length > 10);
  }
  const f = fakes();
  const h = await startHarness(undefined, undefined, { appDeps: { v2protoPublish: { source: f.source, builds: { ...f.builds, start: async () => { throw new Error('403 secret detail'); } } } } });
  try {
    const r = await publish(h, h.adminToken, GREEN);
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.body), /secret detail/);
    assert.equal((await h.call('GET', '/v1/admin/v2proto', { token: h.adminToken })).body.last, null);
  } finally { await h.close(); }
});

test('GitHub: the check is green only when the latest run named check succeeded; main membership comes from compare', async () => {
  assert.equal(ciFromRuns([]), 'unknown');
  assert.equal(ciFromRuns([{ name: 'check', status: 'in_progress', conclusion: null }]), 'pending');
  assert.equal(ciFromRuns([{ name: 'check', status: 'completed', conclusion: 'failure', started_at: '2026-11-28T10:00:00Z' }]), 'red');
  assert.equal(ciFromRuns([{ name: 'check', status: 'completed', conclusion: 'failure', started_at: '2026-11-28T10:00:00Z' }, { name: 'check', status: 'completed', conclusion: 'success', started_at: '2026-11-28T11:00:00Z' }]), 'green');
  assert.equal(ciFromRuns([{ name: 'lint', status: 'completed', conclusion: 'success' }]), 'unknown', 'another job does not count');
  const seen: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push(url);
    assert.match(String((init.headers as Record<string, string>).authorization), /^Bearer ghp-test$/);
    if (url.includes('/compare/')) return new Response(JSON.stringify({ status: url.includes(OFF_MAIN) ? 'diverged' : 'ahead', base_commit: { commit: { message: 'Hello\n\nbody', committer: { date: '2026-11-28T10:00:00Z' } } } }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const src = githubSource('DjL88/Kestrel', async () => 'ghp-test', fetcher);
  assert.deepEqual(await src.onMain(GREEN), { message: 'Hello', committedAtMs: Date.parse('2026-11-28T10:00:00Z') });
  assert.equal(await src.onMain(OFF_MAIN), null);
  assert.equal(await src.ci(GREEN), 'unknown', 'an unreadable check is never green');
  assert.ok(seen.every((u) => u.startsWith('https://api.github.com/repos/DjL88/Kestrel/')));
  assert.throws(() => githubSource('not a repo', async () => 'x'), /owner\/name/);
});
