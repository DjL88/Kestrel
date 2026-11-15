import test from 'node:test';
import assert from 'node:assert/strict';
import { subjectBox, subjectCrop } from './subjectCrop';
import type { SubjectGrid } from './maskTypes';

/** A grid with a filled rectangle, in cells. */
function grid(w: number, h: number, box?: [number, number, number, number]): SubjectGrid {
  const bytes = new Uint8Array(w * h);
  if (box) for (let y = box[1]; y < box[3]; y += 1) for (let x = box[0]; x < box[2]; x += 1) bytes[y * w + x] = 255;
  return { w, h, data: btoa(String.fromCharCode(...bytes)) };
}

test('the box covers exactly the cells marked as subject', () => {
  assert.deepEqual(subjectBox(grid(20, 10, [10, 2, 16, 8])), { x0: 0.5, y0: 0.2, x1: 0.8, y1: 0.8 });
  assert.equal(subjectBox(grid(20, 10)), null, 'no subject');
  assert.equal(subjectBox(grid(100, 100, [5, 5, 6, 6])), null, 'a speck is noise');
});

test('the crop is centred on an animal that is off to one side, with a margin, and stays inside the picture', () => {
  // A 3000 by 2000 picture with the animal in the right third.
  const crop = subjectCrop(3000, 2000, grid(60, 40, [40, 12, 56, 28]));
  const centreX = crop.x + crop.size / 2, centreY = crop.y + crop.size / 2;
  assert.ok(Math.abs(centreX - 2400) < 60 && Math.abs(centreY - 1000) < 60, 'centred on the animal');
  const animalWidth = (16 / 60) * 3000;
  assert.ok(crop.size > animalWidth, 'the margin keeps the animal whole');
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.size <= 3000 && crop.y + crop.size <= 2000);
});

test('an animal at the very edge still gives a crop inside the picture', () => {
  const crop = subjectCrop(3000, 2000, grid(60, 40, [54, 0, 60, 10]));
  assert.ok(crop.x + crop.size <= 3000 && crop.y >= 0);
  assert.equal(crop.y, 0);
});

test('a small subject is not zoomed in beyond a share of the picture, and a big one gives the whole short side', () => {
  const small = subjectCrop(3000, 2000, grid(60, 40, [30, 20, 32, 22]));
  assert.ok(small.size >= 2000 * 0.4 - 1);
  const huge = subjectCrop(3000, 2000, grid(60, 40, [2, 1, 58, 39]));
  assert.equal(huge.size, 2000);
});

test('with no subject it falls back to the centre square', () => {
  assert.deepEqual(subjectCrop(3000, 2000, null), { x: 500, y: 0, size: 2000 });
  assert.deepEqual(subjectCrop(3000, 2000, grid(60, 40)), { x: 500, y: 0, size: 2000 });
  assert.deepEqual(subjectCrop(1000, 1500, undefined), { x: 0, y: 250, size: 1000 });
});
