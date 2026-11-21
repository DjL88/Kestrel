import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendMaskPixelSrgb8 } from './maskBlendSrgb8';
import { blendSrgb16 } from './linearRgb16';
import { protectedMaskAlphaSrgb16 } from './maskEdgeRgb16';

test('preview mask mixes linear light at soft edges just as the 16-bit output does', () => {
  const sources = [[0, 0, 0], [40, 90, 150], [100, 110, 120], [250, 220, 60]];
  const targets = [[255, 255, 255], [220, 170, 50], [160, 200, 240], [120, 100, 20]];
  for (let k = 0; k < sources.length; k++) for (const alpha of [0, 0.05, 0.2, 0.5, 0.75, 0.95, 1]) {
    const before = new Uint8ClampedArray([...sources[k], 211]);
    const adjusted = new Uint8ClampedArray([...targets[k], 9]);
    const start16 = Uint16Array.from(sources[k], (channel) => channel * 257);
    const adjusted16 = Uint16Array.from(targets[k], (channel) => channel * 257);
    const protectedAlpha = protectedMaskAlphaSrgb16(alpha, start16, 0, adjusted16, 0);
    blendMaskPixelSrgb8(before, adjusted, 0, alpha);
    for (let c = 0; c < 3; c++) {
      const expected = blendSrgb16(start16[c], adjusted16[c], protectedAlpha) / 257;
      assert.ok(Math.abs(before[c] - expected) <= 1, String(k) + '/' + String(alpha) + '/' + String(c) + ': ' + String(before[c]) + ' vs ' + String(expected));
    }
    assert.equal(before[3], 211, 'compositing never changes image alpha');
  }
});

test('a gentle black-to-white feather does not use encoded-space mixing', () => {
  const result = new Uint8ClampedArray([0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 255]);
  blendMaskPixelSrgb8(result, white, 0, 0.5);
  assert.ok(result[0] > 140, 'linear-light transition is brighter than 8-bit encoded midpoint');
  assert.ok(result[0] < 188, 'edge protection conservatively reduces an extreme adjustment');
});

test('invalid coverage cannot alter the preview and full coverage is exact', () => {
  const source = new Uint8ClampedArray([10, 40, 90, 150]);
  const target = new Uint8ClampedArray([200, 210, 220, 90]);
  blendMaskPixelSrgb8(source, target, 0, Number.NaN);
  assert.deepEqual(Array.from(source), [10, 40, 90, 150]);
  blendMaskPixelSrgb8(source, target, 0, 1);
  assert.deepEqual(Array.from(source), [200, 210, 220, 150]);
});
