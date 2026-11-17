import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCullBenchmark, type CullBenchmarkCase } from './cullBenchmark';
import type { CullSuggestion } from './autoCull';
import { evaluateCullQualityGate, DEFAULT_CULL_QUALITY_TARGETS } from './cullQualityGate';

const labels: CullBenchmarkCase[] = Array.from({ length: 100 }, (_, index) => ({
  id: 'synthetic-' + index,
  category: (['birds', 'aircraft', 'people', 'mammals', 'landscapes'] as const)[index % 5],
  favourite: index < 20,
}));
const suggestion = (index: number, decision: CullSuggestion['decision']): CullSuggestion => ({
  frameId: 'synthetic-' + index,
  decision, confidence: decision === null ? 'low' : 'high', score: 75, reason: 'someDetail',
});
const good = () => labels.map((_, index) => suggestion(index, index < 20 ? 'keep' : 'reject'));
const check = (predictions: CullSuggestion[]) => evaluateCullQualityGate(evaluateCullBenchmark(labels, predictions));

test('100 labelled photos with 20 correct automatic keeps pass all quality gates', () => {
  const result = check(good());
  assert.equal(result.status, 'pass');
  assert.equal(result.reviewFraction, 0.2);
  assert.equal(result.predictionCoverage, 1);
  assert.deepEqual(result.reasons, []);
});

test('one falsely rejected favourite blocks release even when overall recall looks high', () => {
  const predictions = good();
  predictions[0] = suggestion(0, 'reject');
  const result = check(predictions);
  assert.equal(result.status, 'fail');
  assert.ok(result.reasons.some((reason) => /rejected/.test(reason)));
});

test('keeping every photo fails review workload and automatic Keep precision', () => {
  const result = check(labels.map((_, index) => suggestion(index, 'keep')));
  assert.equal(result.status, 'fail');
  assert.ok(result.reasons.some((reason) => /workload/.test(reason)));
  assert.ok(result.reasons.some((reason) => /precision/.test(reason)));
});

test('unknown predictions cannot manufacture a passing release score', () => {
  const result = check(good().slice(0, 10));
  assert.equal(result.status, 'fail');
  assert.ok(result.reasons.some((reason) => /coverage/.test(reason)));
});

test('insufficient ground truth never passes, including empty and no auto-Keep sets', () => {
  assert.equal(evaluateCullQualityGate(evaluateCullBenchmark([], [])).status, 'insufficient-evidence');
  const few = evaluateCullBenchmark(labels.slice(0, 4), good().slice(0, 4));
  assert.equal(evaluateCullQualityGate(few).status, 'insufficient-evidence');
  assert.equal(check(labels.map((_, index) => suggestion(index, null))).status, 'insufficient-evidence');
});

test('malformed predictions cannot pass quality gate', () => {
  const predictions = good();
  predictions[0] = { ...predictions[0], score: Number.NaN };
  const result = check(predictions);
  assert.equal(result.status, 'fail');
  assert.ok(result.reasons.some((reason) => /Invalid predictions/.test(reason)));
});

test('duplicate prediction identities fail rather than improving recall', () => {
  const predictions = good();
  predictions.push(predictions[0]);
  assert.equal(check(predictions).status, 'fail');
});

test('unrelated predictions are visible as release failures', () => {
  const predictions = good();
  predictions.push({ ...suggestion(0, 'keep'), frameId: 'not-in-shoot' });
  assert.ok(check(predictions).reasons.some((reason) => /Unexpected/.test(reason)));
});

test('thresholds are explicit and invalid policies fail closed', () => {
  assert.equal(DEFAULT_CULL_QUALITY_TARGETS.minRecall, 0.95);
  assert.throws(() => evaluateCullQualityGate(evaluateCullBenchmark(labels, good()), {
    ...DEFAULT_CULL_QUALITY_TARGETS, minRecall: Number.NaN,
  }), /Invalid culling quality targets/);
});

test('benchmark count corruption cannot create a passing result', () => {
  const result = evaluateCullBenchmark(labels, good());
  assert.throws(() => evaluateCullQualityGate({ ...result, suggested: 101 }), /Invalid benchmark result counts/);
});


test('five-category coverage prevents an easy bird-only shoot from certifying all subjects', () => {
  const birdOnly = labels.map((label) => ({ ...label, category: 'birds' as const }));
  const result = evaluateCullQualityGate(evaluateCullBenchmark(birdOnly, good()));
  assert.equal(result.status, 'insufficient-evidence');
  assert.ok(result.reasons.some((reason) => reason.includes('aircraft')));
  assert.ok(result.reasons.some((reason) => reason.includes('landscapes')));
});

test('one lost mammal favourite cannot be hidden by excellent overall recall', () => {
  const predictions = good();
  predictions[3] = suggestion(3, 'reject');
  const result = check(predictions);
  assert.equal(result.status, 'fail');
  assert.ok(result.reasons.some((reason) => reason.includes('mammals') || reason.includes('rejected')));
});

test('category count corruption is rejected rather than certified', () => {
  const result = evaluateCullBenchmark(labels, good());
  assert.throws(() => evaluateCullQualityGate({
    ...result,
    byCategory: { ...result.byCategory, birds: { ...result.byCategory.birds, found: 999 } },
  }), /Invalid benchmark category counts/);
});

test('category sample requirements must be valid positive integers', () => {
  const result = evaluateCullBenchmark(labels, good());
  assert.throws(() => evaluateCullQualityGate(result, {
    ...DEFAULT_CULL_QUALITY_TARGETS, minPhotosPerCategory: 0,
  }), /Invalid culling quality targets/);
});

test('forged overall recall or precision cannot certify a shoot', () => {
  const result = evaluateCullBenchmark(labels, good());
  assert.throws(() => evaluateCullQualityGate({ ...result, recall: 1.01 }), /Inconsistent benchmark result ratios/);
  assert.throws(() => evaluateCullQualityGate({ ...result, precision: 0.9 }), /Inconsistent benchmark result ratios/);
  assert.throws(() => evaluateCullQualityGate({ ...result, autoKeepPrecision: 0.5 }), /Inconsistent benchmark result ratios/);
});

test('forged aggregate totals and false-rejection counts fail closed', () => {
  const result = evaluateCullBenchmark(labels, good());
  assert.throws(() => evaluateCullQualityGate({ ...result, foundFavourites: 19 }), /Inconsistent benchmark result counts/);
  assert.throws(() => evaluateCullQualityGate({ ...result, unsafeRejections: 1 }), /Inconsistent benchmark result counts/);
  assert.throws(() => evaluateCullQualityGate({ ...result, autoKeeps: 101 }), /Inconsistent benchmark result counts/);
});

test('category sums and category recall must agree with the actual labels', () => {
  const result = evaluateCullBenchmark(labels, good());
  const birds = result.byCategory.birds;
  assert.throws(() => evaluateCullQualityGate({
    ...result, byCategory: { ...result.byCategory, birds: { ...birds, total: birds.total + 1 } },
  }), /Inconsistent benchmark category totals/);
  assert.throws(() => evaluateCullQualityGate({
    ...result, byCategory: { ...result.byCategory, birds: { ...birds, recall: 0.9 } },
  }), /Inconsistent benchmark category recall/);
});

test('legitimate incomplete detection still returns fail or insufficient evidence, never throws', () => {
  const result = evaluateCullBenchmark(labels, good().slice(0, 5));
  assert.equal(evaluateCullQualityGate(result).status, 'fail');
});
