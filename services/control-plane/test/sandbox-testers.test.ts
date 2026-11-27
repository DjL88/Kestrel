import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { startHarness } from './helpers.ts';

const SECRET = 'pdl_ntfset_test_only_secret';
const TXN = 'txn_01testsandbox0001';

/**
 * Test payments: with Paddle in its sandbox, anyone could pay with Paddle's public test card, so only testers (the
 * /admin admins and KCP_SANDBOX_TESTERS) may start a checkout, and test payments for anyone else are ignored.
 */
async function harness(environment: 'sandbox' | 'production') {
  const settled: string[] = [];
  const h = await startHarness(undefined, undefined, {
    env: { KCP_ADMIN_EMAILS: 'owner@example.test admin@example.test', KCP_SANDBOX_TESTERS: 'Second.Tester@example.test' },
    paddleEnvironment: environment,
    proCheckout: { start: async () => ({ checkoutId: TXN, url: `https://inflight.studio/pro-checkout?_ptxn=${TXN}` }) as never, status: async () => 'pending' },
    topUpCheckout: { amounts: [500, 1000, 2000], start: async () => ({ checkoutId: TXN, url: `https://inflight.studio/pro-checkout?_ptxn=${TXN}` }) as never, status: async () => 'pending' },
    settlePaddle: async (id) => { settled.push(id); return 'paid' as never; },
    paddleWebhookSecret: SECRET,
  });
  await h.app.store.setSetting('switch_pro-checkout', '1');
  await h.app.store.setSetting('switch_cloud-top-ups', '1');
  const person = async (email: string) => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  const buy = (token: string) => h.call('POST', '/v1/me/checkout/pro', { token, body: { plan: 'monthly' } });
  const topUp = (token: string) => h.call('POST', '/v1/me/checkout/topup', { token, body: { pence: 500 } });
  const webhook = (accountId: string) => {
    const raw = JSON.stringify({ event_id: 'evt_1' + accountId, event_type: 'transaction.completed', occurred_at: '2026-11-27T12:00:00Z', data: { id: TXN, custom_data: { accountId } } });
    const ts = String(Math.floor(h.clock.now / 1000));
    const h1 = crypto.createHmac('sha256', SECRET).update(ts + ':' + raw).digest('hex');
    return h.call('POST', '/v1/billing/paddle', { raw, headers: { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${h1}` } });
  };
  return { h, settled, person, buy, topUp, webhook };
}

test('sandbox: a stranger sees "not on sale yet" for Pro and top-ups, and a test payment for them is ignored', async () => {
  const t = await harness('sandbox');
  try {
    const stranger = await t.person('stranger@example.test');
    for (const r of [await t.buy(stranger.token), await t.topUp(stranger.token)]) {
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, 'CHECKOUT_DISABLED', 'the same state as before Pro goes on sale');
    }
    const r = await t.webhook(stranger.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, 'ignored-sandbox-non-tester');
    assert.deepEqual(t.settled, [], 'no Pro and no credit for a non-tester');
    assert.equal((await t.webhook('acc_unknown')).body.outcome, 'ignored-sandbox-non-tester');
  } finally { await t.h.close(); }
});

test('sandbox: an admin and a listed tester can buy, and their test payments are settled', async () => {
  const t = await harness('sandbox');
  try {
    const owner = await t.person('owner@example.test');
    const tester = await t.person('second.tester@example.test');
    for (const who of [owner, tester]) {
      assert.equal((await t.buy(who.token)).status, 201);
      assert.equal((await t.topUp(who.token)).status, 201);
    }
    assert.equal((await t.webhook(tester.id)).status, 200);
    assert.deepEqual(t.settled, [TXN]);
  } finally { await t.h.close(); }
});

test('production is unaffected: anyone signed in can buy, and every payment is settled', async () => {
  const t = await harness('production');
  try {
    const stranger = await t.person('stranger@example.test');
    assert.equal((await t.buy(stranger.token)).status, 201);
    assert.equal((await t.topUp(stranger.token)).status, 201);
    await t.webhook(stranger.id);
    assert.deepEqual(t.settled, [TXN]);
  } finally { await t.h.close(); }
});

test('/admin says plainly when payments are test-only', async () => {
  for (const environment of ['sandbox', 'production'] as const) {
    const t = await harness(environment);
    try {
      const r = await t.h.call('GET', '/v1/admin/switches', { token: t.h.adminToken });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const pro = r.body.switches.find((s: { key: string }) => s.key === 'pro-checkout');
      const topUps = r.body.switches.find((s: { key: string }) => s.key === 'cloud-top-ups');
      const expected = environment === 'sandbox' ? 'Test payments (sandbox): only testers can buy' : undefined;
      assert.equal(pro.testOnly, expected);
      assert.equal(topUps.testOnly, expected);
    } finally { await t.h.close(); }
  }
});
