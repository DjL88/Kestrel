import assert from 'node:assert/strict';
import test from 'node:test';
import { visiblyDifferent } from './renderAutoCandidates';

test('different candidate recipes must produce meaningfully different visible pixels', () => {
  const before = new Uint8ClampedArray(100 * 4).fill(100);
  const after = before.slice();
  after[0] = 105;
  after[3] = 255;
  assert.equal(visiblyDifferent(before, after), false);
  after[5] = 105;
  assert.equal(visiblyDifferent(before, after), true);
});
