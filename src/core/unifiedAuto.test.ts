import assert from 'node:assert/strict';
import test from 'node:test';
import { naturalAuto } from './naturalAuto';
import { mergeAutoSuggestion } from './autoEnhance';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { describePlan, inRange, planAuto, recipeAtStrength, RANGES, type PlanInput } from './unifiedAuto';
import { speciesColourCheck, subjectSignatureHue, type SpeciesGuess } from './speciesPalette';
import { robinBrightBokeh, woodlandDarkBird, closeRobinGreen } from './syntheticScenes';

/** Deterministic textured scene: a mid-grey ground with fine texture, scaled by `level` (0.1 is a very dark frame). */
function textured(level: number, width = 160, height = 120): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const tex = 0.5 + 0.35 * Math.sin(x * 0.9) * Math.cos(y * 0.7) + (rnd() - 0.5) * 0.04;
    const v = Math.max(0, Math.min(255, Math.round(255 * Math.pow(tex * level, 1 / 2.2) * 1)));
    px[i] = v; px[i + 1] = Math.round(v * 0.98); px[i + 2] = Math.round(v * 0.96); px[i + 3] = 255;
  }
  return px;
}

function plan(pixels: Uint8ClampedArray, width: number, height: number, extra: Partial<PlanInput> = {}) {
  const base: PhotoEdit = { ...DEFAULT_EDIT };
  const natural = naturalAuto({ pixels, width, height, segmentation: extra.segmentation ?? null });
  const proposal = mergeAutoSuggestion(base, natural.edit).edit;
  return planAuto({ pixels, width, height, base, proposal, natural, ...extra });
}

test('dark image regression: a dark photo gets a real exposure lift, never "looks good"', () => {
  const result = plan(textured(0.07), 160, 120);
  assert.equal(result.verdict.kind, 'improved', JSON.stringify(result.measured));
  assert.ok((result.proposal.exposure ?? 0) >= 1, `exposure lift ${result.proposal.exposure} must be real`);
  assert.ok(result.measured.subjectMedian < RANGES.subjectMedian[0], 'the measurement itself shows the photo is dark');
});

test('a hopelessly dark photo is declined honestly, never called good', () => {
  const result = plan(textured(0.03), 160, 120);
  assert.notEqual(result.verdict.kind, 'looks-good');
  assert.equal(result.verdict.kind, 'cannot-improve-safely');
  assert.match(describePlan(result).headline, /cannot improve this safely/i);
  assert.deepEqual(result.proposal, DEFAULT_EDIT, 'nothing is applied when it is declined');
});

test('a well exposed photo says looks good only because its measured values are in range', () => {
  const pixels = textured(0.55);
  const result = plan(pixels, 160, 120);
  if (result.verdict.kind === 'looks-good') assert.ok(inRange(result.measured));
  assert.equal(inRange({ subjectMedian: 0.1, highlightP98: 0.5, reference: 'frame', lowKey: false, colourWarnings: [] }), false);
  assert.equal(inRange({ subjectMedian: 0.5, highlightP98: 0.99, reference: 'frame', lowKey: false, colourWarnings: [] }), false);
  assert.equal(inRange({ subjectMedian: 0.5, highlightP98: 0.9, reference: 'frame', lowKey: false, colourWarnings: ['clippedColour'] }), false);
  assert.equal(inRange({ subjectMedian: 0.5, highlightP98: 0.9, reference: 'frame', lowKey: false, colourWarnings: [] }), true);
});

test('strength scales the whole recipe: 0 is the starting look, 1 is the checked recipe, half is between', () => {
  const s = woodlandDarkBird();
  const result = plan(s.pixels, s.width, s.height, { segmentation: { grid: s.grid, confidence: 'high' } });
  const exposure = result.proposal.exposure ?? 0;
  assert.equal(recipeAtStrength(result, 0), result.base);
  assert.equal(recipeAtStrength(result, 1), result.proposal);
  if (exposure !== 0) {
    const half = recipeAtStrength(result, 0.5).exposure ?? 0;
    assert.ok(Math.abs(half) < Math.abs(exposure) && Math.abs(half) > 0);
  }
});

test('a recipe applied at strength 1 can be restored exactly by the base (undo)', () => {
  const pixels = textured(0.07);
  const result = plan(pixels, 160, 120);
  assert.deepEqual(recipeAtStrength(result, 0), DEFAULT_EDIT);
});

function guess(common: string, probability = 0.95, runnerUp = 0.03): SpeciesGuess { return { common, probability, runnerUp }; }
const maskAll = (n: number) => new Float32Array(n).fill(1);
function solid(r: number, g: number, b: number, n = 64 * 64) {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
  return px;
}

test('species: orange breast at the expected hue is consistent and nothing is corrected', () => {
  const px = solid(220, 110, 40);
  const h = subjectSignatureHue(px, maskAll(64 * 64), 64 * 64)!;
  assert.ok(h.hue > 38 && h.hue < 75, `orange measured at ${h.hue}`);
  const r = speciesColourCheck({ pixels: px, width: 64, height: 64, subject: maskAll(64 * 64), species: guess('European Robin'), warmLight: false });
  assert.equal(r.status, 'consistent');
  assert.equal(r.warmthDelta, 0);
});

test('species: a too-yellow breast on a confident robin is corrected towards warm, bounded', () => {
  const px = solid(230, 160, 40);
  const r = speciesColourCheck({ pixels: px, width: 64, height: 64, subject: maskAll(64 * 64), species: guess('European Robin'), warmLight: false });
  assert.equal(r.status, 'corrected');
  assert.ok(r.warmthDelta > 0 && r.warmthDelta <= 0.4);
  assert.match(r.reason, /evidence, not authority/i);
});

test('species: abstains when confidence is not high, when the light is warm, with no mask, or for an unknown species', () => {
  const px = solid(230, 160, 40);
  const base = { pixels: px, width: 64, height: 64, subject: maskAll(64 * 64), warmLight: false };
  assert.equal(speciesColourCheck({ ...base, species: guess('European Robin', 0.6, 0.3) }).status, 'abstained');
  assert.equal(speciesColourCheck({ ...base, species: guess('European Robin', 0.9, 0.5) }).status, 'abstained', 'small lead over the runner-up');
  assert.equal(speciesColourCheck({ ...base, species: guess('European Robin'), warmLight: true }).status, 'abstained');
  assert.equal(speciesColourCheck({ ...base, species: guess('European Robin'), subject: null }).status, 'abstained');
  assert.equal(speciesColourCheck({ ...base, species: guess('Mute Swan') }).status, 'abstained');
  assert.equal(speciesColourCheck({ ...base, species: null }).status, 'abstained');
  const warm = speciesColourCheck({ ...base, species: guess('European Robin'), warmLight: true });
  assert.match(warm.reason, /light/i);
});

test('species colour never changes the plan without a validated high-confidence mask', () => {
  const s = robinBrightBokeh();
  const without = plan(s.pixels, s.width, s.height);
  const lowConfidence = plan(s.pixels, s.width, s.height, { species: guess('European Robin', 0.5, 0.4) });
  assert.deepEqual(lowConfidence.proposal, without.proposal);
  assert.equal(lowConfidence.species.status, 'abstained');
  const noMask = plan(s.pixels, s.width, s.height, { species: guess('European Robin') });
  assert.equal(noMask.species.status, 'abstained');
});

test('closeRobinGreen with a high-confidence robin: outcome is one of consistent, corrected or abstained, with a reason', () => {
  const s = closeRobinGreen();
  const r = plan(s.pixels, s.width, s.height, { segmentation: { grid: s.grid, confidence: 'high' }, species: guess('European Robin') });
  assert.ok(['consistent', 'corrected', 'abstained'].includes(r.species.status));
  assert.ok(r.species.reason.length > 10);
  assert.ok(describePlan(r).detail.length >= 2);
});
