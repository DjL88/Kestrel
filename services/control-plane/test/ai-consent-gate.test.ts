import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeProvider, image, startHarness } from './helpers.ts';

const routes = ['/v1/ai/identify', '/v1/ai/suggest', '/v1/ai/verify-colour'] as const;

test('all managed AI routes deny default-off consent and live revocation before provider/quota', async () => {
  const provider = fakeProvider();
  const h = await startHarness(provider);
  try {
    const originalQuota = await h.app.store.getQuota(h.user.accountId);
    for (const path of routes) {
      const response = await h.call('POST', path, {
        token: h.user.token, body: { image: image(), userConsent: true },
      });
      assert.equal(response.status, 403, path);
      assert.equal(response.body.error.code, 'AI_CONSENT_REQUIRED', path);
    }
    assert.equal(provider.calls, 0, 'no external provider calls while standing consent is off');
    assert.deepEqual(await h.app.store.getQuota(h.user.accountId), originalQuota, 'denied requests do not consume quota');

    const optedIn = await h.call('POST', '/v1/me/ai-consent', {
      token: h.user.token, body: { consent: true },
    });
    assert.equal(optedIn.status, 200);
    for (const path of routes) {
      const response = await h.call('POST', path, {
        token: h.user.token, body: { image: image(), userConsent: false },
      });
      assert.equal(response.status, 400, path);
      assert.equal(response.body.error.code, 'CONSENT_REQUIRED', path);
    }
    assert.equal(provider.calls, 0, 'standing opt-in never bypasses per-request permission');

    const allowed = await h.call('POST', '/v1/ai/identify', {
      token: h.user.token, body: { image: image(), userConsent: true },
    });
    assert.equal(allowed.status, 200);
    assert.equal(provider.calls, 1);

    const revoked = await h.call('POST', '/v1/me/ai-consent', {
      token: h.user.token, body: { consent: false },
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.aiConsent, false);
    const quotaAtRevocation = await h.app.store.getQuota(h.user.accountId);
    for (const path of routes) {
      const response = await h.call('POST', path, {
        token: h.user.token, body: { image: image(), userConsent: true },
      });
      assert.equal(response.status, 403, path);
      assert.equal(response.body.error.code, 'AI_CONSENT_REQUIRED', path);
    }
    assert.equal(provider.calls, 1, 'reused valid session cannot bypass revocation');
    assert.deepEqual(await h.app.store.getQuota(h.user.accountId), quotaAtRevocation);
  } finally {
    await h.close();
  }
});
