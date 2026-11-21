import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ColourCheckDemandGate, acceptsColourCheck } from './colourCheckDemand';
import { capturePhotoReviewScope } from './photoReviewScope';

test('two clicks before React rerenders start only one check', () => {
  const gate = new ColourCheckDemandGate();
  assert.equal(gate.begin(1000), true);
  assert.equal(gate.begin(1000), false);
  gate.finish();
  assert.equal(gate.begin(1001), false);
  assert.equal(gate.begin(1350), true);
  gate.finish();
});

test('stale photo result is rejected even if generation has not yet changed', () => {
  const photoA = { id: 'a' };
  const photoB = { id: 'b' };
  const recipe = { exposure: 0 };
  const requested = capturePhotoReviewScope([false, photoA, recipe]);
  // Simulates the render changing currentScope before effect cleanup increments generation.
  assert.equal(acceptsColourCheck(4, 4, requested, [false, photoB, recipe]), false);
  assert.equal(acceptsColourCheck(4, 5, requested, [false, photoA, recipe]), false);
  assert.equal(acceptsColourCheck(4, 4, requested, [false, photoA, recipe]), true);
});

test('stale-return cleanup releases gate and cannot strand a future check', () => {
  const gate = new ColourCheckDemandGate();
  const requested = capturePhotoReviewScope(['photo-a', 'edit-1']);
  assert.equal(gate.begin(1000), true);
  let checking = true;
  try {
    if (!acceptsColourCheck(2, 2, requested, ['photo-b', 'edit-1'])) {
      checking = false;
      returnFromStaleResult();
    }
  } finally {
    gate.finish();
  }
  assert.equal(checking, false);
  assert.equal(gate.begin(1351), true);
  gate.finish();
});

function returnFromStaleResult(): void {
  // The caller's stale branch exits before publishing a report.
}
