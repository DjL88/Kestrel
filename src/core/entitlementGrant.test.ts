import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEntitlementGrant } from './entitlementGrant.ts';

const base = { schema: 1, grantId: 'grt_abcdefgh1234', plan: 'paid', managedAi: false, deviceHash: 'a'.repeat(64), issuedAtMs: 1_000, offlineUntilMs: 2_000_000 };

test('a grant without flags is exactly the old grant', () => {
  const parsed = parseEntitlementGrant(base);
  assert.deepEqual(parsed, base);
  assert.equal(parsed && Object.hasOwn(parsed, 'flags'), false);
});

test('a grant can carry resolved flags', () => {
  const flags = { smartCulling: { on: true, trial: true, endsAtMs: 5_000 }, masks: { on: false } };
  assert.deepEqual(parseEntitlementGrant({ ...base, flags })?.flags, flags);
});

test('malformed flags, unknown fields, or a missing field refuse the grant', () => {
  assert.equal(parseEntitlementGrant({ ...base, flags: { a: { on: 'yes' } } }), null);
  assert.equal(parseEntitlementGrant({ ...base, flags: 'on' }), null);
  assert.equal(parseEntitlementGrant({ ...base, surprise: 1 }), null);
  const { grantId: _omit, ...missing } = base;
  assert.equal(parseEntitlementGrant(missing), null);
});
