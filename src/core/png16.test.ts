import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { DEFAULT_EDIT, applyPhotoEdit, type PhotoEdit } from './photoEdits';
import { editRgb16, type Rgb16Image } from './master16';
import { encodePng16, provePng } from './png16';

/** Read the pixels of an RGB 16-bit PNG back, undoing each row's filter (only None and Sub are written). */
function decodeRgb16(bytes: Uint8Array): Rgb16Image {
  const proof = provePng(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = proof.width * 6;
  const data = new Uint16Array(proof.width * proof.height * 3);
  for (let y = 0; y < proof.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    assert.ok(filter === 0 || filter === 1, `row ${y} filter ${filter}`);
    if (filter === 1) for (let i = 6; i < stride; i += 1) row[i] = (row[i] + row[i - 6]) & 0xff;
    for (let i = 0; i < proof.width * 3; i += 1) data[y * proof.width * 3 + i] = (row[i * 2] << 8) | row[i * 2 + 1];
  }
  return { width: proof.width, height: proof.height, data };
}

const ramp = (width: number, height: number): Rgb16Image => {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 3;
    data[at] = Math.round((x / (width - 1)) * 65535);
    data[at + 1] = Math.round((x / (width - 1)) * 40000);
    data[at + 2] = (x * 7919 + y * 104729) % 65536;
  }
  return { width, height, data };
};

test('a 16-bit PNG reads back as 16-bit RGB with every sample exactly as written', async () => {
  const image = ramp(301, 7);
  const bytes = new Uint8Array(await (await encodePng16(image, 3)).arrayBuffer());
  const proof = provePng(bytes);
  assert.deepEqual([proof.width, proof.height, proof.bitDepth, proof.colourType, proof.srgb], [301, 7, 16, 2, true]);
  assert.deepEqual(decodeRgb16(bytes).data, image.data);
});

test('a gradient survives a strong curve in the 16-bit PNG without banding; the 8-bit path cannot', async () => {
  const width = 4096;
  // A steep shadow curve: the darkest quarter of the input is stretched over more than half of the output.
  const edit: PhotoEdit = { ...DEFAULT_EDIT, curve: [[0, 0], [0.25, 0.6], [1, 1]] };
  const sixteen = ramp(width, 1);
  editRgb16(sixteen, edit);
  const back = decodeRgb16(new Uint8Array(await (await encodePng16(sixteen)).arrayBuffer()));
  assert.deepEqual(back.data, sixteen.data);
  const dark = (values: ArrayLike<number>, step: number, scale: number) => {
    const levels: number[] = [];
    for (let x = 0; x < width / 4; x += 1) levels.push(values[x * step] / scale);
    return levels;
  };
  const fine = dark(back.data, 3, 257);
  // The 8-bit intermediate the old path used: quantise, edit, quantise.
  const eight = new Uint8ClampedArray(width * 4);
  ramp(width, 1).data.forEach((value, i) => { if (i % 3 === 0) eight.fill(Math.round(value / 257), (i / 3) * 4, (i / 3) * 4 + 3); });
  for (let x = 0; x < width; x += 1) eight[x * 4 + 3] = 255;
  applyPhotoEdit(eight, edit);
  const coarse = dark(eight, 4, 1);
  const largestStep = (levels: number[]) => levels.slice(1).reduce((most, value, i) => Math.max(most, value - levels[i]), 0);
  // In 8-bit units: the 16-bit result moves less than half a level between neighbours; the 8-bit one jumps in bands.
  assert.ok(largestStep(fine) < 0.5, `16-bit largest step ${largestStep(fine)}`);
  assert.ok(largestStep(coarse) >= 2, `8-bit largest step ${largestStep(coarse)}`);
  assert.ok(new Set(fine).size > new Set(coarse).size * 4, `${new Set(fine).size} vs ${new Set(coarse).size} levels`);
  for (let x = 1; x < fine.length; x += 1) assert.ok(fine[x] >= fine[x - 1], `reversed at ${x}`);
});

test('provePng refuses a damaged or 8-bit-pretending file rather than vouching for it', async () => {
  const bytes = new Uint8Array(await (await encodePng16(ramp(16, 4))).arrayBuffer());
  const damaged = bytes.slice();
  damaged[20] ^= 0xff; // inside IHDR
  assert.throws(() => provePng(damaged), /damaged/);
  assert.throws(() => provePng(bytes.slice(0, bytes.length - 12)), /complete|truncated/);
  assert.throws(() => provePng(new Uint8Array(64)), /Not a PNG/);
  await assert.rejects(encodePng16({ width: 2, height: 2, data: new Uint16Array(5) }), /invalid/);
});
