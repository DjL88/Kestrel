import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCullBenchmark, type CullBenchmarkCase } from './cullBenchmark';
import type { CullSuggestion } from './autoCull';

const categories: CullBenchmarkCase['category'][] = ['birds', 'aircraft', 'people', 'mammals', 'landscapes'];
const labels: CullBenchmarkCase[] = categories.flatMap((category, index) => [
  { id: category + '-hero', category, favourite: true },
  { id: category + '-bad', category, favourite: false, unusable: true },
]);
const prediction = (frameId: string, decision: CullSuggestion['decision']): CullSuggestion => ({
  frameId, decision, confidence: decision === null ? 'low' : 'high', score: 80, reason: 'limitedDetail',
});

test('synthetic five-category benchmark reports perfect recall when all favourites remain reviewable', () => {
  const predictions = labels.map((label) => prediction(label.id, label.favourite ? 'keep' : 'reject'));
  const result = evaluateCullBenchmark(labels, predictions);
  assert.equal(result.total, 10);
  assert.equal(result.recall, 1);
  assert.equal(result.precision, 1);
  assert.equal(result.unsafeRejections, 0);
  assert.equal(result.missingPredictions, 0);
  for (const category of categories) assert.equal(result.byCategory[category].recall, 1);
});

test('unknown aircraft and bird detection stays in review, never counts as a missed favourite', () => {
  const predictions = [prediction('birds-hero', null), prediction('aircraft-hero', null)];
  const result = evaluateCullBenchmark(labels, predictions);
  assert.equal(result.recall, 1);
  assert.equal(result.missingPredictions, 8);
  assert.equal(result.suggested, 10);
  assert.equal(result.precision, 0.5);
});

test('false rejection of a photographer favourite is explicitly measured by category', () => {
  const result = evaluateCullBenchmark(labels, [prediction('aircraft-hero', 'reject')]);
  assert.equal(result.unsafeRejections, 1);
  assert.equal(result.missedFavourites, 1);
  assert.equal(result.recall, 0.8);
  assert.equal(result.byCategory.aircraft.recall, 0);
  assert.equal(result.byCategory.birds.recall, 1);
});

test('duplicate prediction identities fail safe as unknown, never silently reject', () => {
  const result = evaluateCullBenchmark(labels, [prediction('birds-hero', 'reject'), prediction('birds-hero', 'reject')]);
  assert.equal(result.unsafeRejections, 0);
  assert.equal(result.missingPredictions, 10);
});

test('empty and malformed benchmark labels cannot manufacture a recall result', () => {
  const result = evaluateCullBenchmark([], []);
  assert.equal(result.recall, null);
  assert.equal(result.precision, null);
  assert.equal(result.byCategory.landscapes.recall, null);
  assert.throws(() => evaluateCullBenchmark([labels[0], labels[0]], []), /Duplicate benchmark label/);
});


test('ten benchmark safety gates prevent false confidence in bad labels or predictions', () => {
  const hero = labels[0];
  const invalidLabels: Array<[string, CullBenchmarkCase]> = [
    ['blank identity', { ...hero, id: ' ' }],
    ['non-string identity', { ...hero, id: null as unknown as string }],
    ['invalid category', { ...hero, category: 'unknown' as CullBenchmarkCase['category'] }],
    ['non-boolean favourite', { ...hero, favourite: 'yes' as unknown as boolean }],
    ['non-boolean unusable', { ...hero, unusable: 'yes' as unknown as boolean }],
    ['contradictory ground truth', { ...hero, unusable: true }],
  ];
  for (const [name, invalid] of invalidLabels) {
    assert.throws(() => evaluateCullBenchmark([invalid], []), { name: 'Error' }, name);
  }
  const badPredictions: Array<[string, CullSuggestion]> = [
    ['NaN score', { ...prediction(hero.id, 'reject'), score: NaN }],
    ['infinite score', { ...prediction(hero.id, 'reject'), score: Infinity }],
    ['out-of-range score', { ...prediction(hero.id, 'reject'), score: 101 }],
    ['invalid decision', { ...prediction(hero.id, 'reject'), decision: 'discard' as CullSuggestion['decision'] }],
    ['invalid confidence', { ...prediction(hero.id, 'reject'), confidence: 'certain' as CullSuggestion['confidence'] }],
  ];
  for (const [name, invalid] of badPredictions) {
    const result = evaluateCullBenchmark([hero], [invalid]);
    assert.equal(result.recall, 1, name);
    assert.equal(result.unsafeRejections, 0, name);
    assert.equal(result.invalidPredictions, 1, name);
    assert.equal(result.missingPredictions, 1, name);
  }
  const unrelated = evaluateCullBenchmark([hero], [prediction('different-photo', 'reject')]);
  assert.equal(unrelated.unexpectedPredictions, 1);
  assert.equal(unrelated.missingPredictions, 1);
  assert.equal(unrelated.recall, 1);
  const repeated = evaluateCullBenchmark([hero], [prediction(hero.id, 'reject'), prediction(hero.id, 'reject')]);
  assert.equal(repeated.duplicatePredictions, 1);
  assert.equal(repeated.recall, 1);
});


test('automatic Keep precision excludes unknown review candidates and exposes false positives', () => {
  const result = evaluateCullBenchmark(labels, [
    prediction('birds-hero', 'keep'),
    prediction('birds-bad', 'keep'),
    prediction('aircraft-hero', null),
  ]);
  assert.equal(result.autoKeeps, 2);
  assert.equal(result.correctAutoKeeps, 1);
  assert.equal(result.autoKeepPrecision, 0.5);
  assert.equal(result.recall, 1);
  assert.equal(result.precision, 0.5);
  const noAutoKeeps = evaluateCullBenchmark(labels, [prediction('birds-hero', null)]);
  assert.equal(noAutoKeeps.autoKeepPrecision, null);
  assert.equal(noAutoKeeps.autoKeeps, 0);
});

test('500-photo synthetic mixed-subject shoot reports unsafe rejects without hiding uncertain or corrupt predictions', () => {
  // Synthetic acceptance fixture, NOT a measurement of real-shoot subject or eye accuracy.
  const shoot: CullBenchmarkCase[] = categories.flatMap((category) =>
    Array.from({ length: 100 }, (_, i) => ({
      id: `${category}-${i}`,
      category,
      favourite: i < 20,
      unusable: i >= 90,
    })),
  );
  const decisions = shoot.flatMap((photo) => {
    if (photo.id === 'people-0') return []; // missing prediction: review, not reject
    if (photo.id === 'aircraft-0') return [prediction(photo.id, 'reject'), prediction(photo.id, 'reject')]; // duplicate: review
    if (photo.id === 'birds-0') return [{ ...prediction(photo.id, 'reject'), score: Number.NaN }]; // corrupt: review
    if (photo.id === 'mammals-0') return [prediction(photo.id, 'reject')]; // genuine unsafe rejection
    if (photo.id === 'landscapes-0') return [prediction(photo.id, null)]; // honest unknown
    return [prediction(photo.id, photo.favourite ? 'keep' : 'reject')];
  });
  const result = evaluateCullBenchmark(shoot, decisions);
  assert.equal(result.total, 500);
  assert.equal(result.favourites, 100);
  assert.equal(result.missedFavourites, 1);
  assert.equal(result.unsafeRejections, 1);
  assert.equal(result.recall, 0.99);
  assert.equal(result.missingPredictions, 3);
  assert.equal(result.duplicatePredictions, 1);
  assert.equal(result.invalidPredictions, 1);
  assert.equal(result.byCategory.mammals.recall, 0.95);
  for (const category of categories.filter((item) => item !== 'mammals')) {
    assert.equal(result.byCategory[category].recall, 1, category);
  }
});
