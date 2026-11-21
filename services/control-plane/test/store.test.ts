/**
 * The storage contract, checked directly against every store: SQLite, and Firestore (emulator when
 * FIRESTORE_EMULATOR_HOST is set, otherwise the in-memory fake). The route-level scenarios in api/security tests run
 * against both too (see *.firestore.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore, docId } from '../src/firestoreStore.ts';
import { SqliteStore } from '../src/sqliteStore.ts';
import { newLicence, type Store } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { newTestStore } from './helpers.ts';

const T = Date.UTC(2026, 10, 20, 12);
const stores: Array<[string, () => Promise<Store>]> = [
  ['sqlite', async () => new SqliteStore(':memory:')],
  ['firestore', async () => { process.env.KCP_TEST_STORE = 'firestore'; try { return await newTestStore(); } finally { delete process.env.KCP_TEST_STORE; } }],
];
const hex = (n: number) => n.toString(16).padStart(64, '0');
const activation = (licenceId: string, device: number) => ({
  licenceId, planIfNew: 'paid' as const, deviceHash: hex(device), platform: 'windows', appVersion: '26.11.2', newActivationId: `act_${licenceId}_${device}`, nowMs: T,
});

for (const [kind, open] of stores) {
  test(`${kind}: two devices racing for the last slot: exactly one gets it`, async () => {
    const store = await open();
    try {
      await store.insertLicence(newLicence('lic_race', 'paid', T, { maxDevices: 2 }));
      assert.equal((await store.activateDevice(activation('lic_race', 1))).ok, true);
      const results = await Promise.all([2, 3, 4, 5].map((d) => store.activateDevice(activation('lic_race', d))));
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'device_limit'));
      assert.equal((await store.counts()).activations, 2);
      const again = await store.activateDevice({ ...activation('lic_race', 1), newActivationId: 'act_other' });
      assert.deepEqual(again.ok && again.activationId, 'act_lic_race_1', 'the same device keeps its slot');
    } finally { await store.close(); }
  });

  test(`${kind}: an unknown licence is created on first activation; revoked or lapsed ones are refused`, async () => {
    const store = await open();
    try {
      const first = await store.activateDevice(activation('lic_new', 1));
      assert.equal(first.ok, true);
      assert.equal((await store.getLicence('lic_new'))?.status, 'active');
      assert.equal(await store.setLicenceStatus('lic_new', 'revoked', T), true);
      assert.deepEqual(await store.activateDevice(activation('lic_new', 1)), { ok: false, reason: 'not_active' });
      assert.equal(await store.setLicenceStatus('lic_missing', 'revoked', T), false);
      await store.insertLicence(newLicence('lic_lapsed', 'paid', T, { validUntilMs: T - 1 }));
      assert.deepEqual(await store.activateDevice(activation('lic_lapsed', 1)), { ok: false, reason: 'not_active' });
      const until = await store.extendLicence('lic_lapsed', 10, T);
      assert.equal(until, T + 10 * 86_400_000);
      assert.equal((await store.activateDevice(activation('lic_lapsed', 1))).ok, true);
    } finally { await store.close(); }
  });

  test(`${kind}: accounts are unique by email; refresh tokens work once and not after expiry`, async () => {
    const store = await open();
    try {
      const account = { accountId: 'acc_1', emailHash: 'e'.repeat(64), passwordHash: 'x', role: 'user' as const, status: 'active' as const, createdAtMs: T, aiConsent: false };
      assert.equal(await store.createAccount(account), true);
      assert.equal(await store.createAccount({ ...account, accountId: 'acc_2' }), false);
      assert.equal((await store.findAccountByEmailHash('e'.repeat(64)))?.accountId, 'acc_1');
      assert.equal(await store.getAccount('acc_2'), undefined);
      assert.equal((await store.getAccount('acc_1'))?.aiConsent, false);
      await store.setAiConsent('acc_1', true);
      assert.equal((await store.getAccount('acc_1'))?.aiConsent, true);
      await store.setAiConsent('acc_1', false);
      assert.equal((await store.getAccount('acc_1'))?.aiConsent, false);
      await store.addRefreshToken('t1', 'acc_1', T + 1000);
      assert.equal(await store.consumeRefreshToken('t1', T), 'acc_1');
      assert.equal(await store.consumeRefreshToken('t1', T), undefined);
      await store.addRefreshToken('t2', 'acc_1', T + 1000);
      assert.equal(await store.consumeRefreshToken('t2', T + 1000), undefined, 'expired');
    } finally { await store.close(); }
  });

  test(`${kind}: quota periods reset, refunds never go below zero, and billing events apply once`, async () => {
    const store = await open();
    try {
      for (const id of ['acc_q', 'acc_new']) await store.createAccount({ accountId: id, emailHash: id.padEnd(64, '0'), passwordHash: 'x', role: 'user', status: 'active', createdAtMs: T, aiConsent: false });
      await store.setQuotaLimit('acc_q', 1, T);
      assert.equal(await store.reserveQuota('acc_q', T, 1000), true);
      assert.equal(await store.reserveQuota('acc_q', T, 1000), false);
      assert.equal(await store.reserveQuota('acc_q', T + 1000, 1000), true, 'a new period starts');
      await store.refundQuota('acc_q'); await store.refundQuota('acc_q');
      assert.equal((await store.getQuota('acc_q'))?.requestsUsed, 0);
      assert.equal(await store.reserveQuota('acc_new', T, 1000), true, 'the default allowance applies to new accounts');
      assert.equal((await store.getQuota('acc_new'))?.requestsLimit, 500);

      const created = { id: 'evt_1', type: 'licence.created' as const, data: { licenceId: 'lic_b', plan: 'subscriber' as const, managedAi: true } };
      assert.equal(await store.applyBillingEvent(created, T), 'applied');
      assert.equal(await store.applyBillingEvent({ ...created, type: 'licence.revoked' }, T), 'replayed');
      assert.equal((await store.getLicence('lic_b'))?.status, 'active');
      assert.equal(await store.applyBillingEvent({ id: 'evt_2', type: 'licence.revoked', data: { licenceId: 'lic_b' } }, T), 'applied');
      assert.equal((await store.getLicence('lic_b'))?.status, 'revoked');
    } finally { await store.close(); }
  });

  test(`${kind}: model promotion retires the live version and bumps the revision; audit lists newest first`, async () => {
    const store = await open();
    try {
      const asset = { assetId: 'm', kind: 'onnx', version: '1.0.0', channel: 'stable', path: '/data/m.onnx', sha256: 'a'.repeat(64), bytes: 1, requiredAppMin: '0.0.0', status: 'candidate' as const, createdAtMs: T };
      assert.equal(await store.insertModelAsset(asset), true);
      assert.equal(await store.insertModelAsset(asset), false, 'duplicates refused');
      await store.insertModelAsset({ ...asset, version: '1.1.0' });
      assert.equal(await store.promoteModelAsset('m', '1.0.0', 'stable'), true);
      assert.equal(await store.promoteModelAsset('m', '1.1.0', 'stable'), true);
      assert.equal(await store.promoteModelAsset('m', '9.9.9', 'stable'), false);
      assert.deepEqual((await store.listLiveModelAssets('stable')).map((a) => a.version), ['1.1.0']);
      assert.equal(await store.getSetting('manifest_revision_stable'), '3');
      for (const action of ['first', 'second', 'third']) await store.audit({ atMs: T, actor: 'a', action, outcome: 'allowed', detail: 'x'.repeat(900) });
      const entries = await store.listAudit(2);
      assert.deepEqual(entries.map((e) => e.action), ['third', 'second']);
      assert.equal(entries[0].detail.length, 500, 'details are clipped');
    } finally { await store.close(); }
  });
}

test('the in-memory Firestore refuses what real Firestore refuses', async () => {
  const db = new MemoryFirestore();
  const ref = db.collection('c').doc('a');
  await ref.create({ n: 1 });
  await assert.rejects(ref.create({ n: 2 }), (e: { code?: number }) => e.code === 6, 'create on an existing document');
  await assert.rejects(ref.set({ n: undefined }), /undefined/);
  await assert.rejects(db.runTransaction(async (tx) => { tx.update(ref, { n: 2 }); await tx.get(ref); }), /reads to be executed before all writes/);
  await assert.rejects(db.runTransaction(async (tx) => { tx.update(ref, { n: 3 }); tx.update(db.collection('c').doc('missing'), { n: 1 }); }), (e: { code?: number }) => e.code === 5);
  assert.deepEqual(db.peek('c', 'a'), { n: 1 }, 'a failed transaction writes nothing');
  await assert.rejects(db.collection('c').where('n', '==', 1).orderBy('n').get(), /composite index/);
  await assert.rejects(async () => db.collection('c').doc('a/b'), /Invalid document id/);
  assert.equal(docId('a/b', 'c|d'), 'a%2Fb|c%7Cd');
});
