import test from 'node:test';
import assert from 'node:assert/strict';
import { enhancePhoto } from './enhanceLoop';
import { classifyExposureIntent } from './enhanceIntent';
import { observeFrame } from './enhanceObserve';

/**
 * Frozen regression set for the enhance loop: 20 deterministic synthetic scenes with expected BOUNDS (not exact values), so
 * Auto cannot quietly get worse. Real-photo scoring lives in scripts/enhance-eval (photos are never in Git).
 */
const W = 200, H = 130;
const enc = (l: number) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));
function scene(seed: number, gain: number, spot = false): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const sky = y < H * 0.45;
    const card = x > W * 0.4 && x < W * 0.6 && y > H * 0.55 && y < H * 0.85;
    const base = sky ? 0.5 - 0.25 * (y / H) + 0.012 * rnd() : 0.14 + 0.02 * Math.sin(x / (7 + seed % 5)) * Math.sin(y / 6) + 0.006 * rnd();
    let g = gain;
    if (spot) { const d = Math.hypot((x / W - 0.5) / 0.28, (y / H - 0.5) / 0.3); g *= 0.05 + 0.95 * Math.min(1, Math.max(0, 1.4 - d)); }
    const l = (card ? 0.2 : base) * g;
    const o = (y * W + x) * 4;
    px[o] = enc(l); px[o + 1] = enc(l * 0.97); px[o + 2] = enc(l * 0.93); px[o + 3] = 255;
  }
  return px;
}
const clipOf = (px: Uint8ClampedArray) => observeFrame(px, W, H).clipHigh;

for (const [i, gain] of [2.6, 3, 3.2, 3.4].entries()) {
  test(`frozen control ${i + 1}: a well-exposed photo is left almost alone`, async () => {
    const px = scene(10 + i, gain);
    const r = await enhancePhoto({ pixels: px, width: W, height: H, maxRounds: 3, meta: { iso: 100, shutterSeconds: 1 / 250, evCompensation: 0 } });
    for (const o of r.options) assert.ok((o.edit.exposure ?? 0) <= 0.6, 'no big lift on a fine photo');
    if (r.favourite !== null) assert.ok(clipOf(r.options[r.favourite].pixels) <= clipOf(px) + 0.005);
  });
}

for (const [i, gain] of [0.3, 0.38, 0.45, 0.5].entries()) {
  test(`frozen underexposed ${i + 1}: metadata says a lift is expected, so the dark photo is brightened without new clipping`, async () => {
    const px = scene(20 + i, gain);
    const meta = { evCompensation: -1, shutterSeconds: 1 / 2000, iso: 3200, aperture: 4 };
    const intent = classifyExposureIntent(observeFrame(px, W, H), meta);
    assert.ok(['underexposed', 'ambiguous', 'not-dark'].includes(intent.reading));
    assert.notEqual(intent.reading, 'low-key', 'never reads a fast, protected, high-ISO frame as low key');
    const r = await enhancePhoto({ pixels: px, width: W, height: H, maxRounds: 4, meta });
    if (r.favourite !== null) {
      const o = r.options[r.favourite];
      assert.ok((o.edit.exposure ?? 0) >= 0);
      assert.ok(clipOf(o.pixels) <= clipOf(px) + 0.005);
    }
  });
}

for (const [i, gain] of [0.6, 0.8, 1, 1.2].entries()) {
  test(`frozen low key ${i + 1}: a lit pool in a dark scene keeps its dark mood`, async () => {
    const px = scene(30 + i, gain, true);
    const meta = { evCompensation: 0, shutterSeconds: 1 / 15, iso: 200, aperture: 2.8 };
    const stats = observeFrame(px, W, H);
    const intent = classifyExposureIntent(stats, meta);
    assert.ok(['low-key', 'ambiguous'].includes(intent.reading), `read ${intent.reading}`);
    const r = await enhancePhoto({ pixels: px, width: W, height: H, maxRounds: 3, meta });
    for (const o of r.options) {
      if (intent.reading === 'low-key') assert.ok((o.edit.exposure ?? 0) <= 0.5, 'blacks stay black: no global lift');
      assert.ok(observeFrame(o.pixels, W, H).p01 <= stats.p01 + 0.04, 'true blacks are kept');
    }
  });
}

for (const [i, gain] of [6, 7, 8, 9].entries()) {
  test(`frozen blown ${i + 1}: over-exposure is pulled back, never pushed further`, async () => {
    const px = scene(40 + i, gain);
    const r = await enhancePhoto({ pixels: px, width: W, height: H, maxRounds: 3 });
    for (const o of r.options) assert.ok((o.edit.exposure ?? 0) <= 0.2 && clipOf(o.pixels) <= clipOf(px) + 0.002);
  });
}

for (const [i, gain] of [0.25, 0.3, 0.35, 0.4].entries()) {
  test(`frozen ambiguous ${i + 1}: without metadata the options span both readings and are labelled plainly`, async () => {
    const px = scene(50 + i, gain, true);
    const stats = observeFrame(px, W, H);
    const intent = classifyExposureIntent(stats, null);
    assert.notEqual(intent.reading, 'not-dark');
    const r = await enhancePhoto({ pixels: px, width: W, height: H, maxRounds: 3 });
    if (intent.reading === 'ambiguous') {
      assert.deepEqual(r.options.map((o) => o.style), ['mood', 'light', 'full']);
      const e = r.options.map((o) => o.edit.exposure ?? 0);
      assert.ok(e[0] <= e[1] + 0.01 && e[1] <= e[2] + 0.01, `mood ≤ gentle ≤ full, got ${e.join(', ')}`);
    }
    assert.equal(classifyExposureIntent(stats, null, [], 'low-key').reading, 'low-key', 'the person\'s intent always wins');
  });
}
