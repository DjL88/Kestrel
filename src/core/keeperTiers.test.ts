import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoShootState } from './cullingEngine';
import type { CullSuggestion } from './autoCull';
import type { PhotoFrame } from './types';
import { planKeeperTier } from './keeperTiers';

function fixture() {
  const frames: PhotoFrame[] = createDemoShootState(8).frames.map((frame, i) => ({
    ...frame, isDemo: false, burstGroupId: i < 3 ? 'burst-a' : null,
    decision: i === 0 ? 'keep' as const : 'unreviewed' as const,
  }));
  const results: CullSuggestion[] = [
    { frameId: frames[1].id, decision: 'keep', confidence: 'medium', score: 92, reason: 'subjectOk' },
    { frameId: frames[2].id, decision: 'keep', confidence: 'medium', score: 80, reason: 'subjectOk' },
    { frameId: frames[3].id, decision: 'keep', confidence: 'medium', score: 85, reason: 'someDetail' },
    { frameId: frames[4].id, decision: 'keep', confidence: 'medium', score: 62, reason: 'subjectOk' },
    { frameId: frames[5].id, decision: null, confidence: 'low', score: 99, reason: 'noSubject' },
    { frameId: frames[6].id, decision: 'reject', confidence: 'high', score: 100, reason: 'duplicate' },
    { frameId: frames[7].id, decision: 'keep', confidence: 'high', score: 95, reason: 'clearDetail' },
  ];
  return { frames, results };
}

test('Best is strict; Better and Good offer progressively broader, not forced, suggestions', () => {
  const { frames, results } = fixture();
  assert.deepEqual(planKeeperTier(results, frames, 5, 'best').map((c) => c.frameId), [frames[7].id]);
  assert.deepEqual(planKeeperTier(results, frames, 5, 'better').map((c) => c.frameId),
    [frames[7].id, frames[3].id], 'existing burst keeper must exclude other burst frames');
  assert.deepEqual(planKeeperTier(results, frames, 5, 'good').map((c) => c.frameId),
    [frames[7].id, frames[3].id, frames[4].id]);
});

test('never exceeds the keeper target, invents a keeper from weak suggestions or accepts old rejects', () => {
  const { frames, results } = fixture();
  assert.equal(planKeeperTier(results, frames, 1, 'good').length, 0);
  assert.equal(planKeeperTier(results, frames, 2, 'good').length, 1);
  assert.equal(planKeeperTier(results, frames, Number.NaN, 'good').length, 0);
  assert.ok(planKeeperTier(results, frames, 99, 'good').every((c) => c.decision === 'keep'));
  assert.ok(!planKeeperTier(results, frames, 99, 'good').some((c) => c.frameId === frames[5].id || c.frameId === frames[6].id));
});

test('manual decisions, removed photos, virtual copies and duplicate frame IDs are never overwritten', () => {
  const { frames, results } = fixture();
  frames[3].decision = 'reject';
  frames[4].removedAt = 1;
  frames[7].virtualCopy = { originalFrameId: frames[0].id, number: 1 };
  assert.deepEqual(planKeeperTier(results, frames, 5, 'good'), []);
  const duplicate = [frames[0], { ...frames[0] }];
  assert.deepEqual(planKeeperTier(results, duplicate, 8, 'good'), []);
});

test('suggestions are deterministic across shuffled score ties and duplicate result rows', () => {
  const { frames } = fixture();
  const options: CullSuggestion[] = [3, 4, 7].map((index) => ({
    frameId: frames[index].id, decision: 'keep', confidence: 'medium', score: 80, reason: 'someDetail',
  }));
  const forward = planKeeperTier(options, frames, 3, 'better');
  assert.deepEqual(planKeeperTier([...options].reverse(), frames, 3, 'better'), forward);
  assert.deepEqual(planKeeperTier([...options, options[0]], frames, 3, 'better'), forward);
});
