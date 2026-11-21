import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturePhotoReviewScope, samePhotoReviewScope } from './photoReviewScope';

const photo = { id: 'original-one' };
const recipe = { exposure: 0 };
const provider = { model: 'local-vision' };
const framing = { angle: 0 };

test('an async review may survive a rerender with the identical photo and recipe', () => {
  const started = capturePhotoReviewScope([photo, recipe, framing, provider, 'ready']);
  assert.equal(samePhotoReviewScope(started, [photo, recipe, framing, provider, 'ready']), true);
  assert.equal(Object.isFrozen(started), true);
});

test('a changed photo, crop, recipe, provider, or readiness makes an old opinion stale', () => {
  const started = capturePhotoReviewScope([photo, recipe, framing, provider, 'ready']);
  const cases = [
    [{ id: 'different-original' }, recipe, framing, provider, 'ready'],
    [photo, { exposure: 0.1 }, framing, provider, 'ready'],
    [photo, recipe, { angle: 90 }, provider, 'ready'],
    [photo, recipe, framing, { model: 'different' }, 'ready'],
    [photo, recipe, framing, provider, 'loading'],
    [photo, recipe, framing, provider],
  ];
  for (const current of cases) assert.equal(samePhotoReviewScope(started, current), false);
});

test('a later mutation to the original scope array cannot resurrect a stale response', () => {
  const mutable: unknown[] = [photo, recipe];
  const started = capturePhotoReviewScope(mutable);
  mutable[0] = { id: 'switched' };
  assert.equal(samePhotoReviewScope(started, mutable), false);
  assert.equal(samePhotoReviewScope(null, mutable), false);
});
