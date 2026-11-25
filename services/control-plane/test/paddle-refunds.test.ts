import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { paddleApi } from '../src/commerce/paddle.ts';
import { paddleProLicenceId, paddleRefundRevocation, refundEffect } from '../src/commerce/paddleRefunds.ts';
import type { ProPurchaseOrder } from '../src/commerce/proSettlement.ts';
import { purchaseEntitlement } from '../src/entitlement.ts';
import { startHarness } from './helpers.ts';

const SECRET = 'pdl_ntfset_test_only_secret';
const TXN = 'txn_01refundtest000001';
const ORDER: ProPurchaseOrder = { reference: 'paddle_0123456789abcdef01234567', accountId: '', emailHash: 'e'.repeat(64), majorVersion: 1, invoiceNumber: 'INV-1', priceId: 'pri_01pro' };

/** A fake of Paddle's live API (api.paddle.com): adjustments and transactions as Paddle reports them now. */
function fakePaddle(accountId: string) {
  const adjustments = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const state = { fail: false };
  const request = (async (url: string | URL) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://api.paddle.com', 'production, not sandbox');
    calls.push(u.pathname + u.search);
    if (state.fail) return new Response(null, { status: 503 });
    if (u.pathname === '/adjustments') return Response.json({ data: [...adjustments.values()].filter((a) => a.id === u.searchParams.get('id')) });
    if (u.pathname === '/transactions/' + TXN) {
      return Response.json({ data: {
        id: TXN, status: 'completed', currency_code: 'GBP', custom_data: { reference: ORDER.reference, accountId, product: 'pro', majorVersion: '1' },
        items: [{ price: { id: ORDER.priceId }, quantity: 1 }],
        details: { totals: { subtotal: '2417', tax: '483', total: '2900', currency_code: 'GBP' } },
      } });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const adjust = (id: string, fields: Record<string, unknown>) => adjustments.set(id, { id, transaction_id: TXN, status: 'approved', totals: { total: '2900', currency_code: 'GBP' }, ...fields });
  return { request, calls, state, adjust };
}

async function rig() {
  const h = await startHarness(null);
  const accountId = await h.app.createAccount('refund@example.test', 'test-password-with-length', 'user');
  const order = { ...ORDER, accountId };
  await h.app.store.grantLicence(purchaseEntitlement({ store: 'paddle', checkoutReference: order.reference, accountId, emailHash: order.emailHash, majorVersion: 1 }, h.clock.now));
  const paddle = fakePaddle(accountId);
  const claimed = new Set<string>();
  const revoke = paddleRefundRevocation({
    findOrder: async (id) => (id === TXN ? order : null),
    paddle: paddleApi({ apiKey: 'test-only-key', environment: 'production' }, paddle.request),
    licences: h.app.store,
    events: { claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)), release: async (id) => { claimed.delete(id); } },
    now: () => h.clock.now,
  });
  const licence = async () => (await h.app.store.getLicence(paddleProLicenceId(order)))!.status;
  const audit = async () => (await h.app.store.listAudit(50)).filter((e) => e.actor === 'paddle');
  return { h, paddle, revoke, licence, audit };
}

test('what each Paddle adjustment means for Pro', () => {
  assert.equal(refundEffect({ action: 'refund', type: 'full', status: 'approved' }), 'remove');
  assert.equal(refundEffect({ action: 'chargeback', type: 'full', status: 'approved' }), 'remove');
  assert.equal(refundEffect({ action: 'refund', type: 'partial', status: 'approved' }), 'keep');
  assert.equal(refundEffect({ action: 'refund', type: 'full', status: 'pending_approval' }), 'wait');
  assert.equal(refundEffect({ action: 'refund', type: 'full', status: 'rejected' }), 'wait');
  assert.equal(refundEffect({ action: 'credit', type: 'full', status: 'approved' }), 'none');
  assert.equal(refundEffect({ action: 'chargeback_warning', type: null, status: 'approved' }), 'none');
});

test('a full refund removes Pro after re-fetching from Paddle; a partial one keeps it; each with a reason admins can read', async () => {
  const { h, paddle, revoke, licence, audit } = await rig();
  try {
    assert.equal(await licence(), 'active');
    paddle.adjust('adj_01partial00000001', { action: 'refund', type: 'partial', totals: { total: '1000', currency_code: 'GBP' } });
    assert.equal(await revoke('evt_1', 'adj_01partial00000001'), 'kept');
    assert.equal(await licence(), 'active', 'a partial refund keeps Pro');
    paddle.adjust('adj_01pendingfull0001', { action: 'refund', type: 'full', status: 'pending_approval' });
    assert.equal(await revoke('evt_2', 'adj_01pendingfull0001'), 'pending');
    assert.equal(await licence(), 'active', 'not before Paddle approves it');

    paddle.adjust('adj_01pendingfull0001', { action: 'refund', type: 'full', status: 'approved' });
    assert.equal(await revoke('evt_3', 'adj_01pendingfull0001'), 'revoked');
    assert.equal(await licence(), 'revoked');
    assert.ok(paddle.calls.includes('/adjustments?id=adj_01pendingfull0001') && paddle.calls.some((c) => c.startsWith('/transactions/' + TXN)), 'both fetched back from Paddle');
    assert.equal(await revoke('evt_3', 'adj_01pendingfull0001'), 'duplicate', 'each event is acted on once');

    const log = await audit();
    assert.ok(log.some((e) => e.action === 'licence.refund_partial' && e.detail.includes('keeps Pro')));
    assert.ok(log.some((e) => e.action === 'licence.refund_pending'));
    const removed = log.find((e) => e.action === 'licence.revoke')!;
    assert.match(removed.detail, /a full refund, so Pro was removed/);
    assert.match(removed.detail, /adj_01pendingfull0001 on txn_01refundtest000001, 2900 GBP/);
  } finally { await h.close(); }
});

test('a chargeback removes Pro; a credit, a reversal or an adjustment for another purchase does not', async () => {
  const { h, paddle, revoke, licence, audit } = await rig();
  try {
    paddle.adjust('adj_01credit000000001', { action: 'credit', type: 'full' });
    assert.equal(await revoke('evt_c', 'adj_01credit000000001'), 'ignored');
    assert.equal(await licence(), 'active');
    paddle.adjust('adj_01chargeback00001', { action: 'chargeback', type: 'full' });
    assert.equal(await revoke('evt_cb', 'adj_01chargeback00001'), 'revoked');
    assert.equal(await licence(), 'revoked');
    paddle.adjust('adj_01reverse00000001', { action: 'chargeback_reverse', type: 'full' });
    assert.equal(await revoke('evt_rev', 'adj_01reverse00000001'), 'ignored');
    assert.equal(await licence(), 'revoked', 'a reversal is logged for an admin to restore, never restored by itself');
    assert.ok((await audit()).some((e) => e.action === 'licence.chargeback_reversed'));
    paddle.adjust('adj_01othertxn0000001', { action: 'refund', type: 'full', transaction_id: 'txn_01notapro00000001' });
    assert.equal(await revoke('evt_o', 'adj_01othertxn0000001'), 'ignored', 'not a Pro order');
  } finally { await h.close(); }
});

test('when Paddle cannot be reached or does not know the adjustment, nothing changes and the event is retried', async () => {
  const { h, paddle, revoke, licence } = await rig();
  try {
    paddle.adjust('adj_01retry0000000001', { action: 'refund', type: 'full' });
    paddle.state.fail = true;
    await assert.rejects(revoke('evt_r', 'adj_01retry0000000001'));
    assert.equal(await licence(), 'active');
    paddle.state.fail = false;
    assert.equal(await revoke('evt_r', 'adj_01retry0000000001'), 'revoked', 'the same event runs again on Paddle’s retry');
    await assert.rejects(revoke('evt_unknown', 'adj_01nosuchthing00001'));
  } finally { await h.close(); }
});

test('the notification route checks Paddle-Signature before anything, and hands adjustments to the revocation', async () => {
  const seen: string[] = [];
  const h = await startHarness(null, undefined, {
    settlePaddle: async () => 'unknown', paddleWebhookSecret: SECRET,
    revokePaddle: async (eventId, adjustmentId) => { seen.push(`${eventId}/${adjustmentId}`); return 'revoked'; },
  });
  try {
    const body = JSON.stringify({ event_id: 'evt_01route', event_type: 'adjustment.updated', occurred_at: '2026-11-25T12:00:00Z', data: { id: 'adj_01route000000001', action: 'refund' } });
    const ts = String(Math.floor(h.clock.now / 1000));
    const sign = (secret: string) => `ts=${ts};h1=${crypto.createHmac('sha256', secret).update(ts + ':' + body).digest('hex')}`;
    const send = (signature?: string) => h.call('POST', '/v1/billing/paddle', { raw: body, headers: { 'content-type': 'application/json', ...(signature ? { 'paddle-signature': signature } : {}) } });
    assert.equal((await send()).status, 401);
    assert.equal((await send(sign('guess'))).status, 401);
    assert.deepEqual(seen, [], 'nothing is looked up for an unsigned or forged notification');
    const ok = await send(sign(SECRET));
    assert.equal(ok.status, 200); assert.equal(ok.body.outcome, 'revoked');
    assert.deepEqual(seen, ['evt_01route/adj_01route000000001']);
  } finally { await h.close(); }
});
