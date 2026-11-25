import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLateralCa, CA_MAX_SCALE, estimateLateralCa, hasLateralCa, opticalCentre, validLateralCa } from './chromaticAberration';
import { DEFAULT_FRAMING } from './photoFraming';

/** A smooth pattern with edges everywhere, so bilinear sampling is accurate at sub-pixel shifts. */
const pattern = (x: number, y: number) => 0.5 + 0.45 * Math.sin(x / 6) * Math.sin(y / 8);

/** RGBA where red is drawn `red` times too large about the centre and blue `blue` times, as a lens would. */
function fringed(width: number, height: number, red: number, blue: number): Uint8ClampedArray {
  const cx = width / 2 - 0.5, cy = height / 2 - 0.5;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const at = (m: number) => pattern(cx + (x - cx) / m, cy + (y - cy) / m);
      out[i] = Math.round(at(red) * 255);
      out[i + 1] = Math.round(at(1) * 255);
      out[i + 2] = Math.round(at(blue) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

const channelError = (pixels: Uint8ClampedArray, channel: number) => {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += Math.abs(pixels[i + channel] - pixels[i + 1]);
  return sum / (pixels.length / 4);
};

test('auto measures the red and blue scale a lens added, and the correction lines them up with green', () => {
  const width = 1200, height = 800;
  const pixels = fringed(width, height, 1 + 0.5 * CA_MAX_SCALE, 1 - 0.4 * CA_MAX_SCALE);
  const estimate = estimateLateralCa(pixels, width, height, 4);
  assert.equal(estimate.measured, true);
  assert.ok(estimate.edges >= 400);
  assert.ok(Math.abs(estimate.ca.red - 0.5) < 0.1, `red ${estimate.ca.red}`);
  assert.ok(Math.abs(estimate.ca.blue + 0.4) < 0.1, `blue ${estimate.ca.blue}`);
  const before = [channelError(pixels, 0), channelError(pixels, 2)];
  applyLateralCa(pixels, width, height, 4, estimate.ca);
  const after = [channelError(pixels, 0), channelError(pixels, 2)];
  assert.ok(after[0] < before[0] * 0.4 && after[1] < before[1] * 0.4, `before ${before} after ${after}`);
});

test('a photo without fringing measures as none, and one with too few edges says it could not measure', () => {
  const clean = fringed(1200, 800, 1, 1);
  assert.deepEqual(estimateLateralCa(clean, 1200, 800, 4).ca, { red: 0, blue: 0 });
  const flat = new Uint8ClampedArray(600 * 400 * 4).fill(128);
  const blank = estimateLateralCa(flat, 600, 400, 4);
  assert.equal(blank.measured, false);
  assert.deepEqual(blank.ca, { red: 0, blue: 0 });
});

test('the correction is a share of the distance from the centre, so a half-size preview and the full size agree', () => {
  const ca = { red: 0.8, blue: -0.6 };
  const full = fringed(800, 600, 1, 1);
  const half = fringed(400, 300, 1, 1);
  // Build the half-size picture from the full one so both show the same scene.
  for (let y = 0; y < 300; y += 1) for (let x = 0; x < 400; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      const at = (dx: number, dy: number) => full[((2 * y + dy) * 800 + 2 * x + dx) * 4 + c];
      half[(y * 400 + x) * 4 + c] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4);
    }
  }
  applyLateralCa(full, 800, 600, 4, ca);
  applyLateralCa(half, 400, 300, 4, ca);
  let diff = 0;
  for (let y = 0; y < 300; y += 1) for (let x = 0; x < 400; x += 1) {
    const at = (dx: number, dy: number) => full[((2 * y + dy) * 800 + 2 * x + dx) * 4];
    diff += Math.abs((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4 - half[(y * 400 + x) * 4]);
  }
  assert.ok(diff / (400 * 300) < 1.5, `mean difference ${diff / (400 * 300)}`);
});

test('16-bit pixels are corrected without losing precision; green and alpha never change', () => {
  const width = 64, height = 48;
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) { data[i * 3] = (i * 37) % 65536; data[i * 3 + 1] = 30000 + (i % 7); data[i * 3 + 2] = (i * 91) % 65536; }
  const green = data.filter((_, i) => i % 3 === 1);
  applyLateralCa(data, width, height, 3, { red: 1, blue: 0 });
  assert.deepEqual(data.filter((_, i) => i % 3 === 1), green);
  const rgba = new Uint8ClampedArray(width * height * 4).fill(77);
  applyLateralCa(rgba, width, height, 4, { red: 1, blue: 1 });
  for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 77);
});

test('neutral or malformed values do nothing; the lens centre follows the crop', () => {
  assert.equal(hasLateralCa({ red: 0, blue: 0 }), false);
  assert.equal(validLateralCa({ red: 2, blue: 0 }), false);
  assert.equal(validLateralCa({ red: Number.NaN, blue: 0 }), false);
  assert.equal(validLateralCa({ red: 0.2, blue: 0, extra: 1 }), false);
  const pixels = new Uint8ClampedArray(16 * 16 * 4).map((_, i) => i % 251);
  const copy = pixels.slice();
  applyLateralCa(pixels, 16, 16, 4, { red: 5, blue: 0 } as never);
  assert.deepEqual(pixels, copy);
  assert.deepEqual(opticalCentre(6000, 4000, DEFAULT_FRAMING), { x: 0.5, y: 0.5 });
  // A half-width crop at the left edge: the lens centre is at the crop's right edge.
  const left = opticalCentre(6000, 4000, { ...DEFAULT_FRAMING, ratio: 0.75, x: 0 });
  assert.ok(Math.abs(left.x - 1) < 1e-9 && Math.abs(left.y - 0.5) < 1e-9, JSON.stringify(left));
  // A quarter turn swaps the sides first.
  const turned = opticalCentre(6000, 4000, { ...DEFAULT_FRAMING, turns: 1 });
  assert.deepEqual(turned, { x: 0.5, y: 0.5 });
});
