import assert from 'node:assert/strict';
import test from 'node:test';
import { THUMB, bestTurn, thumbDifference, turnThumb, type Thumb } from './orientMatch.ts';

/** A picture with a bright blob in one corner and a gradient, so every turn looks different. */
function scene(): Thumb {
  const t = new Float32Array(THUMB * THUMB);
  for (let y = 0; y < THUMB; y += 1) for (let x = 0; x < THUMB; x += 1) {
    t[y * THUMB + x] = 40 + y * 3 + (x < 8 && y < 8 ? 120 : 0) + (x > 24 ? 20 : 0);
  }
  return t;
}

test('turning four times returns the same picture, and each turn is different', () => {
  let t = scene();
  for (let i = 0; i < 4; i += 1) t = turnThumb(t, 90);
  assert.deepEqual([...t], [...scene()]);
  assert.ok(thumbDifference(scene(), turnThumb(scene(), 90)) > 5);
  assert.deepEqual([...turnThumb(turnThumb(scene(), 90), 90)], [...turnThumb(scene(), 180)]);
});

test('a sideways landscape of a portrait scene is turned the way that matches the preview', () => {
  const upright = scene(); // the camera's preview: portrait
  // The developed picture is the same scene lying on its side: 90 degrees counter-clockwise (so it needs 90 clockwise).
  const sideways = turnThumb(upright, 270);
  assert.equal(bestTurn({ thumb: upright, portrait: true }, { thumb: sideways, portrait: false }), 90);
  const otherWay = turnThumb(upright, 90);
  assert.equal(bestTurn({ thumb: upright, portrait: true }, { thumb: otherWay, portrait: false }), 270);
});

test('a developed picture that already matches is left alone', () => {
  assert.equal(bestTurn({ thumb: scene(), portrait: false }, { thumb: scene(), portrait: false }), 0);
});

test('an upside-down developed picture of the same shape is turned half way, but only when the match is clear', () => {
  const upright = scene();
  assert.equal(bestTurn({ thumb: upright, portrait: false }, { thumb: turnThumb(upright, 180), portrait: false }), 180);
  const flat = new Float32Array(THUMB * THUMB).fill(100);
  assert.equal(bestTurn({ thumb: flat, portrait: false }, { thumb: flat, portrait: false }), 0, 'a featureless picture is not turned');
});
