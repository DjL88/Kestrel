import test from 'node:test';
import assert from 'node:assert/strict';
import { mayPaintPointer, stylusIsInContact, stylusSample } from './stylusInput';

test('pen pressure changes strength and never brush radius', () => {
  assert.deepEqual(stylusSample({ pointerType: 'pen', pressure: 0.3, tiltX: 24, tiltY: -13 }),
    { kind: 'pen', strength: 0.3, tiltX: 24, tiltY: -13 });
  assert.equal(stylusSample({ pointerType: 'pen', pressure: 4 })?.strength, 1);
  assert.equal(stylusSample({ pointerType: 'pen', pressure: -2 })?.strength, 0);
});
test('mouse and touch do not depend on browser-supplied pressure', () => {
  assert.equal(stylusSample({ pointerType: 'mouse', pressure: 0 })?.strength, 1);
  assert.equal(stylusSample({ pointerType: 'touch', pressure: 0.2 })?.strength, 1);
  assert.equal(stylusSample({ pointerType: 'unknown', pressure: 1 }), null);
});
test('palm suppression is explicit and finger painting opt-in', () => {
  const touch = { pointerType: 'touch', pressure: 0.5, isPrimary: true };
  assert.equal(mayPaintPointer(touch, true, true), false);
  assert.equal(mayPaintPointer(touch, false, false), false);
  assert.equal(mayPaintPointer(touch, false, true), true);
  assert.equal(mayPaintPointer({ ...touch, isPrimary: false }, false, true), false);
  assert.equal(mayPaintPointer({ pointerType: 'pen', pressure: 0.5 }, true), true);
});
test('tilt and malformed values are bounded and hover cannot paint', () => {
  assert.deepEqual(stylusSample({ pointerType: 'pen', pressure: Number.NaN, tiltX: 120, tiltY: -120 }),
    { kind: 'pen', strength: 0, tiltX: 90, tiltY: -90 });
  assert.equal(stylusIsInContact({ pointerType: 'pen', pressure: 0, buttons: 0 }), false);
  assert.equal(stylusIsInContact({ pointerType: 'pen', pressure: 0.3, buttons: 1 }), true);
});
