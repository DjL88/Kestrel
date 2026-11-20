import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(report.accepted, true);
    assert.equal(report.evaluated, 500);
    assert.equal(report.passesSafetyGate, true);
    assert.ok(report.evaluation);
    assert.equal(report.evaluation.keeperCount, 100);
    assert.equal(report.evaluation.aircraftCount, 100);
    assert.equal(report.evaluation.falseRejects, 0);
    assert.equal(report.evaluation.falseKeeps, 0);
    assert.equal(report.evaluation.aircraftClassificationCoverage, 1);
    assert.equal(report.evaluation.automaticKeeperRecall, 0.5);
  });
  it('fails closed if a model result points at a different same-name original', () => {
    const batch = fixture(5);
    batch.predictions[0].sha256 = batch.originals[1].sha256;
    const result = evaluateCullEvidence(batch, 5);
    assert.equal(result.accepted, false);
    assert.equal(result.evaluated, 0);
    assert.equal(result.evaluation, null);
  });
  it('rejects duplicate photo IDs, duplicate original hashes and orphan predictions', () => {
    const duplicateId = fixture(5);
    duplicateId.originals[1].photoId = duplicateId.originals[0].photoId;
    assert.equal(evaluateCullEvidence(duplicateId, 5).accepted, false);
    const duplicateHash = fixture(5);
    duplicateHash.originals[1].sha256 = duplicateHash.originals[0].sha256;
    assert.equal(evaluateCullEvidence(duplicateHash, 5).accepted, false);
    const orphan = fixture(5);
    orphan.predictions[1].photoId = 'unknown-file';
    assert.equal(evaluateCullEvidence(orphan, 5).accepted, false);
  });
  it('refuses mixed model versions, empty provenance and invalid hashes', () => {
    const stale = fixture(5);
    stale.predictions[0].modelVersion = 'older';
    assert.equal(evaluateCullEvidence(stale, 5).accepted, false);
    const missing = fixture(5);
    missing.expectedModelVersion = '';
    assert.equal(evaluateCullEvidence(missing, 5).accepted, false);
    const invalid = fixture(5);
    invalid.originals[0].sha256 = 'not-a-sha';
    assert.equal(evaluateCullEvidence(invalid, 5).accepted, false);
  });
  it('prevents unknown subject from being automatically rejected', () => {
    const batch = fixture(5);
    batch.predictions[0].predictedSubject = 'unknown';
    batch.predictions[0].suggestion = 'reject';
    assert.equal(evaluateCullEvidence(batch, 5).accepted, false);
    batch.predictions[0].suggestion = 'review';
    assert.equal(evaluateCullEvidence(batch, 5).accepted, true);
  });
  it('separates evidence completeness from actual release quality', () => {
    const batch = fixture(500);
    batch.predictions[1].predictedSubject = 'bird'; // aircraft incorrectly called bird
    const report = evaluateCullEvidence(batch);
    assert.equal(report.accepted, true);
    assert.equal(report.passesSafetyGate, false);
    assert.equal(report.evaluation?.aircraftLabelledBird, 1);
  });
  it('rejects missing predictions rather than silently shrinking the denominator', () => {
    const batch = fixture(500);
    batch.predictions = batch.predictions.slice(0, -1);
    assert.equal(evaluateCullEvidence(batch).accepted, false);
  });
  it('rejects whitespace-colliding identities and invalid byte lengths', () => {
    const collision = fixture(5);
    collision.labels[0].photoId = ' z8-0 ';
    assert.equal(evaluateCullEvidence(collision, 5).accepted, false);
    const invalidBytes = fixture(5);
    invalidBytes.originals[0].byteLength = Number.NaN;
    assert.equal(evaluateCullEvidence(invalidBytes, 5).accepted, false);
  });
  it('does not accept a synthetic five-frame sample as a 500-photo release gate', () => {
    const report = evaluateCullEvidence(fixture(5));
    assert.equal(report.accepted, true);
    assert.equal(report.passesSafetyGate, false);
  });
});
