import test from 'node:test';
import assert from 'node:assert/strict';
import { sunElevation, sunLight } from './sunPosition';

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual.toFixed(2)} is not within ${tolerance} of ${expected}`);

test('the sun at solar noon on the solstice in London is about 62 degrees up', () => {
  // 90 − 51.51 + 23.44 = 61.93; solar noon in London on 21 June is about 12:02 UTC.
  near(sunElevation(Date.UTC(2026, 5, 21, 12, 2), 51.5074, -0.1278), 61.93, 0.3);
});

test('the sun at midwinter noon in Machynlleth is low, and below the horizon at midnight', () => {
  // 90 − 52.59 − 23.44 = 13.97, near solar noon (about 12:17 UTC at 3.85° W).
  near(sunElevation(Date.UTC(2026, 11, 21, 12, 17), 52.59, -3.85), 13.97 + 0.07, 0.4);
  assert.ok(sunElevation(Date.UTC(2026, 11, 21, 0, 17), 52.59, -3.85) < -55);
});

test('the equator at the March equinox: overhead at noon, on the horizon at about six', () => {
  near(sunElevation(Date.UTC(2026, 2, 20, 12, 7), 0, 0), 89.5, 0.8);
  near(sunElevation(Date.UTC(2026, 2, 20, 18, 7), 0, 0), 0.5, 1.2);
});

test('the photographic bands are named from the elevation', () => {
  assert.equal(sunLight(30), 'day');
  assert.equal(sunLight(6), 'day');
  assert.equal(sunLight(5.9), 'golden-hour');
  assert.equal(sunLight(-4), 'golden-hour');
  assert.equal(sunLight(-5), 'blue-hour');
  assert.equal(sunLight(-8), 'twilight');
  assert.equal(sunLight(-20), 'night');
  assert.throws(() => sunLight(Number.NaN));
});
