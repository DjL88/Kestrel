import assert from 'node:assert/strict';
import test from 'node:test';
import { originalExportCheck, planExport } from './exportOps.ts';
import { DEFAULT_CROP } from './cropOps.ts';
import type { ExportRequest, SizePreset } from '../ui/contract.ts';
import { framedSize, type PhotoFraming } from '../../core/photoFraming.ts';

const original = (over: Partial<SizePreset> = {}): SizePreset => ({ id: 'orig-3x2', label: 'Original', platform: 'custom', width: 1, height: 1, ratioLabel: '3:2', kind: 'photo', enabled: true, linked: true, crop: { ...DEFAULT_CROP }, boardX: 0, boardY: 0, ...over });
const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({ destination: 'local-zip', groupIds: [], sizeIds: ['orig-3x2'], includeBefore: false, includeAfter: true, includeOverlay: false, includeWatermark: false, includeVideo: false, photoIds: ['p1'], ...over });

test('an Original RAW export asks for the sensor size (with the photo\'s own crop), never a preview size', () => {
  const plan = planExport(request(), [{ id: 'p1', filename: '_DJL1679.NEF', exif: { width: 4000, height: 2672 } }], [original()]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs[0].size, { width: 4000, height: 2672 });
  const framing: PhotoFraming = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5, size: 0.5 };
  const cropped = planExport(request(), [{ id: 'p1', filename: '_DJL1679.NEF', exif: { width: 4000, height: 2672 }, framing }], [original()]);
  assert.ok('jobs' in cropped);
  const expected = framedSize(4000, 2672, framing);
  assert.ok(expected.width < 4000, 'the framing crops');
  assert.deepEqual(cropped.jobs[0].size, { width: expected.width, height: expected.height }, 'a framing crop gives exactly the cropped sensor pixels');
});

test('an Original delivered smaller than promised is refused (the owner\'s 4000 x 2672 came out 2723 x 1819)', () => {
  const requested = { width: 4000, height: 2672 };
  assert.equal(originalExportCheck(requested, DEFAULT_CROP, { width: 2723, height: 1819 }).kind, 'short');
  assert.deepEqual(originalExportCheck(requested, DEFAULT_CROP, { width: 2723, height: 1819 }), { kind: 'short', expected: { width: 4000, height: 2672 } });
  assert.equal(originalExportCheck(requested, DEFAULT_CROP, { width: 4000, height: 2672 }).kind, 'full');
  assert.equal(originalExportCheck(requested, DEFAULT_CROP, { width: 3999, height: 2671 }).kind, 'full', 'one pixel of rounding is the same size');
});

test('an Original smaller only because the person zoomed its crop is allowed, and said', () => {
  const requested = { width: 4000, height: 2672 };
  const zoomed = { ...DEFAULT_CROP, zoom: 4000 / 2723 };
  const check = originalExportCheck(requested, zoomed, { width: 2723, height: 1819 });
  assert.equal(check.kind, 'cropped');
  // But not smaller still than that crop allows.
  assert.equal(originalExportCheck(requested, zoomed, { width: 2000, height: 1336 }).kind, 'short');
});
