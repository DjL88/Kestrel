import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_MASTER_EXPORT_ERROR, rawMasterExportBlocked } from './rawMasterExportGate';

const master = [{ id: 'master' }];
const social = [{ id: 'ig-45' }];
const raw = { filename: 'DSC_1234.NEF', isDemo: false };
const jpeg = { filename: 'DSC_1234.JPG', isDemo: false };

test('manual full-size output may not masquerade as a verified RAW master', () => {
  assert.equal(rawMasterExportBlocked(master, [raw]), true);
  assert.equal(rawMasterExportBlocked(master, [{ ...raw, filename: 'DSC_1234.cr3' }]), true);
  assert.equal(rawMasterExportBlocked(master, [{ ...raw, filename: 'DSC_1234.dng' }]), true);
  assert.equal(rawMasterExportBlocked(master, [jpeg, raw]), true, 'one RAW in a mixed batch blocks the master choice');
  assert.match(RAW_MASTER_EXPORT_ERROR, /sensor quality/);
});

test('RAW web exports and developed raster masters remain available', () => {
  assert.equal(rawMasterExportBlocked(social, [raw]), false);
  assert.equal(rawMasterExportBlocked([{ id: 'custom' }], [raw]), false);
  assert.equal(rawMasterExportBlocked(master, [jpeg]), false);
  assert.equal(rawMasterExportBlocked(master, [{ filename: 'IMG.heic', isDemo: false }]), false);
  assert.equal(rawMasterExportBlocked(master, [{ ...raw, isDemo: true }]), false);
  assert.equal(rawMasterExportBlocked([], [raw]), false);
  assert.equal(rawMasterExportBlocked(master, []), false);
});
