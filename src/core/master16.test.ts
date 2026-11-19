import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDetail, applyDetailRgb16, applyPhotoEdit, applyPhotoEditLinear, DEFAULT_EDIT, decodeEncoded } from './photoEdits';
import { editRgb16, encodeTiff16, frameRgb16, master16Blocker, parseRgb16, thumbRgb16, type Rgb16Image } from './master16';
import { DEFAULT_FRAMING } from './photoFraming';
import { THUMB } from './orientMatch';

const EDIT = { ...DEFAULT_EDIT, exposure: 0.6, warmth: 0.3, colour: 0.4, contrast: 0.5, shadows: 1, highlights: -1, whites: 0.5, blacks: 0.4, vibrance: 0.6, brightness: 0.5 };

test('the full-precision tone edit is the 8-bit one, only finer', () => {
  const bytes = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v += 1) bytes.set([v, (v * 7) % 256, 255 - v, 255], v * 4);
  const floats = Float32Array.from(bytes, (value, i) => i % 4 === 3 ? 1 : decodeEncoded(value / 255));
  applyPhotoEdit(bytes, EDIT);
  applyPhotoEditLinear(floats, EDIT);
  for (let i = 0; i < bytes.length; i += 1) {
    if (i % 4 === 3) continue;
    assert.ok(Math.abs(floats[i] * 255 - bytes[i]) <= 0.51, `sample ${i}: ${floats[i] * 255} vs ${bytes[i]}`);
  }
});

/** A smooth 16-bit ramp through the shadows, where an 8-bit file bands first when they are lifted. */
function shadowRamp(): Rgb16Image {
  const width = 4096;
  const data = new Uint16Array(width * 3);
  for (let x = 0; x < width; x += 1) data.fill(Math.round(1000 + x * 3), x * 3, x * 3 + 3); // about 1.5% to 20% of white
  return { width, height: 1, data };
}

test('a strong shadow lift on 16-bit data stays smooth: many more steps than the 8-bit path, never reversed', () => {
  const edit = { ...DEFAULT_EDIT, exposure: 1, shadows: 2 };
  const sixteen = shadowRamp();
  editRgb16(sixteen, edit);
  const eight = new Uint8ClampedArray(4096 * 4);
  shadowRamp().data.forEach((value, i) => { if (i % 3 === 0) eight.set([Math.round(value / 257), Math.round(value / 257), Math.round(value / 257), 255], (i / 3) * 4); });
  applyPhotoEdit(eight, edit);
  const levels = (values: ArrayLike<number>, step: number) => new Set(Array.from({ length: 4096 }, (_, x) => values[x * step])).size;
  const fine = levels(sixteen.data, 3);
  const coarse = levels(eight, 4);
  assert.ok(fine > coarse * 20, `16-bit steps ${fine}, 8-bit steps ${coarse}`);
  for (let x = 1; x < 4096; x += 1) assert.ok(sixteen.data[x * 3] >= sixteen.data[(x - 1) * 3], `reversed at ${x}`);
  // Same picture: the 16-bit result rounds to within a level of the 8-bit one.
  for (let x = 0; x < 4096; x += 97) assert.ok(Math.abs(sixteen.data[x * 3] / 257 - eight[x * 4]) <= 1.5, `x ${x}`);
});

function texture(width: number, height: number): Uint16Array {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = 20000 + 15000 * Math.sin(x / 3) * Math.cos(y / 5) + ((x * 7919 + y * 104729) % 997) * 4;
      data.fill(Math.round(v), (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return data;
}

test('16-bit detail in bands joins exactly: the same as one pass over the whole picture', () => {
  const edit = { ...DEFAULT_EDIT, texture: 1, clarity: 1.5, sharpen: 1 };
  const whole = texture(96, 300);
  const banded = whole.slice();
  applyDetailRgb16(whole, 96, 300, edit, 2000, 100000);
  applyDetailRgb16(banded, 96, 300, edit, 2000, 13);
  assert.deepEqual(banded, whole);
  assert.notDeepEqual(whole, texture(96, 300), 'detail did something');
});

test('16-bit detail matches the 8-bit screen formula', () => {
  const edit = { ...DEFAULT_EDIT, texture: 1, clarity: 1, sharpen: 1 };
  const sixteen = texture(64, 64).map((v) => Math.round(v / 257) * 257);
  const eight = new Uint8ClampedArray(64 * 64 * 4);
  sixteen.forEach((value, i) => { eight[Math.floor(i / 3) * 4 + (i % 3)] = value / 257; });
  applyDetailRgb16(sixteen, 64, 64, edit, 64);
  applyDetail(eight, 64, 64, edit, 64);
  for (let p = 0; p < 64 * 64; p += 1) assert.ok(Math.abs(sixteen[p * 3] / 257 - eight[p * 4]) <= 0.51, `pixel ${p}`);
});

/** A 3 x 2 picture whose red channel numbers its pixels 1 to 6: top row 1 2 3, bottom row 4 5 6. */
const numbered = (): Rgb16Image => ({ width: 3, height: 2, data: Uint16Array.from({ length: 18 }, (_, i) => i % 3 === 0 ? i / 3 + 1 : 0) });
const layout = (image: Rgb16Image) => Array.from({ length: image.height }, (_, y) => Array.from({ length: image.width }, (_, x) => image.data[(y * image.width + x) * 3]));

test('quarter turns go clockwise, as in the editor, and the crop is cut after turning', () => {
  assert.deepEqual(layout(frameRgb16(numbered(), DEFAULT_FRAMING)), [[1, 2, 3], [4, 5, 6]]);
  assert.deepEqual(layout(frameRgb16(numbered(), { ...DEFAULT_FRAMING, turns: 1 })), [[4, 1], [5, 2], [6, 3]]);
  assert.deepEqual(layout(frameRgb16(numbered(), { ...DEFAULT_FRAMING, turns: 2 })), [[6, 5, 4], [3, 2, 1]]);
  assert.deepEqual(layout(frameRgb16(numbered(), { ...DEFAULT_FRAMING, turns: 3 })), [[3, 6], [2, 5], [1, 4]]);
  assert.deepEqual(layout(frameRgb16(numbered(), DEFAULT_FRAMING, 1)), [[4, 1], [5, 2], [6, 3]], 'a turn to match the editor counts too');
  // Square crop at the right-hand side of the turned 2 x 3 picture.
  assert.deepEqual(layout(frameRgb16(numbered(), { ...DEFAULT_FRAMING, turns: 1, ratio: 1, x: 1, y: 1 })), [[5, 2], [6, 3]]);
});

test('the TIFF holds the exact 16-bit samples, with the headers every reader needs', async () => {
  const image: Rgb16Image = { width: 5, height: 3, data: Uint16Array.from({ length: 45 }, (_, i) => i * 1400 + 7) };
  const tiff = new DataView(await encodeTiff16(image).arrayBuffer());
  assert.equal(tiff.getUint16(0, true), 0x4949);
  assert.equal(tiff.getUint16(2, true), 42);
  const ifd = tiff.getUint32(4, true);
  const tags = new Map<number, number>();
  for (let i = 0; i < tiff.getUint16(ifd, true); i += 1) {
    const at = ifd + 2 + i * 12;
    const type = tiff.getUint16(at + 2, true);
    tags.set(tiff.getUint16(at, true), type === 3 && tiff.getUint32(at + 4, true) === 1 ? tiff.getUint16(at + 8, true) : tiff.getUint32(at + 8, true));
  }
  assert.equal(tags.get(256), 5);
  assert.equal(tags.get(257), 3);
  assert.equal(tags.get(277), 3);
  assert.equal(tags.get(262), 2, 'RGB');
  assert.equal(tags.get(259), 1, 'uncompressed');
  assert.equal(tiff.getUint16(tags.get(258)!, true), 16);
  assert.equal(tags.get(279), 5 * 3 * 6);
  const start = tags.get(273)!;
  for (let i = 0; i < 45; i += 1) assert.equal(tiff.getUint16(start + i * 2, true), image.data[i]);
  assert.equal(tiff.byteLength, start + 90);
});

test('the decoder layout is read back exactly, and a short buffer is refused', () => {
  const buffer = new ArrayBuffer(8 + 2 * 1 * 6);
  const view = new DataView(buffer);
  view.setUint32(0, 2, true); view.setUint32(4, 1, true);
  [1, 2, 3, 65535, 0, 300].forEach((v, i) => view.setUint16(8 + i * 2, v, true));
  assert.deepEqual(Array.from(parseRgb16(buffer).data), [1, 2, 3, 65535, 0, 300]);
  assert.throws(() => parseRgb16(buffer.slice(0, 14)), /incomplete/);
  assert.throws(() => parseRgb16(new ArrayBuffer(4)), /empty/);
});

test('the thumbnail compares like the editor\'s own (bright side stays on the same side)', () => {
  const image: Rgb16Image = { width: 64, height: 32, data: new Uint16Array(64 * 32 * 3) };
  for (let y = 0; y < 32; y += 1) for (let x = 32; x < 64; x += 1) image.data.fill(65535, (y * 64 + x) * 3, (y * 64 + x) * 3 + 3);
  const thumb = thumbRgb16(image);
  assert.equal(thumb.length, THUMB * THUMB);
  assert.ok(thumb[0] < 1 && thumb[THUMB - 1] > 254);
});

test('edits the 16-bit TIFF cannot carry yet are named, never silently dropped', () => {
  assert.equal(master16Blocker(EDIT, DEFAULT_FRAMING), null);
  assert.match(master16Blocker({ ...EDIT, denoise: 1 }, DEFAULT_FRAMING)!, /Noise reduction/);
  assert.match(master16Blocker(EDIT, { ...DEFAULT_FRAMING, straighten: 2 })!, /straightening/);
});
