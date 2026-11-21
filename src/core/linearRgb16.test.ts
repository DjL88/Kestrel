import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendSrgb16, blendLinearToSrgb16, decodeSrgb16, encodeSrgb16 } from './linearRgb16';

test('sRGB16 neutral and extremes survive the linear conversion', () => {
  for (const sample of [0, 1, 128, 1024, 8192, 16384, 32768, 49152, 65534, 65535]) {
    assert.ok(Math.abs(encodeSrgb16(decodeSrgb16(sample)) - sample) <= 1);
    assert.equal(blendSrgb16(sample, 65535 - sample, 0), sample);
    assert.equal(blendSrgb16(0, sample, 1), sample);
  }
});
test('linear-light boundary does not introduce a dark fringe at half coverage', () => {
  const half = blendSrgb16(0, 65535, 0.5);
  assert.ok(half > 47000 && half < 49000, 'linear half-light should encode near sRGB 0.735');
  assert.equal(half, blendLinearToSrgb16(0, 1, 0.5));
});
test('16-bit alpha transitions are monotonic and do not collapse to 8-bit', () => {
  const samples = Array.from({ length: 257 }, (_, i) => blendSrgb16(4000, 50000, i / 256));
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1]);
  assert.ok(new Set(samples).size > 200);
});

test('rejects invalid samples and coverage before corrupting an archival output', () => {
  assert.throws(() => decodeSrgb16(NaN), RangeError);
  assert.throws(() => decodeSrgb16(65536), RangeError);
  assert.throws(() => blendSrgb16(0, 65535, NaN), RangeError);
  assert.throws(() => blendLinearToSrgb16(0, 1, Infinity), RangeError);
});

test('nonfinite tone output cannot silently become black in archival RGB16', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => encodeSrgb16(invalid), RangeError);
    assert.throws(() => blendLinearToSrgb16(12345, invalid, 0.5), RangeError);
  }
  assert.equal(encodeSrgb16(0), 0);
  assert.equal(encodeSrgb16(1), 65535);
});
