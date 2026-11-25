import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDefringe, applyLateralCa, detectLateralCa, MAX_CA_SCALE } from './fringe';

/** A grey test chart of sharp rings and spokes, with red and blue drawn `m` times larger than green (lateral CA). */
function chart(width: number, height: number, mRed: number, mBlue: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2, cy = height / 2;
  // Supersampled, so edges are smooth as a lens draws them rather than stepped.
  const at = (x: number, y: number) => {
    let sum = 0;
    for (let j = 0; j < 4; j += 1) for (let k = 0; k < 4; k += 1) sum += hard(x + (k - 1.5) / 2, y + (j - 1.5) / 2);
    return sum / 16;
  };
  const hard = (x: number, y: number) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    return (Math.floor(r / 23) + Math.floor((a + Math.PI) / (Math.PI / 18))) % 2 ? 230 : 25;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const px = x + 0.5, py = y + 0.5, i = (y * width + x) * 4;
    out[i] = at(cx + (px - cx) / (1 + mRed), cy + (py - cy) / (1 + mRed));
    out[i + 1] = at(px, py);
    out[i + 2] = at(cx + (px - cx) / (1 + mBlue), cy + (py - cy) / (1 + mBlue));
    out[i + 3] = 255;
  }
  return out;
}

const fringeEnergy = (p: Uint8ClampedArray) => {
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += Math.abs(p[i] - p[i + 1]) + Math.abs(p[i + 2] - p[i + 1]);
  return sum;
};

test('lateral aberration is measured and corrected: red and blue line up with green again', () => {
  const w = 900, h = 600;
  const pixels = chart(w, h, 0.5 * MAX_CA_SCALE, -0.75 * MAX_CA_SCALE);
  const found = detectLateralCa(pixels, w, h, 4);
  assert.ok(found, 'enough edges to measure');
  assert.ok(Math.abs(found!.red - 0.5) <= 0.1, `red ${found!.red}`);
  assert.ok(Math.abs(found!.blue + 0.75) <= 0.1, `blue ${found!.blue}`);
  const before = fringeEnergy(pixels);
  applyLateralCa(pixels, w, h, 4, found!, w / 2, h / 2);
  const after = fringeEnergy(pixels);
  assert.ok(after < before * 0.45, `colour edges mostly gone: ${after / before}`);
});

test('a clean photo measures as clean, and a flat one as unclear', () => {
  const clean = detectLateralCa(chart(900, 600, 0, 0), 900, 600, 4);
  assert.deepEqual(clean, { red: 0, blue: 0 });
  assert.equal(detectLateralCa(new Uint8ClampedArray(900 * 600 * 4).fill(128), 900, 600, 4), null);
});

test('purple fringe beside a strong edge goes grey; a purple area away from edges keeps its colour', () => {
  const w = 120, h = 40, p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    // dark branch | purple fringe | bright sky ... and a broad, soft purple flower on the right
    const c = x < 30 ? [20, 20, 20] : x < 33 ? [150, 60, 200] : x < 60 ? [240, 240, 240] : [150, 90, 170];
    p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = 255;
  }
  const flower = [...p.slice((20 * w + 100) * 4, (20 * w + 100) * 4 + 3)];
  applyDefringe(p, w, h, 4, { purple: 1, green: 0 }, 1200);
  const f = (20 * w + 31) * 4;
  assert.ok(Math.max(p[f], p[f + 1], p[f + 2]) - Math.min(p[f], p[f + 1], p[f + 2]) < 25, 'fringe is nearly grey');
  assert.deepEqual([...p.slice((20 * w + 100) * 4, (20 * w + 100) * 4 + 3)], flower, 'flower untouched');
});

test('16-bit samples take the same correction', () => {
  const p = new Uint16Array([20, 20, 20, 150 * 257, 60 * 257, 200 * 257, 240 * 257, 240 * 257, 240 * 257].flatMap((v) => [v]));
  const wide = new Uint16Array(3 * 30 * 3);
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 30; x += 1) wide.set(p.slice(Math.min(2, Math.floor(x / 10)) * 3, Math.min(2, Math.floor(x / 10)) * 3 + 3), (y * 30 + x) * 3);
  applyDefringe(wide, 30, 3, 3, { purple: 1, green: 0 }, 1200);
  const i = (1 * 30 + 10) * 3;
  assert.ok(Math.max(wide[i], wide[i + 1], wide[i + 2]) - Math.min(wide[i], wide[i + 1], wide[i + 2]) < 25 * 257);
});

test('a coloured edge on one side of the frame is not taken for the lens', () => {
  const w = 600, h = 400, p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    const c = x < 480 ? [20, 20, 20] : x < 484 ? [150, 60, 200] : [240, 240, 240];
    p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = 255;
  }
  const found = detectLateralCa(p, w, h, 4);
  assert.ok(found === null || (found.red === 0 && found.blue === 0), JSON.stringify(found));
});
