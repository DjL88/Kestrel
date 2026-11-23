import assert from 'node:assert/strict';
import test from 'node:test';
import { planExport } from './exportOps.ts';
import { DEFAULT_CROP } from './cropOps.ts';
import { createDefaultSizes } from '../ui/stub.ts';
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

test('same custom format ID uses dimensions from each individual photo, never the last selected photo', () => {
  const own = [
    { id: 'p1', filename: 'one.jpg', formats: { disabled: [], custom: [{ id: 'custom-poster', label: 'My poster', width: 1600, height: 2400 }] } },
    { id: 'p2', filename: 'two.jpg', formats: { disabled: [], custom: [{ id: 'custom-poster', label: 'My poster', width: 3000, height: 2000 }] } },
  ];
  const plan = planExport(request({ sizeIds: ['custom-poster'] }), own, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => ({ photo: job.frameId, size: job.size, format: [job.format.width, job.format.height] })), [
    { photo: 'p1', size: { width: 1600, height: 2400 }, format: [1600, 2400] },
    { photo: 'p2', size: { width: 3000, height: 2000 }, format: [3000, 2000] },
  ]);
  assert.equal(plan.summary, '2 photos × 1 size = 2 files');
});

test('per-photo export dimensions also honour longest-edge caps independently', () => {
  const own = [
    { id: 'p1', filename: 'one.jpg', formats: { disabled: [], custom: [{ id: 'custom-poster', label: 'Poster', width: 1600, height: 2400 }] } },
    { id: 'p2', filename: 'two.jpg', formats: { disabled: [], custom: [{ id: 'custom-poster', label: 'Poster', width: 2400, height: 1600 }] } },
  ];
  const plan = planExport(request({ sizeIds: ['custom-poster'], maxLongestEdgePx: 1200 }), own, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => job.size), [
    { width: 800, height: 1200 }, { width: 1200, height: 800 },
  ]);
});

test('disabled matching custom format is not exported just because another photo has the same ID enabled', () => {
  const own = [
    { id: 'p1', filename: 'one.jpg', formats: { disabled: ['custom-poster'], custom: [{ id: 'custom-poster', label: 'Poster', width: 1000, height: 1500 }] } },
    { id: 'p2', filename: 'two.jpg', formats: { disabled: [], custom: [{ id: 'custom-poster', label: 'Poster', width: 2000, height: 3000 }] } },
  ];
  const plan = planExport(request({ sizeIds: ['custom-poster'] }), own, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => job.frameId), ['p2']);
  assert.deepEqual(plan.jobs[0].size, { width: 2000, height: 3000 });
});

test('one selected split format exports two numbered sections while other formats remain single', () => {
  const own = [
    { id: 'p1', filename: 'one.jpg', formatSplits: { a: { enabled: true, offset: 0 } } },
    { id: 'p2', filename: 'two.jpg', formatSplits: {} },
  ];
  const plan = planExport(request(), own, [size('a'), size('b')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => ({ frame: job.frameId, id: job.format.id, sections: job.sections ?? 1 })), [
    { frame: 'p1', id: 'a', sections: 2 }, { frame: 'p1', id: 'b', sections: 1 },
    { frame: 'p2', id: 'a', sections: 1 }, { frame: 'p2', id: 'b', sections: 1 },
  ]);
  assert.match(plan.summary, /= 5 files$/);
});

test('an export cap applies to the whole continuous image and keeps equal panel dimensions', () => {
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['a'], maxLongestEdgePx: 1200 }),
    [{ id: 'p1', filename: 'a.png', formatSplits: { a: { enabled: true, offset: 0 } } }], [size('a')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs[0].sections, 2);
  assert.deepEqual(plan.jobs[0].size, { width: 600, height: 750 });
  assert.match(plan.summary, /= 2 files$/);
});

test('saved per-format pan offset adjusts only that split format crop, never the other', () => {
  const plan = planExport(request({ photoIds: ['p1'] }),
    [{ id: 'p1', filename: 'a.jpg', formatSplits: { b: { enabled: true, offset: 8 } },
      sizeCrops: { b: { ...DEFAULT_CROP, panX: 4 } } }], [size('a'), size('b')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs.find((job) => job.format.id === 'a')?.crop.panX, 0);
  assert.equal(plan.jobs.find((job) => job.format.id === 'b')?.crop.panX, 12);
  assert.equal(plan.jobs.find((job) => job.format.id === 'b')?.sections, 2);
});

test('older saved photo-wide split exports Original only as two sections', () => {
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['orig-3x2', 'a'] }),
    [{ id: 'p1', filename: 'old.jpg', splitFrames: true, exif: { width: 1500, height: 1000 } }],
    [size('orig-3x2', { width: 1500, height: 1000 }), size('a')]);
  assert.ok('jobs' in plan);
  assert.equal(plan.jobs.find((job) => job.format.id === 'orig-3x2')?.sections, 2);
  assert.equal(plan.jobs.find((job) => job.format.id === 'a')?.sections, undefined);
});

test('original bytes remain one untouched file even if a developed format is split', () => {
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['a'], includeOriginal: true }),
    [{ id: 'p1', filename: 'a.jpg', formatSplits: { a: { enabled: true, offset: 0 } } }], [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.originals, ['p1']);
  assert.match(plan.summary, /= 3 files$/);
});

test('split planning refuses an impossible combined canvas or a sub-two-pixel size cap', () => {
  const photo = [{ id: 'p1', filename: 'a.jpg', formatSplits: { a: { enabled: true, offset: 0 } } }];
  const tooWide = planExport(request({ photoIds: ['p1'], sizeIds: ['a'] }), photo,
    [size('a', { width: 12000, height: 2000 })]);
  assert.ok('error' in tooWide);
  assert.match(tooWide.error, /too wide/);
  const tiny = planExport(request({ photoIds: ['p1'], sizeIds: ['a'], maxLongestEdgePx: 1 }), photo,
    [size('a')]);
  assert.ok('error' in tiny);
  assert.match(tiny.error, /too wide/);
});

test('removedAt zero is still removed: no developed export and no original copy', () => {
  const zeroRemoved = [
    { id: 'p1', filename: 'zero-removed.jpg', removedAt: 0 },
    { id: 'p2', filename: 'kept.jpg' },
  ];
  const plan = planExport(request({ includeOriginal: true, photoIds: ['p1', 'p2'], sizeIds: ['a'] }), zeroRemoved, [size('a')]);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => job.frameId), ['p2']);
  assert.deepEqual(plan.originals, ['p2']);
  assert.equal(plan.summary, '1 photo × 1 size + 1 original file = 2 files');
});

test('selection containing only removedAt zero refuses even exact original export', () => {
  const zeroRemoved = [{ id: 'p1', filename: 'removed.nef', removedAt: 0 }];
  for (const overrides of [
    { includeOriginal: true, includeAfter: false, sizeIds: [] },
    { includeOriginal: false, includeAfter: true, sizeIds: ['a'] },
  ]) {
    const plan = planExport(request({ ...overrides, photoIds: ['p1'] }), zeroRemoved, [size('a')]);
    assert.deepEqual(plan, { error: 'Choose at least one photo to export.' });
  }
});

test('duplicate live catalogue IDs fail closed for both exact originals and edited output', () => {
  const ambiguous = [
    { id: 'p1', filename: 'bird-original-1.nef' },
    { id: 'p1', filename: 'bird-other-2.nef' },
  ];
  for (const overrides of [
    { includeOriginal: true, includeAfter: false, sizeIds: [] },
    { includeOriginal: true, includeAfter: true, sizeIds: ['a'] },
    { includeOriginal: false, includeAfter: true, sizeIds: ['a'] },
  ]) {
    const plan = planExport(request({ ...overrides, photoIds: ['p1'] }), ambiguous, [size('a')]);
    assert.ok('error' in plan);
    assert.match(plan.error, /same identity/);
  }
});

test('a removed duplicate does not block one unambiguous live original', () => {
  const frames = [
    { id: 'p1', filename: 'live.nef' },
    { id: 'p1', filename: 'removed.nef', removedAt: 0 },
  ];
  const plan = planExport(request({
    photoIds: ['p1'], includeOriginal: true, includeAfter: false, sizeIds: [],
  }), frames, []);
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.originals, ['p1']);
});

test('the Original output format follows each imported photograph rather than a fixed 3:2', () => {
  const sources = [
    { id: 'p1', filename: 'landscape.jpg', exif: { width: 4000, height: 3000 } },
    { id: 'p2', filename: 'portrait.jpg', exif: { width: 3000, height: 4000 } },
  ];
  const plan = planExport(request({ photoIds: ['p1', 'p2'], sizeIds: ['orig-3x2'] }), sources, createDefaultSizes());
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs.map((job) => job.size), [
    { width: 4000, height: 3000 },
    { width: 3000, height: 4000 },
  ]);
});

test('an Original canvas override changes only its output, not its imported dimensions', () => {
  const source = [{
    id: 'p1', filename: 'image.jpg', exif: { width: 8256, height: 5504 },
    formats: { disabled: [], custom: [], originalSize: { width: 2400, height: 1600 } },
  }];
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['orig-3x2'] }), source, createDefaultSizes());
  assert.ok('jobs' in plan);
  assert.deepEqual(plan.jobs[0].size, { width: 2400, height: 1600 });
});

test('unknown imported dimensions do not silently use invented 3000 by 2000 Original', () => {
  const plan = planExport(request({ photoIds: ['p1'], sizeIds: ['orig-3x2'] }),
    [{ id: 'p1', filename: 'unknown.NEF' }], createDefaultSizes());
  assert.ok('error' in plan);
});
