import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoEdit } from '../../src/core/photoEdits';
import { fitGlobalEdit, nelderMead } from './fitMath';

function synthetic(): Uint8ClampedArray {
  const w = 64, h = 48, p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4, t = x / w;
    p[i] = 20 + 200 * t; p[i + 1] = 30 + 120 * (y / h); p[i + 2] = 60 + 100 * (1 - t); p[i + 3] = 255;
  }
  return p;
}

test('nelderMead finds a bounded quadratic minimum', () => {
  const r = nelderMead((x) => (x[0] - 1) ** 2 + (x[1] + 2) ** 2, [0, 0], [-5, -5], [5, 5]);
  assert.ok(Math.abs(r.x[0] - 1) < 0.05 && Math.abs(r.x[1] + 2) < 0.05);
});

test('fit recovers a known exposure and contrast edit on synthetic data', () => {
  const src = synthetic(), dst = new Uint8ClampedArray(src);
  applyPhotoEdit(dst, { exposure: 1.2, warmth: 0.5, colour: 0.3, contrast: 0.6 });
  const r = fitGlobalEdit(src, dst, 1);
  assert.ok(r.after < r.before * 0.2, `after ${r.after} before ${r.before}`);
  assert.ok(r.after < 0.02);
  assert.ok(Math.abs(r.edit.exposure - 1.2) < 0.6);
});

test('an unedited picture fits to a near-neutral recipe', () => {
  const src = synthetic();
  const r = fitGlobalEdit(src, new Uint8ClampedArray(src), 1);
  assert.ok(r.after < 0.01);
});
