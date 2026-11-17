import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoShootFrames } from './cullingEngine';
import { benchmarkShoot, type PhotographerLabel } from './cullShootBenchmark';
import type { CullSuggestion } from './autoCull';

const categories: PhotographerLabel['category'][] = ['birds', 'aircraft', 'people', 'mammals', 'landscapes'];
const frames = generateDemoShootFrames(10).map((frame, index) => ({
  ...frame, isDemo: false, sourceKind: 'file' as const,
  stableKey: 'local://synthetic/' + index,
}));
const labels: PhotographerLabel[] = frames.map((frame, index) => ({
  stableKey: frame.stableKey,
  category: categories[Math.floor(index / 2)],
  favourite: index % 2 === 0,
}));
const suggestion = (frameId: string, decision: CullSuggestion['decision']): CullSuggestion => ({
  frameId, decision, confidence: 'high', score: 90, reason: 'clearDetail',
});

test('synthetic ten-photo five-category shoot has traceable missed favourites', () => {
  const predictions = frames.map((frame, index) => suggestion(frame.id, index === 2 ? 'reject' : index % 2 === 0 ? 'keep' : 'reject'));
  const report = benchmarkShoot(frames, labels, predictions);
  assert.equal(report.result.total, 10);
  assert.equal(report.result.favourites, 5);
  assert.equal(report.result.recall, 0.8);
  assert.equal(report.result.byCategory.aircraft.recall, 0);
  assert.deepEqual(report.missedFavouriteKeys, [frames[2].stableKey]);
  assert.equal(report.predictionCoverage, 1);
});

test('undetected aircraft stays reviewable and coverage is explicit', () => {
  const report = benchmarkShoot(frames, labels, [suggestion(frames[0].id, 'keep')]);
  assert.equal(report.result.recall, 1);
  assert.equal(report.result.missingPredictions, 9);
  assert.equal(report.predictionCoverage, 0.1);
  assert.deepEqual(report.missedFavouriteKeys, []);
});

test('partial or duplicate photographer labels cannot report misleading recall', () => {
  assert.throws(() => benchmarkShoot(frames, labels.slice(1), []), /Missing photographer label/);
  assert.throws(() => benchmarkShoot(frames, [...labels, labels[0]], []), /Duplicate or missing/);
  assert.throws(() => benchmarkShoot(frames, [...labels, { stableKey: 'not-in-shoot', category: 'birds', favourite: true }], []), /outside the active shoot/);
});

test('ambiguous IDs and keys fail closed without changing photographs', () => {
  assert.throws(() => benchmarkShoot([frames[0], { ...frames[1], id: frames[0].id }], labels.slice(0, 2), []), /Ambiguous/);
  assert.throws(() => benchmarkShoot([frames[0], { ...frames[1], stableKey: frames[0].stableKey }], labels.slice(0, 2), []), /Ambiguous/);
  assert.equal(frames[0].decision, 'unreviewed');
});
