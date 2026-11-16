import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAutoCullDecisions, createDemoShootState, undoDecision } from './cullingEngine';

test('conflicting auto-cull suggestions never change a photo, regardless of order', () => {
  for (const reversed of [false, true]) {
    const state = createDemoShootState(3);
    state.frames = state.frames.map((frame) => ({ ...frame, isDemo: false }));
    const [first, second] = state.frames;
    const conflict = [
      { frameId: first.id, decision: 'keep' as const },
      { frameId: first.id, decision: 'reject' as const },
    ];
    const changed = applyAutoCullDecisions(state, [
      ...(reversed ? conflict.reverse() : conflict),
      { frameId: second.id, decision: 'keep' },
    ]);
    assert.equal(changed.frames[0].decision, 'unreviewed');
    assert.equal(changed.frames[1].decision, 'keep');
    assert.equal(changed.undoStack.length, 1);
    const restored = undoDecision(changed);
    assert.equal(restored.frames[0].decision, 'unreviewed');
    assert.equal(restored.frames[1].decision, 'unreviewed');
  }
});

test('only conflicting suggestions are ignored, including three-way repetition', () => {
  const state = createDemoShootState(2);
  state.frames = state.frames.map((frame) => ({ ...frame, isDemo: false }));
  const id = state.frames[0].id;
  const changed = applyAutoCullDecisions(state, [
    { frameId: id, decision: 'keep' },
    { frameId: id, decision: 'reject' },
    { frameId: id, decision: 'keep' },
  ]);
  assert.equal(changed, state);
});
