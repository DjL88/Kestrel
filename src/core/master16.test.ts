import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDetail, applyDetailRgb16, applyPhotoEdit, applyPhotoEditLinear, DEFAULT_EDIT, decodeEncoded, type PhotoEdit } from './photoEdits';
import { editRgb16, applyToneMasksRgb16, encodeTiff16, frameRgb16, master16Blocker, parseRgb16, thumbRgb16, type Rgb16Image } from './master16';
import { DEFAULT_FRAMING } from './photoFraming';
import { THUMB } from './orientMatch';
import { blendSrgb16 } from './linearRgb16';
import { applyMasks, fullContext, maskAlpha } from './masks';
import { createMask, type Mask } from './maskTypes';

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

test('straightening applies at 16-bit precision without clipping a constant image', () => {
  const width = 111, height = 73, value = 31_234;
  const image: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3).fill(value) };
  for (const angle of [-13, -4, 0.75, 6.5, 13]) {
    const framed = frameRgb16(image, { ...DEFAULT_FRAMING, straighten: angle });
    assert.equal(framed.width, width);
    assert.equal(framed.height, height);
    assert.ok(framed.data.every((sample) => sample === value), `no black borders or 8-bit banding at angle ${angle}`);
  }
});

test('straightening turns a true 16-bit horizontal gradient without an 8-bit roundtrip', () => {
  const width = 96, height = 64;
  const image: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3) };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    image.data[at] = 1000 + x * 460;
    image.data[at + 1] = 2500 + y * 650;
    image.data[at + 2] = 17_777;
  }
  const output = frameRgb16(image, { ...DEFAULT_FRAMING, straighten: 7 });
  const at = (x: number, y: number, channel = 0) => output.data[(y * width + x) * 3 + channel];
  assert.ok(at(48, 10) < at(48, 52), 'positive rotation makes horizontal content slant clockwise');
  assert.equal(at(48, 32, 2), 17_777, 'untouched channel retains its 16-bit sample');
  assert.ok(output.data.some((value) => value % 257 !== 0), 'straighten did not quantise to 8-bit');
  assert.ok(at(48, 32) > 21_000 && at(48, 32) < 24_000, 'centre stays near the original centre');
});

test('straighten after quarter-turn and crop preserves dimensions and source boundaries', () => {
  const width = 121, height = 87, value = 26_543;
  const image: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3).fill(value) };
  const framed = frameRgb16(image, { ...DEFAULT_FRAMING, turns: 1, ratio: 1, straighten: 5 });
  assert.equal(framed.width, height);
  assert.equal(framed.height, height);
  assert.ok(framed.data.every((sample) => sample === value), 'orientation and crop do not reveal black frame');
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
  // TIFF ICC tag 34675 must point at a real standard RGB display profile.
  // A bare 'sRGB' text label is not sufficient for colour-managed editors.
  const profileOffset = tags.get(34675)!;
  assert.ok(profileOffset > 0, '16-bit TIFF embeds an ICC profile');
  const iccEntry = ifd + 2 + 14 * 12;
  assert.equal(tiff.getUint16(iccEntry, true), 34675);
  assert.equal(tiff.getUint16(iccEntry + 2, true), 7, 'ICC profile is TIFF UNDEFINED bytes');
  assert.equal(tiff.getUint32(iccEntry + 4, true), 588);
  assert.equal(tiff.getUint32(profileOffset, false), 588, 'ICC declares its own exact byte size');
  const signature = (at: number) => String.fromCharCode(...new Uint8Array(tiff.buffer, at, 4));
  assert.equal(signature(profileOffset + 36), 'acsp');
  assert.equal(signature(profileOffset + 16), 'RGB ');
  assert.equal(signature(profileOffset + 20), 'XYZ ');
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

test('fresh-decoder zero-copy is opt-in; default parser keeps ownership isolation', () => {
  const buffer = new ArrayBuffer(8 + 4 * 3 * 2);
  const view = new DataView(buffer);
  view.setUint32(0, 2, true);
  view.setUint32(4, 2, true);
  for (let i = 0; i < 12; i++) view.setUint16(8 + i * 2, 1400 + i * 11, true);
  const detached = parseRgb16(buffer);
  const shared = parseRgb16(buffer, true);
  assert.deepEqual(shared.data, detached.data, 'both start with the exact decoder samples');
  const nativeLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (nativeLittle) {
    assert.equal(shared.data.buffer, buffer, 'explicit export-only view aliases freshly decoded working bytes');
    shared.data[0] = 34_567;
    assert.equal(view.getUint16(8, true), 34_567, 'mutating working pixels uses no second full buffer');
    assert.equal(detached.data[0], 1400, 'existing caller defaults never alias the mutable working buffer');
  } else {
    assert.notEqual(shared.data.buffer, buffer, 'big-endian hosts safely preserve byte order through copying');
  }
});

test('frame reuse is opt-in and only for provably unchanged framing', () => {
  const source = numbered();
  assert.notEqual(frameRgb16(source, DEFAULT_FRAMING), source,
    'default pure framing retains existing copy semantics');
  assert.equal(frameRgb16(source, DEFAULT_FRAMING, 0, true), source,
    'fresh export buffer avoids an unnecessary full-frame clone');
  assert.notEqual(frameRgb16(source, { ...DEFAULT_FRAMING, turns: 1 }, 0, true), source);
  assert.notEqual(frameRgb16(source, { ...DEFAULT_FRAMING, straighten: 1 }, 0, true), source);
  assert.notEqual(frameRgb16(source, { ...DEFAULT_FRAMING, ratio: 1 }, 0, true), source);
  assert.notEqual(frameRgb16(source, DEFAULT_FRAMING, 1, true), source);
  const reused = frameRgb16(source, DEFAULT_FRAMING, 0, true);
  reused.data[0] = 61_111;
  assert.equal(source.data[0], 61_111,
    'explicit aliasing is safe only for the newly developed, throwaway RGB buffer');
});

test('the thumbnail compares like the editor\'s own (bright side stays on the same side)', () => {
  const image: Rgb16Image = { width: 64, height: 32, data: new Uint16Array(64 * 32 * 3) };
  for (let y = 0; y < 32; y += 1) for (let x = 32; x < 64; x += 1) image.data.fill(65535, (y * 64 + x) * 3, (y * 64 + x) * 3 + 3);
  const thumb = thumbRgb16(image);
  assert.equal(thumb.length, THUMB * THUMB);
  assert.ok(thumb[0] < 1 && thumb[THUMB - 1] > 254);
});

test('16-bit master applies chroma noise reduction before tone and masks', () => {
  const width = 40, height = 40;
  const raw = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const chroma = (i % 3 - 1) * 2300;
    raw.set([23500 + chroma, 27000 - chroma / 4, 30000 - chroma / 2], i * 3);
  }
  const original = raw.slice();
  const image: Rgb16Image = { width, height, data: raw };
  editRgb16(image, { ...DEFAULT_EDIT, denoise: 1 });
  assert.notDeepEqual(image.data, original, 'denoise runs in the TIFF master, not only the preview');
  assert.ok(image.data.some((value) => value % 257 !== 0), 'no 8-bit conversion');
});

test('tonal feather/subject masks are exported at 16-bit and agree with the visible 8-bit preview', () => {
  const width = 64, height = 64, initial = 23_000;
  const mask: Mask = {
    ...createMask('radial', 'bird'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.24, ry: 0.24,
    feather: 0.7, edit: { exposure: 0.9, shadows: 0.3 },
  };
  const frame: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3).fill(initial) };
  const preview = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) preview.set([Math.round(initial / 257), Math.round(initial / 257), Math.round(initial / 257), 255], p * 4);
  applyMasks(preview, width, height, [mask], fullContext(width, height));
  assert.equal(master16Blocker({ ...DEFAULT_EDIT, masks: [mask] }, DEFAULT_FRAMING), null);
  editRgb16(frame, { ...DEFAULT_EDIT, masks: [mask] });
  const at = (x: number, y: number) => frame.data[(y * width + x) * 3];
  assert.ok(at(32, 32) > initial + 1000, 'the bird centre receives the local exposure change');
  assert.equal(at(0, 0), initial, 'unmasked background is untouched');
  for (let p = 0; p < width * height; p++) {
    // Both paths use the same mask alpha, tone maths and compositing.
    assert.ok(Math.abs(frame.data[p * 3] / 257 - preview[p * 4]) <= 2, `preview/master parity at pixel ${p}`);
  }
});

test('a brush stroke and an inverted subject-style mask change only the selected pixels', () => {
  const width = 120, height = 80, initial = 25_000;
  const brush: Mask = {
    ...createMask('brush', 'paint'), kind: 'brush', edit: { exposure: 1 },
    strokes: [{ radius: 0.12, erase: false, points: [0.5, 0.5] }],
  };
  const frame: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3).fill(initial) };
  editRgb16(frame, { ...DEFAULT_EDIT, masks: [brush] });
  const at = (x: number, y: number) => frame.data[(y * width + x) * 3];
  assert.ok(at(60, 40) > initial);
  assert.equal(at(0, 0), initial);
  assert.equal(at(119, 79), initial);
});

test('16-bit mask intersection preserves background and respects the saved mask stack', () => {
  const width = 80, height = 80, initial = 27_000;
  const qualifier: Mask = {
    ...createMask('radial', 'subject-area'), kind: 'radial',
    cx: 0.5, cy: 0.5, rx: 0.20, ry: 0.20, feather: 0.1, edit: {},
  };
  const local: Mask = {
    ...createMask('linear', 'light-on-subject'), kind: 'linear',
    x1: 0.5, y1: 0, x2: 0.5, y2: 1, feather: 1,
    edit: { exposure: 0.7 }, limit: { id: qualifier.id, mode: 'intersect' },
  };
  const frame: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3).fill(initial) };
  editRgb16(frame, { ...DEFAULT_EDIT, masks: [qualifier, local] });
  const at = (x: number, y: number) => frame.data[(y * width + x) * 3];
  assert.ok(at(40, 39) > initial, 'masked centre receives the edit');
  assert.equal(at(40, 2), initial, 'the linear adjustment does not bleed beyond its subject limiter');
  assert.equal(at(2, 39), initial, 'background next to subject remains unchanged');
});

test('tonal mask bands join exactly at high-resolution row boundaries', () => {
  const width = 1024, height = 520, initial = 18_000;
  const mask: Mask = {
    ...createMask('linear', 'sky'), kind: 'linear', x1: 0.5, y1: 0, x2: 0.5, y2: 1,
    feather: 1, edit: { exposure: 0.65 },
  };
  const frame: Rgb16Image = { width, height, data: new Uint16Array(width * height * 3).fill(initial) };
  // This traverses three independent 256-row bands.
  applyToneMasksRgb16(frame, [mask]);
  const alpha = maskAlpha(mask, width, height, fullContext(width, height));
  const sourceTone = { width: 1, height: 1, data: new Uint16Array([initial, initial, initial]) };
  editRgb16(sourceTone, { ...DEFAULT_EDIT, exposure: 0.65 });
  const edited = sourceTone.data[0];
  for (const y of [0, 1, 254, 255, 256, 257, 510, 511, 512, 519]) {
    const p = y * width + 512;
    const expected = blendSrgb16(initial, edited, alpha[p]); // linear-light mix, the shared convention
    assert.ok(Math.abs(frame.data[p * 3] - expected) <= 1, `seam-free mask at row ${y}`);
  }
});

test('16-bit local Texture/Clarity/Sharpening agree with a full-frame reference across stripe boundaries', () => {
  const width = 96, height = 161;
  const original = texture(width, height);
  const local = { ...DEFAULT_EDIT, exposure: 0.4, warmth: 0.25, texture: 0.8, clarity: 0.65, sharpen: 0.9 };
  const mask: Mask = { ...createMask('radial', 'plumage'), kind: 'radial',
    cx: 0.5, cy: 0.5, rx: 0.38, ry: 0.38, feather: 0.75,
    edit: { exposure: local.exposure, warmth: local.warmth, texture: local.texture,
      clarity: local.clarity, sharpen: local.sharpen },
  };
  const full: Rgb16Image = { width, height, data: original.slice() };
  editRgb16(full, local);
  const striped: Rgb16Image = { width, height, data: original.slice() };
  // Force at least 16 stripes and a 6px+ original halo (normal 45MP
  // production defaults to much larger bands).
  applyToneMasksRgb16(striped, [mask], width * 10);
  const alpha = maskAlpha(mask, width, height, fullContext(width, height));
  for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) {
    const i = p * 3;
    const expected = blendSrgb16(original[i + c], full.data[i + c], alpha[p]);
    assert.ok(Math.abs(striped.data[i + c] - expected) <= 1,
      `full-frame detail/mask/stripe match at pixel ${p} channel ${c}`);
  }
  assert.ok(striped.data.some((v, i) => v !== original[i]), 'local detail actually changes the mask');
});

test('multiple local detail masks are applied in saved order, with no unmasked bleed', () => {
  const width = 90, height = 130;
  const original = texture(width, height);
  const one: Mask = { ...createMask('radial', 'bird'), kind: 'radial',
    cx: 0.5, cy: 0.5, rx: 0.24, ry: 0.24, feather: 0.5,
    edit: { texture: 1, sharpen: 1 } };
  const two: Mask = { ...createMask('linear', 'light'), kind: 'linear',
    x1: 0.5, x2: 0.5, y1: 0.1, y2: 0.9, feather: 0.6,
    limit: { id: one.id, mode: 'intersect' }, edit: { clarity: -0.6, exposure: 0.3 } };
  const photo: Rgb16Image = { width, height, data: original.slice() };
  applyToneMasksRgb16(photo, [one, two], width * 12);
  // Use the complete, independently edited full-frame as the reference for
  // each mask; the second reads the output of the first, not untouched input.
  let expected = original.slice();
  for (const mask of [one, two]) {
    const before = expected.slice();
    const reference: Rgb16Image = { width, height, data: before.slice() };
    editRgb16(reference, { exposure: 0, warmth: 0, colour: 0, ...mask.edit });
    const alpha = maskAlpha(mask, width, height, fullContext(width, height));
    // The second mask's intersection must match the production alpha limiter.
    const limiter = mask.limit ? maskAlpha(one, width, height, fullContext(width, height)) : null;
    expected = before.map((value, i) => {
      const pixel = Math.floor(i / 3);
      const a = alpha[pixel] * (limiter ? limiter[pixel] : 1);
      return blendSrgb16(value, reference.data[i], a);
    });
  }
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(photo.data[i] - expected[i]) <= 1, `masked layers order at sample ${i}`);
  }
});

test('full 16-bit export supports existing edits and fails closed on future/invalid recipes', () => {
  assert.equal(master16Blocker(EDIT, DEFAULT_FRAMING), null);
  assert.equal(master16Blocker({ ...EDIT, denoise: 1 }, DEFAULT_FRAMING), null, '16-bit master now supports full-size chroma denoise');
  const localDetail: Mask = { ...createMask('radial', 'feathers'), edit: { texture: 1 } };
  assert.equal(master16Blocker({ ...EDIT, masks: [localDetail] }, DEFAULT_FRAMING), null,
    '16-bit master now includes local detail masks as well as tone');
  assert.equal(master16Blocker(EDIT, { ...DEFAULT_FRAMING, straighten: 2 }), null, '16-bit TIFF now includes straightening');
  assert.match(master16Blocker({ ...EDIT, dehaze: 1 } as PhotoEdit, DEFAULT_FRAMING)!, /dehaze/,
    'a future edit must not be silently dropped from an archival TIFF');
  const invalid: Mask = { ...createMask('radial', 'invalid'), feather: NaN };
  assert.match(master16Blocker({ ...EDIT, masks: [invalid] }, DEFAULT_FRAMING)!, /saved masks/);
  assert.match(master16Blocker(EDIT, { ...DEFAULT_FRAMING, straighten: Number.NaN })!, /invalid/,
    'invalid framing must not produce an empty or misleading master');

});

test('16-bit export refuses invalid saved numeric edits instead of silently corrupting the master', () => {
  for (const key of ['exposure', 'warmth', 'colour', 'brightness', 'contrast', 'highlights',
    'shadows', 'whites', 'blacks', 'vibrance', 'texture', 'clarity', 'sharpen', 'denoise']) {
    for (const bad of [NaN, Infinity, -Infinity, '1']) {
      const edit = { ...DEFAULT_EDIT, [key]: bad } as unknown as PhotoEdit;
      assert.match(master16Blocker(edit, DEFAULT_FRAMING) ?? '', /invalid/, `${key}: ${String(bad)}`);
    }
  }
  assert.equal(master16Blocker({ ...DEFAULT_EDIT, exposure: 0.5, denoise: 1 }, DEFAULT_FRAMING), null);
});


test('archival TIFF refuses truncated, oversized and invalid 16-bit frames', () => {
  const valid: Rgb16Image = { width: 2, height: 2, data: new Uint16Array(12).fill(32769) };
  assert.ok(encodeTiff16(valid).size > 24, 'valid high-bit-depth master still exports');
  for (const bad of [
    { ...valid, width: 3 },
    { ...valid, height: 0 },
    { ...valid, width: NaN },
    { ...valid, width: 1.5 },
    { ...valid, width: 100000, height: 100000 },
    { ...valid, data: new Uint16Array(11) },
  ]) assert.throws(() => encodeTiff16(bad), /invalid dimensions or pixel data/);
});

test('local chroma denoise survives 16-bit export path without touching unmasked feathers', () => {
  const width = 64, height = 48;
  const original = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = ((x * 7 + y * 11) % 5) - 2;
    original.set([(112 + n * 5) * 257, 120 * 257, (128 - n * 4) * 257], (y * width + x) * 3);
  }
  const image: Rgb16Image = { width, height, data: new Uint16Array(original) };
  const local: Mask = { ...createMask('radial', 'chroma-16'), kind: 'radial', cx: 0.3, cy: 0.5,
    rx: 0.22, ry: 0.18, feather: 0.1, edit: { denoise: 2 } };
  assert.equal(master16Blocker({ ...DEFAULT_EDIT, masks: [local] }, DEFAULT_FRAMING), null,
    '16-bit master must accept local noise reduction');
  editRgb16(image, { ...DEFAULT_EDIT, masks: [local] });
  const inside = (24 * width + 20) * 3;
  const outside = (24 * width + 61) * 3;
  assert.notDeepEqual(Array.from(image.data.slice(inside, inside + 3)), Array.from(original.slice(inside, inside + 3)));
  assert.deepEqual(image.data.slice(outside, outside + 3), original.slice(outside, outside + 3),
    'outside mask preserves full 16-bit original samples');
  assert.ok(encodeTiff16(image).size > width * height * 6, 'archival TIFF contains the output');
});

test('RGB16 decoder refuses forged, oversized and trailing frames before allocating pixels', () => {
  const frame = (width: number, height: number, samples: number[] = []): ArrayBuffer => {
    const bytes = new ArrayBuffer(8 + samples.length * 2);
    const view = new DataView(bytes);
    view.setUint32(0, width, true);
    view.setUint32(4, height, true);
    samples.forEach((sample, index) => view.setUint16(8 + index * 2, sample, true));
    return bytes;
  };
  const exact = frame(2, 1, [1, 257, 65535, 32769, 50001, 42]);
  assert.deepEqual(Array.from(parseRgb16(exact).data), [1, 257, 65535, 32769, 50001, 42],
    'samples retain precision beyond 8-bit quantisation');
  assert.deepEqual(Array.from(parseRgb16(exact, true).data), [1, 257, 65535, 32769, 50001, 42]);
  for (const bad of [
    new ArrayBuffer(0),
    new ArrayBuffer(7),
    frame(0, 1),
    frame(1, 0),
    frame(80_000_001, 1),
    frame(0xffffffff, 0xffffffff),
    frame(2, 1, [1, 2, 3]),
    frame(1, 1, [1, 2, 3, 4]),
  ]) {
    assert.throws(() => parseRgb16(bad), /empty|invalid dimensions|incomplete pixel data/);
    assert.throws(() => parseRgb16(bad, true), /empty|invalid dimensions|incomplete pixel data/);
  }
});
