import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSensorRgb16, hashRawSource } from './rawWorkingRaster';

function rgb16(width: number, height: number, samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  samples.forEach((value, index) => view.setUint16(8 + index * 2, value, true));
  return buffer;
}

test('retains intermediate 16-bit samples without JPEG quantisation', () => {
    const out = acceptSensorRgb16(rgb16(2, 1, [1, 256, 32769, 65534, 42, 8193]));
    assert.deepEqual([...out.image.data], [1, 256, 32769, 65534, 42, 8193]);
    assert.equal(out.allocatedBytes, 20);
    assert.equal(out.provenance.encoding, 'display-srgb');
    assert.equal(out.provenance.iccVerified, false);
    assert.equal(out.provenance.sceneLinear, false);
    assert.equal(out.provenance.previewExportParityVerified, false);
  });
test('rejects truncated pixels, trailing bytes and hostile dimensions', () => {
    assert.throws(() => acceptSensorRgb16(rgb16(2, 1, [1, 2, 3])));
    assert.throws(() => acceptSensorRgb16(rgb16(1, 1, [1, 2, 3, 4])));
    assert.throws(() => acceptSensorRgb16(rgb16(2, 1, [1, 2, 3, 4, 5, 6]), 1));
  });
test('rejects invalid memory limits and empty images', () => {
    assert.throws(() => acceptSensorRgb16(new ArrayBuffer(0)));
    assert.throws(() => acceptSensorRgb16(rgb16(1, 1, [1, 2, 3]), Number.NaN));
    assert.throws(() => acceptSensorRgb16(rgb16(1, 1, [1, 2, 3]), 100_000_000));
  });

test('source SHA-256 is reproducible across chunk sizes and retains exact bytes', async () => {
  const source = new Blob([new TextEncoder().encode('abc')]);
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await hashRawSource(source), digest);
  assert.equal(await hashRawSource(source, 4096), digest);
  assert.equal(await source.text(), 'abc');
});

test('streaming source identity covers chunk boundaries and detects changed source', async () => {
  const a = new Uint8Array(9000).fill(11);
  const b = a.slice(); b[8192] ^= 1;
  const hashA = await hashRawSource(new Blob([a]), 4096);
  const hashB = await hashRawSource(new Blob([b]), 4096);
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.notEqual(hashA, hashB);
});

test('source hash rejects empty inputs and unsafe chunk limits', async () => {
  await assert.rejects(hashRawSource(new Blob([])));
  await assert.rejects(hashRawSource(new Blob(['a']), 1));
  await assert.rejects(hashRawSource(new Blob(['a']), 5 * 1024 * 1024));
});
