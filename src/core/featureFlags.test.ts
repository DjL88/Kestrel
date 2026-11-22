import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, evaluateFlag, forPublicDocument, newBucket, parseFlagSet, type FlagSet } from './featureFlags.ts';
import { accessCapabilities } from './commercialAccess.ts';
import { COMPILED_FLAGS, FEATURE_NAMES, NEVER_GATED, evaluateFeature, featureAvailable } from './features.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22);
const none: FlagSet = {};
const ask = (flags: FlagSet, audience: Parameters<typeof evaluateFlag>[3]['audience'], extra: Partial<Parameters<typeof evaluateFlag>[3]> = {}) =>
  evaluateFlag('watermarkCustom', flags, none, { audience, nowMs: NOW, ...extra });

test('with no rule the default applies, and an unknown flag is off', () => {
  assert.deepEqual(ask({ watermarkCustom: { default: true, rules: [] } }, { plan: 'basic' }), { on: true, reason: 'default', trial: false });
  assert.deepEqual(ask({}, { plan: 'pro' }), { on: false, reason: 'unknown-flag', trial: false });
});

test('a plan rule opens a feature for Pro and leaves Basic and Unknown on the default', () => {
  const flags: FlagSet = { watermarkCustom: { default: false, rules: [{ audience: { kind: 'plan', plan: 'pro' }, enabled: true }] } };
  assert.equal(ask(flags, { plan: 'pro' }).on, true);
  assert.equal(ask(flags, { plan: 'basic' }).on, false);
  assert.equal(ask(flags, { plan: 'unknown' }).on, false);
});

test('a named user beats their plan, and a named organisation beats the plan too', () => {
  const flags: FlagSet = { watermarkCustom: { default: false, rules: [
    { audience: { kind: 'plan', plan: 'basic' }, enabled: false },
    { audience: { kind: 'user', email: 'Ann@Example.com' }, enabled: true },
    { audience: { kind: 'corporate', name: 'Acme Ltd' }, enabled: true },
  ] } };
  assert.deepEqual(ask(flags, { plan: 'basic', user: 'ann@example.com' }), { on: true, reason: 'rule-user', trial: false });
  assert.deepEqual(ask(flags, { plan: 'basic', corporate: ' acme ltd ' }), { on: true, reason: 'rule-corporate', trial: false });
  assert.equal(ask(flags, { plan: 'basic', user: 'bob@example.com' }).on, false);
});

test('at the same specificity a rule that switches a feature off beats one that switches it on', () => {
  const flags: FlagSet = { watermarkCustom: { default: false, rules: [
    { audience: { kind: 'plan', plan: 'pro' }, enabled: true },
    { audience: { kind: 'plan', plan: 'pro' }, enabled: false },
  ] } };
  assert.equal(ask(flags, { plan: 'pro' }).on, false);
});

test('a trial runs inside its date range, and an empty end date runs until it is stopped', () => {
  const ranged: FlagSet = { watermarkCustom: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, trial: true, startsAtMs: NOW - DAY, endsAtMs: NOW + DAY }] } };
  assert.deepEqual(ask(ranged, { plan: 'unknown' }), { on: true, reason: 'rule-any', trial: true });
  assert.equal(ask(ranged, { plan: 'unknown' }, { nowMs: NOW - 2 * DAY }).on, false, 'not started');
  assert.equal(ask(ranged, { plan: 'unknown' }, { nowMs: NOW + DAY }).on, false, 'the end is exclusive');
  const open: FlagSet = { watermarkCustom: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, trial: true, startsAtMs: NOW - DAY, endsAtMs: null }] } };
  assert.equal(ask(open, { plan: 'basic' }, { nowMs: NOW + 400 * DAY }).on, true);
  assert.equal(ask(open, { plan: 'basic' }, { nowMs: NOW + 400 * DAY }).trial, true);
});

test('a percentage rollout uses the private device bucket, and a device with no bucket is outside it', () => {
  const flags: FlagSet = { watermarkCustom: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, trial: true, percent: 20 }] } };
  assert.equal(ask(flags, { plan: 'unknown' }, { bucket: 19 }).on, true);
  assert.equal(ask(flags, { plan: 'unknown' }, { bucket: 20 }).on, false);
  assert.equal(ask(flags, { plan: 'unknown' }).on, false);
  assert.equal(newBucket(() => 0), 0);
  assert.equal(newBucket(() => 0.999999), 99);
});

test('the kill switch turns a feature off for everyone, and an old app sees it off', () => {
  const killed: FlagSet = { watermarkCustom: { default: true, kill: true, rules: [{ audience: { kind: 'any' }, enabled: true }] } };
  assert.deepEqual(ask(killed, { plan: 'pro' }), { on: false, reason: 'kill-switch', trial: false });
  const versioned: FlagSet = { watermarkCustom: { default: true, minAppVersion: '26.12.0', rules: [] } };
  assert.equal(ask(versioned, { plan: 'pro' }, { appVersion: '26.11.2' }).reason, 'app-too-old');
  assert.equal(ask(versioned, { plan: 'pro' }, { appVersion: '26.12.0' }).on, true);
  assert.ok(compareVersions('26.11.2', '26.11.10') < 0);
});

test('working with your own photos is never gated, whatever the rules say', () => {
  const hostile: FlagSet = Object.fromEntries([...NEVER_GATED].map((name) => [name, { default: false, kill: true, rules: [{ audience: { kind: 'any' as const }, enabled: false }] }]));
  const free = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
  for (const name of NEVER_GATED) {
    assert.deepEqual(evaluateFeature(name, free, { flags: hostile }), { on: true, reason: 'never-gated', trial: false }, name);
  }
});

test('the compiled defaults reproduce today exactly: free on for all, paid on for Pro only', () => {
  const free = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
  const paid = accessCapabilities({ plan: 'paid', licence: 'active', cloud: 'none', online: false, cachedLocalLicence: true });
  for (const name of FEATURE_NAMES) {
    assert.equal(featureAvailable(name, paid), true, name);
    assert.equal(featureAvailable(name, free), COMPILED_FLAGS[name].default, name);
  }
});

test('a trial can open a Pro feature for Basic people, then closes without affecting free features', () => {
  const free = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
  const flags: FlagSet = { smartCulling: { default: false, rules: [{ audience: { kind: 'plan', plan: 'basic' }, enabled: true, trial: true, startsAtMs: NOW - DAY, endsAtMs: NOW + DAY }] } };
  assert.deepEqual(evaluateFeature('smartCulling', free, { flags, nowMs: NOW }), { on: true, reason: 'rule-plan', trial: true });
  assert.equal(featureAvailable('smartCulling', free, { flags, nowMs: NOW + 2 * DAY }), false);
  assert.equal(featureAvailable('masks', free, { flags, nowMs: NOW + 2 * DAY }), true);
});

test('parsing drops malformed rules and flags instead of guessing', () => {
  const parsed = parseFlagSet({
    good: { default: true, kill: true, minAppVersion: '26.11', rules: [{ audience: { kind: 'plan', plan: 'pro' }, enabled: true, endsAtMs: null, percent: 50 }, { audience: { kind: 'plan', plan: 'gold' }, enabled: true }, { audience: { kind: 'any' } }, 'nonsense'] },
    'bad key!': { default: true, rules: [] },
    noDefault: { rules: [] },
    badPercent: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, percent: 150 }] },
  });
  assert.deepEqual(Object.keys(parsed).sort(), ['badPercent', 'good']);
  assert.equal(parsed.good.rules.length, 1);
  assert.equal(parsed.good.kill, true);
  assert.equal(parsed.badPercent.rules.length, 0);
  assert.deepEqual(parseFlagSet('not an object'), {});
});

test('the public document for people without an account carries no names or emails', () => {
  const flags: FlagSet = { watermarkCustom: { default: false, rules: [
    { audience: { kind: 'user', email: 'ann@example.com' }, enabled: true },
    { audience: { kind: 'corporate', name: 'Acme Ltd' }, enabled: true },
    { audience: { kind: 'plan', plan: 'pro' }, enabled: true },
    { audience: { kind: 'any' }, enabled: false, trial: true },
  ] } };
  const publicFlags = forPublicDocument(flags);
  assert.equal(publicFlags.watermarkCustom.rules.length, 2);
  assert.equal(JSON.stringify(publicFlags).includes('ann@example.com'), false);
  assert.equal(JSON.stringify(publicFlags).includes('Acme'), false);
});
