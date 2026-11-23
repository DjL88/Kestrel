import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreLearningSink } from '../src/learningSignalFirestore.ts';
import { Kite44ResearchLedger } from '../src/kite44ResearchLedger.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const secret = 'kite44-withdrawal-tests-only-32-character-secret';
const review = {
  schemaVersion: 1 as const,
  kind: 'edit' as const,
  modelFamily: 'Kite44' as const,
  modelVersion: '0.1.0',
  outcome: 'accepted' as const,
  metrics: { eyeSharpness: 0.8 },
  adjustments: { exposure: 0.1 },
};

test('withdrawal deletes legacy and Kite44 research plus all previous project/photo grants', async () => {
  const db = new MemoryFirestore();
  const sink = new FirestoreLearningSink(db);
  const ledger = new Kite44ResearchLedger(db, secret);
  const subject = 'pseudonym-A';
  await sink.setConsent(subject, true);
  await ledger.setProjectSharing(subject, 'wildlife', true);
  await ledger.excludePhoto(subject, 'wildlife', 'private-bird', true);
  assert.equal(await ledger.appendShadow(subject, 'wildlife', 'approved-bird', review), true);
  assert.equal(await ledger.appendShadow(subject, 'wildlife', 'private-bird', review), false);
  await sink.append({
    subject, receivedDay: '2026-11-23', source: 'on-device',
    capability: 'exposure', action: 'edited',
    proposal: { exposure: 0.2 }, final: { exposure: 0.1 },
    appVersion: '26.11.2',
  });
  assert.equal((await db.collection('kite44_shadow_signals').get()).size, 1);
  assert.equal((await db.collection('kite44_project_policies').get()).size, 1);
  assert.equal((await db.collection('kite44_photo_exclusions').get()).size, 1);
  // Matches the real authenticated /v1/me/learning-consent withdrawal order.
  await sink.setConsent(subject, false);
  assert.equal(await sink.deleteBySubject(subject), 4);
  for (const name of ['learning_signals', 'kite44_shadow_signals', 'kite44_project_policies', 'kite44_photo_exclusions']) {
    assert.equal((await db.collection(name).get()).size, 0, name);
  }
  assert.equal(await ledger.appendShadow(subject, 'wildlife', 'approved-bird', review), false);
  await sink.setConsent(subject, true);
  // Re-opt-in MUST NOT reactivate an old album/project automatically.
  assert.equal(await ledger.appendShadow(subject, 'wildlife', 'approved-bird', review), false);
});

test('withdrawal is scoped to one account, not another account with the same project name', async () => {
  const db = new MemoryFirestore();
  const sink = new FirestoreLearningSink(db);
  const ledger = new Kite44ResearchLedger(db, secret);
  for (const subject of ['A', 'B']) {
    await sink.setConsent(subject, true);
    await ledger.setProjectSharing(subject, 'family', true);
    assert.equal(await ledger.appendShadow(subject, 'family', 'photo', review), true);
  }
  await sink.setConsent('A', false);
  assert.equal(await sink.deleteBySubject('A'), 2);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size, 1);
  assert.equal((await db.collection('kite44_project_policies').get()).size, 1);
  assert.equal(await ledger.appendShadow('B', 'family', 'photo2', review), true);
});

test('legacy withdrawal clears more than 400 signals in bounded Firestore batches', async () => {
  const db = new MemoryFirestore();
  const sink = new FirestoreLearningSink(db);
  const subject = 'many-signals';
  await sink.setConsent(subject, true);
  // Fill one collection beyond transaction batch size without any photo payload.
  await Promise.all(Array.from({ length: 405 }, (_, i) =>
    db.collection('learning_signals').doc(`item-${i}`).set({ subject, source: 'on-device' })));
  await sink.setConsent(subject, false);
  assert.equal(await sink.deleteBySubject(subject), 405);
  assert.equal((await db.collection('learning_signals').get()).size, 0);
});
