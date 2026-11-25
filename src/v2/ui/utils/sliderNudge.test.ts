import assert from 'node:assert/strict';
import test from 'node:test';
import { NUDGE_STEPS, nudgedValue } from './sliderNudge.ts';

test('a dial click moves a slider one of its own steps, inside its range, without drift', () => {
  assert.equal(nudgedValue(0, -5, 5, 0.1, NUDGE_STEPS.up), 0.1);
  assert.equal(nudgedValue(0.2, -5, 5, 0.1, NUDGE_STEPS.up), 0.3); // not 0.30000000000000004
  assert.equal(nudgedValue(0, -100, 100, 1, NUDGE_STEPS.downMore), -10);
  assert.equal(nudgedValue(98, -100, 100, 1, NUDGE_STEPS.upMore), 100);
  assert.equal(nudgedValue(-4.95, -5, 5, 0.1, NUDGE_STEPS.down), -5);
  // A broken slider never produces NaN.
  assert.equal(nudgedValue(Number.NaN, 0, 100, Number.NaN, 1), 1);
});
