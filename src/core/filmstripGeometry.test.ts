import assert from 'node:assert/strict';
import test from 'node:test';
import { clampFilmstripHeight, parseFilmstripHeight, filmstripTileGeometry } from './filmstripGeometry';

test('filmstrip stays within the actual viewport, with a useful minimum', () => {
  assert.equal(clampFilmstripHeight(240, 800), 240);
  assert.equal(clampFilmstripHeight(800, 800), 320);
  assert.equal(clampFilmstripHeight(10, 800), 80);
  assert.equal(clampFilmstripHeight(340, 240), 96);
  assert.equal(clampFilmstripHeight(Number.NaN, 800), 140);
});
test('corrupt local storage cannot break access to the shoot', () => {
  assert.equal(parseFilmstripHeight(null, 800), 140);
  assert.equal(parseFilmstripHeight('"broken"', 800), 140);
  assert.equal(parseFilmstripHeight('{oops', 800), 140);
  assert.equal(parseFilmstripHeight('180', 800), 180);
});
test('resizing updates thumbnail dimensions and virtual scroll stride', () => {
  const small = filmstripTileGeometry(85);
  const large = filmstripTileGeometry(230);
  assert.ok(large.width > small.width);
  assert.ok(large.height > small.height);
  assert.equal(large.stride, large.width + 8);
  assert.equal(small.stride, small.width + 8);
});
