import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import {
  EMPTY_STYLE, MAX_MULTIPLIER, MIN_EXAMPLES, MIN_MULTIPLIER, RECENT_EXAMPLES, leanProposal, leaningFor, learnedLeanings,
  parseStyle, photosLearnedFrom, recordOutcome, samplesFromOutcome, type EditStyle,
} from './editStyle';

const base: PhotoEdit = { ...DEFAULT_EDIT };
const auto: PhotoEdit = { ...DEFAULT_EDIT, exposure: 0.6, contrast: 0.2 };

const teach = (style: EditStyle, finalExposure: number, times: number, start = 0) => {
  let next = style;
  for (let index = 0; index < times; index += 1) {
    next = recordOutcome(next, { base, applied: auto, final: { ...auto, exposure: finalExposure }, at: start + index });
  }
  return next;
};

test('nothing shifts before the minimum number of examples', () => {
  const style = teach(EMPTY_STYLE, 0.3, MIN_EXAMPLES - 1);
  assert.equal(leaningFor(style, 'exposure'), null);
  assert.deepEqual(learnedLeanings(style), []);
  const { edit, applied } = leanProposal(base, auto, learnedLeanings(style));
  assert.equal(edit, auto);
  assert.deepEqual(applied, []);
});

test('a consistent correction leans the next suggestion, gently at first and more with more examples', () => {
  const few = leaningFor(teach(EMPTY_STYLE, 0.3, MIN_EXAMPLES), 'exposure');
  assert.ok(few);
  assert.equal(few.multiplier, 0.75, 'five examples of "half as much" give half the leaning');
  const many = leaningFor(teach(EMPTY_STYLE, 0.3, 25), 'exposure');
  assert.ok(many && many.multiplier < few.multiplier && many.multiplier >= 0.5);
  // Contrast was kept as suggested every time, so it does not lean.
  assert.equal(leaningFor(teach(EMPTY_STYLE, 0.3, 25), 'contrast'), null);
});

test('the leaning scales only the change Auto made, and stays within bounds', () => {
  const leanings = [{ key: 'exposure' as const, multiplier: 0.75, examples: 5, outliers: 0 }];
  const { edit, applied } = leanProposal({ ...base, exposure: 0.2 }, { ...auto, exposure: 1 }, leanings);
  assert.equal(edit.exposure, 0.8);
  assert.equal(edit.contrast, 0.2);
  assert.equal(applied.length, 1);
  // A slider Auto left alone is never moved.
  assert.equal(leanProposal(base, { ...base, contrast: 0.3 }, leanings).edit.exposure, 0);
  // Always undone: bounded at half; always pushed to double: bounded at one and a half.
  assert.ok((leaningFor(teach(EMPTY_STYLE, 0, RECENT_EXAMPLES), 'exposure')?.multiplier ?? 0) >= MIN_MULTIPLIER);
  assert.ok((leaningFor(teach(EMPTY_STYLE, 3, RECENT_EXAMPLES), 'exposure')?.multiplier ?? 9) <= MAX_MULTIPLIER);
});

test('outliers are ignored', () => {
  let style = teach(EMPTY_STYLE, 0.3, 8);
  const before = leaningFor(style, 'exposure')!.multiplier;
  style = recordOutcome(style, { base, applied: auto, final: { ...auto, exposure: 1.2 }, at: 100 });
  const after = leaningFor(style, 'exposure')!;
  assert.equal(after.outliers, 1);
  assert.equal(after.multiplier, before);
});

test('examples are measured against Auto\'s own change, so a kept leaned suggestion does not undo the leaning', () => {
  const leaned = { ...auto, exposure: 0.3 };
  const [sample] = samplesFromOutcome({ base, applied: leaned, final: leaned, multipliers: { exposure: 0.5 }, at: 1 });
  assert.equal(sample.key, 'exposure');
  assert.equal(sample.kept, 0.5);
  assert.equal(sample.outcome, 'kept');
});

test('undo and correction are told apart', () => {
  const undone = samplesFromOutcome({ base, applied: auto, final: base, at: 1 });
  assert.deepEqual(undone.map((sample) => [sample.key, sample.kept, sample.outcome]), [['exposure', 0, 'undone'], ['contrast', 0, 'undone']]);
  const corrected = samplesFromOutcome({ base, applied: auto, final: { ...auto, exposure: 0.9 }, at: 1 });
  assert.deepEqual(corrected.map((sample) => [sample.key, sample.kept, sample.outcome]), [['exposure', 1.5, 'corrected'], ['contrast', 1, 'kept']]);
  // Auto changed nothing it learns from: nothing to record.
  assert.equal(recordOutcome(EMPTY_STYLE, { base, applied: base, final: base, at: 1 }), EMPTY_STYLE);
});

test('only recent examples count, and a stored style is read defensively', () => {
  const style = teach(EMPTY_STYLE, 0.3, RECENT_EXAMPLES + 10);
  assert.equal(style.samples.filter((sample) => sample.key === 'exposure').length, RECENT_EXAMPLES);
  assert.equal(photosLearnedFrom(style), RECENT_EXAMPLES);
  assert.deepEqual(parseStyle(JSON.parse(JSON.stringify(style))), style);
  assert.deepEqual(parseStyle(null), EMPTY_STYLE);
  assert.deepEqual(parseStyle({ version: 2, samples: [] }), EMPTY_STYLE);
  assert.deepEqual(parseStyle({ version: 1, samples: [{ key: 'masks', kept: 1, outcome: 'kept', at: 1 }, { key: 'exposure', kept: 7, outcome: 'kept', at: 1 }] }).samples, []);
});
