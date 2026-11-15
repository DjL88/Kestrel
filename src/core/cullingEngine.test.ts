import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDecisionWithHistory,
  assignBurstGroups,
  computeCullCounts,
  createDemoShootState,
  filterFrames,
  generateDemoShootFrames,
  getDefaultComparePair,
  redoDecision,
  stepSelection,
  undoDecision,
} from './cullingEngine';

test('generateDemoShootFrames creates 500 deterministic frames with burst groups', () => {
  const framesA = generateDemoShootFrames(500);
  const framesB = generateDemoShootFrames(500);

  assert.equal(framesA.length, 500);
  assert.equal(framesA[0].filename, framesB[0].filename);
  assert.equal(framesA[250].stableKey, framesB[250].stableKey);

  const burstFrames = framesA.filter((f) => f.burstGroupId !== null);
  assert.ok(burstFrames.length > 300, 'Expected majority of demo shoot to be bursts');
  assert.ok(framesA.every((f) => f.decision === 'unreviewed'));
});

test('assignBurstGroups clusters timestamps <= 1500ms and separates wider gaps', () => {
  const base = generateDemoShootFrames(4).map((f, idx) => ({
    ...f,
    burstGroupId: null,
    burstIndex: 1,
    burstCount: 1,
    exif: {
      ...f.exif,
      capturedAtMs:
        idx === 0
          ? 1000
          : idx === 1
          ? 1200
          : idx === 2
          ? 1450
          : 8000,
    },
  }));

  const grouped = assignBurstGroups(base, 1500);
  assert.equal(grouped[0].burstGroupId, 'burst-1');
  assert.equal(grouped[0].burstIndex, 1);
  assert.equal(grouped[0].burstCount, 3);
  assert.equal(grouped[2].burstGroupId, 'burst-1');
  assert.equal(grouped[2].burstIndex, 3);
  assert.equal(grouped[3].burstGroupId, null);
  assert.equal(grouped[3].burstCount, 1);
});

test('applyDecisionWithHistory, undo, and redo preserve counts and selection', () => {
  let state = createDemoShootState(10);
  const firstId = state.frames[0].id;
  const secondId = state.frames[1].id;

  state = applyDecisionWithHistory(state, firstId, 'keep');
  assert.equal(state.frames[0].decision, 'keep');
  assert.equal(state.selectedFrameId, secondId);
  assert.deepEqual(computeCullCounts(state.frames), {
    all: 10,
    unreviewed: 9,
    keep: 1,
    reject: 0,
  });

  state = applyDecisionWithHistory(state, secondId, 'reject');
  assert.equal(state.frames[1].decision, 'reject');
  assert.deepEqual(computeCullCounts(state.frames), {
    all: 10,
    unreviewed: 8,
    keep: 1,
    reject: 1,
  });

  state = undoDecision(state);
  assert.equal(state.frames[1].decision, 'unreviewed');
  assert.equal(state.selectedFrameId, secondId);
  assert.deepEqual(computeCullCounts(state.frames), {
    all: 10,
    unreviewed: 9,
    keep: 1,
    reject: 0,
  });

  state = redoDecision(state);
  assert.equal(state.frames[1].decision, 'reject');
  assert.deepEqual(computeCullCounts(state.frames), {
    all: 10,
    unreviewed: 8,
    keep: 1,
    reject: 1,
  });
});

test('autoAdvance false keeps selection on decided frame', () => {
  let state = createDemoShootState(5);
  state = { ...state, autoAdvance: false };
  const firstId = state.frames[0].id;
  state = applyDecisionWithHistory(state, firstId, 'keep');
  assert.equal(state.selectedFrameId, firstId);
});

test('filterFrames and stepSelection work together cleanly', () => {
  let state = createDemoShootState(6);
  state = applyDecisionWithHistory(state, state.frames[0].id, 'keep');
  state = applyDecisionWithHistory(state, state.frames[2].id, 'reject');

  const keeps = filterFrames(state.frames, 'keep');
  assert.equal(keeps.length, 1);
  assert.equal(keeps[0].id, state.frames[0].id);

  const unreviewed = filterFrames(state.frames, 'unreviewed');
  assert.equal(unreviewed.length, 4);
  const nextId = stepSelection(unreviewed, unreviewed[0].id, 1);
  assert.equal(nextId, unreviewed[1].id);
});

test('getDefaultComparePair picks burst neighbor when available', () => {
  const frames = assignBurstGroups(
    generateDemoShootFrames(4).map((f, i) => ({
      ...f,
      exif: { ...f.exif, capturedAtMs: 1000 + i * 100 },
    })),
    1500
  );
  const pair = getDefaultComparePair(frames, frames[0].id);
  assert.equal(pair.leftId, frames[0].id);
  assert.equal(pair.rightId, frames[1].id);

  const lastPair = getDefaultComparePair(frames, frames[3].id);
  assert.equal(lastPair.leftId, frames[2].id);
  assert.equal(lastPair.rightId, frames[3].id);
});
