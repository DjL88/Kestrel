import assert from 'node:assert/strict';
import test from 'node:test';
import { accessCapabilities } from './commercialAccess.ts';
import { FEATURE_NAMES, featureAvailable } from './features.ts';

const free = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
const paid = accessCapabilities({ plan: 'paid', licence: 'active', cloud: 'none', online: false, cachedLocalLicence: true });
const offlinePaid = accessCapabilities({ plan: 'paid', licence: 'unverified', cloud: 'none', online: false, cachedLocalLicence: true });
const cancelledCloud = accessCapabilities({ plan: 'paid', licence: 'active', cloud: 'cancelled', online: true, cachedLocalLicence: true });

test('Free includes everyday editing, natural Auto, subject detection, masks and full-size export', () => {
  assert.deepEqual(FEATURE_NAMES.filter((name) => featureAvailable(name, free)).sort(),
    ['autoTab', 'basicEditing', 'cropAndStraighten', 'export', 'import', 'localBackup', 'macroPad', 'masks', 'subjectDetection', 'watermark']);
});

test('Pro adds advanced classification and automation instead of withholding photo fidelity', () => {
  for (const name of ['speciesId', 'onlineAi', 'smartCulling'] as const) assert.equal(featureAvailable(name, free), false, name);
  for (const name of ['masks', 'subjectDetection', 'autoTab', 'export', 'localBackup'] as const) assert.equal(featureAvailable(name, free), true, name);
});

test('Paid opens every feature, including offline with a cached licence', () => {
  for (const name of FEATURE_NAMES) {
    assert.equal(featureAvailable(name, paid), true, name);
    assert.equal(featureAvailable(name, offlinePaid), true, name);
  }
});

test('ending the cloud subscription never takes away a Paid licence', () => {
  for (const name of FEATURE_NAMES) assert.equal(featureAvailable(name, cancelledCloud), true, name);
});

test('local recovery is never gated, even on Free', () => {
  assert.equal(free.localBackups, true);
  assert.equal(free.localDataExport, true);
  assert.equal(free.localProjectAccess, true);
});
