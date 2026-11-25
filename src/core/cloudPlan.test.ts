import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOUD_COST_PENCE, FREE_DOWNLOAD_BYTES_PER_MONTH, FREE_STORAGE_BYTES, MONTHLY_PHOTO_ALLOWANCE, PAYG_PENCE,
  estimateCloudTask, formatBytes, formatPence, marginOf, nextResetMs, rentToOwn, usageSummary,
} from './cloudPlan.ts';

const NOW = Date.UTC(2026, 10, 25, 12, 0);

test('every pay-as-you-go line keeps at least 60% margin after VAT and Paddle fees', () => {
  assert.ok(marginOf(PAYG_PENCE.storagePerGbMonth, CLOUD_COST_PENCE.storagePerGbMonth) >= 0.6);
  assert.ok(marginOf(PAYG_PENCE.downloadPerGb, CLOUD_COST_PENCE.downloadPerGb) >= 0.6);
  assert.ok(marginOf(PAYG_PENCE.extraPhotoTenths / 10, CLOUD_COST_PENCE.photo) >= 0.6);
});

test('allowances: Basic 500 photos, Pro 5,000; 2.5 GB storage and 1 GB downloads free for everyone', () => {
  assert.equal(MONTHLY_PHOTO_ALLOWANCE.basic, 500);
  assert.equal(MONTHLY_PHOTO_ALLOWANCE.pro, 5000);
  assert.equal(FREE_STORAGE_BYTES, 2.5e9);
  assert.equal(FREE_DOWNLOAD_BYTES_PER_MONTH, 1e9);
});

test('the allowance month resets on the 1st, UTC, including across a year end', () => {
  assert.equal(nextResetMs(NOW), Date.UTC(2026, 11, 1));
  assert.equal(nextResetMs(Date.UTC(2026, 11, 31, 23, 59)), Date.UTC(2027, 0, 1));
});

test('rent to own: owned after 12 successful payments, never from bad input', () => {
  assert.deepEqual(rentToOwn(8), { owned: false, paymentsMade: 8, paymentsLeft: 4 });
  assert.deepEqual(rentToOwn(12), { owned: true, paymentsMade: 12, paymentsLeft: 0 });
  assert.equal(rentToOwn(Number.NaN).owned, false);
  assert.equal(rentToOwn(-3).paymentsLeft, 12);
});

test('within the free amounts nothing is charged', () => {
  const s = usageSummary({ plan: 'basic', photosUsed: 120, storedBytes: 1e9, downloadedBytes: 2e8, balancePence: 0, nowMs: NOW });
  assert.equal(s.chargePence, 0);
  assert.equal(s.paused, false);
  assert.deepEqual(s.meters.map(m => m.percent), [24, 40, 20]);
});

test('over the free amounts each line is charged at its own rate and rounded up once', () => {
  const s = usageSummary({ plan: 'pro', photosUsed: 6000, storedBytes: 12.5e9, downloadedBytes: 3e9, balancePence: 1000, nowMs: NOW });
  // 1,000 photos × 0.3p = 300p; 10 GB × 7p = 70p; 2 GB × 33p = 66p
  assert.deepEqual(s.meters.map(m => Math.round(m.chargePence)), [300, 70, 66]);
  assert.equal(s.chargePence, 436);
  assert.equal(s.balanceAfterPence, 564);
  assert.equal(s.meters[0].percent, 100);
});

test('when charges pass the balance cloud work pauses; the balance never goes negative', () => {
  const s = usageSummary({ plan: 'basic', photosUsed: 0, storedBytes: 52.5e9, downloadedBytes: 0, balancePence: 100, nowMs: NOW });
  assert.equal(s.chargePence, 350);
  assert.equal(s.paused, true);
  assert.equal(s.balanceAfterPence, 0);
});

test('a cloud task uses the allowance first, then the balance, else runs on this device', () => {
  assert.deepEqual(estimateCloudTask(300, { plan: 'basic', photosUsed: 100, balancePence: 0 }),
    { photos: 300, fromAllowance: 300, paidPhotos: 0, pence: 0, canRunInCloud: true });
  assert.deepEqual(estimateCloudTask(300, { plan: 'basic', photosUsed: 400, balancePence: 0 }),
    { photos: 300, fromAllowance: 100, paidPhotos: 200, pence: 60, canRunInCloud: false });
  assert.equal(estimateCloudTask(300, { plan: 'basic', photosUsed: 400, balancePence: 500 }).canRunInCloud, true);
});

test('formatting', () => {
  assert.equal(formatPence(436), '£4.36');
  assert.equal(formatBytes(2.5e9), '2.5 GB');
  assert.equal(formatBytes(4.2e8), '420 MB');
});
