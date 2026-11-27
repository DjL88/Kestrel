/**
 * InFlight's own online helper is invite-only (owner, 27 Nov 2026): GET /v1/me/entitlements says `onlineHelper:
 * 'available'` only for a usable licence that includes it, with the helper set up on this server and the "Online photo
 * helper" switch on. The app shows the helper's switch and provider choice only then.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers.ts';

const helperFor = async (h: Awaited<ReturnType<typeof startHarness>>, token: string) =>
  (await h.call('GET', '/v1/me/entitlements', { token })).body.onlineHelper;

test('available only with an invited licence, the helper set up and the switch on', async () => {
  const h = await startHarness();
  try {
    assert.equal(await helperFor(h, h.user.token), 'available', 'the harness user holds a licence with the helper');
    assert.equal(await helperFor(h, h.adminToken), 'unavailable', 'no such licence: not offered');

    // Switched off by the owner: hidden in the app, even for invited accounts.
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'managed-ai', on: false } })).status, 200);
    assert.equal(await helperFor(h, h.user.token), 'unavailable');
    await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'managed-ai', on: true } });
    assert.equal(await helperFor(h, h.user.token), 'available');

    // The entitlement taken away while the switch is on: hidden, and the server refuses the helper itself.
    const { licences } = (await h.call('GET', '/v1/admin/licensees', { token: h.adminToken })).body;
    const helperLicence = licences.find((l: { accountId: string | null; managedAi: boolean }) => l.accountId === h.user.accountId && l.managedAi);
    assert.equal((await h.call('POST', `/v1/admin/licences/${helperLicence.licenceId}/revoke`, { token: h.adminToken })).status, 200);
    assert.equal(await helperFor(h, h.user.token), 'unavailable');
  } finally { await h.close(); }
});

test('a server without the helper set up never offers it', async () => {
  const h = await startHarness(null);
  try {
    assert.equal(await helperFor(h, h.user.token), 'unavailable');
  } finally { await h.close(); }
});
