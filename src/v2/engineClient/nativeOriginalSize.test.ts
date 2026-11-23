import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedNativeOriginalSize } from './nativeOriginalSize.ts';

test('verified decoded pixels determine native Original, not fixed 3000 by 2000 placeholder', () => {
  const result = verifiedNativeOriginalSize({
    provenance: 'verified-full-image', decodedWidth: 8256, decodedHeight: 5504,
    fullWidth: 8256, fullHeight: 5504, decoderId: 'verified-decoder-v1',
  });
  assert.deepEqual(result, { ok: true, width: 8256, height: 5504,
    label: 'Original', source: 'verified-full-image', decoderId: 'verified-decoder-v1' });
});

test('an embedded RAW preview must never be described as native Original', () => {
  const result = verifiedNativeOriginalSize({
    provenance: 'embedded-preview', decodedWidth: 1620, decodedHeight: 1080,
    fullWidth: 8256, fullHeight: 5504, decoderId: 'jpeg-preview',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'unverified');
});

test('no guessed dimensions when EXIF is available but decode identity is unknown', () => {
  const result = verifiedNativeOriginalSize({
    provenance: 'unknown', decodedWidth: 3000, decodedHeight: 2000,
    fullWidth: 8256, fullHeight: 5504,
  });
  assert.equal(result.ok, false);
});

test('claiming verified full image without a decoder identity is not sufficient', () => {
  assert.equal(verifiedNativeOriginalSize({
    provenance: 'verified-full-image', decodedWidth: 4000, decodedHeight: 3000,
    fullWidth: 4000, fullHeight: 3000,
  }).ok, false);
});

test('full-size and decoded pixel mismatch must fail closed', () => {
  const result = verifiedNativeOriginalSize({
    provenance: 'verified-full-image', decodedWidth: 1620, decodedHeight: 1080,
    fullWidth: 8256, fullHeight: 5504, decoderId: 'fake-claim',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'mismatch');
});

test('malformed dimensions are rejected and never rounded or silently capped', () => {
  for (const n of [0, -1, 50.5, Number.NaN, Infinity, 100001]) {
    assert.equal(verifiedNativeOriginalSize({
      provenance: 'verified-full-image', decodedWidth: n, decodedHeight: 100,
      fullWidth: n, fullHeight: 100, decoderId: 'decoder',
    }).ok, false);
  }
});

test('orientation is never automatically swapped', () => {
  const result = verifiedNativeOriginalSize({
    provenance: 'verified-full-image', decodedWidth: 5504, decodedHeight: 8256,
    fullWidth: 5504, fullHeight: 8256, decoderId: 'decoder',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual([result.width, result.height], [5504, 8256]);
});
