import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoEdit, DEFAULT_EDIT } from './photoEdits';

test('as-shot settings preserve source pixels exactly', () => {
  const source = new Uint8ClampedArray([20, 130, 243, 128, 255, 80, 0, 255]);
  const pixels = new Uint8ClampedArray(source);
  applyPhotoEdit(pixels, DEFAULT_EDIT);
  assert.deepEqual(pixels, source);
});

test('light adjusts neutral pixels without adding a colour cast', () => {
  const pixels = new Uint8ClampedArray([100, 100, 100, 128]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, exposure: 1 });
  assert.ok(pixels[0] > 100);
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[0], pixels[2]);
  assert.equal(pixels[3], 128);
});

test('warmth changes red and blue in opposite directions', () => {
  const pixels = new Uint8ClampedArray([100, 100, 100, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, warmth: 1 });
  assert.ok(pixels[0] > 100);
  assert.equal(pixels[1], 100);
  assert.ok(pixels[2] < 100);
});

const pixel = (value: number, edit: Partial<typeof DEFAULT_EDIT>) => {
  const pixels = new Uint8ClampedArray([value, value, value, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, ...edit });
  return pixels[0];
};

test('shadows lift dark tones far more than bright ones', () => {
  assert.ok(pixel(40, { shadows: 2 }) - 40 > 3 * (pixel(220, { shadows: 2 }) - 220));
});

test('highlights recovery darkens bright tones and leaves dark tones', () => {
  assert.ok(pixel(230, { highlights: -2 }) < 230);
  assert.ok(Math.abs(pixel(30, { highlights: -2 }) - 30) <= 1);
});

test('contrast spreads tones around mid grey and keeps neutrals neutral', () => {
  assert.ok(pixel(60, { contrast: 1 }) < 60);
  assert.ok(pixel(200, { contrast: 1 }) > 200);
  const pixels = new Uint8ClampedArray([90, 90, 90, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, contrast: 1, shadows: 1, vibrance: 1 });
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[1], pixels[2]);
});

test('whites and blacks move the end points', () => {
  assert.ok(pixel(250, { whites: 2 }) >= 250);
  assert.ok(pixel(8, { blacks: 2 }) > 8);
});

test('vibrance lifts muted colours more than saturated ones', () => {
  const muted = new Uint8ClampedArray([120, 110, 100, 255]);
  const vivid = new Uint8ClampedArray([250, 40, 20, 255]);
  const spread = (p: Uint8ClampedArray) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const before = [spread(muted), spread(vivid)];
  applyPhotoEdit(muted, { ...DEFAULT_EDIT, vibrance: 2 });
  applyPhotoEdit(vivid, { ...DEFAULT_EDIT, vibrance: 2 });
  assert.ok(spread(muted) / before[0] > spread(vivid) / before[1]);
});

import { applyDetail, hasDetail } from './photoEdits';

function edgeImage(size = 64) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const v = x < size / 2 ? 90 : 160;
    pixels.set([v, v, v, 255], (y * size + x) * 4);
  }
  return pixels;
}

test('detail controls on zero leave pixels untouched and report no detail', () => {
  assert.equal(hasDetail(DEFAULT_EDIT), false);
  const pixels = edgeImage();
  const copy = new Uint8ClampedArray(pixels);
  applyDetail(pixels, 64, 64, DEFAULT_EDIT, 64);
  assert.deepEqual(pixels, copy);
});

test('sharpening leaves flat areas alone and steepens an edge', () => {
  const pixels = edgeImage();
  applyDetail(pixels, 64, 64, { ...DEFAULT_EDIT, sharpen: 2 }, 2200);
  const at = (x: number) => pixels[(32 * 64 + x) * 4];
  assert.equal(at(2), 90);
  assert.equal(at(61), 160);
  assert.ok(at(31) < 90, 'dark side of the edge gets darker');
  assert.ok(at(32) > 160, 'bright side of the edge gets brighter');
});

test('negative texture softens an edge', () => {
  const pixels = edgeImage();
  applyDetail(pixels, 64, 64, { ...DEFAULT_EDIT, texture: -2 }, 2200);
  const at = (x: number) => pixels[(32 * 64 + x) * 4];
  assert.ok(at(31) > 90 && at(32) < 160);
});

test('detail never adds a colour cast to grey', () => {
  const pixels = edgeImage();
  applyDetail(pixels, 64, 64, { ...DEFAULT_EDIT, clarity: 2, sharpen: 1 }, 2200);
  for (let i = 0; i < pixels.length; i += 4) assert.equal(pixels[i], pixels[i + 1]);
});

test('Colour -2 produces grayscale pixels while retaining alpha and allowing tonal adjustments', () => {
  const source = new Uint8ClampedArray([210, 95, 35, 123, 20, 200, 110, 255]);
  const mono = new Uint8ClampedArray(source);
  applyPhotoEdit(mono, { ...DEFAULT_EDIT, colour: -2, contrast: 0.5, vibrance: 1.5 });
  for (let index = 0; index < mono.length; index += 4) {
    assert.equal(mono[index], mono[index + 1]);
    assert.equal(mono[index], mono[index + 2]);
    assert.equal(mono[index + 3], source[index + 3]);
  }
  const colour = new Uint8ClampedArray(source);
  applyPhotoEdit(colour, { ...DEFAULT_EDIT, colour: -1.9 });
  assert.notEqual(colour[0], colour[1], 'positions above -2 retain colour');
});


test('Brightness adjusts midtones separately from Exposure and holds pure black/white endpoints', () => {
  assert.ok(pixel(128, { brightness: 1 }) > 128);
  assert.ok(pixel(128, { brightness: -1 }) < 128);
  assert.equal(pixel(0, { brightness: 2 }), 0, 'pure black stays black');
  assert.equal(pixel(255, { brightness: 2 }), 255, 'pure white stays white');
  assert.equal(pixel(255, { brightness: -2 }), 255, 'pure white is protected on darkening too');
  assert.notEqual(pixel(96, { exposure: 1 }), pixel(96, { brightness: 1 }),
    'Exposure EV and perceptual Brightness must have different response curves');
});

test('Brightness is monotonic at maximum positive and negative amounts, so gradients do not invert', () => {
  for (const brightness of [-2, 2]) {
    const original = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i += 1) original.set([i, i, i, 255], i * 4);
    const result = original.slice();
    applyPhotoEdit(result, { ...DEFAULT_EDIT, brightness });
    assert.equal(result[0], 0);
    assert.equal(result[255 * 4], 255);
    for (let i = 1; i < 256; i += 1) {
      assert.ok(result[i * 4] >= result[(i - 1) * 4], 'no inverted grey gradients at ' + i);
      assert.equal(result[i * 4], result[i * 4 + 1]);
      assert.equal(result[i * 4], result[i * 4 + 2]);
      assert.equal(result[i * 4 + 3], 255);
    }
  }
});

test('neutral Brightness does not change prior edits or their alpha', () => {
  const input = new Uint8ClampedArray([10, 100, 200, 77, 170, 90, 40, 255]);
  const baseline = input.slice(), zeroBrightness = input.slice();
  applyPhotoEdit(baseline, { ...DEFAULT_EDIT, exposure: 1.5, warmth: 0.4, contrast: 0.2 });
  applyPhotoEdit(zeroBrightness, { ...DEFAULT_EDIT, exposure: 1.5, warmth: 0.4, contrast: 0.2, brightness: 0 });
  assert.deepEqual(zeroBrightness, baseline, 'old projects with no Brightness maintain identical rendering');
});


test('raising Brightness does not clip an already-bright saturated feather colour', () => {
  const before = new Uint8ClampedArray([250, 45, 30, 255]);
  const after = before.slice();
  applyPhotoEdit(after, { ...DEFAULT_EDIT, brightness: 2 });
  assert.ok(after[0] >= before[0], 'Brightness must not darken the coloured highlight');
  assert.ok(after[0] < 255, 'retain at least a little peak-channel headroom');
  assert.equal(after[3], 255);
});

import {
  applyDetailFloat,
  applyPhotoEditLinearInPlace,
  computeWbFromNeutralSample,
  displayFloatToRgbaBytes,
  evaluateToneCurveLut,
  isIdentityToneCurve,
  rgbaBytesToLinearFloat,
  rollOffHighlights,
  validToneCurve,
  wbMultipliers,
} from './photoEdits';

test('tint axis shifts green vs magenta without distorting warmth', () => {
  const greenPixels = new Uint8ClampedArray([120, 120, 120, 255]);
  applyPhotoEdit(greenPixels, { ...DEFAULT_EDIT, tint: -1.5 });
  assert.ok(greenPixels[1] > greenPixels[0], 'negative tint increases green channel relative to R/B');
  assert.ok(greenPixels[1] > greenPixels[2]);

  const magentaPixels = new Uint8ClampedArray([120, 120, 120, 255]);
  applyPhotoEdit(magentaPixels, { ...DEFAULT_EDIT, tint: 1.5 });
  assert.ok(magentaPixels[0] > magentaPixels[1] && magentaPixels[2] > magentaPixels[1],
    'positive tint shifts green downward relative to R/B (magenta)');
  const [rm, gm, bm] = wbMultipliers(0, 1);
  const lum = 0.2126 * rm + 0.7152 * gm + 0.0722 * bm;
  assert.ok(Math.abs(lum - 1) < 0.02, 'tint multipliers keep luminance near neutral');
});

test('computeWbFromNeutralSample balances cool, warm, and tinted swatches', () => {
  const coolCast = computeWbFromNeutralSample(140, 160, 195);
  assert.ok(coolCast.warmth > 0, 'blue cast should suggest warmer temperature');
  const warmCast = computeWbFromNeutralSample(195, 160, 130);
  assert.ok(warmCast.warmth < 0, 'orange cast should suggest cooler temperature');
  const greenCast = computeWbFromNeutralSample(130, 175, 130);
  assert.ok(greenCast.tint > 0, 'green cast should suggest magenta tint correction');
  const neutral = computeWbFromNeutralSample(128, 128, 128);
  assert.deepEqual(neutral, { warmth: 0, tint: 0 });
});

test('rollOffHighlights protects saturated hue ratios while passing sub-1.0 pixels untouched', () => {
  assert.deepEqual(rollOffHighlights(0.8, 0.4, 0.1), [0.8, 0.4, 0.1]);
  const [r, g, b] = rollOffHighlights(2.5, 1.2, 0.3);
  assert.ok(r <= 1.0 && g <= 1.0 && b <= 1.0, 'rolled-off channels remain display-bounded');
  assert.ok(r > g && g > b, 'dominant warm red-orange hue order stays intact without hard channel clipping');

  // High exposure push on saturated colour retains hue ranking
  const bright = new Uint8ClampedArray([250, 120, 30, 255]);
  applyPhotoEdit(bright, { ...DEFAULT_EDIT, exposure: 2 });
  assert.ok(bright[0] >= bright[1] && bright[1] > bright[2]);
});

test('contrast sCurve remains strictly monotonic across the tonal ramp at all slider extremes', () => {
  for (const contrast of [-2, -1, 0, 1, 2]) {
    const ramp = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i += 1) ramp.set([i, i, i, 255], i * 4);
    applyPhotoEdit(ramp, { ...DEFAULT_EDIT, contrast });
    for (let i = 1; i < 256; i += 1) {
      assert.ok(ramp[i * 4] >= ramp[(i - 1) * 4], `monotonic contrast=${contrast} at ${i}`);
    }
  }
});

test('evaluateToneCurveLut uses Fritsch-Carlson monotonic Hermite interpolation without overshoot', () => {
  const steep: [number, number][] = [[0, 0], [0.25, 0.05], [0.5, 0.5], [0.75, 0.95], [1, 1]];
  assert.equal(validToneCurve(steep), true);
  assert.equal(isIdentityToneCurve(steep), false);
  const lut = evaluateToneCurveLut(steep, 256);
  assert.equal(lut[0], 0);
  assert.equal(lut[255], 1);
  for (let i = 1; i < lut.length; i += 1) {
    assert.ok(lut[i] >= lut[i - 1] - 1e-6, `curve LUT monotonic at ${i}`);
    assert.ok(lut[i] >= 0 && lut[i] <= 1, 'LUT never overshoots [0, 1]');
  }
  assert.equal(validToneCurve([[0, 0], [0.6, 0.6], [0.4, 0.4], [1, 1]]), false);
});

test('applyDetailFloat and applyDetail preserve hue ratio on saturated edges', () => {
  const size = 48;
  const bytes = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const k = x < size / 2 ? 0.5 : 1.0;
      bytes.set([Math.round(200 * k), Math.round(100 * k), Math.round(40 * k), 255], (y * size + x) * 4);
    }
  }
  const f32 = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) f32[i] = bytes[i] / 255;

  applyDetail(bytes, size, size, { ...DEFAULT_EDIT, clarity: 1.5, sharpen: 1 }, 1600);
  applyDetailFloat(f32, size, size, { ...DEFAULT_EDIT, clarity: 1.5, sharpen: 1 }, 1600);

  const edgeIdx = (24 * size + 24) * 4;
  assert.ok(bytes[edgeIdx] > bytes[edgeIdx + 1] && bytes[edgeIdx + 1] > bytes[edgeIdx + 2], 'CPU byte detail keeps hue');
  assert.ok(f32[edgeIdx] > f32[edgeIdx + 1] && f32[edgeIdx + 1] > f32[edgeIdx + 2], 'Float32 detail keeps hue');
});

test('continuous Float32 pipeline converts cleanly without alpha drift or midtone clipping', () => {
  const src = new Uint8ClampedArray([12, 85, 190, 200, 220, 150, 90, 255]);
  const f32 = rgbaBytesToLinearFloat(src);
  applyPhotoEditLinearInPlace(f32, { ...DEFAULT_EDIT, exposure: 0.5, contrast: 0.4, tint: 0.3 });
  const out = new Uint8ClampedArray(src.length);
  displayFloatToRgbaBytes(f32, out);
  assert.equal(out[3], 200);
  assert.equal(out[7], 255);
  assert.ok(out[4] > 220 && out[4] <= 255);
});

