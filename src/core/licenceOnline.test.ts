import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInDaysLeft, decideAccess, decideAccountAccess, NEW_DEVICE_CHECK_IN_DAYS, parseControlPlaneUrl, parsePinnedKeys, platformOf, renewalDue, RENEW_AFTER_MS } from './licenceOnline';
import type { EntitlementGrant } from './entitlementGrant';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 21);
const grant = (overrides: Partial<EntitlementGrant> = {}): EntitlementGrant => ({
  schema: 1, grantId: 'grt_abcdefgh', plan: 'paid', managedAi: false, deviceHash: 'a'.repeat(64), issuedAtMs: NOW, offlineUntilMs: NOW + 30 * DAY, ...overrides,
});

test('pinned keys come from a build setting; anything malformed is left out', () => {
  const key = 'fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=';
  assert.deepEqual(parsePinnedKeys(`kcp-2026-11=${key}, bad=short, =${key}, ok.2=${key}`), { 'kcp-2026-11': key, 'ok.2': key });
  assert.deepEqual(parsePinnedKeys(undefined), {});
});

test('the control plane address must be https (http only on this computer), with no credentials or query', () => {
  assert.equal(parseControlPlaneUrl('https://kcp.example.app/'), 'https://kcp.example.app');
  assert.equal(parseControlPlaneUrl('http://localhost:8787'), 'http://localhost:8787');
  for (const bad of ['http://kcp.example.app', 'https://user:pw@kcp.example.app', 'https://kcp.example.app/?x=1', 'ftp://x', 'not a url', '', undefined]) {
    assert.equal(parseControlPlaneUrl(bad), null, String(bad));
  }
});

test('renewal is due with no grant, after a week, or in the last week of the offline window', () => {
  assert.equal(renewalDue(null, NOW), true);
  assert.equal(renewalDue(grant(), NOW + DAY), false);
  assert.equal(renewalDue(grant(), NOW + RENEW_AFTER_MS), true);
  assert.equal(renewalDue(grant({ offlineUntilMs: NOW + 10 * DAY }), NOW + 4 * DAY), true);
});

test('platform names follow the shell, not just the browser', () => {
  assert.equal(platformOf(true, 'Mozilla/5.0 (Windows NT 10.0)'), 'windows');
  assert.equal(platformOf(true, 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'), 'macos');
  assert.equal(platformOf(true, 'Mozilla/5.0 (Linux; Android 14)'), 'android');
  assert.equal(platformOf(true, 'Mozilla/5.0 (iPad; CPU OS 18)'), 'ios');
  assert.equal(platformOf(false, 'Mozilla/5.0 (Macintosh)'), 'web');
});

test('Pro: signed key remains valid offline, while last-known server denials override it', () => {
  assert.deepEqual(decideAccess(false, { kind: 'active', grant: grant(), activationId: 'act_1' }, NOW), { pro: false, managedAi: false, basis: 'none' });
  assert.deepEqual(decideAccess(true, { kind: 'not_set_up' }, NOW), { pro: true, managedAi: false, basis: 'key' });
  assert.deepEqual(decideAccess(true, { kind: 'not_checked' }, NOW), { pro: true, managedAi: false, basis: 'key' });
  assert.deepEqual(decideAccess(true, { kind: 'device_limit', message: 'Full' }, NOW), { pro: false, managedAi: false, basis: 'none' });
  assert.deepEqual(decideAccess(true, { kind: 'unreachable', grant: null, activationId: null }, NOW), { pro: true, managedAi: false, basis: 'key' });
  assert.deepEqual(decideAccess(true, { kind: 'unreachable', grant: grant({ plan: 'free' }), activationId: 'act_1' }, NOW), { pro: false, managedAi: false, basis: 'none' });
  assert.deepEqual(decideAccess(true, { kind: 'active', grant: grant({ managedAi: true }), activationId: 'act_1' }, NOW), { pro: true, managedAi: true, basis: 'grant' });
  assert.deepEqual(decideAccess(true, { kind: 'unreachable', grant: grant({ managedAi: true }), activationId: 'act_1' }, NOW + 31 * DAY), { pro: true, managedAi: false, basis: 'key' });
  assert.deepEqual(decideAccess(true, { kind: 'active', grant: grant({ plan: 'free' }), activationId: 'act_1' }, NOW), { pro: false, managedAi: false, basis: 'none' });
  assert.deepEqual(decideAccess(true, { kind: 'revoked', message: 'x' }, NOW), { pro: false, managedAi: false, basis: 'revoked' });
});

test('an account licence bought outright keeps Pro past the offline window; managed AI does not', () => {
  const owned = grant({ managedAi: true, flags: { 'licence.owned': { on: true } } });
  assert.deepEqual(decideAccountAccess({ kind: 'active', grant: owned, activationId: 'act_1' }, NOW), { pro: true, managedAi: true, basis: 'grant' });
  // Years with no server at all: still Pro on this device, never managed AI.
  assert.deepEqual(decideAccountAccess({ kind: 'active', grant: owned, activationId: 'act_1' }, NOW + 3650 * DAY), { pro: true, managedAi: false, basis: 'grant' });
  // A revoke or refund heard online still wins.
  assert.deepEqual(decideAccountAccess({ kind: 'revoked', message: 'Refunded' }, NOW), { pro: false, managedAi: false, basis: 'revoked' });
  // Only "on for good" counts: a trial, a time-boxed or an "off" flag, or a non-paid plan, lapses as before.
  for (const flag of [{ on: false }, { on: true, trial: true as const }, { on: true, endsAtMs: NOW + 400 * DAY }]) {
    assert.equal(decideAccountAccess({ kind: 'active', grant: grant({ flags: { 'licence.owned': flag } }), activationId: 'act_1' }, NOW + 31 * DAY).pro, false);
  }
  assert.equal(decideAccountAccess({ kind: 'active', grant: grant({ plan: 'subscriber', flags: { 'licence.owned': { on: true } } }), activationId: 'act_1' }, NOW + 31 * DAY).pro, false);
});

test('an account has nothing to fall back on: Pro only inside the grant\'s offline window (30 days by default)', () => {
  assert.deepEqual(decideAccountAccess({ kind: 'no_licence' }, NOW), { pro: false, managedAi: false, basis: 'none' });
  assert.deepEqual(decideAccountAccess({ kind: 'revoked', message: 'x' }, NOW), { pro: false, managedAi: false, basis: 'revoked' });
  assert.deepEqual(decideAccountAccess({ kind: 'device_limit', message: 'x' }, NOW), { pro: false, managedAi: false, basis: 'none' });
  // Inside the window: Pro, with whatever managed-AI flag the grant carries.
  assert.deepEqual(decideAccountAccess({ kind: 'active', grant: grant({ managedAi: true }), activationId: 'act_1' }, NOW),
    { pro: true, managedAi: true, basis: 'grant' });
  // Exactly on the boundary still counts.
  assert.deepEqual(decideAccountAccess({ kind: 'active', grant: grant(), activationId: 'act_1' }, NOW + 30 * DAY),
    { pro: true, managedAi: false, basis: 'grant' });
  // One tick past 30 days offline with no successful renewal: back to Basic, unlike a signed key
  // there is no fallback that keeps it Pro.
  assert.deepEqual(decideAccountAccess({ kind: 'active', grant: grant(), activationId: 'act_1' }, NOW + 30 * DAY + 1),
    { pro: false, managedAi: false, basis: 'none' });
  // A grant that was always Free never counts, whatever its window.
  assert.deepEqual(decideAccountAccess({ kind: 'active', grant: grant({ plan: 'free' }), activationId: 'act_1' }, NOW),
    { pro: false, managedAi: false, basis: 'none' });
});

test('a new device must register its key once within 30 days, so one key cannot spread over unlimited offline devices', () => {
  const first = NOW;
  const never = { kind: 'not_checked' } as const;
  const unreachableNever = { kind: 'unreachable', grant: null, activationId: null } as const;
  assert.equal(NEW_DEVICE_CHECK_IN_DAYS, 30);
  assert.deepEqual(decideAccess(true, never, NOW + 30 * DAY, first), { pro: true, managedAi: false, basis: 'key' });
  assert.equal(checkInDaysLeft(never, first, NOW + 10 * DAY), 20);
  assert.deepEqual(decideAccess(true, never, NOW + 30 * DAY + 1, first), { pro: false, managedAi: false, basis: 'check_in' });
  assert.deepEqual(decideAccess(true, unreachableNever, NOW + 31 * DAY, first), { pro: false, managedAi: false, basis: 'check_in' });
  // Registered once: Pro for good on this device, with no server, years later.
  assert.deepEqual(decideAccess(true, { kind: 'unreachable', grant: grant(), activationId: 'act_1' }, NOW + 3650 * DAY, first), { pro: true, managedAi: false, basis: 'key' });
  assert.equal(checkInDaysLeft({ kind: 'unreachable', grant: grant(), activationId: 'act_1' }, first, NOW), null);
  // Builds with no licence service never ask (firstUse is null there).
  assert.deepEqual(decideAccess(true, { kind: 'not_set_up' }, NOW + 3650 * DAY, null), { pro: true, managedAi: false, basis: 'key' });
});
