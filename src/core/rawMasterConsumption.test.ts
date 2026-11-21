import { describe } from 'node:test';
import { expect, it } from './testExpect';
import { acceptRawMaster, type MasterRequest } from './rawMasterHandoff';
import { consumeVerifiedMaster, type OriginalIdentity, type MasterConsumptionAdapter } from './rawMasterConsumption';
import type { RawMasterEvidence } from './rawMasterProvenance';

const hash = 'a'.repeat(64);
const request: MasterRequest = { sourceId: 'bird-1', generation: 4, expectedOriginalSha256: hash, expectedWidth: 8256, expectedHeight: 5504 };
const evidence: RawMasterEvidence = {
  originalSha256: hash, decoderId: 'verified-native', decoderVersion: '1', codec: 'sensor',
  compression: 'lossless', rightsVerified: true, sensorDerived: true,
  intermediate: 'sensor-rgb16', sourceBitsPerChannel: 14, outputBitsPerChannel: 16,
  width: 8256, height: 5504, iccProfileId: 'verified-rgb',
  colourTransformVerified: true, referenceTestVerified: true,
};
const verified = acceptRawMaster(request, {
  sourceId: 'bird-1', generation: 4, verifiedOriginalSha256: hash, evidence,
});
const identity = (): OriginalIdentity => ({ sourceId: request.sourceId, generation: request.generation, originalSha256: hash });
function fixture() {
  let current = identity();
  let reads = 0, prepared = 0, commits = 0, discarded = 0;
  const adapter: MasterConsumptionAdapter<{ id: string }> = {
    async readOriginalIdentity() { reads++; return { ...current }; },
    async prepare() { prepared++; return { id: 'private-staging' }; },
    async commit() { commits++; },
    async discard() { discarded++; },
  };
  return { adapter, setIdentity: (next: OriginalIdentity) => { current = next; },
    get counts() { return { reads, prepared, commits, discarded }; } };
}
describe('verified high-precision master consumption fence', () => {
  it('stages, rehashes and commits only a verified unchanged original', async () => {
    const f = fixture();
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: true });
    expect(f.counts).toEqual({ reads: 2, prepared: 1, commits: 1, discarded: 1 });
  });
  it('never opens an output for provisional JPEG or blocked evidence', async () => {
    const f = fixture();
    expect(await consumeVerifiedMaster(acceptRawMaster(request), request, f.adapter)).toEqual({ ok: false, reason: 'unverified-master' });
    expect(f.counts).toEqual({ reads: 0, prepared: 0, commits: 0, discarded: 0 });
  });
  it('rejects replaced original before preparing output', async () => {
    const f = fixture();
    f.setIdentity({ ...identity(), originalSha256: 'b'.repeat(64) });
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: false, reason: 'original-changed' });
    expect(f.counts.commits).toBe(0);
    expect(f.counts.prepared).toBe(0);
  });
  it('discards staged output if original changes during rendering', async () => {
    const f = fixture();
    f.adapter.prepare = async () => {
      f.setIdentity({ ...identity(), originalSha256: 'b'.repeat(64) });
      return { id: 'private-staging' };
    };
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: false, reason: 'original-changed' });
    expect(f.counts.commits).toBe(0);
    expect(f.counts.discarded).toBe(1);
  });
  it('fails closed when catalogue photo generation changes', async () => {
    const f = fixture();
    f.setIdentity({ ...identity(), generation: 5 });
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: false, reason: 'original-changed' });
    expect(f.counts.commits).toBe(0);
  });
  it('cancels without staging or committing', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await consumeVerifiedMaster(verified, request, f.adapter, controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
    expect(f.counts.prepared).toBe(0);
  });
  it('cancels and discards after staging, before final publication', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.adapter.prepare = async () => { controller.abort(); return { id: 'private-staging' }; };
    expect(await consumeVerifiedMaster(verified, request, f.adapter, controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
    expect(f.counts.commits).toBe(0);
    expect(f.counts.discarded).toBe(1);
  });
  it('discards staged output on commit failure without claiming success', async () => {
    const f = fixture();
    f.adapter.commit = async () => { throw new Error('disk full'); };
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: false, reason: 'commit-failed' });
    expect(f.counts.discarded).toBe(1);
  });
  it('reports a successful atomic publication even if staging cleanup fails', async () => {
    const f = fixture();
    f.adapter.discard = async () => { throw new Error('staging cleanup denied'); };
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: true, cleanupFailed: true });
    expect(f.counts.commits).toBe(1);
  });
  it('preserves a failed commit when staging cleanup also fails', async () => {
    const f = fixture();
    f.adapter.commit = async () => { throw new Error('destination full'); };
    f.adapter.discard = async () => { throw new Error('staging cleanup denied'); };
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: false, reason: 'commit-failed', cleanupFailed: true });
    expect(f.counts.commits).toBe(0);
  });
  it('never commits after original mismatch even when cleanup fails', async () => {
    const f = fixture();
    f.adapter.prepare = async () => { f.setIdentity({ ...identity(), originalSha256: 'b'.repeat(64) }); return { id: 'staged' }; };
    f.adapter.discard = async () => { throw new Error('staging cleanup denied'); };
    expect(await consumeVerifiedMaster(verified, request, f.adapter)).toEqual({ ok: false, reason: 'original-changed', cleanupFailed: true });
    expect(f.counts.commits).toBe(0);
  });
});
