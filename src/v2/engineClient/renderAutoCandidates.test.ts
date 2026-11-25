import assert from 'node:assert/strict';
import test from 'node:test';
import { unionAlpha, visiblyDifferent } from './renderAutoCandidates';

test('different candidate recipes must produce meaningfully different visible pixels', () => {
  const before = new Uint8ClampedArray(100 * 4).fill(100);
  const after = before.slice();
  after[0] = 105;
  after[3] = 255;
  assert.equal(visiblyDifferent(before, after), false);
  after[5] = 105;
  assert.equal(visiblyDifferent(before, after), true);
});


test('several subjects are judged together: each pixel takes the strongest mask covering it', () => {
  assert.deepEqual([...unionAlpha([Float32Array.from([0, 0.5, 1, 0]), Float32Array.from([0.25, 0.25, 0, 0])])!], [0.25, 0.5, 1, 0]);
  assert.equal(unionAlpha([]), null);
  assert.equal(unionAlpha([new Float32Array(2), new Float32Array(3)]), null);
});
