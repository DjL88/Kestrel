/**
 * The admin page looks things up every five minutes. A feature this server has not been set up for answers 200 with
 * `configured: false` and a reason, never a 5xx: on 27 Nov those 503s set off the owner's "server errors" alert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers.ts';

const LOOKUPS = ['/v1/admin/paddle/key', '/v1/admin/learning', '/v1/admin/mail', '/v1/admin/tax', '/v1/admin/pricing/review',
  '/v1/admin/compliance/documents', '/v1/admin/balance-refunds'];

test('every look-up the admin page makes answers without a server error on a server with nothing optional set up', async () => {
  const h = await startHarness(null);
  try {
    for (const path of LOOKUPS) {
      const r = await h.call('GET', path, { token: h.adminToken });
      assert.equal(r.status, 200, path);
      assert.equal(r.body.configured, false, path);
      assert.match(r.body.reason, /not set up|does not have/, path);
    }
    // The page's other look-ups already answer normally on a bare server.
    for (const path of ['/v1/admin/overview', '/v1/admin/licensees', '/v1/admin/usage', '/v1/admin/payments', '/v1/admin/accounts',
      '/v1/admin/messages', '/v1/admin/safety', '/v1/admin/switches', '/v1/admin/flags', '/v1/admin/audit']) {
      assert.ok((await h.call('GET', path, { token: h.adminToken })).status < 500, path);
    }
  } finally { await h.close(); }
});

test('not set up is still admin-only and still recorded', async () => {
  const h = await startHarness(null);
  try {
    assert.equal((await h.call('GET', '/v1/admin/paddle/key')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/paddle/key', { token: h.user.token })).status, 403);
    await h.call('GET', '/v1/admin/learning', { token: h.adminToken });
    const entry = (await h.app.store.listAudit(50)).find((e) => e.action === 'learning.read');
    assert.equal(entry?.outcome, 'allowed');
    assert.equal(entry?.detail, 'not configured');
  } finally { await h.close(); }
});
