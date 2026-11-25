import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankRgb16, copyRgb16, cropRgb16, drawRgb16, fillRgb16, looksEightBit, overlayRgba8OnRgb16, rgb8To16 } from './compose16';
import { encodePng16, readPng16 } from './png16';
import type { Rgb16Image } from './master16';

/** A horizontal 16-bit ramp whose values are not whole 8-bit levels (a picture 8 bits cannot hold). */
function ramp(width: number, height: number): Rgb16Image {
  const image = blankRgb16(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 3;
    image.data[at] = 1000 + x * 7 + y; image.data[at + 1] = 30001 + x * 3; image.data[at + 2] = 60001 - y * 5;
  }
  return image;
}
const px = (image: Rgb16Image, x: number, y: number) => Array.from(image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3));
const identity = (image: Rgb16Image, picture: Rgb16Image) => ({ centreX: image.width / 2, centreY: image.height / 2, rotateRad: 0, scaleX: 1, scaleY: 1,
  drawWidth: picture.width, drawHeight: picture.height, clip: { x: 0, y: 0, width: image.width, height: image.height } });

test('a one-to-one placement copies every 16-bit value exactly', () => {
  const picture = ramp(12, 8);
  const out = blankRgb16(12, 8);
  drawRgb16(out, picture, identity(out, picture));
  assert.deepEqual(out.data, picture.data);
  assert.equal(looksEightBit(out), false);
});

test('a horizontal flip mirrors the picture without changing any value', () => {
  const picture = ramp(10, 4);
  const out = blankRgb16(10, 4);
  drawRgb16(out, picture, { ...identity(out, picture), scaleX: -1 });
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 10; x += 1) assert.deepEqual(px(out, x, y), px(picture, 9 - x, y));
});

test('a quarter turn lands on the pixel grid exactly', () => {
  const picture = ramp(6, 4);
  const out = blankRgb16(4, 6);
  drawRgb16(out, picture, { ...identity(out, picture), rotateRad: Math.PI / 2 });
  // Canvas rotate(+90°) turns clockwise on screen: output (x, y) shows picture (y, H-1-x).
  for (let y = 0; y < 6; y += 1) for (let x = 0; x < 4; x += 1) assert.deepEqual(px(out, x, y), px(picture, y, 3 - x));
});

test('the clip leaves pixels outside it untouched (border colour stays)', () => {
  const picture = ramp(8, 8);
  const out = blankRgb16(8, 8);
  const white = rgb8To16([255, 255, 255]);
  fillRgb16(out, white);
  drawRgb16(out, picture, { ...identity(out, picture), clip: { x: 2, y: 2, width: 4, height: 4 } });
  assert.deepEqual(px(out, 1, 1), white);
  assert.deepEqual(px(out, 6, 6), white);
  assert.deepEqual(px(out, 2, 2), px(picture, 2, 2));
  assert.deepEqual(px(out, 5, 5), px(picture, 5, 5));
});

test('drawing smaller area-averages first, and keeps 16-bit values', () => {
  const picture = ramp(40, 20);
  const out = blankRgb16(10, 5);
  drawRgb16(out, picture, { ...identity(out, picture), drawWidth: 10, drawHeight: 5 });
  assert.equal(looksEightBit(out), false);
  // The first output pixel is the average of the top-left 4 x 4 block.
  let r = 0; for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) r += px(picture, x, y)[0];
  assert.equal(px(out, 0, 0)[0], Math.round(r / 16));
});

test('an overlay changes only the pixels it covers, and blends like source-over', () => {
  const picture = ramp(4, 1);
  const before = picture.data.slice();
  const sheet = new Uint8ClampedArray(4 * 4);
  sheet.set([255, 255, 255, 255], 4); // opaque white at x = 1
  sheet.set([0, 0, 0, 128], 8); // half black at x = 2
  overlayRgba8OnRgb16(picture, sheet);
  assert.deepEqual(px(picture, 0, 0), Array.from(before.subarray(0, 3)));
  assert.deepEqual(px(picture, 1, 0), [65535, 65535, 65535]);
  assert.deepEqual(px(picture, 2, 0), Array.from(before.subarray(6, 9)).map((v) => Math.round(v * (1 - 128 / 255))));
  assert.deepEqual(px(picture, 3, 0), Array.from(before.subarray(9, 12)));
});

test('split sections are exact 16-bit copies of the joined frame', async () => {
  const joined = ramp(20, 6);
  const left = cropRgb16(joined, { x: 0, y: 0, width: 10, height: 6 });
  const right = cropRgb16(joined, { x: 10, y: 0, width: 10, height: 6 });
  const back = blankRgb16(20, 6);
  copyRgb16(left, { x: 0, y: 0, width: 10, height: 6 }, back, 0, 0);
  copyRgb16(right, { x: 0, y: 0, width: 10, height: 6 }, back, 10, 0);
  assert.deepEqual(back.data, joined.data);
  assert.throws(() => copyRgb16(left, { x: 0, y: 0, width: 11, height: 6 }, back, 0, 0));
});

test('a 16-bit PNG reads back value for value', async () => {
  const picture = ramp(33, 7);
  const back = await readPng16(new Uint8Array(await (await encodePng16(picture, 3)).arrayBuffer()));
  assert.equal(back.width, 33); assert.equal(back.height, 7);
  assert.deepEqual(back.data, picture.data);
  assert.equal(looksEightBit(back), false);
});

test('looksEightBit is true for a picture that went through 8 bits', () => {
  const picture = blankRgb16(2, 1);
  picture.data.set([257 * 3, 0, 65535, 257 * 200, 257, 257 * 9]);
  assert.equal(looksEightBit(picture), true);
});
