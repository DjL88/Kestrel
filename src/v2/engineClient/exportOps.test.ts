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
  for (const over of [{ includeVideo: true }, { destination: 'dropbox' as const }, { includeAfter: false }]) {
    assert.ok('error' in planExport(request(over), frames, sizes), JSON.stringify(over));
  }
});

test('each job carries its size copy crop, and an uncropped size gets the default', () => {
  const cropped = [{ id: 'p1', filename: 'one.jpg', sizeCrops: { a: { ...DEFAULT_CROP, zoom: 2 } } }];
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['a', 'b'] }), cropped, [size('a'), size('b')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs[0].crop.zoom, 2);
  assert.equal(plan.jobs[1].crop.zoom, 1);
  assert.deepEqual(plan.jobs[0].size, { width: 1080, height: 1350 });
});

test('overlay and watermark requests are planned, not refused', () => {
  assert.ok('jobs' in planExport(request({ includeOverlay: true, includeWatermark: true }), frames, [size('a')]));
});

test('nothing selected gives a plain message', () => {
  assert.ok('error' in planExport(request({ photoIds: [] }), frames, [size('a')]));
  assert.ok('error' in planExport(request({ sizeIds: [] }), frames, [size('a')]));
});

test('before and after plans both variants per file; the unedited one is never called the original', () => {
  const plan = planExport(request({ includeBefore: true, photoIds: ['p1'], sizeIds: ['a'] }), frames, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs[0].variants, ['unedited', 'edited']);
  assert.match(plan.summary, /before and after = 2 files/);
  assert.equal(plan.originals.length, 0);
});

test('unedited alone is planned as unedited only', () => {
  const plan = planExport(request({ includeBefore: true, includeAfter: false, photoIds: ['p1'], sizeIds: ['a'] }), frames, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs[0].variants, ['unedited']);
});

test('original file alone needs no size and plans one exact copy per photo', () => {
  const plan = planExport(request({ includeOriginal: true, includeAfter: false, sizeIds: [] }), frames, [size('a')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs.length, 0);
  assert.deepEqual(plan.originals, ['p1', 'p2']);
  assert.equal(plan.summary, '2 original files = 2 files');
});

test('original file plus edited counts both', () => {
  const plan = planExport(request({ includeOriginal: true, photoIds: ['p1'], sizeIds: ['a'] }), frames, [size('a')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.summary, '1 photo × 1 size + 1 original file = 2 files');
});

test('choosing nothing at all is refused with a plain message', () => {
  assert.ok('error' in planExport(request({ includeAfter: false }), frames, [size('a')]));
});

test('honours the requested encoder and JPEG quality while retaining legacy defaults', () => {
  for (const [options, format, quality] of [
    [{}, 'jpeg', 0.94],
    [{ fileFormat: 'jpeg', jpegQuality: 0.61 }, 'jpeg', 0.61],
    [{ fileFormat: 'png', jpegQuality: 0.61 }, 'png', 1],
  ] as const) {
    const plan = planExport(request(options), frames, [size('a')]);
    assert.ok('jobs' in plan);
    for (const job of plan.jobs) {
      assert.equal(job.format.format, format);
      assert.equal(job.format.quality, quality);
    }
  }
  assert.ok('error' in planExport(request({ jpegQuality: NaN }), frames, [size('a')]));
});

test('a custom format exports only for the photo that has it, and a format a photo switched off is skipped for it', () => {
  const custom = { disabled: [], custom: [{ id: 'custom-abc123', label: 'Poster', width: 2400, height: 3000 }] };
  const withCustom = [{ id: 'p1', filename: 'one.jpg', formats: custom }, { id: 'p2', filename: 'two.jpg' }];
  const plan = planExport(request({ sizeIds: ['custom-abc123'] }), withCustom, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => job.frameId), ['p1']);
  const off = [{ id: 'p1', filename: 'one.jpg', formats: { disabled: ['a'], custom: [] } }, { id: 'p2', filename: 'two.jpg' }];
  const skipped = planExport(request({ sizeIds: ['a'] }), off, [size('a')]);
  assert.ok('jobs' in skipped);
  assert.deepEqual(skipped.jobs.map((job) => job.frameId), ['p2']);
});

test('PNG export counts only enabled formats on each photo, never the whole selection grid', () => {
  const custom = { disabled: [], custom: [{ id: 'custom-abc123', label: 'Poster', width: 2400, height: 3000 }] };
  const partial = [
    { id: 'p1', filename: 'one.jpg', formats: custom },
    { id: 'p2', filename: 'two.jpg', formats: { disabled: ['a'], custom: [] } },
  ];
  const plan = planExport(request({ fileFormat: 'png', sizeIds: ['a', 'custom-abc123'] }), partial, [size('a')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs.length, 2);
  assert.deepEqual(plan.jobs.map((job) => job.frameId), ['p1', 'p1']);
  assert.ok(plan.jobs.every((job) => job.format.format === 'png' && job.format.quality === 1));
  assert.equal(plan.summary, '2 size versions across 2 photos = 2 files');

  const none = planExport(request({ sizeIds: ['a'] }), partial.map((frame) => ({
    ...frame, formats: { disabled: ['a'], custom: [] },
  })), [size('a')]);
  assert.deepEqual(none, { error: 'None of the selected sizes is enabled on the chosen photos.' });
});

test('a longest-edge cap shrinks a bigger format proportionally, keeping aspect ratio', () => {
  // size('a') is 1080x1350 (4:5). Longer side 1350 capped to 900 -> scale 2/3 -> 720x900.
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['a'], maxLongestEdgePx: 900 }), frames, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs[0].size, { width: 720, height: 900 });
  assert.equal(plan.jobs[0].format.width, 720);
  assert.equal(plan.jobs[0].format.height, 900);
});

test('a longest-edge cap never upscales a format already within it', () => {
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['a'], maxLongestEdgePx: 4000 }), frames, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs[0].size, { width: 1080, height: 1350 });
});

test('no cap, a zero cap and an unset cap all mean full size', () => {
  for (const maxLongestEdgePx of [undefined, 0] as const) {
    const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['a'], maxLongestEdgePx }), frames, [size('a')]);
    assert.ok('jobs' in plan);
    assert.deepEqual(plan.jobs[0].size, { width: 1080, height: 1350 });
  }
});

test('a negative or non-finite cap is refused with a plain message, not silently ignored', () => {
  for (const maxLongestEdgePx of [-1, NaN, Infinity]) {
    assert.ok('error' in planExport(request({ sizeIds: ['a'], maxLongestEdgePx }), frames, [size('a')]));
  }
});
