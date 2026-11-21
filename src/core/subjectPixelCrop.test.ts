import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactSubjectPixelCrop, type SourcePixelRaster } from './subjectPixelCrop';
const sha = 'a'.repeat(64);
const raster = (): SourcePixelRaster => ({
  photoId: 'p', sourceSha256: sha, width: 4, height: 3, sourceWidth: 4, sourceHeight: 3,
  rgba: Uint8Array.from({ length: 48 }, (_, i) => i),
});
test('exact A/B subject crop copies unscaled original pixel rows', () => {
  const original = raster();
  const result = exactSubjectPixelCrop(original, 'p', sha, { x: 0.25, y: 1/3, width: 0.5, height: 1/3 });
  assert.ok(result);
  assert.deepEqual([result.x, result.y, result.width, result.height], [1, 1, 2, 1]);
  assert.deepEqual([...result.rgba], [...original.rgba.slice(20, 28)]);
  result.rgba[0] = 0;
  assert.equal(original.rgba[20], 20);
});
test('photo switch, wrong original, and reduced preview cannot masquerade as source pixels', () => {
  const r = raster();
  const b = { x: 0, y: 0, width: 0.5, height: 0.5 };
  assert.equal(exactSubjectPixelCrop(r, 'other', sha, b), null);
  assert.equal(exactSubjectPixelCrop(r, 'p', 'b'.repeat(64), b), null);
  assert.equal(exactSubjectPixelCrop({ ...r, sourceWidth: 400 }, 'p', sha, b), null);
  assert.equal(exactSubjectPixelCrop({ ...r, rgba: r.rgba.slice(0, 24) }, 'p', sha, b), null);
});
test('malformed, oversized, or non-finite crop abstains', () => {
  const r = raster();
  assert.equal(exactSubjectPixelCrop(r, 'p', sha, { x: NaN, y: 0, width: 1, height: 1 }), null);
  assert.equal(exactSubjectPixelCrop(r, 'p', sha, { x: 0.9, y: 0, width: 0.5, height: 1 }), null);
  assert.equal(exactSubjectPixelCrop(r, 'p', sha, { x: 0, y: 0, width: 1, height: 1 }, 8), null);
});
