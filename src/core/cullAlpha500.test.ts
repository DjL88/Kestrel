import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAutoCullDecisions, applyDecisionWithHistory, computeCullCounts,
  createDemoShootState, filterFrames, getDefaultComparePair, redoDecision,
  stepSelection, undoDecision,
} from './cullingEngine';

/**
 * Synthetic 500-photo Alpha journey. These simulated frames are not evidence of
 * real camera colour, subject/eye detection accuracy or real-shoot performance.
 * No disk writes, original files, cloud requests or edits are involved.
 */
function alphaShoot() {
  const demo = createDemoShootState(500);
  return {
    ...demo,
    frames: demo.frames.map((frame) => ({
      ...frame, isDemo: false, sourceKind: 'file' as const,
      stableKey: 'synthetic-local://' + frame.id,
    })),
  };
}

test('500-photo review: batch classification, manual overrides and full undo/redo retain every identity', () => {
  const original = alphaShoot();
  const ids = original.frames.map((frame) => frame.id);
  const originals = new Map(original.frames.map((frame) => [frame.id, frame.stableKey]));
  const requested = ids.map((frameId, index) => ({
    frameId, decision: index % 5 === 0 ? 'keep' as const : 'reject' as const,
  }));
  const classified = applyAutoCullDecisions(original, requested);
  assert.deepEqual(computeCullCounts(classified.frames), {
    all: 500, keep: 100, reject: 400, unreviewed: 0,
  });
  assert.equal(classified.undoStack.length, 1, 'one reversible batch');
  assert.equal(classified.undoStack[0].batch?.length, 500);
  const restored = undoDecision(classified);
  assert.deepEqual(computeCullCounts(restored.frames), {
    all: 500, keep: 0, reject: 0, unreviewed: 500,
  });
  const replayed = redoDecision(restored);
  assert.deepEqual(replayed.frames.map((frame) => frame.decision),
    classified.frames.map((frame) => frame.decision));
  assert.deepEqual(replayed.frames.map((frame) => frame.id), ids);
  assert.ok(replayed.frames.every((frame) => frame.stableKey === originals.get(frame.id)));
  assert.ok(replayed.frames.every((frame) => frame.removedAt === undefined));

  // A manual override is not silently replaced by the next automatic scan.
  const manuallyKept = applyDecisionWithHistory(replayed, ids[1], 'keep', { allowAdvance: false });
  const rescanned = applyAutoCullDecisions(manuallyKept, requested);
  assert.equal(rescanned.frames[1].decision, 'keep');
  assert.equal(undoDecision(manuallyKept).frames[1].decision, 'reject');
});

test('500-photo review: stale, conflicting and duplicate suggestions never alter protected frames', () => {
  const original = alphaShoot();
  const [removed, manual, ambiguous] = original.frames;
  const frames = original.frames.map((frame, index) => ({
    ...frame,
    ...(index === 0 ? { removedAt: 123 } : {}),
    ...(index === 1 ? { decision: 'keep' as const } : {}),
  }));
  frames[3] = { ...frames[3], id: ambiguous.id };
  const state = { ...original, frames };
  const updated = applyAutoCullDecisions(state, [
    { frameId: removed.id, decision: 'keep' },
    { frameId: manual.id, decision: 'reject' },
    { frameId: ambiguous.id, decision: 'keep' },
    { frameId: state.frames[4].id, decision: 'keep' },
    { frameId: state.frames[4].id, decision: 'reject' },
    { frameId: state.frames[5].id, decision: 'keep' },
  ]);
  for (const index of [0, 1, 2, 3, 4]) {
    assert.equal(updated.frames[index].decision, state.frames[index].decision);
  }
  assert.equal(updated.frames[0].removedAt, 123);
  assert.equal(updated.frames[5].decision, 'keep');
  assert.equal(updated.undoStack.at(-1)?.batch?.length, 1);
});

test('500-photo review: keyboard stepping and compare never mutate or remove originals', () => {
  const state = alphaShoot();
  const visible = filterFrames(state.frames, 'all');
  assert.equal(visible.length, 500);
  let selected: string | null = visible[0].id;
  for (let index = 1; index < 500; index += 1) {
    selected = stepSelection(visible, selected, 1);
    assert.equal(selected, visible[index].id);
  }
  assert.equal(stepSelection(visible, selected, 1), selected);
  for (let index = 498; index >= 0; index -= 1) {
    selected = stepSelection(visible, selected, -1);
    assert.equal(selected, visible[index].id);
  }
  const pair = getDefaultComparePair(visible, visible[249].id);
  assert.ok(pair.leftId && pair.rightId && pair.leftId !== pair.rightId);
  assert.equal(state.frames.length, 500);
  assert.ok(state.frames.every((frame) => frame.decision === 'unreviewed' && !frame.removedAt));
});
