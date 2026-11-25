import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CROP } from './cropOps.ts';
import { anchoredBox, cropPlacement, referenceScale, watermarkBox, fitWatermarkArtwork, safeAnchoredBox, safeOverlayTransform } from './exportLayout.ts';

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

test('a box is anchored by its own centre, continuously across the whole frame', () => {
  const frame = { width: 1000, height: 800 };
  // At x%, the box's centre - not an edge - sits at x% of the frame width; a box can extend past the
  // frame edge when anchored at 0% or 100%, same as the canvas's fixed-centre translate(-50%, -50%).
  assert.deepEqual(anchoredBox(frame, 0, 50, { width: 200, height: 100 }), { x: -100, y: 350, width: 200, height: 100 });
  assert.deepEqual(anchoredBox(frame, 100, 50, { width: 200, height: 100 }), { x: 900, y: 350, width: 200, height: 100 });
  assert.equal(anchoredBox(frame, 50, 50, { width: 200, height: 100 }).x, 400);
});

test('the watermark scales about its own centre and keeps that point fixed', () => {
  const frame = { width: 1000, height: 800 };
  const natural = { width: 200, height: 50 };
  const full = watermarkBox(frame, { watermarkX: 80, watermarkY: 90, watermarkScale: 100 }, natural);
  const half = watermarkBox(frame, { watermarkX: 80, watermarkY: 90, watermarkScale: 50 }, natural);
  close(full.x + full.width / 2, half.x + half.width / 2);
  close(half.width, 100);
  close(half.y + half.height / 2, 720);
});

test('sizes scale from the 660 px reference frame', () => {
  close(referenceScale(1320), 2);
});

test('watermark artwork retains its aspect ratio inside the preview limits', () => {
  assert.deepEqual(fitWatermarkArtwork(660, 1000, 100), { width: 180, height: 18 });
  assert.deepEqual(fitWatermarkArtwork(660, 100, 100), { width: 36, height: 36 });
  assert.deepEqual(fitWatermarkArtwork(1320, 100, 200), { width: 36, height: 72 });
  assert.deepEqual(fitWatermarkArtwork(660, 0, 0), { width: 0, height: 0 });
});


test('edge text and scaled watermark keep the same page-relative safe margins at preview and export resolutions', () => {
  for (const n of [1, 4]) {
    const frame = {width:1000*n,height:800*n};
    const text = safeAnchoredBox(frame,8,6,{width:300*n,height:100*n});
    close(text.x,40*n);
    close(text.y,32*n);
    const mark = watermarkBox(frame,{watermarkX:96,watermarkY:96,watermarkScale:160},{width:200*n,height:50*n});
    close(mark.x+mark.width,960*n);
    close(mark.y+mark.height,768*n);
    const centred = safeAnchoredBox(frame,50,50,{width:300*n,height:100*n});
    close(centred.x,350*n);
    close(centred.y,350*n);
  }
  const css = safeOverlayTransform(96,96,1.6);
  assert.match(css,/clamp\(/);
  assert.match(css,/cqw/);
  assert.match(css,/cqh/);
  assert.match(css,/scale\(1\.6\)/);
});
