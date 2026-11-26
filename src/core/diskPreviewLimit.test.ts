import assert from 'node:assert/strict';
import test from 'node:test';
import { TIER_LIMITS, memoryBudget } from './memoryBudget';
import {
  defaultDiskPreviewLimitGB, diskPreviewLimitBytes, diskPreviewThreads, formatPreviewBytes, parseDiskPreviewLimitGB, photosThatFit,
} from './diskPreviewLimit';

const GB = 1024 ** 3;

test('the disk preview limit defaults to the device tier and grows with it', () => {
  assert.ok(TIER_LIMITS.low.diskPreviewBytes < TIER_LIMITS.standard.diskPreviewBytes);
  assert.ok(TIER_LIMITS.standard.diskPreviewBytes < TIER_LIMITS.high.diskPreviewBytes);
  const desktop = memoryBudget({ memoryGB: 8, cores: 12, phone: false });
  assert.equal(diskPreviewLimitBytes(undefined, desktop), desktop.diskPreviewBytes);
  assert.equal(defaultDiskPreviewLimitGB(desktop), 20);
  assert.equal(defaultDiskPreviewLimitGB(memoryBudget({ cores: 8, phone: false })), 8);
});

test('the person’s chosen limit is used only when it is a sensible number', () => {
  const budget = { diskPreviewBytes: 8 * GB };
  assert.equal(diskPreviewLimitBytes('5', budget), 5 * GB);
  assert.equal(diskPreviewLimitBytes(50, budget), 50 * GB);
  for (const bad of ['', 'lots', '0', -3, 0.5, 9999, Number.NaN, null, {}]) {
    assert.equal(parseDiskPreviewLimitGB(bad), undefined, String(bad));
    assert.equal(diskPreviewLimitBytes(bad, budget), 8 * GB);
  }
});

test('a smaller device develops fewer photos into the folder at once', () => {
  assert.equal(diskPreviewThreads({ cullWorkers: 1 }), 1);
  assert.equal(diskPreviewThreads(memoryBudget({ memoryGB: 2, cores: 8, phone: false })), 1);
  assert.equal(diskPreviewThreads(memoryBudget({ cores: 8, phone: false })), 2);
  assert.equal(diskPreviewThreads(memoryBudget({ memoryGB: 8, cores: 16, phone: false })), 3);
});

test('preview folder sizes are said in plain words', () => {
  assert.equal(formatPreviewBytes(0), '0 MB');
  assert.equal(formatPreviewBytes(740 * 1024 * 1024), '740 MB');
  assert.equal(formatPreviewBytes(3.4 * GB), '3.4 GB');
  assert.equal(formatPreviewBytes(20 * GB), '20 GB');
  assert.equal(photosThatFit(8 * GB), 4096);
});
