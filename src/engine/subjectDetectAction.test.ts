import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSubjectDetectAction, type DetectedSubject } from './subjectDetectAction.ts';

const sharpBird: DetectedSubject = { detection: { label: 'bird', classId: 1, score: 0.8, box: { x: 10, y: 10, w: 200, h: 180 } }, sharpness: 20, coverage: 0.3 };
const softBird: DetectedSubject = { detection: { label: 'bird', classId: 1, score: 0.5, box: { x: 10, y: 10, w: 130, h: 120 } }, sharpness: 6, coverage: 0.05 };
const sharpAircraft: DetectedSubject = { detection: { label: 'airplane', classId: 4, score: 0.9, box: { x: 0, y: 0, w: 300, h: 100 } }, sharpness: 22, coverage: 0.4 };

describe('runSubjectDetectAction', () => {
  it('trusts a real, sharp, confident detection as a subject', async () => {
    const result = await runSubjectDetectAction({ frameId: 'f1', detect: async () => sharpBird });
    assert.equal(result.trust.decision, 'keep');
    assert.equal(result.trust.reason, 'subjectSharp');
    assert.equal(result.finding, sharpBird);
  });

  it('does not trust a weak/soft detection as a subject', async () => {
    const result = await runSubjectDetectAction({ frameId: 'f2', detect: async () => softBird });
    assert.equal(result.trust.decision, null);
    assert.equal(result.trust.reason, 'subjectSoft');
  });

  it('reports no finding and no trust when nothing is detected', async () => {
    const result = await runSubjectDetectAction({ frameId: 'f3', detect: async () => null });
    assert.equal(result.finding, null);
    assert.equal(result.trust.reason, 'noSubject');
    assert.deepEqual(result.corroboration, { state: 'unverified' });
  });

  it('corroborates agreement between the detector and a given vision description', async () => {
    const result = await runSubjectDetectAction({ frameId: 'f4', detect: async () => sharpBird, visionDescription: 'A kestrel perched on a fence post.' });
    assert.deepEqual(result.corroboration, { state: 'agreed', subject: 'bird' });
  });

  it('flags a conflict when the detector and the vision description name different kinds', async () => {
    const result = await runSubjectDetectAction({ frameId: 'f5', detect: async () => sharpAircraft, visionDescription: 'A bird flying low over a field.' });
    assert.equal(result.corroboration.state, 'conflict');
  });

  it('is unverified (not a failure) when no vision description is given at all', async () => {
    const result = await runSubjectDetectAction({ frameId: 'f6', detect: async () => sharpBird });
    assert.deepEqual(result.corroboration, { state: 'unverified' });
  });
});
