import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMayContinue } from './exportCancellation';

test('only an active export can render or publish its results', () => {
  assert.equal(exportMayContinue(false, false, false), true);
  for (const [aborted, cancelled, closed] of [
    [true, false, false], [false, true, false], [false, false, true],
    [true, true, true], [true, false, true],
  ]) {
    assert.equal(exportMayContinue(aborted, cancelled, closed), false);
  }
});
