import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_WATERMARK } from './watermark.ts';
import { parseWatermark } from './watermarkStore.ts';

test('nothing saved, or damaged data, gives the defaults', () => {
  assert.deepEqual(parseWatermark(null), NO_WATERMARK);
  assert.deepEqual(parseWatermark('{nope'), NO_WATERMARK);
});

test('saved settings come back, with odd values corrected', () => {
  const back = parseWatermark(JSON.stringify({ on: true, kind: 'text', text: '© D', position: 'centre', size: 9, opacity: -1, tone: 'dark' }));
  assert.equal(back.on, true);
  assert.equal(back.position, 'centre');
  assert.equal(back.size, 0.5);
  assert.equal(back.opacity, 0.15);
  assert.equal(back.tone, 'dark');
});

test('a picture mark needs real image data, and a script address is refused', () => {
  assert.equal(parseWatermark(JSON.stringify({ kind: 'image', imageData: 'javascript:alert(1)' })).kind, 'text');
  assert.equal(parseWatermark(JSON.stringify({ kind: 'image', imageData: 'data:image/png;base64,AA' })).kind, 'image');
});
