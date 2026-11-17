import test from 'node:test';
import assert from 'node:assert/strict';
import { triageCullReview } from './cullReviewTriage';
import { limitAutoKeepers } from './autoCull';
import { createDemoShootState } from './cullingEngine';

test('epoch-zero removed keeper does not occupy a burst group', () => {
  const frames = [
    { id: 'removed', decision: 'keep' as const, removedAt: 0, burstGroupId: 'burst' },
    { id: 'candidate', decision: 'unreviewed' as const, burstGroupId: 'burst',
      suggestion: { decision: 'keep' as const, confidence: 'high' as const, score: 92 } },
  ];
  assert.deepEqual(triageCullReview(frames).map((f) => f.id), ['candidate']);
  assert.equal(triageCullReview(frames)[0].reason, 'suggestedKeep');
});

test('epoch-zero removed unreviewed frames never enter triage', () => {
  const frames = [
    { id: 'removed', decision: 'unreviewed' as const, removedAt: 0 },
    { id: 'active', decision: 'unreviewed' as const },
  ];
  assert.deepEqual(triageCullReview(frames).map((f) => f.id), ['active']);
});

test('epoch-zero removed frames cannot reserve or receive an automatic keeper slot', () => {
  const state = createDemoShootState(3);
  const [removed, candidate, alternate] = state.frames;
  const frames = [
    { ...removed, removedAt: 0, burstGroupId: 'same', decision: 'keep' as const, isDemo: false },
    { ...candidate, burstGroupId: 'same', decision: 'unreviewed' as const, isDemo: false },
    { ...alternate, removedAt: 0, decision: 'unreviewed' as const, isDemo: false },
  ];
  const suggestions = frames.map((f, i) => ({
    frameId: f.id, decision: 'keep' as const, confidence: 'high' as const,
    score: 99 - i, reason: 'clearDetail' as const,
  }));
  const output = limitAutoKeepers(suggestions, frames, 1);
  assert.equal(output[0].confidence, 'medium', 'removed existing keeper must not receive a new action');
  assert.equal(output[1].confidence, 'high', 'active candidate remains eligible');
  assert.equal(output[2].confidence, 'medium', 'removed candidate is never promoted');
  assert.deepEqual(frames.map((f) => f.removedAt), [0, undefined, 0], 'no catalogue mutations');
});
