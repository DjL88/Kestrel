import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// This project runs tests with node:test (see package.json); these are the only matchers the file needs.
const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toBeNull: () => assert.equal(actual, null),
  toMatchObject: (expected: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(expected)) assert.deepEqual((actual as Record<string, unknown>)[key], value, key);
  },
});
import { evaluateCullGroundTruth, passesCullSafetyGate, type LabelledCullFrame } from './cullGroundTruth';

const samples: LabelledCullFrame[] = [
  { id: 'osprey-1', truth: 'keep', subject: 'bird', predictedSubject: 'bird', suggestion: 'keep' },
  { id: 'helicopter-1', truth: 'reject', subject: 'aircraft', predictedSubject: 'aircraft', suggestion: 'review' },
  { id: 'tiny-bird', truth: 'keep', subject: 'bird', predictedSubject: 'unknown', suggestion: 'review' },
  { id: 'blurred-1', truth: 'reject', subject: 'other', suggestion: 'reject' },
];
describe('independent cull ground truth', () => {
  it('counts abstentions as safe for keeper recall without inventing a keep', () => {
    const result = evaluateCullGroundTruth(samples);
    expect(result).toMatchObject({ total: 4, evaluated: 4, invalid: 0, abstained: 2, keeperCount: 2, keeperRecall: 1, falseRejects: 0, aircraftLabelledBird: 0 });
    expect(passesCullSafetyGate(result, 4)).toBe(true);
  });
  it('fails on any false rejection of a labelled keeper', () => {
    const changed = samples.map(frame => frame.id === 'tiny-bird' ? { ...frame, suggestion: 'reject' as const } : frame);
    const result = evaluateCullGroundTruth(changed);
    expect(result.falseRejects).toBe(1);
    expect(result.keeperRecall).toBe(0.5);
    expect(passesCullSafetyGate(result, 4)).toBe(false);
  });
  it('catches helicopter labelled bird even when the decision abstains', () => {
    const changed = samples.map(frame => frame.id === 'helicopter-1' ? { ...frame, predictedSubject: 'bird' as const } : frame);
    expect(passesCullSafetyGate(evaluateCullGroundTruth(changed), 4)).toBe(false);
  });
  it('excludes duplicate IDs instead of matching labels to the wrong image', () => {
    const result = evaluateCullGroundTruth([...samples, { ...samples[0], truth: 'reject' }]);
    expect(result.invalid).toBe(2);
    expect(result.evaluated).toBe(3);
    expect(passesCullSafetyGate(result, 3)).toBe(false);
  });
  it('separates explicit keeper recommendations from safe abstention', () => {
    const result = evaluateCullGroundTruth(samples);
    expect(result.automaticKeeperRecall).toBe(0.5);
    expect(result.keeperRecall).toBe(1);
    expect(result.falseRejects).toBe(0);
    expect(result.falseKeeps).toBe(0);
    expect(result.nonKeeperCount).toBe(2);
    expect(result.falseKeepRate).toBe(0);
  });
  it('does not count a safe review abstention as a false rejection', () => {
    const result = evaluateCullGroundTruth(samples);
    expect(result.falseRejects).toBe(0);
    expect(result.falseRejectRate).toBe(0);
    expect(result.abstained).toBe(2);
    expect(result.automaticKeeperRecall).toBe(0.5);
  });
  it('fails when an aircraft is automatically kept even without a bird misclassification', () => {
    const changed = samples.map(frame => frame.id === 'helicopter-1'
      ? { ...frame, suggestion: 'keep' as const } : frame);
    const result = evaluateCullGroundTruth(changed);
    expect(result.falseKeeps).toBe(1);
    expect(result.aircraftLabelledBird).toBe(0);
    expect(passesCullSafetyGate(result, 4)).toBe(false);
  });
  it('fails closed when an evaluation summary has missing or inconsistent counts', () => {
    const valid = evaluateCullGroundTruth(samples);
    expect(passesCullSafetyGate({ ...valid, total: valid.total + 1 }, 4)).toBe(false);
    expect(passesCullSafetyGate({ ...valid, falseKeeps: 1 }, 4)).toBe(false);
    expect(passesCullSafetyGate({ ...valid, automaticKeeperRecall: null }, 4)).toBe(false);
    expect(passesCullSafetyGate({ ...valid, proposedKeep: valid.proposedKeep + 1 }, 4)).toBe(false);
    expect(passesCullSafetyGate({ ...valid, keeperRecall: 0.25 }, 4)).toBe(false);
    expect(passesCullSafetyGate({ ...valid, errors: ['hidden invalid row'] }, 4)).toBe(false);
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
    expect(result).toMatchObject({ total: 500, evaluated: 500, keeperCount: 100, aircraftCount: 100, falseRejects: 0, falseKeeps: 0 });
    expect(result.automaticKeeperRecall).toBe(0.5);
    expect(passesCullSafetyGate(result, 500)).toBe(true);
    expect(passesCullSafetyGate(evaluateCullGroundTruth([...frames, { ...frames[0] }]), 500)).toBe(false);
  });
  it('rejects an all-Review keeper policy masquerading as perfect safety', () => {
    const allReview = samples.map(frame => frame.truth === 'keep'
      ? { ...frame, suggestion: 'review' as const } : frame);
    const result = evaluateCullGroundTruth(allReview);
    expect(result.keeperRecall).toBe(1);
    expect(result.automaticKeeperRecall).toBe(0);
    expect(passesCullSafetyGate(result, 4)).toBe(false);
  });
  it('requires explicit aircraft predictions, including honest unknown', () => {
    const missing = samples.map(frame => frame.subject === 'aircraft'
      ? { ...frame, predictedSubject: undefined } : frame);
    const result = evaluateCullGroundTruth(missing);
    expect(result.aircraftPredictionsMissing).toBe(1);
    expect(result.aircraftLabelledBird).toBe(0);
    expect(passesCullSafetyGate(result, 4)).toBe(false);
    const unknown = missing.map(frame => frame.subject === 'aircraft'
      ? { ...frame, predictedSubject: 'unknown' as const } : frame);
    const abstaining = evaluateCullGroundTruth(unknown);
    expect(abstaining.aircraftClassificationCoverage).toBe(0);
    expect(abstaining.aircraftConditionalAccuracy).toBeNull();
    expect(passesCullSafetyGate(abstaining, 4)).toBe(false);
  });
  it('rejects manipulated aircraft rates and unsafe keeper coverage thresholds', () => {
    const valid = evaluateCullGroundTruth(samples);
    expect(passesCullSafetyGate({ ...valid, aircraftBirdConfusionRate: 0.5 }, 4)).toBe(false);
    expect(passesCullSafetyGate({ ...valid, aircraftPredictionsMissing: 1 }, 4)).toBe(false);
    expect(passesCullSafetyGate(valid, 4, 0, 0)).toBe(false);
    expect(passesCullSafetyGate(valid, 4, 0, 0.75)).toBe(false);
    expect(passesCullSafetyGate(valid, 4, 0, 0.5)).toBe(true);
  });
  it('reports aircraft coverage separately from accuracy and rejects all-abstain models', () => {
    const mixed = evaluateCullGroundTruth([
      ...samples,
      { id: 'aircraft-2', truth: 'reject', subject: 'aircraft', predictedSubject: 'unknown', suggestion: 'review' },
    ]);
    expect(mixed.aircraftCount).toBe(2);
    expect(mixed.aircraftClassified).toBe(1);
    expect(mixed.aircraftAbstained).toBe(1);
    expect(mixed.aircraftClassificationCoverage).toBe(0.5);
    expect(mixed.aircraftConditionalAccuracy).toBe(1);
    expect(passesCullSafetyGate(mixed, 5)).toBe(true);
    expect(passesCullSafetyGate(mixed, 5, 0, 0.5, 0.75)).toBe(false);
    expect(passesCullSafetyGate({ ...mixed, aircraftClassificationCoverage: 1 }, 5)).toBe(false);
    expect(passesCullSafetyGate({ ...mixed, aircraftCorrectlyClassified: 2 }, 5)).toBe(false);
  });
  it('rejects whitespace variants and noncanonical IDs before joining labels to predictions', () => {
    const collision = evaluateCullGroundTruth([
      ...samples, { ...samples[0], id: ' osprey-1 ' },
    ]);
    expect(collision.invalid).toBe(2);
    expect(passesCullSafetyGate(collision, 3)).toBe(false);
    const whitespace = evaluateCullGroundTruth([{ ...samples[0], id: ' bird-2 ' }]);
    expect(whitespace.invalid).toBe(1);
  });
  it('rejects corrupt fixtures and empty denominators', () => {
    const result = evaluateCullGroundTruth([{ ...samples[0], id: '' }, { ...samples[0], suggestion: 'maybe' as never }]);
    expect(result.invalid).toBe(2);
    expect(result.keeperRecall).toBeNull();
    expect(result.aircraftBirdConfusionRate).toBeNull();
    expect(passesCullSafetyGate(result, 1)).toBe(false);
    expect(passesCullSafetyGate(evaluateCullGroundTruth(samples), 0)).toBe(false);
  });
});
