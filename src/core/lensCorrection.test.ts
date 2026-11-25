import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLensCorrection, fillScale, MAX_DISTORTION_K, validLens } from './lensCorrection';

const grey = (w: number, h: number, v: number) => { const p = new Uint8ClampedArray(w * h * 4).fill(v); return p; };

test('lens vignetting correction brightens the corners and leaves the centre alone', () => {
  const w = 300, h = 200, p = grey(w, h, 100);
  applyLensCorrection(p, w, h, 4, { vignetting: 1 });
  const at = (x: number, y: number) => p[(y * w + x) * 4];
  assert.equal(at(150, 100), 100);
  assert.ok(at(0, 0) > 150, `corner ${at(0, 0)}`);
  assert.ok(at(0, 100) > 100 && at(0, 100) < at(0, 0), 'edge middle brightened less than the corner');
});

test('it is centred on the original photo, not the crop', () => {
  // The crop is the right half of the original: the lens centre sits on its left edge.
  const w = 150, h = 200, p = grey(w, h, 100);
  applyLensCorrection(p, w, h, 4, { vignetting: 1 }, { aspect: h / w, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: { x: 0, y: 0.5, r: Math.hypot(300, 200) / 2 / 150 } });
  assert.equal(p[(100 * w + 0) * 4], 100);
  assert.ok(p[(0 * w + 149) * 4] > 150);
});

test('fixing barrel pulls a bowed line straight, and no empty edge shows', () => {
  const w = 400, h = 300, cx = 200, cy = 150, radius = Math.hypot(w, h) / 2;
  // Draw a horizontal line near the top as a barrel lens would: bowed outwards (towards the top) in the middle.
  const k = -MAX_DISTORTION_K; // the lens's barrel
  const p = grey(w, h, 240);
  for (let x = 0; x < w; x += 1) {
    // True line at y = 20. A barrel lens draws a point at r_u at r_d = r_u (1 + k r_u^2).
    const dx = x + 0.5 - cx, dy = 20 - cy;
    const f = 1 + k * (dx * dx + dy * dy) / (radius * radius);
    const y = Math.round(cy + dy * f), xx = Math.round(cx + dx * f);
    for (let t = -1; t <= 1; t += 1) if (xx >= 0 && xx < w && y + t >= 0 && y + t < h) p.fill(0, ((y + t) * w + xx) * 4, ((y + t) * w + xx) * 4 + 3);
  }
  const lineY = (data: Uint8ClampedArray, x: number) => { let best = 0, low = 999; for (let y = 0; y < h / 2; y += 1) { const v = data[(y * w + x) * 4]; if (v < low) { low = v; best = y; } } return best; };
  const bowBefore = lineY(p, 60) - lineY(p, 200);
  applyLensCorrection(p, w, h, 4, { distortion: 1 });
  const bowAfter = lineY(p, 60) - lineY(p, 200);
  assert.ok(bowBefore >= 4, `bowed to start with (${bowBefore})`);
  assert.ok(Math.abs(bowAfter) <= 1, `straight after (${bowAfter})`);
  assert.ok(p[0] > 200 && p[(h * w - 1) * 4] > 200, 'corners still picture, not empty');
});

test('fixing pincushion enlarges just enough to hide empty edges; out-of-range values are refused', () => {
  const z = fillScale(400, 300, 0.5 * MAX_DISTORTION_K, 200, 150, 250);
  assert.ok(z > 1 && z < 1.1, `zoom ${z}`);
  assert.equal(fillScale(400, 300, -0.5 * MAX_DISTORTION_K, 200, 150, 250), 1);
  assert.equal(validLens({ distortion: 2 }), false);
  assert.equal(validLens({ vignetting: -0.1 }), false);
  assert.equal(validLens({ distortion: -0.3, vignetting: 0.4 }), true);
});

test('a lens profile corrects its own distortion and vignetting, and only a valid profile is accepted', () => {
  const w = 400, h = 300, cx = 200, cy = 150, radius = Math.hypot(w, h) / 2;
  // A ptlens barrel: the lens drew r_u at r_u (a r^3 + b r^2 + c r + d), r in the profile's units (here scale 1.2).
  const profile = { name: 'Test 24mm', distortion: { model: 'ptlens' as const, k: [0, -0.06, 0], scale: 1.2 }, vignetting: { k: [-0.5, 0, 0] as [number, number, number], scale: 1 } };
  const p = grey(w, h, 240);
  const g = (r: number) => -0.06 * r * r + 1.06;
  for (let x = 0; x < w; x += 1) {
    const dx = x + 0.5 - cx, dy = 20 - cy;
    const rho = Math.hypot(dx, dy) / radius;
    const f = g(rho * 1.2);
    const y = Math.round(cy + dy * f), xx = Math.round(cx + dx * f);
    for (let t = -1; t <= 1; t += 1) if (xx >= 0 && xx < w && y + t >= 0 && y + t < h) p.fill(0, ((y + t) * w + xx) * 4, ((y + t) * w + xx) * 4 + 3);
  }
  const lineY = (data: Uint8ClampedArray, x: number) => { let best = 0, low = 999; for (let y = 0; y < h / 2; y += 1) { const v = data[(y * w + x) * 4]; if (v < low) { low = v; best = y; } } return best; };
  const bowBefore = lineY(p, 60) - lineY(p, 200);
  applyLensCorrection(p, w, h, 4, { profile: { name: profile.name, distortion: profile.distortion } });
  const bowAfter = lineY(p, 60) - lineY(p, 200);
  assert.ok(bowBefore >= 4, `bowed to start with (${bowBefore})`);
  assert.ok(Math.abs(bowAfter) <= 1, `straight after (${bowAfter})`);

  const v = grey(w, h, 100);
  applyLensCorrection(v, w, h, 4, { profile: { name: profile.name, vignetting: profile.vignetting } });
  assert.equal(v[(150 * w + 200) * 4], 100);
  assert.ok(v[0] > 130, `corner ${v[0]}`); // twice the light on linear values: 100 becomes about 137

  assert.equal(validLens({ profile }), true);
  assert.equal(validLens({ profile: { name: 'x' } }), false, 'a profile with nothing in it');
  assert.equal(validLens({ profile: { ...profile, distortion: { model: 'ptlens', k: [0, 1], scale: 1 } } }), false, 'wrong number of terms');
  assert.equal(validLens({ profile: { ...profile, vignetting: { k: [Number.NaN, 0, 0], scale: 1 } } }), false);
  assert.equal(validLens({ profile: { ...profile, notes: ['made-up'] } }), false);
});
