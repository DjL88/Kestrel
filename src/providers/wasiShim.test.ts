import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { instantiateRawWasm } from './wasiShim';

const WASM = new URL('../assets/wasm/kestrel_raw.wasm', import.meta.url);
// A 96 × 64 Bayer mosaic written by ticoraw's DNG writer, orientation 6 (portrait). Synthetic: no camera data.
const DNG = new URL('../../tests/fixtures/synthetic-z8.dng', import.meta.url);

/** Width and height from a baseline or progressive JPEG's frame header. */
function jpegSize(jpeg: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    const length = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xc0 || marker === 0xc2) return { height: (jpeg[i + 5] << 8) | jpeg[i + 6], width: (jpeg[i + 7] << 8) | jpeg[i + 8] };
    i += 2 + length;
  }
  return null;
}

const skip = !existsSync(WASM) && 'the RAW WebAssembly is not built in this checkout (npm run raw:wasm)';

test('the web build develops RAW sensor data with the same code as the desktop app', { skip }, async () => {
  const raw = await instantiateRawWasm(new WebAssembly.Module(readFileSync(WASM)));
  const jpeg = raw.develop(new Uint8Array(readFileSync(DNG)));
  assert.deepEqual([jpeg[0], jpeg[1]], [0xff, 0xd8], 'a JPEG');
  // Full size, turned the way the camera was held: 96 × 64 sensor, orientation 6, so 64 wide and 96 tall.
  assert.deepEqual(jpegSize(jpeg), { width: 64, height: 96 });
});

test('a file the decoder cannot read is refused in plain words, and the module keeps working', { skip }, async () => {
  const raw = await instantiateRawWasm(new WebAssembly.Module(readFileSync(WASM)));
  assert.throws(() => raw.develop(new Uint8Array(4096)), /RAW file/);
  assert.throws(() => raw.develop(new Uint8Array(0)), /RAW file/);
  const jpeg = raw.develop(new Uint8Array(readFileSync(DNG)));
  assert.deepEqual([jpeg[0], jpeg[1]], [0xff, 0xd8]);
});

test('only Nikon High Efficiency files are reported as such', { skip }, async () => {
  const raw = await instantiateRawWasm(new WebAssembly.Module(readFileSync(WASM)));
  const dng = new Uint8Array(readFileSync(DNG));
  assert.equal(raw.sensorMode(dng.subarray(0, 4096), dng.length), 'other');
  assert.equal(raw.sensorMode(new Uint8Array(0), 0), 'other');
});

/**
 * Optional, owner-provided or public CC0 Nikon HE/HE* files: KESTREL_RAW_SAMPLES=<folder> npm test. Every HE NEF there
 * must be recognised from its headers (reading more only when asked) and develop to a full-size JPEG through the
 * WebAssembly build the web app and the phone shells use. Nothing is written or uploaded.
 */
const samples = process.env.KESTREL_RAW_SAMPLES;
test('owner HE/HE* files develop through the WebAssembly build', { skip: (!samples && 'KESTREL_RAW_SAMPLES not set') || skip }, async () => {
  const { readdirSync } = await import('node:fs');
  const raw = await instantiateRawWasm(new WebAssembly.Module(readFileSync(WASM)));
  let developed = 0;
  for (const name of readdirSync(samples!).filter((entry) => /\.nef$/i.test(entry))) {
    const bytes = new Uint8Array(readFileSync(`${samples}/${name}`));
    let mode = raw.sensorMode(bytes.subarray(0, 4 << 20), bytes.length);
    for (let size = 8 << 20; mode === 'need-more' && size <= 64 << 20; size *= 2) mode = raw.sensorMode(bytes.subarray(0, Math.min(size, bytes.length)), bytes.length);
    if (mode !== 'nikon-he' && mode !== 'nikon-he-star') continue;
    const started = performance.now();
    const size = jpegSize(raw.develop(bytes));
    assert.ok(size && size.width > 1000 && size.height > 1000, `${name}: ${JSON.stringify(size)}`);
    console.log(`${name} | ${mode} | ${size!.width}x${size!.height} | ${Math.round(performance.now() - started)}ms`);
    developed += 1;
  }
  console.log(`HE/HE* files developed through WebAssembly: ${developed}`);
});

test('the decoder reports its memory, so the worker can give it back after a big file', { skip }, async () => {
  const raw = await instantiateRawWasm(new WebAssembly.Module(readFileSync(WASM)));
  const before = raw.memoryBytes();
  raw.develop(new Uint8Array(readFileSync(DNG)));
  assert.ok(before > 0 && raw.memoryBytes() >= before, 'memory only grows within one instance');
});

test('the web build also gives the full 16-bit picture the JPEG was made from', { skip }, async () => {
  const raw = await instantiateRawWasm(new WebAssembly.Module(readFileSync(WASM)));
  const picture = raw.develop16(new Uint8Array(readFileSync(DNG)));
  const view = new DataView(picture.buffer, picture.byteOffset, picture.byteLength);
  assert.deepEqual([view.getUint32(0, true), view.getUint32(4, true)], [64, 96], 'full size, turned as the camera was held');
  assert.equal(picture.byteLength, 8 + 64 * 96 * 6);
  assert.throws(() => raw.develop16(new Uint8Array(4096)), /RAW file/);
});
