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
    ...(index === 4 ? { virtualCopy: { originalFrameId: state.frames[0].id, number: 1 } } : {}),
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

test('malformed runtime decisions cannot alter photos or create history', () => {
  const state = createDemoShootState(2);
  state.frames = state.frames.map((frame) => ({ ...frame, isDemo: false }));
  const id = state.frames[0].id;
  const malformed = [
    { frameId: id, decision: 'unreviewed' },
    { frameId: id, decision: 'delete' },
    { frameId: id, decision: null },
    { frameId: id, decision: undefined },
  ] as unknown as { frameId: string; decision: 'keep' | 'reject' }[];
  assert.equal(applyAutoCullDecisions(state, malformed), state);
  const valid = applyAutoCullDecisions(state, [
    ...malformed,
    { frameId: id, decision: 'keep' },
  ]);
  assert.equal(valid.frames[0].decision, 'keep');
  assert.equal(valid.frames[1].decision, 'unreviewed');
  assert.equal(valid.undoStack.length, 1);
  assert.equal(undoDecision(valid).frames[0].decision, 'unreviewed');
});

test('malformed null worker entries and invalid frame IDs do not interrupt valid decisions', () => {
  const state = createDemoShootState(2);
  state.frames = state.frames.map((frame) => ({ ...frame, isDemo: false }));
  const [first, second] = state.frames;
  const untrusted = [
    null,
    undefined,
    { decision: 'reject' },
    { frameId: null, decision: 'reject' },
    { frameId: {}, decision: 'reject' },
    { frameId: '', decision: 'reject' },
    { frameId: first.id, decision: 'keep' },
    { frameId: second.id, decision: 'reject' },
  ] as unknown as { frameId: string; decision: 'keep' | 'reject' }[];
  const changed = applyAutoCullDecisions(state, untrusted);
  assert.deepEqual(changed.frames.map((frame) => frame.decision), ['keep', 'reject']);
  assert.equal(changed.undoStack.length, 1);
  assert.deepEqual(undoDecision(changed).frames.map((frame) => frame.decision), ['unreviewed', 'unreviewed']);
});

test('ambiguous duplicate catalogue IDs cannot classify two photographs with one suggestion', () => {
  const state = createDemoShootState(3);
  state.frames = state.frames.map((frame) => ({ ...frame, isDemo: false }));
  const [first, second, third] = state.frames;
  // Simulate a damaged catalogue with distinct photographs sharing a persisted ID.
  state.frames[1] = { ...second, id: first.id };
  const changed = applyAutoCullDecisions(state, [
    { frameId: first.id, decision: 'reject' },
    { frameId: third.id, decision: 'keep' },
  ]);
  assert.deepEqual(changed.frames.map((frame) => frame.decision), ['unreviewed', 'unreviewed', 'keep']);
  assert.equal(changed.undoStack.length, 1);
  assert.equal(changed.undoStack[0].batch?.length, 1);
  assert.deepEqual(undoDecision(changed).frames.map((frame) => frame.decision), ['unreviewed', 'unreviewed', 'unreviewed']);

  const ambiguousOnly = applyAutoCullDecisions(state, [{ frameId: first.id, decision: 'keep' }]);
  assert.equal(ambiguousOnly, state, 'no changes or history for ambiguous IDs');
});
