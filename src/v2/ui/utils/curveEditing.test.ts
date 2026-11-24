import test from 'node:test';
import assert from 'node:assert/strict';
import { validCurve } from '../../../core/curveMixer';
import { addCurvePoint, CURVE_PRESETS, curvePath, MIN_GAP, moveCurvePoint, removeCurvePoint, type UiCurvePoint } from './curveEditing';

const straight: UiCurvePoint[] = [[0, 0], [1, 1]];

test('adding a point keeps the inputs in order and the curve valid', () => {
  const added = addCurvePoint(straight, [0.4, 0.3]);
  assert.ok(added);
  assert.equal(added.index, 1);
  assert.deepEqual(added.points, [[0, 0], [0.4, 0.3], [1, 1]]);
  assert.ok(validCurve(added.points));
  assert.equal(addCurvePoint(added.points, [0.405, 0.9]), null, 'too close to an existing point');
});

test('a dragged point cannot pass its neighbours or leave the graph', () => {
  const points: UiCurvePoint[] = [[0, 0], [0.4, 0.3], [0.6, 0.7], [1, 1]];
  const moved = moveCurvePoint(points, 1, [0.9, 1.4]);
  assert.equal(moved[1][0], 0.6 - MIN_GAP);
  assert.equal(moved[1][1], 1);
  assert.ok(validCurve(moved));
  assert.deepEqual(points[1], [0.4, 0.3], 'the original list is not changed');
  assert.ok(validCurve(moveCurvePoint(points, 0, [-1, 0.2])));
});

test('a curve always keeps two points and stops at sixteen', () => {
  assert.equal(removeCurvePoint(straight, 0), null);
  let points = straight;
  for (let i = 1; i < 20; i += 1) points = addCurvePoint(points, [i / 20, i / 20])?.points ?? points;
  assert.equal(points.length, 16);
});

test('every preset is a valid engine curve and draws a path', () => {
  for (const preset of Object.values(CURVE_PRESETS)) {
    assert.ok(validCurve(preset));
    assert.match(curvePath(preset, 200), /^M0,/);
  }
});
