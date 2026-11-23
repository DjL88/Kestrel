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

test('V2 cloud remains download-only for 90 days after the verified paid-through date', () => {
  const paidThrough = NOW - 10 * DAY;
  const base = { plan: 'subscriber' as const, licence: 'active' as const, cachedLocalLicence: true, online: true, cloud: 'cancelled' as const, nowMs: NOW, cloudPaidThroughMs: paidThrough, cloudQuotaBytes: 50_000_000_000 };
  const result = accessCapabilities(base);
  assert.equal(CLOUD_READ_ONLY_DAYS, 90);
  assert.equal(result.cloudReadOnlyUntilMs, paidThrough + 90 * DAY);
  assert.equal(result.cloudDownloads, true);
  assert.equal(result.cloudUploads, false);
  assert.equal(result.cloudAi, false);
  assert.equal(accessCapabilities({ ...base, nowMs: paidThrough + 90 * DAY }).cloudDownloads, true);
  assert.equal(accessCapabilities({ ...base, nowMs: paidThrough + 90 * DAY + 1 }).cloudDownloads, false);
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

test('legacy plan-less active cloud cannot authorise upload or AI without a verified subscription', () => {
  const legacy = { licence: 'active' as const, cloud: 'active' as const,
    online: true, cachedLocalLicence: true, cloudQuotaBytes: 1_000_000_000,
    nowMs: NOW };
  for (const patch of [
    {},
    { cloudPaidThroughMs: NOW + DAY },
    { plan: 'paid' as const, cloudPaidThroughMs: NOW + DAY },
    { plan: 'subscriber' as const, cloudPaidThroughMs: undefined },
  ]) {
    const result = accessCapabilities({ ...legacy, ...patch });
    assert.equal(result.cloudUploads, false, JSON.stringify(patch));
    assert.equal(result.cloudAi, false, JSON.stringify(patch));
    assert.equal(result.cloudQuotaBytes, null, JSON.stringify(patch));
  }
  assert.equal(accessCapabilities({ ...legacy, plan: 'subscriber', cloudPaidThroughMs: NOW + DAY }).cloudUploads, true);
});

test('expired Pro Cloud subscription does not lock local recovery and exports, and read-only does not require active editor licence', () => {
  const subscription = { plan: 'subscriber' as const, licence: 'unlicensed' as const,
    cloud: 'cancelled' as const, online: true, cachedLocalLicence: false,
    cloudPaidThroughMs: NOW - 10 * DAY, nowMs: NOW,
    cloudQuotaBytes: 50 * 1_000_000_000 };
  const result = accessCapabilities(subscription);
  assert.equal(result.cloudUploads, false);
  assert.equal(result.cloudAi, false);
  assert.equal(result.cloudDownloads, true, 'read-only retained files remain downloadable');
  assert.equal(result.fullEditor, false);
  assert.equal(result.localDataExport, true);
  assert.equal(result.localBackups, true);
  assert.equal(result.localProjectAccess, true);
  assert.equal(accessCapabilities({ ...subscription, nowMs: NOW + 100 * DAY }).cloudDownloads, false);
});

test('invalid timestamps and unknown plans never turn on cloud capability', () => {
  const base = { licence: 'active' as const, cloud: 'active' as const, online: true,
    cachedLocalLicence: true, cloudQuotaBytes: 1000 };
  for (const time of [undefined, Number.NaN, -1, Infinity, 1.25]) {
    const r = accessCapabilities({ ...base, plan: 'subscriber', nowMs: NOW,
      cloudPaidThroughMs: time });
    assert.equal(r.cloudUploads, false);
  }
  assert.equal(accessCapabilities({ ...base, plan: 'subscriber', nowMs: undefined,
    cloudPaidThroughMs: NOW + 1000 }).cloudUploads, false);
});
