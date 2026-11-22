import assert from 'node:assert/strict';
import test from 'node:test';
import { openEnvelope } from '../../../src/core/signedEnvelope.ts';
import { verifyEntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { startHarness, type Harness } from './helpers.ts';

const DEVICE = 'b'.repeat(64);
const DAY = 86_400_000;
const keys = (h: Harness) => ({ [h.app.config.signingKey.keyId]: h.app.config.signingKey.publicKeyBase64 });
const activate = (h: Harness) => h.call('POST', '/v1/me/activate', { token: h.user.token, body: { deviceHash: DEVICE, platform: 'macos', appVersion: '26.11.2' } });
const setFlag = (h: Harness, key: string, flag: unknown, token = h.adminToken) => h.call('POST', '/v1/admin/flags/set', { token, body: { key, flag } });

test('only an admin can read or change flags, and every change is audited without any email', async () => {
  const h = await startHarness();
  try {
    assert.equal((await setFlag(h, 'watermarkCustom', { default: false, rules: [] }, h.user.token)).status, 403);
    assert.equal((await h.call('GET', '/v1/admin/flags', { token: h.user.token })).status, 403);
    const set = await setFlag(h, 'watermarkCustom', { default: false, rules: [{ audience: { kind: 'user', email: 'User@Example.test' }, enabled: true }] });
    assert.equal(set.status, 200);
    const read = await h.call('GET', '/v1/admin/flags', { token: h.adminToken });
    assert.equal(read.body.flags.watermarkCustom.rules.length, 1);
    assert.equal(JSON.stringify(read.body).includes('example.test'), false, 'the address is stored as a hash');
    assert.match(read.body.flags.watermarkCustom.rules[0].audience.email, /^[0-9a-f]{64}$/);
    const audit = await h.call('GET', '/v1/admin/audit', { token: h.adminToken });
    const text = JSON.stringify(audit.body);
    assert.ok(text.includes('flags.set'));
    assert.equal(text.includes('example.test'), false);
  } finally { await h.close(); }
});

test('an invalid rule is refused and nothing changes', async () => {
  const h = await startHarness();
  try {
    await setFlag(h, 'keep', { default: true, rules: [] });
    const bad = await setFlag(h, 'keep', { default: false, rules: [{ audience: { kind: 'plan', plan: 'gold' }, enabled: true }] });
    assert.equal(bad.status, 400);
    const read = await h.call('GET', '/v1/admin/flags', { token: h.adminToken });
    assert.equal(read.body.flags.keep.default, true);
  } finally { await h.close(); }
});

test('the signed grant carries each flag already resolved for that person, and keeps other people\'s rules out', async () => {
  const h = await startHarness();
  try {
    const endsAtMs = h.clock.now + 3 * DAY;
    await setFlag(h, 'watermarkCustom', { default: false, rules: [{ audience: { kind: 'plan', plan: 'pro' }, enabled: true }] });
    await setFlag(h, 'smartCulling', { default: false, rules: [{ audience: { kind: 'user', email: 'user@example.test' }, enabled: true, trial: true, endsAtMs }] });
    await setFlag(h, 'speciesId', { default: false, rules: [{ audience: { kind: 'user', email: 'someone@else.test' }, enabled: true }] });
    await setFlag(h, 'onlineAi', { default: true, kill: true, rules: [] });
    const response = await activate(h);
    assert.equal(response.status, 200);
    const checked = await verifyEntitlementGrant(response.body.grant, keys(h), DEVICE);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.deepEqual(checked.grant.flags, {
      watermarkCustom: { on: true },
      smartCulling: { on: true, trial: true, endsAtMs },
      speciesId: { on: false },
      onlineAi: { on: false },
    });
    assert.equal(JSON.stringify(response.body).includes('else.test'), false);
  } finally { await h.close(); }
});

test('with no flags defined the grant is exactly the old grant', async () => {
  const h = await startHarness();
  try {
    const checked = await verifyEntitlementGrant((await activate(h)).body.grant, keys(h), DEVICE);
    assert.equal(checked.ok, true);
    if (checked.ok) assert.equal(Object.hasOwn(checked.grant, 'flags'), false);
  } finally { await h.close(); }
});

test('the public document is signed and carries no named users or organisations', async () => {
  const h = await startHarness();
  try {
    await setFlag(h, 'watermarkCustom', { default: false, rules: [
      { audience: { kind: 'user', email: 'user@example.test' }, enabled: true },
      { audience: { kind: 'corporate', name: 'Acme Ltd' }, enabled: true },
      { audience: { kind: 'plan', plan: 'pro' }, enabled: true },
      { audience: { kind: 'any' }, enabled: true, trial: true, endsAtMs: h.clock.now + DAY },
    ] });
    const response = await h.call('GET', '/v1/flags/public');
    assert.equal(response.status, 200);
    const opened = await openEnvelope(response.body, keys(h));
    assert.ok(!('failure' in opened));
    if ('failure' in opened) return;
    const flags = (opened.payload as { flags: Record<string, { rules: unknown[] }> }).flags;
    assert.equal(flags.watermarkCustom.rules.length, 2);
    const text = JSON.stringify(response.body) + JSON.stringify(opened.payload);
    assert.equal(text.includes('Acme'), false);
    assert.equal(text.includes('example.test'), false);
  } finally { await h.close(); }
});

test('deleting a flag removes it, and deleting one that is not there is harmless', async () => {
  const h = await startHarness();
  try {
    await setFlag(h, 'masks', { default: false, rules: [] });
    const gone = await h.call('POST', '/v1/admin/flags/delete', { token: h.adminToken, body: { key: 'masks' } });
    assert.deepEqual(gone.body, { key: 'masks', existed: true });
    const again = await h.call('POST', '/v1/admin/flags/delete', { token: h.adminToken, body: { key: 'masks' } });
    assert.equal(again.body.existed, false);
    assert.deepEqual((await h.call('GET', '/v1/admin/flags', { token: h.adminToken })).body.flags, {});
  } finally { await h.close(); }
});
