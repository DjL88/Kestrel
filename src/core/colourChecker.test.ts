import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKER_SRGB, fitCheckerCalibration, patchCentres, samplePatches, type CheckerCorners } from './colourChecker.ts';
import { calibrationMatrix } from './calibration.ts';

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

/** Draw a synthetic chart, 6 × 4 patches of 40 px, with a colour error applied in linear light. */
function chart(distort: (rgb: number[]) => number[]) {
  const width = 240, height = 160, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const patch = Math.floor(y / 40) * 6 + Math.floor(x / 40);
    const rgb = distort(CHECKER_SRGB[patch].map((v) => toLinear(v / 255))).map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255));
    data.set([...rgb, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}
const corners: CheckerCorners = [{ x: 20, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 140 }, { x: 20, y: 140 }];

test('patch centres follow the four corner marks', () => {
  const centres = patchCentres(corners);
  const near = (p: { x: number; y: number }, x: number, y: number) => assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, JSON.stringify(p));
  near(centres[0], 20, 20);
  near(centres[7], 60, 60);
  near(centres[23], 220, 140);
});

test('a faithful chart needs no calibration', () => {
  const fit = fitCheckerCalibration(samplePatches(chart((rgb) => rgb), corners));
  assert.ok(fit.before < 1.5, `before ${fit.before}`);
  assert.ok(fit.after <= fit.before);
});

test('a camera with a colour cast and muted colours is pulled back towards the chart', () => {
  // A warm cast plus a known calibration error: blue turned and colours desaturated.
  const error = calibrationMatrix({ red: [0.2, -0.3], green: [-0.15, -0.3], blue: [0.3, -0.2] });
  const fit = fitCheckerCalibration(samplePatches(chart((rgb) => {
    const m = [0, 1, 2].map((r) => error[r * 3] * rgb[0] + error[r * 3 + 1] * rgb[1] + error[r * 3 + 2] * rgb[2]);
    return [m[0] * 1.2, m[1], m[2] * 0.8];
  }), corners));
  assert.ok(fit.before > 4, `the error is visible first (${fit.before.toFixed(1)})`);
  assert.ok(fit.after < 2, `and brought within a just-visible difference (${fit.before.toFixed(1)} → ${fit.after.toFixed(1)})`);
  assert.ok(fit.calibration.red[0] < 0 && fit.calibration.blue[0] < 0, 'the turned primaries are turned back');
  assert.ok(fit.calibration.red[1] > 0, 'and the muted red is given more saturation');
});

test('marks on the wrong patches are refused in words', () => {
  const flipped: CheckerCorners = [corners[2], corners[3], corners[0], corners[1]];
  assert.throws(() => fitCheckerCalibration(samplePatches(chart((rgb) => rgb), flipped)), /step from white to black/);
});
