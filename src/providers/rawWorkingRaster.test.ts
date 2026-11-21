import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSensorRgb16 } from './rawWorkingRaster';

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
