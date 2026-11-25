import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSubjectColour, hueDifference, COLOUR_SENSE_TOLERANCE } from './colourSense.ts';
import type { Pixels } from './colourCheck.ts';

const W = 10, H = 10;
/** Left half is the subject (one colour), right half the background (another). */
const picture = (subject: [number, number, number], background: [number, number, number] = [90, 110, 90]): Pixels => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p += 1) {
    const [r, g, b] = p % W < W / 2 ? subject : background;
    data.set([r, g, b, 255], p * 4);
  }
  return { data, width: W, height: H };
};
const leftHalf = () => Float32Array.from({ length: W * H }, (_, p) => (p % W < W / 2 ? 1 : 0));

test('a gentle brightening keeps the subject colour within tolerance', () => {
  const result = checkSubjectColour(picture([200, 110, 40]), picture([212, 118, 44]), leftHalf());
  if (result.verdict === 'unknown') return assert.fail('expected a verdict');
  assert.equal(result.verdict, 'kept');
  assert.equal(result.before, 'orange');
  assert.equal(result.after, 'orange');
  assert.ok(result.hueShift !== null && Math.abs(result.hueShift) <= COLOUR_SENSE_TOLERANCE.hueDegrees);
  assert.deepEqual(result.outside, []);
});

test('an orange subject pushed towards yellow is reported as a hue change, naming both colours', () => {
  const result = checkSubjectColour(picture([200, 110, 40]), picture([205, 180, 40]), leftHalf());
  if (result.verdict === 'unknown') return assert.fail('expected a verdict');
  assert.equal(result.verdict, 'changed');
  assert.ok(result.outside.includes('hue'));
  assert.equal(result.before, 'orange');
  assert.equal(result.after, 'yellow');
});

test('a much stronger colour is a saturation change; the background does not count', () => {
  const result = checkSubjectColour(picture([170, 120, 90], [128, 128, 128]), picture([215, 105, 40], [20, 200, 20]), leftHalf());
  if (result.verdict === 'unknown') return assert.fail('expected a verdict');
  assert.equal(result.verdict, 'changed');
  assert.ok(result.outside.includes('saturation'));
  assert.ok(result.saturationChange > COLOUR_SENSE_TOLERANCE.saturation);
});

test('a channel that newly hits its limit on the subject is clipping, per channel', () => {
  const result = checkSubjectColour(picture([230, 120, 60]), picture([255, 128, 64]), leftHalf());
  if (result.verdict === 'unknown') return assert.fail('expected a verdict');
  assert.ok(result.outside.includes('clipping'));
  assert.equal(result.newlyClipped.red, 1);
  assert.equal(result.newlyClipped.green, 0);
  assert.equal(result.newlyClipped.blue, 0);
});

test('already-clipped channels in the original are not blamed on the edit', () => {
  const result = checkSubjectColour(picture([255, 120, 60]), picture([255, 122, 61]), leftHalf());
  if (result.verdict === 'unknown') return assert.fail('expected a verdict');
  assert.equal(result.newlyClipped.red, 0);
  assert.equal(result.verdict, 'kept');
});

test('a nearly grey subject has no hue to judge, so the hue shift stays unknown', () => {
  const result = checkSubjectColour(picture([128, 128, 130]), picture([140, 138, 128]), leftHalf());
  if (result.verdict === 'unknown') return assert.fail('expected a verdict');
  assert.equal(result.hueShift, null);
  assert.ok(!result.outside.includes('hue'));
});

test('no subject, or mismatched pictures, is unknown rather than a guess', () => {
  assert.deepEqual(checkSubjectColour(picture([200, 110, 40]), picture([200, 110, 40]), new Float32Array(W * H)), { verdict: 'unknown', reason: 'noSubject' });
  assert.deepEqual(checkSubjectColour(picture([200, 110, 40]), { data: new Uint8ClampedArray(16), width: 2, height: 2 }, leftHalf()), { verdict: 'unknown', reason: 'mismatch' });
  assert.deepEqual(checkSubjectColour(picture([200, 110, 40]), picture([200, 110, 40]), new Float32Array(3)), { verdict: 'unknown', reason: 'mismatch' });
});

test('hue differences wrap round the colour wheel', () => {
  assert.equal(hueDifference(350, 10), 20);
  assert.equal(hueDifference(10, 350), -20);
  assert.equal(hueDifference(90, 90), 0);
});
