import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLearningSink } from '../src/learningSignal.ts';
import { startHarness } from './helpers.ts';

const signal = { source: 'gemini', capability: 'exposure', action: 'edited', candidateRank: 2, proposal: { exposure: 0.3, shadows: 0.5 }, final: { exposure: 0.2, shadows: 0.5 }, appVersion: '26.11.2' };

async function harness() {
  const sink = new MemoryLearningSink();
  const h = await startHarness(undefined, undefined, { learning: sink });
  return { h, sink };
}

test('off by default: no consent means nothing is stored', async () => {
  const { h, sink } = await harness();
  try {
    assert.equal((await h.call('GET', '/v1/me/learning-consent', { token: h.user.token })).body.learningConsent, false);
    assert.equal((await h.call('POST', '/v1/learning/signals', { body: signal })).status, 401);
    const r = await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: signal });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'LEARNING_CONSENT_REQUIRED');
    assert.equal(sink.count(), 0);
  } finally { await h.close(); }
});

test('with consent a signal is stored under a pseudonym, never the account id, and only the allowed fields', async () => {
  const { h, sink } = await harness();
  try {
    await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } });
    assert.equal((await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: signal })).status, 200);
    const [rec] = sink.all();
    assert.ok(!JSON.stringify(rec).includes(h.user.accountId));
    assert.deepEqual(Object.keys(rec).sort(), ['action', 'appVersion', 'candidateRank', 'capability', 'final', 'proposal', 'receivedDay', 'source', 'subject']);
    assert.match(rec.receivedDay, /^\d{4}-\d{2}-\d{2}$/, 'day only, not a timestamp');
  } finally { await h.close(); }
});

test('payloads that could carry a photo, a name or free text are refused', async () => {
  const { h, sink } = await harness();
  try {
    await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } });
    const bad: object[] = [
      { ...signal, image: 'QUJD' }, { ...signal, note: 'my kids at school' }, { ...signal, source: 'other' },
      { ...signal, proposal: { 'a b': 1 } }, { ...signal, proposal: { exposure: 'x' } }, { ...signal, proposal: { exposure: 9999 } },
      { ...signal, proposal: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 0])) }, { ...signal, candidateRank: 9 }, { ...signal, appVersion: '1.2' },
    ];
    for (const b of bad) assert.equal((await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: b })).status, 400, JSON.stringify(b).slice(0, 60));
    assert.equal(sink.count(), 0);
  } finally { await h.close(); }
});

test('withdrawing consent deletes that person\'s signals at once, leaves others, and stops new ones', async () => {
  const { h, sink } = await harness();
  try {
    const otherId = await h.app.createAccount('o@example.test', 'other-password-123', 'user');
    const otherToken = (await h.app.issueSession(otherId, 'user')).accessToken;
    for (const t of [h.user.token, otherToken]) {
      await h.call('POST', '/v1/me/learning-consent', { token: t, body: { consent: true } });
      await h.call('POST', '/v1/learning/signals', { token: t, body: signal });
    }
    assert.equal(sink.count(), 2);
    const w = await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: false } });
    assert.equal(w.status, 200); assert.equal(w.body.learningConsent, false); assert.equal(w.body.deleted, 1);
    assert.equal(sink.count(), 1);
    assert.equal((await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: signal })).status, 403);
    assert.equal((await h.call('POST', '/v1/learning/signals', { token: otherToken, body: signal })).status, 200);
  } finally { await h.close(); }
});

test('not configured: the deployed service answers 503 and stores nothing', async () => {
  const h = await startHarness();
  try {
    assert.equal((await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } })).status, 503);
  } finally { await h.close(); }
});
