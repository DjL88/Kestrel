import assert from 'node:assert/strict';
import test from 'node:test';
import { fitScale, maxCanvasPixels } from './exportLimits';

test('full-resolution Nikon-sized frame remains unscaled on desktop when within canvas cap', () => {
  const width = 8256, height = 5504;
  const cap = maxCanvasPixels({ userAgent: 'Kite44 desktop', platform: 'Win32' });
  assert.equal(cap, 120_000_000);
  assert.equal(fitScale(width, height, cap), 1);
});

test('mobile preview scale is bounded; this helper must not silently resize an export', () => {
  const width = 8256, height = 5504;
  const cap = maxCanvasPixels({ userAgent: 'iPhone', platform: 'iPhone' });
  const scale = fitScale(width, height, cap);
  assert.ok(scale > 0 && scale < 1);
  assert.ok(width * height * scale * scale < cap);
});

test('invalid decoded dimensions fail closed, including multiplication overflow', () => {
  for (const [w, h, cap] of [
    [0, 500, 120_000_000],
    [-1, 500, 120_000_000],
    [NaN, 500, 120_000_000],
    [0.5, 2, 120_000_000],
    [8256.5, 5504, 120_000_000],
    [8256, 5504, 120_000_000.5],
    [8256, 5504, Infinity],
    [Infinity, 500, 120_000_000],
    [500, Infinity, 120_000_000],
    [Number.MAX_SAFE_INTEGER, 2, 120_000_000],
    [8256, 5504, 0],
    [8256, 5504, NaN],
  ]) {
    assert.throws(() => fitScale(w, h, cap), RangeError, `dimensions ${w}x${h}, limit ${cap}`);
  }
});

test('Apple Silicon iPad desktop user-agent still uses iOS pixel cap', () => {
  assert.equal(maxCanvasPixels({ userAgent: 'Mozilla/5.0 Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), 16_777_216);
  assert.equal(maxCanvasPixels({ userAgent: 'Mozilla/5.0 Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }), 120_000_000);
});
