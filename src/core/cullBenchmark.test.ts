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
