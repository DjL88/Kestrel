import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_WATERMARK, watermarkFont, watermarkToneForPixels } from './watermark.ts';
import { parseWatermark } from './watermarkStore.ts';

const patch = (r: number, g: number, b: number, w = 8, h = 8) => {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
  }
  return pixels;
};

test('auto watermark selects light on dark surfaces', () => {
  assert.equal(watermarkToneForPixels(patch(5, 5, 5), 8, 8), 'light');
});

test('auto watermark selects dark on bright surfaces', () => {
  assert.equal(watermarkToneForPixels(patch(250, 250, 250), 8, 8), 'dark');
});

test('auto watermark samples each photo independently', () => {
  assert.notEqual(watermarkToneForPixels(patch(12, 12, 12), 8, 8), watermarkToneForPixels(patch(244, 244, 244), 8, 8));
});

test('transparent or invalid patch fails to a stable tone', () => {
  assert.equal(watermarkToneForPixels(new Uint8ClampedArray(4), 1, 1), 'light');
  assert.equal(watermarkToneForPixels(new Uint8ClampedArray(0), 8, 8), 'light');
});

test('new watermarks default to automatic contrast, old explicit choices remain', () => {
  assert.equal(NO_WATERMARK.tone, 'auto');
  assert.equal(parseWatermark(null).tone, 'auto');
  assert.equal(parseWatermark(JSON.stringify({ tone: 'dark' })).tone, 'dark');
  assert.equal(parseWatermark(JSON.stringify({ tone: 'light' })).tone, 'light');
});

test('font choices are limited to packaged fonts', () => {
  assert.match(watermarkFont('jakarta'), /Jakarta/);
  assert.match(watermarkFont('atkinson'), /Atkinson/);
  assert.equal(watermarkFont('invalid' as never), watermarkFont('inter'));
  assert.equal(parseWatermark(JSON.stringify({ font: 'untrusted;url(example)' })).font, 'inter');
});
