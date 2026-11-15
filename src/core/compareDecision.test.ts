import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleCompareDecision } from './compareDecision';

test('compare Keep and Reject controls toggle without deleting or changing unrelated decisions', () => {
  assert.equal(toggleCompareDecision('unreviewed', 'keep'), 'keep');
  assert.equal(toggleCompareDecision('unreviewed', 'reject'), 'reject');
  assert.equal(toggleCompareDecision('keep', 'keep'), 'unreviewed');
  assert.equal(toggleCompareDecision('reject', 'reject'), 'unreviewed');
  assert.equal(toggleCompareDecision('keep', 'reject'), 'reject');
  assert.equal(toggleCompareDecision('reject', 'keep'), 'keep');
});
