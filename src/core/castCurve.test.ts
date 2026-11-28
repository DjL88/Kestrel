import assert from 'node:assert/strict';
import test from 'node:test';
import { castFindingFor, measureCastCurve, recastReport, SLIDER_PER_STEP, type CastCurve } from './castCurve';
import { checkColour } from './colourCheck';
import { colourVerdict } from './colourVerdict';
import { renderRecipePreview } from './naturalAuto';
import { DEFAULT_EDIT } from './photoEdits';

const W = 120, H = 90;
/** A grey-ish background (optionally with a warm lean) and an orange bird in the middle. */
function scene(lean: [number, number, number], bird: boolean) {
  const data = new Uint8ClampedArray(W * H * 4);
  const subject = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    const inBird = bird && x > 40 && x < 80 && y > 25 && y < 65;
    const v = 120 + ((x * 5 + y * 3) % 7);
    const px = inBird ? [215, 110, 30] : [v + lean[0], v + lean[1], v + lean[2]];
    data.set([px[0], px[1], px[2], 255], p * 4);
    if (inBird) subject[p] = 1;
  }
  return { data, subject };
}

test('an orange subject on a neutral background is not a cast', () => {
  const { data, subject } = scene([0, 0, 0], true);
  const report = checkColour({ after: { data, width: W, height: H }, subject });
  assert.equal(report.findings.some((f) => f.id === 'cast'), false);
  const curve = measureCastCurve({ pixels: data, width: W, height: H, subject })!;
  assert.equal(castFindingFor(curve, DEFAULT_EDIT), null);
  assert.notEqual(colourVerdict(recastReport(report, curve, DEFAULT_EDIT)).kind, 'tooWarm');
});

test('without a subject mask the bird still is not the reference (neutral pixels only)', () => {
  const { data } = scene([0, 0, 0], true);
  const report = checkColour({ after: { data, width: W, height: H } });
  assert.equal(report.findings.some((f) => f.id === 'cast'), false);
});

test('a real warm cast on a neutral background is measured, corrected by the amount needed, and the message clears after one re-measure', () => {
  const { data, subject } = scene([7, 2, -7], true);
  const report = checkColour({ after: { data, width: W, height: H }, subject });
  assert.equal(report.findings.some((f) => f.id === 'cast'), true, 'the cast is found');
  const curve = measureCastCurve({ pixels: data, width: W, height: H, subject })!;
  const found = castFindingFor(curve, DEFAULT_EDIT);
  assert.ok(found && found.id === 'cast' && found.status === 'fixable' && found.direction === 'warm');
  const delta = (found as { fixDelta: number }).fixDelta;
  assert.ok(delta < 0 && Math.abs(delta) > 0, 'cooler, by a measured amount');
  const verdict = colourVerdict(recastReport(report, curve, DEFAULT_EDIT));
  assert.equal(verdict.kind, 'tooWarm');
  assert.equal(verdict.fix?.delta, delta, 'Correct applies the measured amount, not a fixed one');
  // Apply it, re-measure from the curve: cleared.
  const fixed = { warmth: delta / SLIDER_PER_STEP, tint: 0 };
  assert.equal(castFindingFor(curve, fixed), null);
  assert.equal(colourVerdict(recastReport(report, curve, fixed)).kind, 'normal');
  // And the real render agrees: re-checking the actual pixels finds no cast.
  const rendered = renderRecipePreview(data, W, H, { ...DEFAULT_EDIT, warmth: fixed.warmth });
  assert.equal(checkColour({ after: { data: rendered, width: W, height: H }, subject }).findings.some((f) => f.id === 'cast'), false);
});

test('expected warm light is called natural, with no fix', () => {
  const { data, subject } = scene([7, 2, -7], true);
  const curve = measureCastCurve({ pixels: data, width: W, height: H, subject, expectWarm: true })!;
  const verdict = colourVerdict(recastReport(checkColour({ after: { data, width: W, height: H }, subject }), curve, DEFAULT_EDIT));
  assert.equal(verdict.kind, 'castNatural');
  assert.equal(verdict.fix, undefined);
});

test('a cast no reachable correction can fix is said plainly, with no useless nudge', () => {
  const stuck = { a: 0.02, b: 0.02 };
  const curve: CastCurve = { share: 0.5, expectWarm: false, warmth: Array(9).fill(stuck), tint: Array(9).fill(stuck) };
  const found = castFindingFor(curve, DEFAULT_EDIT);
  assert.ok(found && found.id === 'cast' && found.status === 'left');
  const verdict = colourVerdict({ palette: [], monochrome: false, findings: [found!] });
  assert.equal(verdict.kind, 'castLeft');
  assert.equal(verdict.fix, undefined);
});
