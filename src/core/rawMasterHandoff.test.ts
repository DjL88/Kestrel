import { describe, it, expect } from 'vitest';
import { acceptRawMaster, mayUseMaster, type MasterCandidate, type MasterRequest } from './rawMasterHandoff';
import type { RawMasterEvidence } from './rawMasterProvenance';

const sha = 'a'.repeat(64);
const request: MasterRequest = { sourceId: 'photo-1', generation: 4, expectedOriginalSha256: sha, expectedWidth: 8256, expectedHeight: 5504 };
const evidence: RawMasterEvidence = {
  originalSha256: sha, decoderId: 'native-decoder', decoderVersion: '1', codec: 'verified-sensor',
  compression: 'lossless', rightsVerified: true, sensorDerived: true,
  intermediate: 'sensor-rgb16', sourceBitsPerChannel: 14, outputBitsPerChannel: 16,
  width: 8256, height: 5504, iccProfileId: 'verified-rgb', colourTransformVerified: true,
  referenceTestVerified: true,
};
const candidate: MasterCandidate = { sourceId: 'photo-1', generation: 4, verifiedOriginalSha256: sha, evidence };
const copy = (changes: Partial<MasterCandidate> = {}, e: Partial<RawMasterEvidence> = {}): MasterCandidate =>
  ({ ...candidate, ...changes, evidence: { ...evidence, ...e } });

describe('RAW edit-master handoff', () => {
  it('keeps an absent master explicitly preview-only', () => {
    const result = acceptRawMaster(request);
    expect(result.state).toBe('preview-only');
    expect(mayUseMaster(result, request)).toBe(false);
  });
  it('accepts independently verified sensor pixels with matching original identity', () => {
    const result = acceptRawMaster(request, copy());
    expect(result.state).toBe('verified');
    expect(mayUseMaster(result, request)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.state === 'verified') expect(Object.isFrozen(result.evidence)).toBe(true);
  });
  it.each([
    ['different catalogue photo', { sourceId: 'photo-2' }, {}],
    ['stale generation', { generation: 3 }, {}],
    ['changed original', { verifiedOriginalSha256: 'b'.repeat(64) }, {}],
    ['unbound decoder hash', {}, { originalSha256: 'b'.repeat(64) }],
    ['eight-bit JPEG', {}, { intermediate: 'jpeg8', sourceBitsPerChannel: 8 }],
    ['preview pixels', {}, { intermediate: 'preview' }],
    ['unverified rights', {}, { rightsVerified: false }],
    ['unverified colour', {}, { colourTransformVerified: false }],
    ['unverified reference', {}, { referenceTestVerified: false }],
    ['wrong dimensions', {}, { width: 1024 }],
  ] as const)('blocks %s', (_label, changes, e) => {
    const result = acceptRawMaster(request, copy(changes, e));
    expect(result.state).toBe('blocked');
    expect(mayUseMaster(result, request)).toBe(false);
  });
  it('rejects invalid catalogue identity and import fingerprint', () => {
    expect(acceptRawMaster({ ...request, sourceId: '' }, candidate).state).toBe('blocked');
    expect(acceptRawMaster({ ...request, expectedOriginalSha256: '' }, candidate).state).toBe('blocked');
    expect(acceptRawMaster({ ...request, generation: -1 }, candidate).state).toBe('blocked');
  });
  it('revokes eligibility when original or generation changes after handoff', () => {
    const master = acceptRawMaster(request, copy());
    expect(mayUseMaster(master, { ...request, expectedOriginalSha256: 'b'.repeat(64) })).toBe(false);
    expect(mayUseMaster(master, { ...request, generation: 5 })).toBe(false);
    expect(mayUseMaster(master, { ...request, sourceId: 'photo-2' })).toBe(false);
  });
  it('does not trust an unverified Nikon HE* decode', () => {
    const result = acceptRawMaster(request, copy({}, { compression: 'nikon-he-star', rightsVerified: false, referenceTestVerified: false }));
    expect(result.state).toBe('blocked');
  });
});
