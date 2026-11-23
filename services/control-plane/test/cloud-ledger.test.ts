import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, type CloudJobRecord, type CloudLedger } from '../src/cloudJobs.ts';
import { FirestoreCloudLedger } from '../src/cloudLedgerFirestore.ts';
import type { FirestoreLike } from '../src/firestoreStore.ts';
import { openFirestore } from '../src/openStore.ts';
import { FirestoreSpendGuard } from '../src/spendGuard.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const DAY = 86_400_000, PERIOD = 30 * DAY;
const rec: CloudJobRecord = { jobId: 'j1', accountId: 'a1', kind: 'denoise', inputBytes: 1000, status: 'awaiting-upload', createdAtMs: 5, consentAtMs: 5 };

// The same contract runs against both ledgers, so the fake the gate is tested with cannot drift from Firestore.
const firestoreBackends: Array<[string, (t: TestContext) => FirestoreLike | Promise<FirestoreLike>]> = [
  ['firestore fake', () => new MemoryFirestore()],
];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  let project = 0;
  firestoreBackends.push(['firestore emulator', async (t) => {
    const db = await openFirestore({ firestoreProjectId: `kestrel-cloud-${process.pid}-${++project}` });
    t.after(() => db.terminate());
    return db as unknown as FirestoreLike;
  }]);
}

const ledgers: Array<[string, (t: TestContext) => CloudLedger | Promise<CloudLedger>]> = [
  ['memory', () => new MemoryCloudLedger()],
  ...firestoreBackends.map(([name, make]): [string, (t: TestContext) => Promise<CloudLedger>] =>
    [name, async (t) => new FirestoreCloudLedger(await make(t))]),
];

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

for (const [name, make] of firestoreBackends) {
  test(`${name}: failure refunds one job at its original price without touching the next month`, async (t) => {
    const db = await make(t);
    const ledger = new FirestoreCloudLedger(db);
    const spend = new FirestoreSpendGuard(db);
    const november = Date.UTC(2026, 10, 30, 23, 59);
    const december = november + 120_000;
    assert.equal(await spend.reserve(november, 11, 100), true);
    assert.equal(await spend.reserve(december, 9, 100), true);
    assert.equal(await ledger.reserve(rec.accountId, november, 2, PERIOD), true);
    assert.equal(await ledger.reserve(rec.accountId, december, 2, PERIOD), true);
    await ledger.put({ ...rec, status: 'running', createdAtMs: november, consentAtMs: november, spendPence: 3 });

    const settled = await Promise.all(Array.from({ length: 4 }, () => ledger.settleFailed(rec.jobId, 7)));
    assert.equal(settled.filter(Boolean).length, 1);
    const job = await ledger.get(rec.jobId);
    assert.equal(job?.status, 'failed');
    assert.equal(job?.spendPence, 3);
    assert.equal(await spend.spent(november), 8);
    assert.equal(await spend.spent(december), 9);
    assert.equal(await ledger.reserve(rec.accountId, december, 2, PERIOD), true);
    assert.equal(await ledger.reserve(rec.accountId, december, 2, PERIOD), false);
  });

  test(`${name}: an older job refunds the legacy estimate while preserving a new quota period`, async (t) => {
    const db = await make(t);
    const ledger = new FirestoreCloudLedger(db);
    const spend = new FirestoreSpendGuard(db);
    const then = Date.UTC(2026, 9, 12, 10);
    const today = then + PERIOD + 1;
    assert.equal(await spend.reserve(then, 5, 100), true);
    assert.equal(await ledger.reserve(rec.accountId, then, 1, PERIOD), true);
    assert.equal(await ledger.reserve(rec.accountId, today, 1, PERIOD), true);
    await ledger.put({ ...rec, status: 'running', createdAtMs: then, consentAtMs: then });

    assert.equal(await ledger.settleFailed(rec.jobId, 2), true);
    assert.equal(await spend.spent(then), 3);
    assert.equal(await ledger.reserve(rec.accountId, today, 1, PERIOD), false);
  });
}
