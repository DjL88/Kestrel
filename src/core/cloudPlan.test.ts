import assert from 'node:assert/strict';
import test from 'node:test';
import {
  usageFromServer, CLOUD_COST_PENCE, FREE_DOWNLOAD_BYTES_PER_MONTH, FREE_STORAGE_BYTES_BY_PLAN, MONTHLY_PHOTO_ALLOWANCE, PAYG_PENCE, STORAGE_PLANS, keepRatioFor, photosThatFit,
  estimateCloudTask, formatBytes, formatPence, KEEP_RATIO_SMALLEST_TOP_UP, marginOf, nextResetMs, rentToOwn, usageSummary,
} from './cloudPlan.ts';

const NOW = Date.UTC(2026, 10, 25, 12, 0);

test('every pay-as-you-go line keeps at least 60% margin after VAT and Paddle fees', () => {
  assert.ok(marginOf(PAYG_PENCE.storagePerGbMonth, CLOUD_COST_PENCE.storagePerGbMonth) >= 0.6);
  assert.ok(marginOf(PAYG_PENCE.downloadPerGb, CLOUD_COST_PENCE.downloadPerGb) >= 0.6);
  assert.ok(marginOf(PAYG_PENCE.extraPhotoTenths / 10, CLOUD_COST_PENCE.photo) >= 0.6);
});

test('every fixed storage plan keeps at least 60% margin even when completely full', () => {
  assert.ok(Math.abs(keepRatioFor(500) - KEEP_RATIO_SMALLEST_TOP_UP) < 0.02, 'the per-payment keep ratio agrees with the £5 top-up figure');
  for (const plan of STORAGE_PLANS) {
    const costPence = (plan.bytes / 1e9) * CLOUD_COST_PENCE.storagePerGbMonth;
    assert.ok(marginOf(plan.monthlyPence, costPence, keepRatioFor(plan.monthlyPence)) >= 0.6, plan.id);
    assert.equal(plan.available, false, 'not on sale until Paddle checkout is live');
  }
});

test('allowances: Basic 500 photos and no storage, Pro 5,000 photos and 2.5 GB; 1 GB downloads free for everyone', () => {
  assert.equal(MONTHLY_PHOTO_ALLOWANCE.basic, 500);
  assert.equal(MONTHLY_PHOTO_ALLOWANCE.pro, 5000);
  assert.deepEqual(FREE_STORAGE_BYTES_BY_PLAN, { basic: 0, pro: 2.5e9 });
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
  const s = usageSummary({ plan: 'pro', photosUsed: 1200, storedBytes: 1e9, downloadedBytes: 2e8, balancePence: 0, nowMs: NOW });
  assert.equal(s.chargePence, 0);
  assert.equal(s.paused, false);
  assert.deepEqual(s.meters.map(m => m.percent), [24, 40, 20]);
});

test('Basic includes no cloud storage: every stored GB is charged', () => {
  const s = usageSummary({ plan: 'basic', photosUsed: 0, storedBytes: 10e9, downloadedBytes: 0, balancePence: 100, nowMs: NOW });
  const storage = s.meters.find(m => m.id === 'storage')!;
  assert.equal(storage.included, 0);
  assert.equal(Math.round(storage.chargePence), 70);
  assert.equal(s.chargePence, 70);
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
  const s = usageSummary({ plan: 'basic', photosUsed: 0, storedBytes: 50e9, downloadedBytes: 0, balancePence: 100, nowMs: NOW });
  assert.equal(s.chargePence, 350);
  assert.equal(s.paused, true);
  assert.equal(s.balanceAfterPence, 0);
});

test('a cloud task uses the allowance first, then the balance, else runs on this device', () => {
  assert.deepEqual(estimateCloudTask(300, { plan: 'basic', photosUsed: 100, balancePence: 0 }),
    { photos: 300, fromAllowance: 300, paidPhotos: 0, allowanceLeftAfter: 100, pence: 0, canRunInCloud: true });
  assert.deepEqual(estimateCloudTask(300, { plan: 'basic', photosUsed: 400, balancePence: 0 }),
    { photos: 300, fromAllowance: 100, paidPhotos: 200, allowanceLeftAfter: 0, pence: 60, canRunInCloud: false });
  assert.equal(estimateCloudTask(300, { plan: 'basic', photosUsed: 400, balancePence: 500 }).canRunInCloud, true);
});

test('formatting', () => {
  assert.equal(formatPence(436), '£4.36');
  assert.equal(formatBytes(2.5e9), '2.5 GB');
  assert.equal(formatBytes(4.2e8), '420 MB');
});

test('the server usage answer maps to the panel, and an older server without plan fields shows nothing', () => {
  assert.deepEqual(usageFromServer({ plan: 'pro', photosUsed: 12, bytes: 5e8, balanceCredits: 250.7 }, NOW),
    { plan: 'pro', photosUsed: 12, downloadedBytes: 5e8, balancePence: 250, nowMs: NOW });
  assert.equal(usageFromServer({ bytes: 1 }, NOW), null);
  assert.deepEqual(usageSummary(usageFromServer({ plan: 'basic' }, NOW)!).meters.map(m => m.id), ['photos', 'downloads'], 'no storage meter until the server reports it');
});

test('roughly how many photos fit, rounded down so it never over-promises', () => {
  assert.deepEqual(photosThatFit(2.5e9), { previews: 2500, withRawOriginals: 80, withJpegOriginals: 220 });
  assert.deepEqual(photosThatFit(100e9), { previews: 100000, withRawOriginals: 3200, withJpegOriginals: 9000 });
  assert.deepEqual(photosThatFit(0), { previews: 0, withRawOriginals: 0, withJpegOriginals: 0 });
});
