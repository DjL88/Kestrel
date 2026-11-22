import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CROP } from './cropOps.ts';
import { anchoredBox, cropPlacement, referenceScale, watermarkBox } from './exportLayout.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

test('the picture covers the frame, with no zoom or pan at the default crop', () => {
  const place = cropPlacement(1080, 1350, { width: 6000, height: 4000 }, DEFAULT_CROP);
  close(place.drawHeight, 1350);
  close(place.drawWidth, 2025);
  assert.equal(place.translateX, 0);
  assert.equal(place.scaleX, 1);
  assert.deepEqual(place.clip, { x: 0, y: 0, width: 1080, height: 1350 });
});

test('zoom, pan, flips, rotation and insets follow the canvas transform', () => {
  const place = cropPlacement(1000, 500, { width: 2000, height: 1000 }, { ...DEFAULT_CROP, zoom: 2, panX: 10, panY: -20, flipH: true, rotateDeg: 90, insetLeft: 10, insetRight: 10, insetTop: 5, insetBottom: 5 });
  assert.equal(place.translateX, 100);
  assert.equal(place.translateY, -100);
  assert.equal(place.scaleX, -2);
  assert.equal(place.scaleY, 2);
  close(place.rotateRad, Math.PI / 2);
  assert.deepEqual(place.clip, { x: 100, y: 25, width: 800, height: 450 });
});

test('a box anchored at an edge stays inside the frame and is centred at 50%', () => {
  const frame = { width: 1000, height: 800 };
  assert.deepEqual(anchoredBox(frame, 0, 50, { width: 200, height: 100 }), { x: 0, y: 350, width: 200, height: 100 });
  assert.deepEqual(anchoredBox(frame, 100, 50, { width: 200, height: 100 }), { x: 800, y: 350, width: 200, height: 100 });
  assert.equal(anchoredBox(frame, 50, 50, { width: 200, height: 100 }).x, 400);
});

test('the watermark scales about its anchor and keeps that point fixed', () => {
  const frame = { width: 1000, height: 800 };
  const natural = { width: 200, height: 50 };
  const full = watermarkBox(frame, { watermarkX: 80, watermarkY: 90, watermarkScale: 100 }, natural);
  const half = watermarkBox(frame, { watermarkX: 80, watermarkY: 90, watermarkScale: 50 }, natural);
  close(full.x + 0.8 * full.width, half.x + 0.8 * half.width);
  close(half.width, 100);
  close(half.y + half.height / 2, 720);
});

test('sizes scale from the 660 px reference frame', () => {
  close(referenceScale(1320), 2);
});
