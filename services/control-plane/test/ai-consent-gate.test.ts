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

test('account switching never inherits another account consent, including a valid session', async () => {
  const provider = fakeProvider();
  const h = await startHarness(provider);
  try {
    const secondId = await h.app.createAccount('other@example.test', 'other-password-123', 'user');
    const secondToken = (await h.app.issueSession(secondId, 'user')).accessToken;
    const grant = await h.call('POST', '/v1/admin/licences/issue', {
      token: h.adminToken, body: { plan: 'paid', managedAi: true, accountId: secondId },
    });
    assert.equal(grant.status, 200);
    assert.equal((await h.call('POST', '/v1/me/ai-consent', {
      token: h.user.token, body: { consent: true },
    })).status, 200);
    const quotaBefore = await h.app.store.getQuota(secondId);
    for (const route of routes) {
      const denied = await h.call('POST', route, {
        token: secondToken, body: { image: image(), userConsent: true },
      });
      assert.equal(denied.status, 403, route);
      assert.equal(denied.body.error.code, 'AI_CONSENT_REQUIRED', route);
    }
    assert.equal(provider.calls, 0, 'switching accounts never sends another account photo');
    assert.deepEqual(await h.app.store.getQuota(secondId), quotaBefore);
    const first = await h.call('POST', '/v1/ai/identify', {
      token: h.user.token, body: { image: image(), userConsent: true },
    });
    assert.equal(first.status, 200, 'the original opted-in account still works');
    assert.equal(provider.calls, 1);
  } finally {
    await h.close();
  }
});

test('metadata, missing per-photo consent and revoked consent never spend quota or reach provider', async () => {
  const provider = fakeProvider();
  const h = await startHarness(provider);
  try {
    assert.equal((await h.call('POST', '/v1/me/ai-consent', {
      token: h.user.token, body: { consent: true },
    })).status, 200);
    const initialQuota = await h.app.store.getQuota(h.user.accountId);
    for (const route of routes) {
      const noPermission = await h.call('POST', route, {
        token: h.user.token, body: { image: image(), userConsent: false },
      });
      assert.equal(noPermission.status, 400, route);
      assert.equal(noPermission.body.error.code, 'CONSENT_REQUIRED', route);
      const exif = await h.call('POST', route, {
        token: h.user.token, body: { image: image(640, 480, { exif: true }), userConsent: true },
      });
      assert.equal(exif.status, 400, route);
      assert.equal(exif.body.error.code, 'IMAGE_HAS_METADATA', route);
    }
    assert.equal(provider.calls, 0);
    assert.deepEqual(await h.app.store.getQuota(h.user.accountId), initialQuota);
    assert.equal((await h.call('POST', '/v1/me/ai-consent', {
      token: h.user.token, body: { consent: false },
    })).status, 200);
    const revoked = await h.call('POST', '/v1/ai/identify', {
      token: h.user.token, body: { image: image(), userConsent: true },
    });
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body.error.code, 'AI_CONSENT_REQUIRED');
    assert.deepEqual(await h.app.store.getQuota(h.user.accountId), initialQuota);
    assert.equal(provider.calls, 0);
  } finally {
    await h.close();
  }
});
