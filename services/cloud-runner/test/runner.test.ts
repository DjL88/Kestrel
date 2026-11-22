import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runJob, type RunnerStore } from '../src/run.ts';
import { encodeDenoiseUpload, encodeMaskUpload, encodeUpscaleUpload, decodeResult } from '../../../src/providers/cloudJobCodec.ts';
import type { Pixels } from '../../../src/core/colourCheck.ts';

function fakeStore(files: Record<string, Uint8Array>): RunnerStore & { files: Record<string, Uint8Array> } {
  return {
    files,
    read: async (n) => { if (!files[n]) throw new Error('missing'); return files[n]; },
    write: async (n, b) => { files[n] = b; },
  };
}
function noisy(size: number): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i + c] = 128 + ((seed >> 8) % 41) - 20; }
    data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

describe('cloud runner', () => {
  it('denoises an upload and writes a decodable result of the same size', async () => {
    const photo = noisy(32);
    const store = fakeStore({ 'inputs/j1': encodeDenoiseUpload(photo, 1) });
    assert.equal(await runJob(store, 'j1', 'denoise'), true);
    const { picture } = decodeResult(store.files['results/j1']);
    assert.equal(picture.width, 32);
    assert.notDeepEqual(Array.from(picture.data), Array.from(photo.data));
    assert.equal(store.files['failed/j1'], undefined);
  });
  it('protects the subject: strength between background and subject follows the alpha plane', async () => {
    const photo = noisy(32);
    const alpha = new Float32Array(32 * 32).fill(1);
    const store = fakeStore({ 'inputs/j2': encodeDenoiseUpload(photo, 1, 0, alpha) });
    assert.equal(await runJob(store, 'j2', 'denoise'), true);
  });
  it('runs a mask job with no masks as an identity copy', async () => {
    const photo = noisy(16);
    const store = fakeStore({ 'inputs/j3': encodeMaskUpload(photo, []) });
    assert.equal(await runJob(store, 'j3', 'mask'), true);
    assert.deepEqual(Array.from(decodeResult(store.files['results/j3']).picture.data), Array.from(photo.data));
  });
  it('upscales an upload to the requested scale and honestly reports usedModel: false (no server-side enlarger exists)', async () => {
    const photo = noisy(16);
    const store = fakeStore({ 'inputs/j4': encodeUpscaleUpload(photo, 2) });
    assert.equal(await runJob(store, 'j4', 'upscale'), true);
    const { header, picture } = decodeResult(store.files['results/j4']);
    assert.equal(picture.width, 32);
    assert.equal(picture.height, 32);
    assert.equal(header.usedModel, false);
    assert.equal(store.files['failed/j4'], undefined);
  });
  it('writes an empty failed marker for a missing, corrupt, mismatched or oversized input, and nothing else', async () => {
    const photo = noisy(8);
    const cases: [string, Record<string, Uint8Array>, string, number?][] = [
      ['a', {}, 'denoise'],
      ['b', { 'inputs/b': new Uint8Array([1, 2, 3]) }, 'denoise'],
      ['c', { 'inputs/c': encodeDenoiseUpload(photo, 1) }, 'mask'],
      ['d', { 'inputs/d': encodeDenoiseUpload(photo, 1) }, 'denoise', 10],
    ];
    for (const [id, files, kind, max] of cases) {
      const store = fakeStore(files);
      assert.equal(await runJob(store, id, kind, max), false);
      assert.equal(store.files[`failed/${id}`].byteLength, 0);
      assert.equal(store.files[`results/${id}`], undefined);
    }
  });
  it('refuses a job id that could leave its folder', async () => {
    const store = fakeStore({});
    assert.equal(await runJob(store, '../x', 'denoise'), false);
    assert.equal(Object.keys(store.files).some((k) => k.includes('..')), false);
  });
});
