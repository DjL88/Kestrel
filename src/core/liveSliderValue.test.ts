import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveSliderValue } from './liveSliderValue';

test('the thumb follows a pointer gesture even while parent rendering lags', () => {
  assert.equal(liveSliderValue(0, 0.7, true), 0.7);
  assert.equal(liveSliderValue(-1, 0.5, true), 0.5);
});
test('Undo, Reset, paste and photo switching reflect committed values immediately', () => {
  for (const committed of [-2, -0.2, 0, 0.4, 1.7, 0]) assert.equal(liveSliderValue(committed, 1.5, false), committed);
});
test('an invalid draft never displays as a false crop or adjustment', () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(liveSliderValue(0.6, invalid, true), 0.6);
  }
});
test('transient values cannot silently mutate a saved recipe', () => {
  const saved = Object.freeze({ exposure: -0.2, warmth: 0 });
  const preview = liveSliderValue(saved.exposure, 1.2, true);
  assert.equal(preview, 1.2);
  assert.equal(liveSliderValue(saved.exposure, preview, false), -0.2);
  assert.deepEqual(saved, { exposure: -0.2, warmth: 0 });
});
