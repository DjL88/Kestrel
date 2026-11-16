import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAutoCullDecisions, createDemoShootState, undoDecision, redoDecision } from './cullingEngine';

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


test('stale auto-cull batches cannot overwrite manual, removed or virtual-copy decisions', () => {
  const state = createDemoShootState(5);
  state.frames = state.frames.map((frame, index) => ({
    ...frame,
    isDemo: index === 3,
    virtualCopy: index === 4,
    decision: index === 0 ? 'keep' as const : index === 1 ? 'reject' as const : 'unreviewed' as const,
    ...(index === 2 ? { removedAt: Date.now() } : {}),
  }));
  const changed = applyAutoCullDecisions(state, state.frames.map((frame) => ({
    frameId: frame.id,
    decision: frame.decision === 'keep' ? 'reject' as const : 'keep' as const,
  })));
  assert.equal(changed, state, 'protected frames must not create a new undo entry');
});

test('a repeated consistent decision is applied once and remains undoable and redoable', () => {
  const state = createDemoShootState(2);
  state.frames = state.frames.map((frame) => ({ ...frame, isDemo: false }));
  const [first, second] = state.frames;
  const changed = applyAutoCullDecisions(state, [
    { frameId: first.id, decision: 'reject' },
    { frameId: first.id, decision: 'reject' },
    { frameId: second.id, decision: 'keep' },
    { frameId: 'missing-stale-photo', decision: 'reject' },
  ]);
  assert.deepEqual(changed.frames.map((frame) => frame.decision), ['reject', 'keep']);
  assert.equal(changed.undoStack.length, 1);
  assert.equal(changed.undoStack[0].batch?.length, 2);
  const restored = undoDecision(changed);
  assert.deepEqual(restored.frames.map((frame) => frame.decision), ['unreviewed', 'unreviewed']);
  const redone = redoDecision(restored);
  assert.deepEqual(redone.frames.map((frame) => frame.decision), ['reject', 'keep']);
});
