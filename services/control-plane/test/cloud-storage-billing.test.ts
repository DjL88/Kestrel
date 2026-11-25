import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudBalance } from '../src/cloudBalance.ts';
import { dailyStorageMillicredits, monthAheadMillicredits, settleStorageDay, storageAllowsUpload } from '../src/cloudStorageBilling.ts';

test('7p per GB a month beyond 2.5 GB, charged a day at a time', () => {
  assert.equal(dailyStorageMillicredits(2_500_000_000), 0);
  assert.equal(dailyStorageMillicredits(12_500_000_000), 2334); // 10 GB: 70p a month = 2.33p a day, rounded up
  assert.equal(monthAheadMillicredits(12_500_000_000), 70_020);
});

test('a day is charged once; an empty balance leaves it unpaid without deleting anything', async () => {
  const b = new MemoryCloudBalance();
  assert.equal(await settleStorageDay(b, 'a', 1e9, 0), 'free');
  assert.equal(await settleStorageDay(b, 'a', 12.5e9, 0), 'unpaid');
  await b.credit('a', 10_000, 'topup');
  assert.equal(await settleStorageDay(b, 'a', 12.5e9, 0), 'charged');
  assert.equal(await settleStorageDay(b, 'a', 12.5e9, 3_600_000), 'charged', 'same day, same key');
  assert.equal(await b.millicredits('a'), 10_000 - 2334);
});

test('uploads beyond the free amount need a month of storage in the balance', async () => {
  const b = new MemoryCloudBalance();
  assert.equal(await storageAllowsUpload(b, 'a', 2e9, 4e8), true);
  assert.equal(await storageAllowsUpload(b, 'a', 2e9, 1e9), false);
  await b.credit('a', 3_510, 'topup');
  assert.equal(await storageAllowsUpload(b, 'a', 2e9, 1e9), true, '0.5 GB over needs 30 days at 0.117 credits');
  assert.equal(await storageAllowsUpload(undefined, 'a', 50e9, 1e9), true, 'a server without a balance keeps only the project cap');
});
