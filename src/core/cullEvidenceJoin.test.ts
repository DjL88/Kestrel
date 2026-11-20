import { describe, expect, it } from 'vitest';
import { evaluateCullEvidence, type CullEvidenceBatch } from './cullEvidenceJoin';

const sha = (i: number) => i.toString(16).padStart(64, '0');
function fixture(count = 500): CullEvidenceBatch {
  const originals = Array.from({ length: count }, (_, i) => ({
    photoId: `z8-${i}`, sha256: sha(i + 1), byteLength: 45_000_000 + i,
  }));
  const labels = originals.map((o, i) => ({
    photoId: o.photoId, sha256: o.sha256,
    truth: (i % 5 === 0 ? 'keep' : 'reject') as 'keep' | 'reject',
    subject: (i % 5 === 0 ? 'bird' : i % 5 === 1 ? 'aircraft' : 'other') as 'bird' | 'aircraft' | 'other',
  }));
  const predictions = originals.map((o, i) => ({
    photoId: o.photoId, sha256: o.sha256, modelId: 'kestrel-local-onnx',
    modelVersion: '1.0.0',
    predictedSubject: (i % 5 === 0 ? 'bird' : i % 5 === 1 ? 'aircraft' : 'other') as 'bird' | 'aircraft' | 'other',
    suggestion: (i % 5 === 0 ? (i % 10 === 0 ? 'keep' : 'review') : 'reject') as 'keep' | 'review' | 'reject',
  }));
  return { originals, labels, predictions, expectedModelId: 'kestrel-local-onnx', expectedModelVersion: '1.0.0' };
}
describe('independent cull evidence joined by immutable original bytes', () => {
  it('joins a complete 500-photo synthetic evidence set without claiming field accuracy', () => {
    const report = evaluateCullEvidence(fixture());
    expect(report).toMatchObject({ accepted: true, evaluated: 500, passesSafetyGate: true });
    expect(report.evaluation).toMatchObject({
      keeperCount: 100, aircraftCount: 100, falseRejects: 0, falseKeeps: 0,
      aircraftClassificationCoverage: 1, automaticKeeperRecall: 0.5,
    });
  });
  it('fails closed if a model result points at a different same-name original', () => {
    const batch = fixture(5);
    batch.predictions[0].sha256 = batch.originals[1].sha256;
    const result = evaluateCullEvidence(batch, 5);
    expect(result.accepted).toBe(false);
    expect(result.evaluated).toBe(0);
    expect(result.evaluation).toBeNull();
  });
  it('rejects duplicate photo IDs, duplicate original hashes and orphan predictions', () => {
    const duplicateId = fixture(5);
    duplicateId.originals[1].photoId = duplicateId.originals[0].photoId;
    expect(evaluateCullEvidence(duplicateId, 5).accepted).toBe(false);
    const duplicateHash = fixture(5);
    duplicateHash.originals[1].sha256 = duplicateHash.originals[0].sha256;
    expect(evaluateCullEvidence(duplicateHash, 5).accepted).toBe(false);
    const orphan = fixture(5);
    orphan.predictions[1].photoId = 'unknown-file';
    expect(evaluateCullEvidence(orphan, 5).accepted).toBe(false);
  });
  it('refuses mixed model versions, empty provenance and invalid hashes', () => {
    const stale = fixture(5);
    stale.predictions[0].modelVersion = 'older';
    expect(evaluateCullEvidence(stale, 5).accepted).toBe(false);
    const missing = fixture(5);
    missing.expectedModelVersion = '';
    expect(evaluateCullEvidence(missing, 5).accepted).toBe(false);
    const invalid = fixture(5);
    invalid.originals[0].sha256 = 'not-a-sha';
    expect(evaluateCullEvidence(invalid, 5).accepted).toBe(false);
  });
  it('prevents unknown subject from being automatically rejected', () => {
    const batch = fixture(5);
    batch.predictions[0].predictedSubject = 'unknown';
    batch.predictions[0].suggestion = 'reject';
    expect(evaluateCullEvidence(batch, 5).accepted).toBe(false);
    batch.predictions[0].suggestion = 'review';
    expect(evaluateCullEvidence(batch, 5).accepted).toBe(true);
  });
  it('separates evidence completeness from actual release quality', () => {
    const batch = fixture(500);
    batch.predictions[1].predictedSubject = 'bird'; // aircraft incorrectly called bird
    const report = evaluateCullEvidence(batch);
    expect(report.accepted).toBe(true);
    expect(report.passesSafetyGate).toBe(false);
    expect(report.evaluation?.aircraftLabelledBird).toBe(1);
  });
  it('rejects missing predictions rather than silently shrinking the denominator', () => {
    const batch = fixture(500);
    batch.predictions.pop();
    expect(evaluateCullEvidence(batch).accepted).toBe(false);
  });
  it('does not accept a synthetic five-frame sample as a 500-photo release gate', () => {
    const report = evaluateCullEvidence(fixture(5));
    expect(report.accepted).toBe(true);
    expect(report.passesSafetyGate).toBe(false);
  });
});
