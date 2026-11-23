import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, type CloudJobRecord, type CloudLedger } from '../src/cloudJobs.ts';
import { FirestoreCloudLedger } from '../src/cloudLedgerFirestore.ts';
import type { FirestoreLike } from '../src/firestoreStore.ts';
import { openFirestore } from '../src/openStore.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const DAY = 86_400_000, PERIOD = 30 * DAY;
const rec: CloudJobRecord = { jobId: 'j1', accountId: 'a1', kind: 'denoise', inputBytes: 1000, status: 'awaiting-upload', createdAtMs: 5, consentAtMs: 5 };

// The same contract runs against both ledgers, so the fake the gate is tested with cannot drift from Firestore.
const ledgers: Array<[string, (t: TestContext) => CloudLedger | Promise<CloudLedger>]> = [
  ['memory', () => new MemoryCloudLedger()],
  ['firestore fake', () => new FirestoreCloudLedger(new MemoryFirestore())],
];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  let project = 0;
  ledgers.push(['firestore emulator', async (t) => {
    const db = await openFirestore({ firestoreProjectId: `kestrel-cloud-${process.pid}-${++project}` });
    t.after(() => db.terminate());
    return new FirestoreCloudLedger(db as unknown as FirestoreLike);
  }]);
}

for (const [name, make] of ledgers) {
  test(`${name}: reserve stops at the limit, refunds, and rolls over per period`, async (t) => {
    const l = await make(t);
    assert.equal(await l.reserve('a1', 0, 2, PERIOD), true);
    assert.equal(await l.reserve('a1', 1, 2, PERIOD), true);
    assert.equal(await l.reserve('a1', 2, 2, PERIOD), false);
    await l.refund('a1', 0);
    assert.equal(await l.reserve('a1', 3, 2, PERIOD), true);
    assert.equal(await l.reserve('b1', 3, 1, PERIOD), true, 'another account is separate');
    assert.equal(await l.reserve('a1', PERIOD + 10, 2, PERIOD), true, 'new period');
    await l.refund('a1', 0);
    assert.equal(await l.reserve('a1', PERIOD + 11, 1, PERIOD), false, 'the previous period cannot refund the current one');
    await l.refund('nobody', 0); // no throw
  });
  test(`${name}: concurrent reserves never exceed the limit`, async (t) => {
    const l = await make(t);
    const results = await Promise.all(Array.from({ length: 10 }, () => l.reserve('a1', 0, 3, PERIOD)));
    assert.equal(results.filter(Boolean).length, 3);
  });
  test(`${name}: jobs round-trip with only the allowed fields`, async (t) => {
    const l = await make(t);
    assert.equal(await l.get('j1'), undefined);
    await l.put({ ...rec, extra: 'photo.nef' } as CloudJobRecord);
    assert.deepEqual(await l.get('j1'), rec);
    await l.put({ ...rec, status: 'finished' });
    assert.equal((await l.get('j1'))!.status, 'finished');
  });
  test(`${name}: concurrent state transitions have one winner and cannot reopen finished jobs`, async (t) => {
    const l = await make(t);
    assert.equal(await l.transition(rec.jobId, 'awaiting-upload', 'running'), false);
    await l.put(rec);
    const starts = await Promise.all(Array.from({ length: 4 }, () => l.transition(rec.jobId, 'awaiting-upload', 'running')));
    assert.equal(starts.filter(Boolean).length, 1);
    const completed = await Promise.all((['ready', 'failed'] as const).map((status) =>
      l.transition(rec.jobId, 'running', status)));
    assert.equal(completed.filter(Boolean).length, 1);
    await l.put({ ...rec, status: 'finished' });
    assert.equal(await l.transition(rec.jobId, 'running', 'ready'), false);
    assert.equal((await l.get(rec.jobId))?.status, 'finished');
  });
}
