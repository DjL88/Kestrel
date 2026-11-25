import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDIT, applyPhotoEdit, type PhotoEdit } from './photoEdits';
import { editRgb16, type Rgb16Image } from './master16';
import { ditherRgb16ToRgba8, downscaleRgb16 } from './rgb16Output';

const grey = (width: number, height: number, at: (x: number, y: number) => number): Rgb16Image => {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.fill(at(x, y), (y * width + x) * 3, (y * width + x) * 3 + 3);
  return { width, height, data };
};

test('downscaling averages the exact area each output pixel covers, in 16 bits', () => {
  const image = grey(4, 2, (x) => [0, 65535, 1000, 3000][x]);
  assert.deepEqual(Array.from(downscaleRgb16(image, 2, 1).data), [32768, 32768, 32768, 2000, 2000, 2000]);
  // A non-integer ratio weights the partly covered middle pixel by half.
  assert.deepEqual(Array.from(downscaleRgb16(grey(3, 1, (x) => [0, 30000, 60000][x]), 2, 1).data.filter((_, i) => i % 3 === 0)), [10000, 50000]);
  // A uniform picture stays exactly uniform at any size, and a same-size call is a copy.
  assert.ok(downscaleRgb16(grey(97, 61, () => 12345), 13, 7).data.every((value) => value === 12345));
  const same = downscaleRgb16(image, 4, 2);
  assert.deepEqual(same.data, image.data);
  assert.notEqual(same.data, image.data);
  assert.throws(() => downscaleRgb16(image, 8, 2), /Invalid/);
});

test('one dithered rounding keeps a 16-bit level between two 8-bit steps, on average', () => {
  // 100.3 8-bit levels: plain rounding gives 100 everywhere; the dither averages back to 100.3.
  const image = grey(128, 128, () => Math.round(100.3 * 257));
  const out = ditherRgb16ToRgba8(image);
  let sum = 0, n = 0;
  for (let i = 0; i < out.length; i += 4) { sum += out[i]; n += 1; assert.ok(out[i] >= 99 && out[i] <= 102); assert.equal(out[i + 3], 255); }
  assert.ok(Math.abs(sum / n - 100.3) < 0.03, `mean ${sum / n}`);
  // Exact 8-bit values stay exact more often than not, and black and white never wrap.
  assert.ok(ditherRgb16ToRgba8(grey(1, 1, () => 0)).slice(0, 3).every((value) => value === 0));
  assert.ok(ditherRgb16ToRgba8(grey(1, 1, () => 65535)).slice(0, 3).every((value) => value === 255));
});

test('the dither is fixed by pixel position, so repeat exports and tiles are byte-identical', () => {
  const image = grey(64, 32, (x, y) => (x * 1031 + y * 977) % 65536);
  assert.deepEqual(ditherRgb16ToRgba8(image), ditherRgb16ToRgba8(image));
  const right: Rgb16Image = { width: 32, height: 32, data: new Uint16Array(32 * 32 * 3) };
  for (let y = 0; y < 32; y += 1) right.data.set(image.data.subarray((y * 64 + 32) * 3, (y * 64 + 64) * 3), y * 32 * 3);
  const whole = ditherRgb16ToRgba8(image);
  const tile = ditherRgb16ToRgba8(right, 32, 0);
  for (let y = 0; y < 32; y += 1) assert.deepEqual(tile.subarray(y * 32 * 4, (y + 1) * 32 * 4), whole.subarray((y * 64 + 32) * 4, (y * 64 + 64) * 4));
});

test('a gradient through a strong curve, rounded once at the end, has no bands; the 8-bit path does', () => {
  const width = 4096;
  const edit: PhotoEdit = { ...DEFAULT_EDIT, curve: [[0, 0], [0.25, 0.6], [1, 1]] };
  const ramp = () => grey(width, 16, (x) => Math.round((x / (width - 1)) * 65535));
  const sixteen = ramp();
  editRgb16(sixteen, edit);
  const once = ditherRgb16ToRgba8(sixteen);
  const eight = new Uint8ClampedArray(width * 16 * 4);
  ramp().data.forEach((value, i) => { if (i % 3 === 0) { eight.fill(Math.round(value / 257), (i / 3) * 4, (i / 3) * 4 + 3); eight[(i / 3) * 4 + 3] = 255; } });
  applyPhotoEdit(eight, edit);
  // Average each column over 16 rows (what the eye does) across the darkest quarter, where the curve stretches most.
  const columns = (pixels: Uint8ClampedArray) => Array.from({ length: width / 4 }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < 16; y += 1) sum += pixels[(y * width + x) * 4];
    return sum / 16;
  });
  // The true result is the 16-bit curve itself; how far does each column's average stray from it?
  const truth = Array.from({ length: width / 4 }, (_, x) => sixteen.data[x * 3] / 257);
  const worst = (values: number[]) => values.reduce((most, value, x) => Math.max(most, Math.abs(value - truth[x])), 0);
  const dithered = worst(columns(once));
  const banded = worst(columns(eight));
  assert.ok(dithered < 0.5, `16-bit then one dither strays ${dithered} levels`);
  assert.ok(banded > dithered * 2, `8-bit path strays ${banded} levels, dithered ${dithered}`);
});

test('a strong lift of a smooth sky shows no steps on the canvas: dithered, not plainly rounded', async () => {
  const { rgb16ToRgba } = await import('./master16');
  // A clear sky in the shadows: 1024 columns spanning only 6 8-bit levels before the edit, as an underexposed RAW gives.
  const width = 1024, height = 256;
  const sky = grey(width, height, (x) => Math.round((40 + (6 * x) / (width - 1)) * 257));
  const lift: PhotoEdit = { ...DEFAULT_EDIT, exposure: 1.5, shadows: 60 };
  editRgb16(sky, lift);
  const truth = Array.from({ length: width }, (_, x) => sky.data[x * 3] / 257);
  // The lift spreads those 6 levels across many more: real room for steps.
  assert.ok(truth[width - 1] - truth[0] > 12, `span ${truth[width - 1] - truth[0]}`);

  /** Worst error of each column's average from the true 16-bit value (what the eye sees as a band edge), and the widest flat run. */
  const measure = (rgba: Uint8ClampedArray) => {
    let worst = 0, run = 1, widest = 1;
    let previous = -1;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = 0; y < height; y += 1) sum += rgba[(y * width + x) * 4];
      const mean = sum / height;
      worst = Math.max(worst, Math.abs(mean - truth[x]));
      const level = Math.round(mean * 4) / 4;
      run = level === previous ? run + 1 : 1;
      widest = Math.max(widest, run);
      previous = level;
    }
    return { worst, widest };
  };
  const plain = measure(rgb16ToRgba(sky));
  const dithered = measure(ditherRgb16ToRgba8(sky));
  // Plain rounding: flat bands with steps up to half a level off the true sky. The dither follows it within a fifth of a level.
  assert.ok(plain.worst > 0.4, `plain ${plain.worst}`);
  assert.ok(dithered.worst < 0.2, `dithered ${dithered.worst}`);
  assert.ok(dithered.widest * 2 < plain.widest, `bands ${dithered.widest} vs ${plain.widest}`);
});
