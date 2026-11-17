import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from './cullingEngine';
import { benchmarkShoot, type PhotographerLabel } from './cullShootBenchmark';
import type { CullSuggestion } from './autoCull';

/**
 * Deterministic integration fixture, NOT a real-shoot accuracy measurement.
 * Tests benchmark bookkeeping when a 500-photo review has detector outages,
 * duplicate predictions, and a removed original.
 */
test('500-photo mixed-detector benchmark never hides coverage gaps or modifies originals', () => {
  const categories: PhotographerLabel['category'][] = ['birds', 'aircraft', 'people', 'mammals', 'landscapes'];
  const frames = createDemoShootState(500).frames.map((frame, index) => ({
    ...frame, isDemo: false, sourceKind: 'file' as const,
    stableKey: 'synthetic-local://' + index,
    ...(index === 499 ? { removedAt: 0 } : {}),
  }));
  const snapshot = structuredClone(frames);
  const active = frames.slice(0, 499);
  const labels = active.map((frame, index) => ({
    stableKey: frame.stableKey,
    category: categories[Math.floor(index / 100)],
    favourite: index % 10 === 0,
  }));
  const prediction = (frameId: string, decision: CullSuggestion['decision']): CullSuggestion =>
    ({ frameId, decision, confidence: 'low', score: 50, reason: 'clearDetail' });
  const suggestions = active.slice(0, 400).map((frame, index) =>
    prediction(frame.id, index === 0 ? 'reject' : null));
  suggestions.push(prediction(active[1].id, 'reject')); // duplicate must be treated as unknown
  suggestions[2] = { ...prediction(active[2].id, 'reject'), score: Number.NaN }; // invalid
  const report = benchmarkShoot(frames, labels, suggestions);
  assert.equal(report.result.total, 499);
  assert.equal(report.result.favourites, 50);
  assert.equal(report.result.unsafeRejections, 1);
  assert.deepEqual(report.missedFavouriteKeys, [active[0].stableKey]);
  assert.equal(report.result.duplicatePredictions, 1);
  assert.equal(report.result.invalidPredictions, 1);
  assert.equal(report.result.missingPredictions, 101);
  assert.equal(report.predictionCoverage, 398 / 499);
  assert.equal(report.result.recall, 49 / 50);
  assert.deepEqual(frames, snapshot, 'benchmark is read-only, including removed-at-zero originals');
});
