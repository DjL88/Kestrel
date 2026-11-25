import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { FirestorePaddleRecords, paddleLicenceId, paddleSettlement, verifyPaddleSignature } from '../src/commerce/paddle.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const SECRET = 'pdl_ntfset_test_only_not_a_real_secret';
const PRICE = 'pri_01testpro';
const sign = (body: string, tsS: number, secret = SECRET) => `ts=${tsS};h1=${createHmac('sha256', secret).update(`${tsS}:${body}`).digest('hex')}`;

test('Paddle-Signature: right secret and body within five minutes only; a rotated second h1 is accepted', () => {
  const body = '{"event_id":"evt_1"}';
  const now = Date.UTC(2026, 10, 25, 12);
  const ts = Math.floor(now / 1000);
  assert.ok(verifyPaddleSignature(body, sign(body, ts), SECRET, now));
  assert.ok(!verifyPaddleSignature(body + ' ', sign(body, ts), SECRET, now), 'a changed body fails');
  assert.ok(!verifyPaddleSignature(body, sign(body, ts, 'another-secret'), SECRET, now), 'another secret fails');
  assert.ok(!verifyPaddleSignature(body, sign(body, ts - 301), SECRET, now), 'too old');
  assert.ok(!verifyPaddleSignature(body, undefined, SECRET, now));
  assert.ok(!verifyPaddleSignature(body, 'ts=abc;h1=00', SECRET, now));
  const rotated = `${sign(body, ts, 'old-secret')};h1=${createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')}`;
  assert.ok(verifyPaddleSignature(body, rotated, SECRET, now), 'during secret rotation either signature may match');
});

async function rig() {
  const h = await startHarness();
  const id = await h.app.createAccount('buyer@example.test', 'a-long-password-123', 'user');
  const account = await h.app.store.getAccount(id);
  const records = new FirestorePaddleRecords(new MemoryFirestore());
  await records.saveOrder({ reference: 'ord_abc123', accountId: id, emailHash: account!.emailHash, majorVersion: 1, priceId: PRICE, createdAtMs: h.clock.now });
  const audits: string[] = [];
  const handle = paddleSettlement({ records, licences: h.app.store, proPriceId: PRICE, now: () => h.clock.now, audit: async (o, d) => { audits.push(`${o} ${d}`); } });
  const licence = async () => (await h.app.store.listLicencesForAccount(id)).find((l) => l.licenceId === paddleLicenceId('ord_abc123'));
  return { h, id, records, handle, licence, audits };
}

const completed = (over: Record<string, unknown> = {}, eventId = 'evt_c1') => ({
  event_id: eventId, event_type: 'transaction.completed',
  data: { id: 'txn_01abc', status: 'completed', currency_code: 'GBP', billed_at: '2026-11-25T12:00:00Z', custom_data: { reference: 'ord_abc123' },
    items: [{ price: { id: PRICE } }], details: { totals: { grand_total: '2900' } }, ...over },
});
const adjustment = (data: Record<string, unknown>, eventId = 'evt_a1') => ({ event_id: eventId, event_type: 'adjustment.updated', data: { transaction_id: 'txn_01abc', status: 'approved', ...data } });

test('a completed Pro transaction for our order grants Pro once; retries and duplicates change nothing', async () => {
  const { h, handle, licence, audits } = await rig();
  try {
    assert.equal(await handle(completed()), 'granted');
    const l = await licence();
    assert.ok(l); assert.equal(l!.plan, 'paid'); assert.equal(l!.paid, true); assert.equal(l!.status, 'active');
    assert.equal(await handle(completed()), 'duplicate', 'the same event id is processed once');
    assert.equal(await handle(completed({}, 'evt_c2')), 'granted', 'a second delivery under another id grants the same licence');
    assert.equal((await h.app.store.listLicencesForAccount((await licence())!.accountId!)).length, 1);
    assert.ok(audits.every((a) => !a.includes('@')), 'no address in the audit');
  } finally { await h.close(); }
});

test('nothing is granted for another price, an unknown order, an unfinished transaction or a forged account', async () => {
  const { h, handle, licence, records, id } = await rig();
  try {
    assert.equal(await handle(completed({ items: [{ price: { id: 'pri_other' } }] }, 'evt_1')), 'ignored');
    assert.equal(await handle(completed({ custom_data: { reference: 'ord_unknown' } }, 'evt_2')), 'ignored');
    assert.equal(await handle(completed({ status: 'paid' }, 'evt_3')), 'ignored');
    assert.equal(await handle({ event_id: 'evt_4', event_type: 'subscription.created', data: {} }), 'ignored');
    assert.equal(await licence(), undefined);
    await records.saveOrder({ reference: 'ord_forged', accountId: id, emailHash: 'f'.repeat(64), majorVersion: 1, priceId: PRICE, createdAtMs: 0 });
    await assert.rejects(handle(completed({ custom_data: { reference: 'ord_forged' } }, 'evt_5')), /no matching account/);
    assert.equal(await records.claimEvent('evt_5', 0), true, 'a failed event is released so Paddle\'s retry is processed');
  } finally { await h.close(); }
});

test('a full refund or a chargeback revokes Pro; a partial refund, a pending one or a credit does not', async () => {
  const { h, handle, licence } = await rig();
  try {
    await handle(completed());
    assert.equal(await handle(adjustment({ action: 'refund', type: 'partial' }, 'evt_p')), 'ignored');
    assert.equal(await handle(adjustment({ action: 'refund', type: 'full', status: 'pending_approval' }, 'evt_q')), 'ignored');
    assert.equal(await handle(adjustment({ action: 'credit', type: 'full' }, 'evt_r')), 'ignored');
    assert.equal((await licence())!.status, 'active');
    assert.equal(await handle(adjustment({ action: 'refund', type: 'full' }, 'evt_s')), 'revoked');
    assert.equal((await licence())!.status, 'revoked');
    assert.equal(await handle(adjustment({ action: 'chargeback', transaction_id: 'txn_unknown' }, 'evt_t')), 'ignored');
  } finally { await h.close(); }
});

test('the webhook route refuses anything Paddle did not sign, and grants for a signed event', async () => {
  const bare = await startHarness();
  try { assert.equal((await bare.call('POST', '/v1/billing/paddle', { raw: '{}' })).status, 503); } finally { await bare.close(); }
  const h = await startHarness(undefined, undefined, { paddle: { webhookSecret: SECRET, handle: async (e) => ((e as { event_id?: string }).event_id === 'evt_ok' ? 'granted' : 'ignored') } });
  try {
    const body = JSON.stringify({ event_id: 'evt_ok', event_type: 'transaction.completed', data: {} });
    const ts = Math.floor(h.clock.now / 1000);
    const unsigned = await h.call('POST', '/v1/billing/paddle', { raw: body, headers: { 'content-type': 'application/json' } });
    assert.equal(unsigned.status, 401); assert.equal(unsigned.body.error.code, 'PADDLE_SIGNATURE_INVALID');
    const forged = await h.call('POST', '/v1/billing/paddle', { raw: body, headers: { 'paddle-signature': sign(body, ts, 'guess'), 'content-type': 'application/json' } });
    assert.equal(forged.status, 401);
    const ok = await h.call('POST', '/v1/billing/paddle', { raw: body, headers: { 'paddle-signature': sign(body, ts), 'content-type': 'application/json' } });
    assert.equal(ok.status, 200); assert.equal(ok.body.outcome, 'granted');
  } finally { await h.close(); }
});
