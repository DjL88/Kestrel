import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLearningSink } from '../src/learningSignal.ts';
import { sha256Hex } from '../src/crypto.ts';
import { startHarness } from './helpers.ts';

const signal = { source: 'gemini' as const, capability: 'exposure' as const, action: 'edited' as const, candidateRank: 2, proposal: { exposure: 0.3, shadows: 0.5 }, final: { exposure: 0.2, shadows: 0.5 }, appVersion: '26.11.2' };

async function harness() {
  const sink = new MemoryLearningSink();
  const h = await startHarness(undefined, undefined, { learning: sink });
  return { h, sink };
}

test('legacy intake cannot accept records without a project/photo scope, even if account opted in', async () => {
  const { h, sink } = await harness();
  try {
    assert.equal((await h.call('GET', '/v1/me/learning-consent', { token: h.user.token })).body.learningConsent, false);
    assert.equal((await h.call('POST', '/v1/learning/signals', { body: signal })).status, 401);
    for (const consent of [false, true]) {
      if (consent) {
        assert.equal((await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } })).status, 200);
      }
      const r = await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: signal });
      assert.equal(r.status, 410);
      assert.equal(r.body.error.code, 'LEARNING_SCOPE_REQUIRED');
      assert.equal(sink.count(), 0);
    }
  } finally { await h.close(); }
});

test('inventing project/photo fields cannot bypass the old payload schema', async () => {
  const { h, sink } = await harness();
  try {
    await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } });
    for (const body of [
      { ...signal, projectId: 'wildlife', photoId: 'bird' },
      { ...signal, image: 'QUJD' },
      { ...signal, note: 'my kids at school' },
      { ...signal, proposal: { 'a b': 1 } },
      { ...signal, proposal: { exposure: 'x' } },
      { ...signal, candidateRank: 9 },
    ]) {
      const r = await h.call('POST', '/v1/learning/signals', { token: h.user.token, body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(sink.count(), 0);
  } finally { await h.close(); }
});

test('withdrawal still deletes prior legacy records without deleting another account', async () => {
  const { h, sink } = await harness();
  try {
    const otherId = await h.app.createAccount('o@example.test', 'other-password-123', 'user');
    const otherToken = (await h.app.issueSession(otherId, 'user')).accessToken;
    for (const [id, token] of [[h.user.accountId, h.user.token], [otherId, otherToken]] as const) {
      const consent = await h.call('POST', '/v1/me/learning-consent', { token, body: { consent: true } });
      assert.equal(consent.status, 200);
      // Simulate records created by an older server before the unscoped endpoint was retired.
      await sink.append({ ...signal, subject: sha256Hex(`learning:${id}`), receivedDay: '2026-11-23' });
    }
    assert.equal(sink.count(), 2);
    const withdrawal = await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: false } });
    assert.equal(withdrawal.status, 200);
    assert.equal(withdrawal.body.learningConsent, false);
    assert.equal(withdrawal.body.deleted, 1);
    assert.equal(sink.count(), 1);
    assert.equal((await h.call('POST', '/v1/learning/signals', { token: otherToken, body: signal })).status, 410);
  } finally { await h.close(); }
});

test('learning feature unconfigured: new opt-in is unavailable and legacy intake cannot write', async () => {
  const h = await startHarness();
  try {
    assert.equal((await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } })).status, 503);
    const response = await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: signal });
    assert.equal(response.status, 410);
  } finally { await h.close(); }
});
