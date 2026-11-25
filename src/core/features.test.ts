import assert from 'node:assert/strict';
import test from 'node:test';
import { accessCapabilities } from './commercialAccess.ts';
import { COMPILED_FLAGS, FEATURE_NAMES, FEATURES, featureAvailable } from './features.ts';

const basic = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
const paid = accessCapabilities({ plan: 'paid', licence: 'active', cloud: 'none', online: false, cachedLocalLicence: true });
const offlinePaid = accessCapabilities({ plan: 'paid', licence: 'unverified', cloud: 'none', online: false, cachedLocalLicence: true });
const cancelledCloud = accessCapabilities({ plan: 'paid', licence: 'active', cloud: 'cancelled', online: true, cachedLocalLicence: true });

const proKeys = FEATURE_NAMES.filter((name) => FEATURES[name] === 'paid');

test('Basic includes overlays, custom watermarks and all local photographic essentials', () => {
  assert.deepEqual(FEATURE_NAMES.filter((name) => featureAvailable(name, basic)).sort(),
    ['autoTab', 'basicEditing', 'cropAndStraighten', 'export', 'import', 'localBackup', 'macroPad', 'masks',
      'overlayText', 'smartCulling', 'speciesId', 'splitFrames', 'subjectDetection', 'watermark', 'watermarkCustom', 'zoomVideo']);
});

test('Pro-tagged features are disabled by default even for paid and offline-paid accounts', () => {
  assert.deepEqual(proKeys.sort(), ['cloudAssist', 'onlineAi']);
  for (const name of proKeys) {
    assert.equal(COMPILED_FLAGS[name].default, false, name);
    assert.deepEqual(COMPILED_FLAGS[name].rules, [], name);
    for (const account of [basic, paid, offlinePaid, cancelledCloud]) {
      assert.equal(featureAvailable(name, account), false, name);
    }
  }
  for (const name of ['overlayText', 'watermarkCustom', 'export', 'localBackup'] as const) {
    assert.equal(featureAvailable(name, basic), true, name);
  }
});

test('stale Pro-only Admin rules cannot lock Basic text and watermark overlays', () => {
  const oldFlags = {
    overlayText: { default: false, kill: true, rules: [] },
    watermarkCustom: { default: false, rules: [{ audience: { kind: 'plan' as const, plan: 'pro' as const }, enabled: true }] },
  };
  assert.equal(featureAvailable('overlayText', basic, { flags: oldFlags }), true);
  assert.equal(featureAvailable('watermarkCustom', basic, { flags: oldFlags }), true);
});

test('an explicit verified Admin rule can enable a Pro feature for Pro or a named Basic trial', () => {
  const flags = { smartCulling: { default: false, rules: [
    { audience: { kind: 'plan' as const, plan: 'pro' as const }, enabled: true },
  ] } };
  assert.equal(featureAvailable('smartCulling', basic, { flags }), false);
  assert.equal(featureAvailable('smartCulling', paid, { flags }), true);
  assert.equal(featureAvailable('smartCulling', offlinePaid, { flags }), true);
  const trial = { smartCulling: { default: false, rules: [
    { audience: { kind: 'plan' as const, plan: 'basic' as const }, enabled: true, trial: true },
  ] } };
  assert.equal(featureAvailable('smartCulling', basic, { flags: trial }), true);
});

test('cloud cancellation never removes local Basic tools and never self-enables Pro', () => {
  for (const name of FEATURE_NAMES.filter((name) => FEATURES[name] === 'free')) {
    assert.equal(featureAvailable(name, cancelledCloud), true, name);
  }
  assert.equal(featureAvailable('cloudAssist', cancelledCloud), false);
});

test('local recovery remains available without a licence or Admin flags', () => {
  assert.equal(basic.localBackups, true);
  assert.equal(basic.localDataExport, true);
  assert.equal(basic.localProjectAccess, true);
});

test('every on-device model is Basic by default (owner decision 13), and an admin flag can still restrict it', () => {
  const basic = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
  for (const name of ['smartCulling', 'speciesId', 'subjectDetection', 'masks', 'autoTab'] as const) {
    assert.equal(featureAvailable(name, basic), true, name + ' is on for Basic with no flags');
    assert.equal(featureAvailable(name, basic, { flags: { [name]: { default: false, rules: [] } } }), false, name + ' can be switched off from /admin');
  }
  // The enhanced cloud models stay Pro and off until an admin flag enables them.
  for (const name of ['cloudAssist', 'onlineAi'] as const) assert.equal(featureAvailable(name, basic), false, name);
});
