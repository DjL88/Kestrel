import assert from 'node:assert/strict';
import test from 'node:test';
import { photoIndexFromNumber, photoPositionLabel } from './photoJump';

test('photo numbers are one-based in Review, Edit and a filtered edit queue', () => {
  assert.equal(photoIndexFromNumber('1', 28), 0);
  assert.equal(photoIndexFromNumber('28', 28), 27);
  assert.equal(photoIndexFromNumber(' 4 ', 10), 3);
  assert.equal(photoIndexFromNumber('1', 1), 0);
  assert.equal(photoPositionLabel(0, 28), '1 of 28');
  assert.equal(photoPositionLabel(27, 28), '28 of 28');
});
test('jump never silently clamps invalid input to a different photograph', () => {
  for (const input of ['', '0', '-1', '29', '2.5', 'NaN', '1e3', 'Infinity', 'abc']) {
    assert.equal(photoIndexFromNumber(input, 28), null, input);
  }
  assert.equal(photoIndexFromNumber('1', 0), null);
  assert.equal(photoIndexFromNumber('1', Number.NaN), null);
  assert.equal(photoPositionLabel(-1, 5), '— of 5');
  assert.equal(photoPositionLabel(1, 0), 'No photos');
});
