import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAutoQuality } from './autoQualityGate';

const paint = (count: number, rgb: [number, number, number]) => {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) pixels.set([...rgb, 255], i * 4);
  return pixels;
};

test('unattended Auto rejects new pure-white clipping', () => {
  assert.equal(assessAutoQuality(paint(100, [250, 250, 250]), paint(100, [255, 255, 255])).safe, false);
});
test('unattended Auto rejects orange feathers losing a colour channel', () => {
  const check = assessAutoQuality(paint(100, [230, 110, 30]), paint(100, [255, 150, 40]));
  assert.equal(check.safe, false);
  assert.match(check.reason, /colour-channel clipping/i);
});
test('unattended Auto accepts a gentle exposure lift', () => {
  assert.equal(assessAutoQuality(paint(100, [80, 85, 95]), paint(100, [110, 115, 125])).safe, true);
});
test('existing blown-out highlights are not confused with newly introduced clipping', () => {
  assert.equal(assessAutoQuality(paint(100, [255, 255, 255]), paint(100, [255, 255, 255])).safe, true);
});
test('unattended Auto rejects large colour shifts in vivid subjects', () => {
  assert.equal(assessAutoQuality(paint(100, [210, 90, 25]), paint(100, [25, 150, 210])).safe, false);
});
test('invalid samples fail closed', () => {
  assert.equal(assessAutoQuality(paint(5, [80, 90, 100]), paint(4, [100, 110, 120])).safe, false);
});
