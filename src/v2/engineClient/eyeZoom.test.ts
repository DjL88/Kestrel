import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureToScreen } from './eyeZoom';

const rect = { left: 100, top: 50, width: 400, height: 400 };

test('pictureToScreen maps a fill picture straight across its element', () => {
  assert.deepEqual(pictureToScreen({ x: 0.25, y: 0.5 }, { width: 800, height: 400 }, rect, 'fill'), { x: 200, y: 250 });
});

test('pictureToScreen allows for the bars of a contained picture', () => {
  // 800×400 in a 400×400 box: drawn 400×200, 100 px bar above and below.
  assert.deepEqual(pictureToScreen({ x: 0.5, y: 0 }, { width: 800, height: 400 }, rect, 'contain'), { x: 300, y: 150 });
});

test('pictureToScreen allows for the cropped edges of a covering picture, and refuses a point that is cropped away', () => {
  // 800×400 covering a 400×400 box: drawn 800×400, 200 px cut off each side.
  assert.deepEqual(pictureToScreen({ x: 0.5, y: 0.5 }, { width: 800, height: 400 }, rect, 'cover'), { x: 300, y: 250 });
  assert.equal(pictureToScreen({ x: 0.1, y: 0.5 }, { width: 800, height: 400 }, rect, 'cover'), null);
});

test('pictureToScreen refuses nonsense input rather than guessing', () => {
  assert.equal(pictureToScreen({ x: 1.5, y: 0.5 }, { width: 800, height: 400 }, rect, 'fill'), null);
  assert.equal(pictureToScreen({ x: 0.5, y: 0.5 }, { width: 0, height: 400 }, rect, 'fill'), null);
  assert.equal(pictureToScreen({ x: Number.NaN, y: 0.5 }, { width: 800, height: 400 }, rect, 'fill'), null);
});
