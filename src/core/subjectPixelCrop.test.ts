import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactSubjectPixelCrop, exactSubjectProofPair, type SourcePixelRaster } from './subjectPixelCrop';
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

test('two original-pixel subject crops preserve source identity and remain review-only', () => {
  const left = raster();
  const right = { ...raster(), photoId: 'q', sourceSha256: 'b'.repeat(64), rgba: Uint8Array.from({ length: 48 }, (_, i) => 255 - i) };
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const a = { raster: left, photoId: 'p', sourceSha256: sha, box, comparisonGroup: 'folder/burst' };
  const b = { raster: right, photoId: 'q', sourceSha256: right.sourceSha256, box, comparisonGroup: 'folder/burst' };
  const result = exactSubjectProofPair(a, b);
  assert.ok(result);
  assert.equal(result.recommendation, 'review');
  assert.equal(result.left.photoId, 'p');
  assert.equal(result.right.photoId, 'q');
  assert.equal(result.left.rgba[0], 0);
  assert.equal(result.right.rgba[0], 255);
  assert.ok(Number.isFinite(result.leftEdgeEnergy));
  assert.ok(Number.isFinite(result.rightEdgeEnergy));
  assert.ok(result.leftEdgeEnergy >= 0 && result.rightEdgeEnergy >= 0);
});
test('A/B proof abstains across source groups, stale images and unbalanced crop geometry', () => {
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const a = { raster: raster(), photoId: 'p', sourceSha256: sha, box, comparisonGroup: 'folder/one' };
  const b = { ...a, photoId: 'q', raster: { ...raster(), photoId: 'q' } };
  assert.equal(exactSubjectProofPair(a, { ...b, comparisonGroup: 'folder/two' }), null);
  assert.equal(exactSubjectProofPair(a, { ...b, sourceSha256: 'b'.repeat(64) }), null);
  assert.equal(exactSubjectProofPair(a, { ...b, box: { x: 0, y: 0, width: 0.5, height: 1 } }), null);
  assert.equal(exactSubjectProofPair(a, b, 16), null);
  assert.equal(exactSubjectProofPair(a, { ...a }), null);
});
test('A/B proof does not invent sharpness from fully transparent source samples', () => {
  const left = raster();
  const right = { ...raster(), photoId: 'q' };
  for (let i = 3; i < left.rgba.length; i += 4) {
    left.rgba[i] = 0;
    right.rgba[i] = 0;
  }
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const a = { raster: left, photoId: 'p', sourceSha256: sha, box, comparisonGroup: 'g' };
  const b = { raster: right, photoId: 'q', sourceSha256: sha, box, comparisonGroup: 'g' };
  assert.equal(exactSubjectProofPair(a, b), null);
});

test('source crop abstains if current photo changes before or during copying', () => {
  const box = { x: 0, y: 0, width: 1, height: 1 };
  assert.equal(exactSubjectPixelCrop(raster(), 'p', sha, box, 1024, () => false), null);
  let checks = 0;
  assert.equal(exactSubjectPixelCrop(raster(), 'p', sha, box, 1024, () => ++checks === 1), null);
});
test('A/B comparison refuses stale scope before work and after measuring', () => {
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const a = { raster: raster(), photoId: 'p', sourceSha256: sha, box, comparisonGroup: 'g' };
  const b = { ...a, raster: { ...raster(), photoId: 'q' }, photoId: 'q' };
  assert.equal(exactSubjectProofPair(a, b, 1024, () => false), null);
  let checks = 0;
  assert.equal(exactSubjectProofPair(a, b, 1024, () => ++checks < 6), null);
});
