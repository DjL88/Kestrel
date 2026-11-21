import assert from 'node:assert/strict';
import test from 'node:test';
import { coversVersion, emailHashOf, giftEntitlement, purchaseEntitlement } from '../src/entitlement.ts';
import { newTestStore } from './helpers.ts';

const NOW = Date.UTC(2026, 10, 21, 12);

test('a paid entitlement is derived from the checkout reference and marked paid', () => {
  const a = purchaseEntitlement({ email: ' Ann@Example.com ', checkoutReference: 'chk_123', majorVersion: 1 }, NOW);
  assert.equal(a.licenceId, 'lic_p_chk_123');
  assert.equal(a.paid, true);
  assert.equal(a.source, 'purchase');
  assert.equal(a.plan, 'paid');
  assert.equal(a.emailHash, emailHashOf('ann@example.com'), 'the email is normalised, then hashed');
  assert.ok(!JSON.stringify(a).includes('example.com'), 'the address itself is never stored');
  assert.throws(() => purchaseEntitlement({ email: 'a@b.c', checkoutReference: '../x', majorVersion: 1 }, NOW), /checkout reference/);
  assert.throws(() => purchaseEntitlement({ email: 'a@b.c', checkoutReference: 'ok', majorVersion: 0 }, NOW), /version/);
});

test('a gift is free but still grants the plan, once per person, plan and version', () => {
  const a = giftEntitlement({ email: 'Ann@example.com', plan: 'paid', majorVersion: 1, managedAi: true, note: 'Camera club' }, NOW);
  const b = giftEntitlement({ email: 'ann@example.com ', plan: 'paid', majorVersion: 1 }, NOW + 1000);
  assert.equal(a.licenceId, b.licenceId);
  assert.equal(a.paid, false);
  assert.equal(a.source, 'gift');
  assert.equal(a.managedAi, true);
  assert.notEqual(giftEntitlement({ email: 'ann@example.com', plan: 'paid', majorVersion: 2 }, NOW).licenceId, a.licenceId);
});

test('a licence covers its own major version and older apps, not a newer one', () => {
  assert.equal(coversVersion({ majorVersion: 1 }, 1), true);
  assert.equal(coversVersion({ majorVersion: 2 }, 1), true);
  assert.equal(coversVersion({ majorVersion: 1 }, 2), false);
});

test('granting twice creates one entitlement, and it waits for the person to sign in', async () => {
  const store = await newTestStore();
  try {
    const grant = purchaseEntitlement({ email: 'ann@example.com', checkoutReference: 'chk_1', majorVersion: 1 }, NOW);
    assert.equal((await store.grantLicence(grant)).created, true);
    const again = await store.grantLicence({ ...grant, plan: 'free' });
    assert.equal(again.created, false);
    assert.equal(again.licence.plan, 'paid', 'a replay never changes what was granted');

    // Before sign-up nothing is attached to an account.
    assert.equal((await store.getLicence(grant.licenceId))?.accountId, null);
    const accountId = 'acc_ann';
    assert.equal(await store.createAccount({ accountId, emailHash: emailHashOf('ann@example.com'), passwordHash: 'x', role: 'user', status: 'active', createdAtMs: NOW }), true);
    assert.equal(await store.claimLicencesForEmail(emailHashOf('ann@example.com'), accountId), 1);
    assert.equal(await store.claimLicencesForEmail(emailHashOf('ann@example.com'), accountId), 0, 'already claimed');
    const mine = await store.listLicencesForAccount(accountId);
    assert.equal(mine.length, 1);
    assert.deepEqual([mine[0].paid, mine[0].source, mine[0].majorVersion], [true, 'purchase', 1]);
  } finally { await store.close(); }
});

test('a claim cannot take a licence that already belongs to someone else', async () => {
  const store = await newTestStore();
  try {
    const grant = giftEntitlement({ email: 'ann@example.com', plan: 'paid', majorVersion: 1 }, NOW);
    await store.grantLicence(grant);
    await store.createAccount({ accountId: 'acc_a', emailHash: emailHashOf('ann@example.com'), passwordHash: 'x', role: 'user', status: 'active', createdAtMs: NOW });
    await store.createAccount({ accountId: 'acc_b', emailHash: emailHashOf('bob@example.com'), passwordHash: 'x', role: 'user', status: 'active', createdAtMs: NOW });
    assert.equal(await store.claimLicencesForEmail(emailHashOf('bob@example.com'), 'acc_b'), 0, "Bob's email does not match Ann's grant");
    assert.equal(await store.claimLicencesForEmail(emailHashOf('ann@example.com'), 'acc_a'), 1);
    assert.equal(await store.claimLicencesForEmail(emailHashOf('ann@example.com'), 'acc_b'), 0);
  } finally { await store.close(); }
});
