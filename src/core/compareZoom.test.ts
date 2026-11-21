import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePreviewPixelZoom } from './compareZoom';
import { percentFor } from './zoomControls';

test('200 percent means two device pixels per loaded preview pixel, not twice Fit', () => {
  const fit = 0.25;
  const scale = comparePreviewPixelZoom(fit, 1);
  assert.equal(scale, 8);
  assert.equal(percentFor(scale!, fit, 1), 200);
  assert.notEqual(scale, 2, '2× Fit would have represented only 50%');
});

test('a high-density display uses device pixel ratio when zooming to 200 percent', () => {
  const fit = 0.2;
  const zoom = comparePreviewPixelZoom(fit, 2);
  assert.equal(zoom, 5);
  assert.equal(percentFor(zoom!, fit, 2), 200);
});

test('unloaded or malformed preview sizes must disable 200 percent rather than jump to Fit', () => {
  for (const fit of [0, -1, NaN, Infinity]) assert.equal(comparePreviewPixelZoom(fit, 1), null);
  for (const dpr of [0, -1, NaN, Infinity]) assert.equal(comparePreviewPixelZoom(0.2, dpr), null);
});

test('small photos already above 200 percent at Fit do not display misleading zoom buttons', () => {
  assert.equal(comparePreviewPixelZoom(3, 1), null);
  assert.equal(comparePreviewPixelZoom(1.1, 2), null);
});

test('a representative 500-photo Compare sequence has stable zoom across switches', () => {
  for (let index = 0; index < 500; index += 1) {
    const fit = 0.1 + (index % 9) / 100;
    const zoom = comparePreviewPixelZoom(fit, 1);
    assert.ok(zoom !== null);
    assert.equal(percentFor(zoom!, fit, 1), 200);
  }
});

test('100 percent is one device pixel per preview pixel and disables when Fit is larger', () => {
  const zoom = comparePreviewPixelZoom(0.25, 2, 100);
  assert.equal(zoom, 2);
  assert.equal(percentFor(zoom, 0.25, 2), 100);
  assert.equal(comparePreviewPixelZoom(0.75, 2, 100), null);
  assert.equal(comparePreviewPixelZoom(0.75, 2, 200), 4 / 3);
});
