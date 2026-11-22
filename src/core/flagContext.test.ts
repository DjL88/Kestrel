import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntitlementGrant } from './entitlementGrant.ts';
import { assembleFlags, audienceFor, grantInForce } from './flagContext.ts';
import { accessCapabilities } from './commercialAccess.ts';
import { evaluateFeature, featureAvailable } from './features.ts';

const NOW = Date.UTC(2026, 10, 22);
const DAY = 86_400_000;
const grant = (plan: EntitlementGrant['plan'], flags?: EntitlementGrant['flags'], until = NOW + 5 * DAY): EntitlementGrant =>
  ({ schema: 1, grantId: 'grt_abcdefgh1234', plan, managedAi: false, deviceHash: 'a'.repeat(64), issuedAtMs: NOW - DAY, offlineUntilMs: until, ...(flags ? { flags } : {}) });
const free = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });

test('the audience is Pro with a paid grant in force, Basic when signed in, and Unknown otherwise', () => {
  assert.deepEqual(audienceFor(grant('paid'), NOW, false), { plan: 'pro' });
  assert.deepEqual(audienceFor(grant('free'), NOW, false), { plan: 'basic' });
  assert.deepEqual(audienceFor(null, NOW, true), { plan: 'basic' });
  assert.deepEqual(audienceFor(null, NOW, false), { plan: 'unknown' });
  assert.deepEqual(audienceFor(grant('paid', undefined, NOW - 1), NOW, false), { plan: 'unknown' }, 'a lapsed grant says nothing');
  assert.equal(grantInForce(grant('paid'), NOW), true);
  assert.equal(grantInForce(undefined, NOW), false);
});

test('grant flags replace the public rule for the same key, and a lapsed grant adds nothing', () => {
  const publicFlags = { smartCulling: { default: false, rules: [{ audience: { kind: 'plan' as const, plan: 'unknown' as const }, enabled: true, trial: true }] }, speciesId: { default: false, rules: [] } };
  const g = grant('free', { smartCulling: { on: false }, speciesId: { on: true } });
  const merged = assembleFlags(publicFlags, g, NOW);
  assert.equal(merged.smartCulling.default, false);
  assert.equal(merged.smartCulling.rules.length, 0, 'the grant replaced the public rule');
  assert.equal(merged.speciesId.default, true);
  assert.equal(assembleFlags(publicFlags, grant('free', { speciesId: { on: true } }, NOW - 1), NOW).speciesId.default, false);
  assert.deepEqual(assembleFlags(undefined, null, NOW), {});
});

test('a public trial for people without an account opens a Pro feature for them only, and says it is a trial', () => {
  const publicFlags = { smartCulling: { default: false, rules: [{ audience: { kind: 'plan' as const, plan: 'unknown' as const }, enabled: true, trial: true, endsAtMs: NOW + DAY }] } };
  const ask = (signedIn: boolean) => evaluateFeature('smartCulling', free, {
    flags: assembleFlags(publicFlags, null, NOW), audience: audienceFor(null, NOW, signedIn), nowMs: NOW,
  });
  assert.deepEqual(ask(false), { on: true, reason: 'rule-plan', trial: true });
  assert.equal(ask(true).on, false, 'a signed-in Basic person is not in a trial aimed at people without an account');
});

test('a trial from a grant closes on time with no network, and free work is untouched', () => {
  const g = grant('free', { smartCulling: { on: true, trial: true, endsAtMs: NOW + DAY } });
  const during = (t: number) => featureAvailable('smartCulling', free, { flags: assembleFlags(undefined, g, t), audience: audienceFor(g, t, true), nowMs: t });
  assert.equal(during(NOW), true);
  assert.equal(during(NOW + 2 * DAY), false);
  assert.equal(featureAvailable('masks', free, { flags: assembleFlags(undefined, g, NOW + 2 * DAY), nowMs: NOW + 2 * DAY }), true);
});
