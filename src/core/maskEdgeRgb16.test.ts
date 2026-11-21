import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedMaskAlpha, protectedMaskAlphaLinear, protectedMaskAlphaSrgb16 } from './maskEdgeRgb16';
import { blendLinearToSrgb16, decodeSrgb16 } from './linearRgb16';

const neutral = (v: number): [number, number, number] => [v, v, v];

test('zero/one alpha and small ordinary colour edits remain unchanged', () => {
  assert.equal(protectedMaskAlpha(0, neutral(0.1), neutral(0.9)), 0);
  assert.equal(protectedMaskAlpha(1, neutral(0.1), neutral(0.9)), 1);
  assert.equal(protectedMaskAlpha(0.5, neutral(0.4), neutral(0.45)), 0.5);
  assert.equal(protectedMaskAlpha(Number.NaN, neutral(0.4), neutral(0.9)), 0);
});
test('bird feather edge: extreme bright subject treatment is gentler in transition', () => {
  const a = protectedMaskAlpha(0.5, neutral(0.12), neutral(0.9));
  assert.ok(a >= 0.325 && a < 0.5);
  assert.equal(protectedMaskAlpha(1, neutral(0.12), neutral(0.9)), 1);
  const raw = 22000;
  const unguarded = blendLinearToSrgb16(raw, 0.9, 0.5);
  const guarded = blendLinearToSrgb16(raw, 0.9, a);
  assert.ok(guarded < unguarded);
  assert.ok(guarded > raw);
});
test('portrait skin proxy: gentle exposure change is not reduced', () => {
  assert.equal(protectedMaskAlpha(0.5, [0.35, 0.25, 0.2], [0.4, 0.3, 0.24]), 0.5);
});
test('sky and foliage proxies: strong local darkening protects edge without changing centre', () => {
  for (const rgb of [[0.2, 0.45, 0.7], [0.12, 0.4, 0.1]] as const) {
    const a = protectedMaskAlpha(0.5, rgb, [0.01, 0.02, 0.02]);
    assert.ok(a < 0.5 && a >= 0.325);
    assert.equal(protectedMaskAlpha(1, rgb, [0.01, 0.02, 0.02]), 1);
  }
});
test('RGB16 and float-tone adapters agree on the same linear-light pixels', () => {
  const src = new Uint16Array([12000, 30000, 50000]);
  const dst = new Uint16Array([40000, 55000, 60000]);
  const linear = new Float32Array(Array.from(dst, decodeSrgb16));
  const a = protectedMaskAlphaSrgb16(0.5, src, 0, dst, 0);
  const b = protectedMaskAlphaLinear(0.5, src, 0, linear, 0);
  assert.ok(Math.abs(a - b) < 1e-7);
});

test('chroma-only bird feather fringe is reduced without reducing the solid centre', () => {
  // Equal linear luminance but radically different hue: previous tone-only
  // protection could not see this bright-green contamination.
  const feather: [number, number, number] = [0.25, 0.25, 0.25];
  const green: [number, number, number] = [0.05, 0.30956, 0.05];
  const a = protectedMaskAlpha(0.5, feather, green);
  assert.ok(a < 0.5 && a >= 0.325, `guarded alpha: ${a}`);
  assert.equal(protectedMaskAlpha(1, feather, green), 1);
  assert.equal(protectedMaskAlpha(0, feather, green), 0);
});
test('ordinary exposure and gentle colour balance keep the natural transition', () => {
  const src: [number, number, number] = [0.24, 0.32, 0.43];
  const gentle: [number, number, number] = [0.26, 0.34, 0.44];
  assert.equal(protectedMaskAlpha(0.5, src, gentle), 0.5);
  assert.equal(protectedMaskAlpha(0.25, src, gentle), 0.25);
});
test('newly clipped bright sky edge receives bounded attenuation', () => {
  const src: [number, number, number] = [0.92, 0.94, 0.95];
  const clipped: [number, number, number] = [1, 0.94, 0.95];
  const a = protectedMaskAlpha(0.5, src, clipped);
  assert.ok(a < 0.5 && a >= 0.325);
  assert.equal(protectedMaskAlpha(1, src, clipped), 1);
});
test('near-black colour noise does not trigger an unstable hue guard', () => {
  const src: [number, number, number] = [0.002, 0.003, 0.001];
  const dst: [number, number, number] = [0.003, 0.002, 0.001];
  assert.equal(protectedMaskAlpha(0.5, src, dst), 0.5);
});
