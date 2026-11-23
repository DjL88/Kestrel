import assert from 'node:assert/strict';
import test from 'node:test';
import { startHarness } from './helpers.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { FirestoreLearningSink } from '../src/learningSignalFirestore.ts';
import { Kite44ResearchLedger } from '../src/kite44ResearchLedger.ts';

const record = {
  schemaVersion: 1 as const, kind: 'edit' as const, modelFamily: 'Kite44' as const,
  modelVersion: '0.1.0', outcome: 'accepted' as const,
  metrics: { eyeSharpness: 0.8 }, adjustments: { exposure: 0.1 },
};

test('authenticated withdrawal works and deletes project grants when learning intake is not configured', async () => {
  const db = new MemoryFirestore();
  const sink = new FirestoreLearningSink(db);
  const h = await startHarness(undefined, undefined, { learningWithdrawal: sink });
  try {
    const subject = (await import('../src/crypto.ts')).sha256Hex(`learning:${h.user.accountId}`);
    const ledger = new Kite44ResearchLedger(db, 'test-only-32-character-kite44-secret!');
    await sink.setConsent(subject, true);
    await ledger.setProjectSharing(subject, 'family', true);
    assert.equal(await ledger.appendShadow(subject, 'family', 'image', record), true);

    assert.equal((await h.call('GET', '/v1/me/learning-consent', { token: h.user.token })).body.learningConsent, false,
      'no research intake is configured');
    assert.equal((await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } })).status, 503,
      'cannot turn collection on through withdrawal-only dependency');
    assert.equal((await h.call('POST', '/v1/me/learning-consent', { body: { consent: false } })).status, 401,
      'withdrawal requires authentication');
    const withdrawn = await h.call('POST', '/v1/me/learning-consent', {
      token: h.user.token, body: { consent: false },
    });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.learningConsent, false);
    assert.equal(withdrawn.body.deleted, 2);
    assert.equal((await db.collection('kite44_shadow_signals').get()).size, 0);
    assert.equal((await db.collection('kite44_project_policies').get()).size, 0);
    assert.equal(await ledger.appendShadow(subject, 'family', 'image', record), false);
    assert.equal((await h.call('POST', '/v1/learning/signals', {
      token: h.user.token,
      body: { source: 'on-device', capability: 'exposure', action: 'edited',
        proposal: {}, final: {}, appVersion: '26.11.2' },
    })).status, 410, 'legacy photo-unscoped intake remains closed');
  } finally { await h.close(); }
});
