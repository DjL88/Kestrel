import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountErasure } from '../src/accountErasureWiring.ts';
import { DELETION_GRACE_MS } from '../src/accountErasure.ts';
import { CollabStore } from '../src/collaboration.ts';
import { FirestoreStore } from '../src/firestoreStore.ts';
import { PushService } from '../src/push.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

// The daily job and the server build deletion the same way, from Firestore alone: alerts and shared projects are
// cleared even when those features are switched off now, and no bucket means cloud photo records are left, not half-done.
test('the daily job’s wiring deletes a due account from Firestore alone, and sends nothing', async (t) => {
  const db = new MemoryFirestore();
  const store = new FirestoreStore(db);
  const now = Date.now();
  await store.createAccount({ accountId: 'acc_ann', emailHash: 'e'.repeat(64), passwordHash: 'google-only', role: 'user', status: 'active', createdAtMs: now - DELETION_GRACE_MS * 2, aiConsent: false });
  const sent: string[] = [];
  await new PushService(db, { send: async (token) => { sent.push(token); return 'ok'; } }).register('acc_ann', 'fcm-ann', 'ios', now);
  await new CollabStore(db).createProject({ accountId: 'acc_ann', displayName: 'Ann' }, 'Solo', now);
  t.mock.method(Date, 'now', () => now - DELETION_GRACE_MS - 1000);
  const erasure = await buildAccountErasure(db, store, {});
  await erasure.schedule('acc_ann', 'DELETE');
  t.mock.restoreAll();

  assert.deepEqual(await erasure.runDue(), { deleted: 1, failed: 0 });
  assert.equal(await store.getAccount('acc_ann'), undefined);
  assert.equal((await db.collection('push_devices').where('accountId', '==', 'acc_ann').get()).size, 0);
  assert.equal((await db.collection('collab_memberships').where('accountId', '==', 'acc_ann').get()).size, 0);
  assert.deepEqual(sent, []);
  assert.deepEqual(await erasure.runDue(), { deleted: 0, failed: 0 });
});
