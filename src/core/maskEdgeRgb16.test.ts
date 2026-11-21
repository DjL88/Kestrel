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
