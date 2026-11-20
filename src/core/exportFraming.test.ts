import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExportFraming } from './exportFraming';
import { EXPORT_PROFILES } from './exportProfiles';

test('focus crop centres a reachable point and clamps near the edge', () => {
  const profile = EXPORT_PROFILES[1];
  const plan = planExportFraming(4000, 2000, profile, 'focus', { x: 0.7, y: 0.5 });
  assert.deepEqual(plan.region, { x: 2050, y: 0, width: 1500, height: 2000 });
  assert.equal(planExportFraming(4000, 2000, profile, 'focus', { x: 0.99, y: 0.5 }).region.x, 2500);
});

test('white borders preserve source framing and long edge never upscales', () => {
  const profile = EXPORT_PROFILES[1];
  const bordered = planExportFraming(4000, 2000, profile, 'border');
  assert.deepEqual(bordered.border, { width: 1080, height: 1440 });
  assert.equal(bordered.region.width, 4000);
  assert.equal(planExportFraming(4000, 2000, profile, 'long', undefined, 1200).scale, 0.3);
  assert.equal(planExportFraming(400, 200, profile, 'long', undefined, 1200).scale, 1);
});

test('zoom shrinks the crop without changing its shape, and the anchor is kept inside its working range', async () => {
  const { planExportFraming, clampAnchor, clampZoom, MAX_ZOOM } = await import('./exportFraming');
  const profile = { id: 'p', label: 'p', prefix: '', width: 1080, height: 1350, quality: 0.9, format: 'jpeg' as const };
  const flat = planExportFraming(6000, 4000, profile, 'focus', { x: 0.5, y: 0.5 }, undefined, 1).region;
  const close = planExportFraming(6000, 4000, profile, 'focus', { x: 0.5, y: 0.5 }, undefined, 2).region;
  assert.equal(close.width, Math.round(flat.width / 2));
  assert.equal(close.height, Math.round(flat.height / 2));
  assert.ok(Math.abs(close.width / close.height - 0.8) < 0.01, 'still 4:5');
  // Zoomed in, the crop can move up and down as well as across.
  assert.ok(close.height < 4000);
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  // A crop 3200 wide in a 6000 wide photo: the centre can sit between 0.267 and 0.733 of the way across.
  assert.equal(Math.round(clampAnchor(0, 6000, 3200) * 1000), 267);
  assert.equal(Math.round(clampAnchor(1, 6000, 3200) * 1000), 733);
  assert.equal(clampAnchor(0.9, 4000, 4000), 0.5, 'a crop as big as the photo has nothing to move');
});


test('opt-in enlargement goes through the same crop/fit planner as export proof', () => {
  const upscaled = { id: 'custom', label: 'Custom', prefix: '', width: 3200, height: 2400,
    quality: 1, format: 'png' as const, allowUpscale: true };
  const standard = { ...upscaled, allowUpscale: false };
  const focus = planExportFraming(800, 600, upscaled, 'focus');
  assert.equal(focus.scale, 4);
  assert.deepEqual(focus.region, { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(planExportFraming(800, 600, standard, 'focus').scale, 1);
  assert.equal(planExportFraming(800, 600, upscaled, 'fit').scale, 4);
  assert.equal(planExportFraming(800, 600, upscaled, 'long', undefined, 3200).scale, 1,
    'ordinary long-edge resizing remains a non-upscaling path');
});
