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
test('a small vivid bird region is protected even on a mostly muted background', () => {
  const before = paint(10_000, [95, 100, 105]);
  const after = before.slice();
  for (let p = 0; p < 120; p += 1) {
    before.set([40, 170, 220, 255], p * 4);
    after.set([215, 80, 35, 255], p * 4);
  }
  assert.equal(assessAutoQuality(before, after).safe, false);
});

test('unattended Auto refuses to wash vivid feather colour into grey', () => {
  const result = assessAutoQuality(paint(100, [40, 190, 235]), paint(100, [150, 155, 157]));
  assert.equal(result.safe, false);
  assert.match(result.reason, /vivid|saturated|feathers/i);
});

test('gentle edits with preserved colourful patches stay eligible', () => {
  const before = paint(10_000, [95, 100, 105]);
  const after = paint(10_000, [110, 115, 120]);
  for (let p = 0; p < 120; p += 1) {
    before.set([40, 170, 220, 255], p * 4);
    after.set([45, 175, 225, 255], p * 4);
  }
  assert.equal(assessAutoQuality(before, after).safe, true);
});

test('invalid samples fail closed', () => {
  assert.equal(assessAutoQuality(paint(5, [80, 90, 100]), paint(4, [100, 110, 120])).safe, false);
});
