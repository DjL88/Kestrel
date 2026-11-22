import assert from 'node:assert/strict';
import test from 'node:test';
import { planExport } from './exportOps.ts';
import { DEFAULT_CROP } from './cropOps.ts';
import type { ExportRequest, SizePreset } from '../ui/contract.ts';

const size = (id: string, over: Partial<SizePreset> = {}): SizePreset => ({ id, label: id, platform: 'instagram', width: 1080, height: 1350, ratioLabel: '4:5', kind: 'photo', enabled: true, linked: true, crop: { ...DEFAULT_CROP }, boardX: 0, boardY: 0, ...over });
const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({ destination: 'local-zip', groupIds: [], sizeIds: ['a', 'b'], includeBefore: false, includeAfter: true, includeOverlay: false, includeWatermark: false, includeVideo: false, photoIds: ['p1', 'p2'], ...over });
const frames = [{ id: 'p1', filename: 'one.jpg' }, { id: 'p2', filename: 'two.jpg' }, { id: 'p3', filename: 'gone.jpg', removedAt: 1 }];

test('photos times sizes becomes one job each, with the count shown', () => {
  const plan = planExport(request(), frames, [size('a'), size('b')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs.length, 4);
  assert.equal(plan.summary, '2 photos × 2 sizes = 4 files');
  assert.equal(plan.jobs[0].format.fit, 'fill');
});

test('removed photos and video sizes are skipped', () => {
  const plan = planExport(request({ photoIds: ['p1', 'p3'], sizeIds: ['a', 'v'] }), frames, [size('a'), size('v', { kind: 'video' })]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs.length, 1);
});

test('anything the file would not honour is refused, never silently dropped', () => {
  const sizes = [size('a'), size('b')];
  for (const over of [{ includeOverlay: true }, { includeWatermark: true }, { includeBefore: true }, { includeVideo: true }, { destination: 'dropbox' as const }, { includeAfter: false }]) {
    assert.ok('error' in planExport(request(over), frames, sizes), JSON.stringify(over));
  }
});

test('a saved crop blocks export until crops are applied to files', () => {
  const cropped = [{ id: 'p1', filename: 'one.jpg', sizeCrops: { a: { ...DEFAULT_CROP, zoom: 2 } } }];
  const plan = planExport(request({ photoIds: ['p1'] }), cropped, [size('a')]);
  assert.ok('error' in plan);
  assert.match(plan.error, /one\.jpg/);
});

test('nothing selected gives a plain message', () => {
  assert.ok('error' in planExport(request({ photoIds: [] }), frames, [size('a')]));
  assert.ok('error' in planExport(request({ sizeIds: [] }), frames, [size('a')]));
});
