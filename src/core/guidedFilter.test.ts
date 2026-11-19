import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidedFilter, resampleMap } from './guidedFilter';

const W = 64, H = 32;

/** A sharp vertical edge in the photo at x = 40, and a coarse mask whose edge is blurred and in the wrong place. */
function scene() {
  const guide = new Float32Array(W * H);
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      guide[y * W + x] = x < 40 ? 0.3 : 0.9;
      mask[y * W + x] = Math.min(1, Math.max(0, (44 - x) / 10)); // soft ramp from x = 34 to 44
    }
  }
  return { guide, mask };
}

test('the refined mask edge moves onto the photo\'s edge and gets sharper', () => {
  const { guide, mask } = scene();
  const refined = guidedFilter(guide, mask, W, H, 4, 1e-3)!;
  const row = 16;
  const at = (values: Float32Array, x: number) => values[row * W + x];
  // Coarse: half-way at x = 39; still 0.4 on the background side at x = 40.
  assert.ok(at(mask, 40) > 0.35);
  // Refined: each side moves towards its true value, and the sharpest step sits exactly on the photo's edge.
  assert.ok(at(refined, 38) > at(mask, 38) + 0.08, `inside ${at(refined, 38)} vs ${at(mask, 38)}`);
  assert.ok(at(refined, 41) < at(mask, 41) - 0.08, `outside ${at(refined, 41)} vs ${at(mask, 41)}`);
  let sharpest = 0, where = -1;
  for (let x = 1; x < W; x += 1) {
    const step = at(refined, x - 1) - at(refined, x);
    if (step > sharpest) { sharpest = step; where = x; }
  }
  assert.equal(where, 40, 'the edge lands where the photo changes');
  assert.ok(sharpest > 0.25, `edge step ${sharpest}; the coarse ramp's steps are 0.1`);
  // Far from the edge, nothing changes much.
  assert.ok(Math.abs(at(refined, 5) - at(mask, 5)) < 0.05);
  assert.ok(Math.abs(at(refined, 60) - at(mask, 60)) < 0.05);
});

test('on a flat photo the mask is only smoothed, never sharpened into an invented edge', () => {
  const { mask } = scene();
  const flat = new Float32Array(W * H).fill(0.5);
  const refined = guidedFilter(flat, mask, W, H, 4, 1e-3)!;
  for (let x = 1; x < W; x += 1) {
    const step = Math.abs(refined[16 * W + x] - refined[16 * W + x - 1]);
    assert.ok(step <= 0.11, `step ${step} at ${x}`);
  }
});

test('values stay within 0 to 1 and bad input is refused', () => {
  const { guide, mask } = scene();
  const refined = guidedFilter(guide, mask, W, H, 3, 1e-4)!;
  assert.ok(refined.every((v) => v >= 0 && v <= 1));
  assert.equal(guidedFilter(guide.subarray(1), mask, W, H, 3, 1e-3), null);
  assert.equal(guidedFilter(guide, mask, W, H, 0, 1e-3), null);
  assert.equal(guidedFilter(guide, mask, W, H, 3, 0), null);
  const broken = Float32Array.from(mask); broken[3] = Number.NaN;
  assert.equal(guidedFilter(guide, broken, W, H, 3, 1e-3), null);
});

test('resampling a model map keeps its values and corners', () => {
  const map = Float32Array.from([0, 1, 1, 0]);
  const out = resampleMap(map, 2, 4, 4);
  assert.ok(out[0] < 0.01 && out[3] > 0.99 && out[12] > 0.99 && out[15] < 0.01);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
});
