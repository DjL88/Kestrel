import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCullGroundTruth, passesCullSafetyGate, type LabelledCullFrame } from './cullGroundTruth';

/** Compare just the expected release evidence fields without a Vitest dependency. */
function assertContains(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `Unexpected cull evidence field: ${key}`);
  }
}

const samples: LabelledCullFrame[] = [
  { id: 'osprey-1', truth: 'keep', subject: 'bird', predictedSubject: 'bird', suggestion: 'keep' },
  { id: 'helicopter-1', truth: 'reject', subject: 'aircraft', predictedSubject: 'aircraft', suggestion: 'review' },
  { id: 'tiny-bird', truth: 'keep', subject: 'bird', predictedSubject: 'unknown', suggestion: 'review' },
  { id: 'blurred-1', truth: 'reject', subject: 'other', suggestion: 'reject' },
];
describe('independent cull ground truth', () => {
  it('counts abstentions as safe for keeper recall without inventing a keep', () => {
    const result = evaluateCullGroundTruth(samples);
    assertContains(result, { total: 4, evaluated: 4, invalid: 0, abstained: 2, keeperCount: 2, keeperRecall: 1, falseRejects: 0, aircraftLabelledBird: 0 });
    assert.equal(passesCullSafetyGate(result, 4), true);
  });
  it('fails on any false rejection of a labelled keeper', () => {
    const changed = samples.map(frame => frame.id === 'tiny-bird' ? { ...frame, suggestion: 'reject' as const } : frame);
    const result = evaluateCullGroundTruth(changed);
    assert.equal(result.falseRejects, 1);
    assert.equal(result.keeperRecall, 0.5);
    assert.equal(passesCullSafetyGate(result, 4), false);
  });
  it('catches helicopter labelled bird even when the decision abstains', () => {
    const changed = samples.map(frame => frame.id === 'helicopter-1' ? { ...frame, predictedSubject: 'bird' as const } : frame);
    assert.equal(passesCullSafetyGate(evaluateCullGroundTruth(changed), 4), false);
  });
  it('excludes duplicate IDs instead of matching labels to the wrong image', () => {
    const result = evaluateCullGroundTruth([...samples, { ...samples[0], truth: 'reject' }]);
    assert.equal(result.invalid, 2);
    assert.equal(result.evaluated, 3);
    assert.equal(passesCullSafetyGate(result, 3), false);
  });
  it('separates explicit keeper recommendations from safe abstention', () => {
    const result = evaluateCullGroundTruth(samples);
    assert.equal(result.automaticKeeperRecall, 0.5);
    assert.equal(result.keeperRecall, 1);
    assert.equal(result.falseRejects, 0);
    assert.equal(result.falseKeeps, 0);
    assert.equal(result.nonKeeperCount, 2);
    assert.equal(result.falseKeepRate, 0);
  });
  it('does not count a safe review abstention as a false rejection', () => {
    const result = evaluateCullGroundTruth(samples);
    assert.equal(result.falseRejects, 0);
    assert.equal(result.falseRejectRate, 0);
    assert.equal(result.abstained, 2);
    assert.equal(result.automaticKeeperRecall, 0.5);
  });
  it('fails when an aircraft is automatically kept even without a bird misclassification', () => {
    const changed = samples.map(frame => frame.id === 'helicopter-1'
      ? { ...frame, suggestion: 'keep' as const } : frame);
    const result = evaluateCullGroundTruth(changed);
    assert.equal(result.falseKeeps, 1);
    assert.equal(result.aircraftLabelledBird, 0);
    assert.equal(passesCullSafetyGate(result, 4), false);
  });
  it('fails closed when an evaluation summary has missing or inconsistent counts', () => {
    const valid = evaluateCullGroundTruth(samples);
    assert.equal(passesCullSafetyGate({ ...valid, total: valid.total + 1 }, 4), false);
    assert.equal(passesCullSafetyGate({ ...valid, falseKeeps: 1 }, 4), false);
    assert.equal(passesCullSafetyGate({ ...valid, automaticKeeperRecall: null }, 4), false);
    assert.equal(passesCullSafetyGate({ ...valid, proposedKeep: valid.proposedKeep + 1 }, 4), false);
    assert.equal(passesCullSafetyGate({ ...valid, keeperRecall: 0.25 }, 4), false);
    assert.equal(passesCullSafetyGate({ ...valid, errors: ['hidden invalid row'] }, 4), false);
  });
  it('evaluates 500 deterministic synthetic frames without duplicate identity', () => {
    const frames: LabelledCullFrame[] = Array.from({ length: 500 }, (_, i) => ({
      id: `synthetic-${i}`,
      truth: i % 5 === 0 ? 'keep' : 'reject',
      subject: i % 5 === 0 ? 'bird' : i % 5 === 1 ? 'aircraft' : 'other',
      predictedSubject: i % 5 === 0 ? 'bird' : i % 5 === 1 ? 'aircraft' : 'other',
      suggestion: i % 5 === 0 ? (i % 10 === 0 ? 'keep' : 'review') : 'reject',
    }));
    const result = evaluateCullGroundTruth(frames);
    assertContains(result, { total: 500, evaluated: 500, keeperCount: 100, aircraftCount: 100, falseRejects: 0, falseKeeps: 0 });
    assert.equal(result.automaticKeeperRecall, 0.5);
    assert.equal(passesCullSafetyGate(result, 500), true);
    assert.equal(passesCullSafetyGate(evaluateCullGroundTruth([...frames, { ...frames[0] }]), 500), false);
  });
  it('rejects an all-Review keeper policy masquerading as perfect safety', () => {
    const allReview = samples.map(frame => frame.truth === 'keep'
      ? { ...frame, suggestion: 'review' as const } : frame);
    const result = evaluateCullGroundTruth(allReview);
    assert.equal(result.keeperRecall, 1);
    assert.equal(result.automaticKeeperRecall, 0);
    assert.equal(passesCullSafetyGate(result, 4), false);
  });
  it('requires explicit aircraft predictions, including honest unknown', () => {
    const missing = samples.map(frame => frame.subject === 'aircraft'
      ? { ...frame, predictedSubject: undefined } : frame);
    const result = evaluateCullGroundTruth(missing);
    assert.equal(result.aircraftPredictionsMissing, 1);
    assert.equal(result.aircraftLabelledBird, 0);
    assert.equal(passesCullSafetyGate(result, 4), false);
    const unknown = missing.map(frame => frame.subject === 'aircraft'
      ? { ...frame, predictedSubject: 'unknown' as const } : frame);
    const abstaining = evaluateCullGroundTruth(unknown);
    assert.equal(abstaining.aircraftClassificationCoverage, 0);
    assert.equal(abstaining.aircraftConditionalAccuracy, null);
    assert.equal(passesCullSafetyGate(abstaining, 4), false);
  });
  it('rejects manipulated aircraft rates and unsafe keeper coverage thresholds', () => {
    const valid = evaluateCullGroundTruth(samples);
    assert.equal(passesCullSafetyGate({ ...valid, aircraftBirdConfusionRate: 0.5 }, 4), false);
    assert.equal(passesCullSafetyGate({ ...valid, aircraftPredictionsMissing: 1 }, 4), false);
    assert.equal(passesCullSafetyGate(valid, 4, 0, 0), false);
    assert.equal(passesCullSafetyGate(valid, 4, 0, 0.75), false);
    assert.equal(passesCullSafetyGate(valid, 4, 0, 0.5), true);
  });
  it('reports aircraft coverage separately from accuracy and rejects all-abstain models', () => {
    const mixed = evaluateCullGroundTruth([
      ...samples,
      { id: 'aircraft-2', truth: 'reject', subject: 'aircraft', predictedSubject: 'unknown', suggestion: 'review' },
    ]);
    assert.equal(mixed.aircraftCount, 2);
    assert.equal(mixed.aircraftClassified, 1);
    assert.equal(mixed.aircraftAbstained, 1);
    assert.equal(mixed.aircraftClassificationCoverage, 0.5);
    assert.equal(mixed.aircraftConditionalAccuracy, 1);
    assert.equal(passesCullSafetyGate(mixed, 5), true);
    assert.equal(passesCullSafetyGate(mixed, 5, 0, 0.5, 0.75), false);
    assert.equal(passesCullSafetyGate({ ...mixed, aircraftClassificationCoverage: 1 }, 5), false);
    assert.equal(passesCullSafetyGate({ ...mixed, aircraftCorrectlyClassified: 2 }, 5), false);
  });
  it('rejects whitespace variants and noncanonical IDs before joining labels to predictions', () => {
    const collision = evaluateCullGroundTruth([
      ...samples, { ...samples[0], id: ' osprey-1 ' },
    ]);
    assert.equal(collision.invalid, 2);
    assert.equal(passesCullSafetyGate(collision, 3), false);
    const whitespace = evaluateCullGroundTruth([{ ...samples[0], id: ' bird-2 ' }]);
    assert.equal(whitespace.invalid, 1);
  });
  it('rejects corrupt fixtures and empty denominators', () => {
    const result = evaluateCullGroundTruth([{ ...samples[0], id: '' }, { ...samples[0], suggestion: 'maybe' as never }]);
    assert.equal(result.invalid, 2);
    assert.equal(result.keeperRecall, null);
    assert.equal(result.aircraftBirdConfusionRate, null);
    assert.equal(passesCullSafetyGate(result, 1), false);
    assert.equal(passesCullSafetyGate(evaluateCullGroundTruth(samples), 0), false);
  });
});
