import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFirestore } from './memoryFirestore.ts';
import { Kite44ResearchLedger } from '../src/kite44ResearchLedger.ts';

const record = {
  schemaVersion: 1 as const, kind: 'edit' as const,
  modelFamily: 'Kite44' as const, modelVersion: '0.1.0',
  outcome: 'modified' as const, metrics: { eyeSharpness: 0.8 },
  adjustments: { exposure: 0.3 },
};
const make = () => {
  const db = new MemoryFirestore();
  return { db, ledger: new Kite44ResearchLedger(db, 'test-secret-32-characters-minimum-123') };
};

test('no account or project permission means no signal written', async () => {
  const { db, ledger } = make();
  assert.equal(await ledger.appendShadow('userA','family','photo1',record), false);
  await db.collection('learning_consent').doc('userA').set({consent:true});
  assert.equal(await ledger.appendShadow('userA','family','photo1',record), false);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size, 0);
});
test('family project denied even while wildlife project is opted in', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({consent:true});
  await ledger.setProjectSharing('userA','wildlife',true);
  await ledger.setProjectSharing('userA','family',false);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird1',record), true);
  assert.equal(await ledger.appendShadow('userA','family','family1',record), false);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size,1);
});
test('individual photo exclusion and account revocation both deny', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({consent:true});
  await ledger.setProjectSharing('userA','wildlife',true);
  await ledger.excludePhoto('userA','wildlife','child',true);
  assert.equal(await ledger.appendShadow('userA','wildlife','child',record), false);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird',record), true);
  assert.equal(await ledger.revokeAndDelete('userA'), 1);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird',record), false);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size,0);
});
test('no cross-account project sharing', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({consent:true});
  await db.collection('learning_consent').doc('userB').set({consent:true});
  await ledger.setProjectSharing('userA','same-name',true);
  assert.equal(await ledger.appendShadow('userB','same-name','bird',record),false);
});
test('reject unknown or identifying fields rather than persisting them', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({consent:true});
  await ledger.setProjectSharing('userA','wildlife',true);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird',{...record, filename:'family.jpg'} as typeof record),false);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird',{...record, metrics:{unknown:0.5}}),false);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size,0);
});
test('concurrent writes and consent withdrawal obey transaction order', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({consent:true});
  await ledger.setProjectSharing('userA','wildlife',true);
  const results = await Promise.all([
    ledger.appendShadow('userA','wildlife','bird',record),
    db.collection('learning_consent').doc('userA').set({consent:false}),
    ledger.appendShadow('userA','wildlife','bird',record),
  ]);
  assert.equal(results[0],true);
  assert.equal(results[2],false);
});

test('turning off a project removes previously shared shadows but not other projects', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({ consent: true });
  await ledger.setProjectSharing('userA', 'family', true);
  await ledger.setProjectSharing('userA', 'wildlife', true);
  assert.equal(await ledger.appendShadow('userA','family','album1',record),true);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird1',record),true);
  assert.equal(await ledger.setProjectSharing('userA','family',false),1);
  assert.equal(await ledger.appendShadow('userA','family','album2',record),false);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size,1);
});

test('excluding a photo removes its prior shadows and preserves other photos', async () => {
  const { db, ledger } = make();
  await db.collection('learning_consent').doc('userA').set({ consent: true });
  await ledger.setProjectSharing('userA','wildlife',true);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird1',record),true);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird2',record),true);
  assert.equal(await ledger.excludePhoto('userA','wildlife','bird1',true),1);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird1',record),false);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size,1);
});

test('revoking one person leaves another account’s records intact', async () => {
  const { db, ledger } = make();
  for (const subject of ['userA','userB']) {
    await db.collection('learning_consent').doc(subject).set({consent:true});
    await ledger.setProjectSharing(subject,'wildlife',true);
    assert.equal(await ledger.appendShadow(subject,'wildlife','bird',record),true);
  }
  assert.equal(await ledger.revokeAndDelete('userA'),1);
  assert.equal((await db.collection('kite44_shadow_signals').get()).size,1);
  assert.equal(await ledger.appendShadow('userA','wildlife','bird',record),false);
  assert.equal(await ledger.appendShadow('userB','wildlife','bird',record),true);
});
