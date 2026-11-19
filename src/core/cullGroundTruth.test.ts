import { describe, expect, it } from 'vitest';
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
  it('rejects corrupt fixtures and empty denominators', () => {
    const result = evaluateCullGroundTruth([{ ...samples[0], id: '' }, { ...samples[0], suggestion: 'maybe' as never }]);
    expect(result.invalid).toBe(2);
    expect(result.keeperRecall).toBeNull();
    expect(result.aircraftBirdConfusionRate).toBeNull();
    expect(passesCullSafetyGate(result, 1)).toBe(false);
    expect(passesCullSafetyGate(evaluateCullGroundTruth(samples), 0)).toBe(false);
  });
});
