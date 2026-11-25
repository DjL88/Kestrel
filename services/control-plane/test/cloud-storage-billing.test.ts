import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudBalance } from '../src/cloudBalance.ts';
import { FREE_STORAGE_BYTES, dailyStorageMillicredits, freeStorageFor, monthAheadMillicredits, settleStorageDay, storageAllowsUpload } from '../src/cloudStorageBilling.ts';

const PRO = FREE_STORAGE_BYTES.pro;

test('Pro includes 2.5 GB and Basic none, matching the shared price list', () => {
  assert.equal(freeStorageFor(true), 2_500_000_000);
  assert.equal(freeStorageFor(false), 0);
});

test('7p per GB a month beyond the included amount, charged a day at a time', () => {
  assert.equal(dailyStorageMillicredits(2_500_000_000, PRO), 0);
  assert.equal(dailyStorageMillicredits(12_500_000_000, PRO), 2334); // 10 GB: 70p a month = 2.33p a day, rounded up
  assert.equal(monthAheadMillicredits(12_500_000_000, PRO), 70_020);
  assert.equal(dailyStorageMillicredits(10_000_000_000, 0), 2334, 'Basic pays for every GB');
});

test('a day is charged once; an empty balance leaves it unpaid without deleting anything', async () => {
  const b = new MemoryCloudBalance();
  assert.equal(await settleStorageDay(b, 'a', 1e9, PRO, 0), 'free');
  assert.equal(await settleStorageDay(b, 'a', 12.5e9, PRO, 0), 'unpaid');
  await b.credit('a', 10_000, 'topup');
  assert.equal(await settleStorageDay(b, 'a', 12.5e9, PRO, 0), 'charged');
  assert.equal(await settleStorageDay(b, 'a', 12.5e9, PRO, 3_600_000), 'charged', 'same day, same key');
  assert.equal(await b.millicredits('a'), 10_000 - 2334);
});

test('uploads beyond the included amount need a month of storage in the balance', async () => {
  const b = new MemoryCloudBalance();
  assert.equal(await storageAllowsUpload(b, 'a', 2e9, 4e8, PRO), true);
  assert.equal(await storageAllowsUpload(b, 'a', 2e9, 1e9, PRO), false);
  assert.equal(await storageAllowsUpload(b, 'a', 0, 1e6, 0), false, 'Basic needs balance for its first upload');
  await b.credit('a', 3_510, 'topup');
  assert.equal(await storageAllowsUpload(b, 'a', 2e9, 1e9, PRO), true, '0.5 GB over needs 30 days at 0.117 credits');
  assert.equal(await storageAllowsUpload(undefined, 'a', 50e9, 1e9, 0), true, 'a server without a balance keeps only the project cap');
});
