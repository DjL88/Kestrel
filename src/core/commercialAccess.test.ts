import test from 'node:test';
import assert from 'node:assert/strict';
import { accessCapabilities, PROPOSED_UK_PRICES } from './commercialAccess';

test('purchased local editing continues offline without cloud', () => {
  const access = accessCapabilities({ licence: 'unverified', cloud: 'none', online: false, cachedLocalLicence: true });
  assert.equal(access.localEditing, true);
  assert.equal(access.cloudUploads, false);
  assert.equal(access.localProjectAccess, true);
  assert.equal(access.localBackups, true);
});

test('cancelled subscriptions never disable a purchased local editor', () => {
  for (const cloud of ['cancelled', 'past_due', 'none'] as const) {
    const access = accessCapabilities({ licence: 'active', cloud, online: true, cachedLocalLicence: true });
    assert.equal(access.localEditing, true);
    assert.equal(access.cloudUploads, false);
    assert.equal(access.cloudDownloads, false);
  }
});

test('server-confirmed cloud quota is required to propose uploads', () => {
  const base = { licence: 'active' as const, cloud: 'active' as const, online: true, cachedLocalLicence: true };
  assert.equal(accessCapabilities(base).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloudQuotaBytes: -1 }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloudQuotaBytes: Number.NaN }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloudQuotaBytes: 50 * 1000 ** 3 }).cloudUploads, true);
  assert.equal(accessCapabilities({ ...base, online: false, cloudQuotaBytes: 50 * 1000 ** 3 }).cloudUploads, false);
});

test('unlicensed users still retain access to their own project data and backups', () => {
  const access = accessCapabilities({ licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
  assert.equal(access.localEditing, false);
  assert.equal(access.localProjectAccess, true);
  assert.equal(access.localBackups, true);
});

test('trial can edit locally but does not grant cloud storage', () => {
  const access = accessCapabilities({ licence: 'trial', cloud: 'active', online: true, cachedLocalLicence: false, cloudQuotaBytes: 1000 });
  assert.equal(access.localEditing, true);
  assert.equal(access.cloudUploads, false);
});

test('launch prices are fixed pennies without floating point rounding', () => {
  assert.deepEqual(PROPOSED_UK_PRICES, { localPence: 2900, cloudMonthlyPence: 299, currency: 'GBP' });
});
