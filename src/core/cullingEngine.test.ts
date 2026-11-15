import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDecisionWithHistory,
  applyAutoCullDecisions,
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

test('search finds confirmed subject names alongside the decision filter', () => {
  const [first, second] = generateDemoShootFrames(2);
  const frames = [
    { ...first, decision: 'keep' as const, subjectNames: ['Coco', 'Mabel'] },
    second,
  ];
  assert.deepEqual(filterFrames(frames, 'keep', ' MABEL '), [frames[0]]);
  assert.deepEqual(filterFrames(frames, 'reject', 'Mabel'), []);
});

test('flagged keepers leave the review queue and the queue stays near the current frame', () => {
  const project = createDemoShootState(5);
  const current = project.frames[2];
  const state = { ...project, filter: 'unreviewed' as const, selectedFrameId: current.id };
  const kept = applyDecisionWithHistory(state, current.id, 'keep', { allowAdvance: false });
  assert.equal(kept.selectedFrameId, project.frames[3].id);
  assert.equal(filterFrames(kept.frames, 'keep')[0].id, current.id);
  assert.ok(!filterFrames(kept.frames, 'unreviewed').some((frame) => frame.id === current.id));
  assert.equal(undoDecision(kept).selectedFrameId, current.id);
});

import { removeFromLibrary, removedFrames, restoreRemoved, computeCullCounts as counts, filterFrames as filtered, undoDecision as undo, redoDecision as redo, applyDecisionWithHistory as decide } from './cullingEngine';
import { appendProjectPhotos, createEmptyProject } from './projects';
import type { PhotoFrame } from './types';

function projectWith(decisions: ('keep' | 'reject' | 'unreviewed')[]) {
  const base = createEmptyProject('p', 'P');
  const frames = decisions.map((decision, index) => ({
    id: `f${index}`, stableKey: `k${index}`, filename: `${index}.jpg`, sequenceIndex: index + 1, decision,
    burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
  } as PhotoFrame));
  return { ...base, frames, selectedFrameId: frames[0]?.id ?? null };
}

test('removing from Trash hides the photo everywhere but keeps it for restore', () => {
  const state = removeFromLibrary(projectWith(['reject', 'keep']), ['f0']);
  assert.equal(state.frames.length, 2, 'the record is kept so it can be restored');
  assert.deepEqual(counts(state.frames), { all: 1, unreviewed: 0, keep: 1, reject: 0 });
  assert.equal(filtered(state.frames, 'all').length, 1);
  assert.equal(filtered(state.frames, 'reject').length, 0);
  assert.equal(state.selectedFrameId, 'f1');
  assert.deepEqual(removedFrames(state.frames).map((frame) => frame.id), ['f0']);
});

test('only photos already in Trash can be removed', () => {
  const state = projectWith(['keep', 'unreviewed']);
  assert.equal(removeFromLibrary(state, ['f0', 'f1']), state);
});

test('undo and redo bring a removal back and forth', () => {
  const removed = removeFromLibrary(projectWith(['reject']), ['f0']);
  const undone = undo(removed);
  assert.equal(counts(undone.frames).reject, 1);
  assert.equal(undone.frames[0].removedAt, undefined);
  const redone = redo(undone);
  assert.equal(counts(redone.frames).all, 0);
});

test('restore returns the photo to Trash, not Keepers', () => {
  const restored = restoreRemoved(removeFromLibrary(projectWith(['reject']), ['f0']), ['f0']);
  assert.equal(restored.frames[0].decision, 'reject');
  assert.equal(counts(restored.frames).reject, 1);
});

test('adding a removed photo again revives it as unreviewed instead of ignoring it', () => {
  const removed = removeFromLibrary(projectWith(['reject']), ['f0']);
  const again = appendProjectPhotos(removed, [{ ...removed.frames[0], id: 'new' }], 'imp');
  assert.equal(again.frames.length, 1, 'no duplicate record');
  assert.equal(again.frames[0].removedAt, undefined);
  assert.equal(again.frames[0].decision, 'unreviewed');
});

test('keep to trash is an ordinary reversible decision, never a removal', () => {
  const state = decide(projectWith(['keep']), 'f0', 'reject');
  assert.equal(state.frames[0].decision, 'reject');
  assert.equal(state.frames[0].removedAt, undefined);
  assert.equal(undo(state).frames[0].decision, 'keep');
});


test('auto cull cannot reclassify a removed photo, even from stale scan results', () => {
  const project = projectWith(['unreviewed', 'unreviewed']);
  const state = {
    ...project,
    frames: [{ ...project.frames[0], removedAt: 1234 }, project.frames[1]],
  };
  const updated = applyAutoCullDecisions(state, [
    { frameId: 'f0', decision: 'keep' },
    { frameId: 'f1', decision: 'keep' },
  ]);
  assert.equal(updated.frames[0].decision, 'unreviewed');
  assert.equal(updated.frames[0].removedAt, 1234);
  assert.equal(updated.frames[1].decision, 'keep');
  assert.equal(updated.undoStack.length, 1);
  assert.deepEqual(updated.undoStack[0].batch?.map((item) => item.frameId), ['f1']);
  assert.equal(undoDecision(updated).frames[1].decision, 'unreviewed');
});

test('auto cull does not create a history entry for removed-only results', () => {
  const project = projectWith(['unreviewed']);
  const state = { ...project, frames: [{ ...project.frames[0], removedAt: 1234 }] };
  const updated = applyAutoCullDecisions(state, [{ frameId: 'f0', decision: 'reject' }]);
  assert.equal(updated, state);
});
