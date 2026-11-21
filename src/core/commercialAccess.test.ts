import test from 'node:test';
import assert from 'node:assert/strict';
import { accessCapabilities, CLOUD_READ_ONLY_DAYS, PROPOSED_UK_PRICES } from './commercialAccess';

const NOW = Date.UTC(2026, 10, 15);
const DAY = 86400000;

test('Free gets basic editing and local export without registration', () => {
  const result = accessCapabilities({ plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false });
  assert.equal(result.localEditing, true);
  assert.equal(result.fullEditor, false);
  assert.equal(result.localProjectAccess, true);
  assert.equal(result.localBackups, true);
  assert.equal(result.localDataExport, true);
  assert.equal(result.cloudUploads, false);
  assert.equal(result.cloudAi, false);
});

test('£29 lifetime licence unlocks full desktop editor, works offline and never needs cloud', () => {
  const result = accessCapabilities({ plan: 'paid', licence: 'unverified', cachedLocalLicence: true, cloud: 'none', online: false });
  assert.equal(result.fullEditor, true);
  assert.equal(result.cloudUploads, false);
  assert.equal(result.cloudDownloads, false);
  assert.equal(result.requiresLicenceVerification, false);
});

test('Subscriber can upload and use cloud AI only while active, paid and online', () => {
  const base = { plan: 'subscriber' as const, licence: 'active' as const, cachedLocalLicence: true, cloud: 'active' as const, online: true, nowMs: NOW, cloudPaidThroughMs: NOW + DAY, cloudQuotaBytes: 50 * 1_000_000_000 };
  const ready = accessCapabilities(base);
  assert.equal(ready.fullEditor, true);
  assert.equal(ready.cloudUploads, true);
  assert.equal(ready.cloudDownloads, true);
  assert.equal(ready.cloudAi, true);
  assert.equal(ready.cloudQuotaBytes, 50_000_000_000);
  assert.equal(accessCapabilities({ ...base, online: false }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloudQuotaBytes: -1 }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloudQuotaBytes: NaN }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloudPaidThroughMs: NOW - 1 }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloud: 'past_due' }).cloudUploads, false);
  assert.equal(accessCapabilities({ ...base, cloud: 'cancelled' }).cloudAi, false);
});

test('Cloud retention stays download-only for 365 days after paid entitlement ends', () => {
  const paidThrough = NOW - 10 * DAY;
  const base = { plan: 'subscriber' as const, licence: 'active' as const, cachedLocalLicence: true, online: true, cloud: 'cancelled' as const, nowMs: NOW, cloudPaidThroughMs: paidThrough, cloudQuotaBytes: 50_000_000_000 };
  const result = accessCapabilities(base);
  assert.equal(CLOUD_READ_ONLY_DAYS, 365);
  assert.equal(result.cloudReadOnlyUntilMs, paidThrough + 365 * DAY);
  assert.equal(result.cloudDownloads, true);
  assert.equal(result.cloudUploads, false);
  assert.equal(result.cloudAi, false);
  assert.equal(accessCapabilities({ ...base, nowMs: paidThrough + 365 * DAY }).cloudDownloads, true);
  assert.equal(accessCapabilities({ ...base, nowMs: paidThrough + 365 * DAY + 1 }).cloudDownloads, false);
  assert.equal(accessCapabilities({ ...base, online: false }).cloudDownloads, false);
  assert.equal(accessCapabilities({ ...base, cloud: 'none' }).cloudDownloads, false);
});

test('Read-only cloud grace requires a trustworthy paid-through date and never grants paid access to Free', () => {
  const base = { plan: 'subscriber' as const, licence: 'active' as const, cachedLocalLicence: true, online: true, cloud: 'cancelled' as const, nowMs: NOW };
  assert.equal(accessCapabilities(base).cloudDownloads, false);
  assert.equal(accessCapabilities({ ...base, cloudPaidThroughMs: Number.NaN }).cloudDownloads, false);
  assert.equal(accessCapabilities({ ...base, cloudPaidThroughMs: -1 }).cloudDownloads, false);
  assert.equal(accessCapabilities({ ...base, nowMs: undefined, cloudPaidThroughMs: NOW }).cloudDownloads, false);
  assert.equal(accessCapabilities({ ...base, plan: 'free', cloudPaidThroughMs: NOW }).cloudDownloads, false);
});

test('Expired or cancelled cloud subscription never locks local editing, exports or backups', () => {
  for (const cloud of ['cancelled', 'past_due', 'none'] as const) {
    const result = accessCapabilities({ plan: 'paid', licence: 'active', cachedLocalLicence: true, cloud, online: false });
    assert.equal(result.fullEditor, true);
    assert.equal(result.localDataExport, true);
    assert.equal(result.localBackups, true);
    assert.equal(result.cloudUploads, false);
  }
});

test('Older stored entitlement snapshots remain migratable and local content stays recoverable', () => {
  const result = accessCapabilities({ licence: 'active', cachedLocalLicence: true, cloud: 'none', online: false });
  assert.equal(result.fullEditor, true);
  assert.equal(result.localProjectAccess, true);
  assert.equal(result.cloudDownloads, false);
  assert.deepEqual(PROPOSED_UK_PRICES, { localPence: 2900, currency: 'GBP' });
});
