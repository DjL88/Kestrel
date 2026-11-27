import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TECHNICAL_OVERVIEW_PATH } from '../src/routesAdmin.ts';
import { startHarness } from './helpers.ts';

test('an admin reads the technical overview from the repository, and the read is audited', async () => {
  const h = await startHarness();
  try {
    const res = await h.call('GET', '/v1/admin/technical-overview', { token: h.adminToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.markdown, readFileSync(TECHNICAL_OVERVIEW_PATH, 'utf8'), 'served unchanged from docs/TECHNICAL-OVERVIEW.md');
    assert.match(res.body.markdown, /^# InFlight technical overview/);
    assert.match(res.body.sha256, /^[0-9a-f]{64}$/);
    const audit = (await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body.entries as { action: string; outcome: string }[];
    assert.ok(audit.some((e) => e.action === 'overview.read' && e.outcome === 'allowed'));
  } finally { await h.close(); }
});

test('people who are not admins cannot read the technical overview', async () => {
  const h = await startHarness();
  try {
    assert.equal((await h.call('GET', '/v1/admin/technical-overview')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/technical-overview', { token: h.user.token })).status, 403);
  } finally { await h.close(); }
});

test('a server build without the overview says so instead of failing', async () => {
  const h = await startHarness(undefined, undefined, { appDeps: { technicalOverviewPath: new URL('./no-such-overview.md', import.meta.url) } });
  try {
    const res = await h.call('GET', '/v1/admin/technical-overview', { token: h.adminToken });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'OVERVIEW_MISSING');
  } finally { await h.close(); }
});
