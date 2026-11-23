import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousExportLayout, cappedContinuousLayout } from './continuousExport.ts';

test('a 2-section panorama occupies two full per-format widths with no overlap or gap', () => {
  const layout = continuousExportLayout(1080, 1350, 2);
  assert.deepEqual(layout.sections, [
    { index: 1, x: 0, y: 0, width: 1080, height: 1350 },
    { index: 2, x: 1080, y: 0, width: 1080, height: 1350 },
  ]);
  assert.equal(layout.width, 2160);
});
test('a capped odd combined width loses one column, never duplicates pixels at the seam', () => {
  const layout = cappedContinuousLayout(1891, 1182, 2);
  assert.equal(layout.width, 1890);
  assert.deepEqual(layout.sections.map(s => [s.x,s.width]), [[0,945],[945,945]]);
});
test('ordinary one-panel export retains its original dimensions', () => {
  assert.equal(continuousExportLayout(3000, 4000, 1).width, 3000);
});
test('bad dimensions and too-wide combined canvases fail clearly', () => {
  for (const width of [0, -1, NaN, Infinity, 1.5, 20001]) assert.throws(() => continuousExportLayout(width, 1000, 2));
  assert.throws(() => continuousExportLayout(10001, 1000, 2));
  assert.throws(() => continuousExportLayout(1080, 1350, 3 as never));
});

test('numbered files keep the right extension and left-to-right order', async () => {
  const { numberedSectionFilename } = await import('./continuousExport.ts');
  assert.equal(numberedSectionFilename('ig_photo.jpg', 1, 2), 'ig_photo-01-of-02.jpg');
  assert.equal(numberedSectionFilename('ig_photo.jpg', 2, 2), 'ig_photo-02-of-02.jpg');
  assert.equal(numberedSectionFilename('a.png', 1, 1), 'a.png');
  assert.throws(() => numberedSectionFilename('a.jpg', 3, 2));
  assert.throws(() => numberedSectionFilename('a', 1, 2));
});
