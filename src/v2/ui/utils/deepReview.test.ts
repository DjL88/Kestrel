import assert from 'node:assert/strict';
import test from 'node:test';
import { deepReviewAvailable, deepReviewFailure } from './deepReview';

test('the on-device check is offered on every plan, online or not, whatever the online Pro switches say', () => {
  const pro = { onlineAi: false, cloudAssist: false, cloudRecipe: true };
  assert.equal(deepReviewAvailable({ features: pro, online: true }), true, 'Pro, online, online review still switched off by the admin');
  assert.equal(deepReviewAvailable({ features: { onlineAi: false, cloudAssist: false }, online: false }), true, 'Basic and offline');
  assert.equal(deepReviewAvailable({ features: { onlineAi: true, cloudAssist: true }, online: true }), true);
});

test('a failed check says why (a missing model), never that the plan does not include it', () => {
  const missing = new Error('The optional subject detector is not installed in this preview. Original photos and manual editing remain available.');
  assert.match(deepReviewFailure(missing, 'Deep vision review failed.'), /not installed/);
  assert.equal(deepReviewFailure(undefined, 'Deep vision review failed.'), 'Deep vision review failed.');
  assert.equal(deepReviewFailure(new Error('  '), 'fallback'), 'fallback');
  assert.equal(deepReviewFailure('checksum did not match', 'fallback'), 'checksum did not match');
  assert.doesNotMatch(deepReviewFailure(missing, 'x'), /plan/i);
});
