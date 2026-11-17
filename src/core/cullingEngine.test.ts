import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDecisionWithHistory,
  applyAutoCullDecisions,
  applyCullConfidence,
  assignBurstGroups,
  computeCullCounts,
  createDemoShootState,
  filterFrames,
  generateDemoShootFrames,
  getDefaultComparePair,
  redoDecision,
  sortFrames,
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

test('filterFrames narrows by camera and lens, exact match only', () => {
  const [first, second, third] = generateDemoShootFrames(3);
  const frames = [
    { ...first, exif: { ...first.exif, camera: 'Nikon Z8', lens: 'Z 100-400mm' } },
    { ...second, exif: { ...second.exif, camera: 'Nikon Z8', lens: 'Z 24-120mm' } },
    { ...third, exif: { ...third.exif, camera: 'Nikon Z5II', lens: 'Z 100-400mm' } },
  ];
  assert.deepEqual(filterFrames(frames, 'all', '', null, 'Nikon Z8'), [frames[0], frames[1]]);
  assert.deepEqual(filterFrames(frames, 'all', '', null, null, 'Z 100-400mm'), [frames[0], frames[2]]);
  assert.deepEqual(filterFrames(frames, 'all', '', null, 'Nikon Z8', 'Z 100-400mm'), [frames[0]]);
  // No camera/lens filter given: everything (minus removed) passes through, same as before this option existed.
  assert.equal(filterFrames(frames, 'all').length, 3);
});

test('sortFrames leaves catalogue order alone until a sort is chosen, then orders cleanly', () => {
  const [first, second, third] = generateDemoShootFrames(3);
  const frames = [
    { ...first, filename: 'b.jpg', rating: 2, exif: { ...first.exif, capturedAtMs: 2000 } },
    { ...second, filename: 'a.jpg', rating: 5, exif: { ...second.exif, capturedAtMs: 1000 } },
    { ...third, filename: 'c.jpg', rating: undefined, exif: { ...third.exif, capturedAtMs: 3000 } },
  ];
  // No sort order: unchanged, same order and same objects (not even a defensive copy's worth of reordering).
  assert.deepEqual(sortFrames(frames), frames);
  assert.deepEqual(sortFrames(frames, 'captured-asc').map((f) => f.filename), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.deepEqual(sortFrames(frames, 'captured-desc').map((f) => f.filename), ['c.jpg', 'b.jpg', 'a.jpg']);
  assert.deepEqual(sortFrames(frames, 'rating-desc').map((f) => f.filename), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.deepEqual(sortFrames(frames, 'name-asc').map((f) => f.filename), ['a.jpg', 'b.jpg', 'c.jpg']);
});

test('sortFrames by culling confidence ranks high over medium over low, unscored photos last', () => {
  const [first, second, third, fourth] = generateDemoShootFrames(4);
  const frames = [
    { ...first, filename: 'medium.jpg', cullConfidence: 'medium' as const, cullScore: 60 },
    { ...second, filename: 'unscored.jpg' },
    { ...third, filename: 'high.jpg', cullConfidence: 'high' as const, cullScore: 90 },
    { ...fourth, filename: 'alsohigh.jpg', cullConfidence: 'high' as const, cullScore: 95 },
  ];
  assert.deepEqual(sortFrames(frames, 'confidence-desc').map((f) => f.filename),
    ['alsohigh.jpg', 'high.jpg', 'medium.jpg', 'unscored.jpg']);
});

test('applyCullConfidence records what a scan found without ever touching decision', () => {
  const state = createDemoShootState(3);
  const [a, b] = state.frames;
  const next = applyCullConfidence(state, [
    { frameId: a.id, confidence: 'high', score: 92 },
    { frameId: b.id, confidence: 'low', score: 20 },
  ]);
  assert.equal(next.frames.find((f) => f.id === a.id)?.cullConfidence, 'high');
  assert.equal(next.frames.find((f) => f.id === a.id)?.cullScore, 92);
  assert.equal(next.frames.find((f) => f.id === b.id)?.cullConfidence, 'low');
  assert.equal(next.frames.find((f) => f.id === a.id)?.decision, 'unreviewed');
  // Unaffected frames are untouched, same object reference.
  assert.equal(next.frames[2], state.frames[2]);
  // Empty results: no-op, same state back.
  assert.equal(applyCullConfidence(state, []), state);
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

test('manual culling ignores stale decisions for removed photos without changing history or selection', () => {
  const project = projectWith(['reject', 'unreviewed']);
  const removed = removeFromLibrary(project, ['f0']);
  const before = removed.undoStack.length;
  for (const decision of ['keep', 'reject', 'unreviewed'] as const) {
    const next = applyDecisionWithHistory(removed, 'f0', decision);
    assert.equal(next, removed, 'removed photo must be unchanged');
    assert.equal(next.undoStack.length, before);
    assert.equal(next.selectedFrameId, 'f1');
  }
  // An explicit restore permits normal culling again.
  const restored = restoreRemoved(removed, ['f0']);
  const kept = applyDecisionWithHistory(restored, 'f0', 'keep', { allowAdvance: false });
  assert.equal(kept.frames[0].decision, 'keep');
  assert.equal(kept.frames[0].removedAt, undefined);
});

test('auto advance never jumps into removed or filtered-out photos at the end of a queue', () => {
  const base = createDemoShootState(4);
  const frames = base.frames.map((frame, index) => ({
    ...frame,
    ...(index === 2 ? { removedAt: 1234 } : {}),
  }));
  const lastVisible = frames[1];
  const state = {
    ...base, frames, selectedFrameId: lastVisible.id,
    searchQuery: lastVisible.filename,
  };
  const decided = applyDecisionWithHistory(state, lastVisible.id, 'keep');
  assert.equal(decided.selectedFrameId, lastVisible.id);
  assert.equal(decided.frames[1].decision, 'keep');
  assert.equal(decided.undoStack.length, 1);
  assert.equal(undoDecision(decided).selectedFrameId, lastVisible.id);

  const all = { ...base, frames, selectedFrameId: frames[3].id };
  const last = applyDecisionWithHistory(all, frames[3].id, 'reject');
  assert.equal(last.selectedFrameId, frames[3].id);
});


test('bursts never combine interleaved Z8 and Z5II frames', () => {
  const frames = generateDemoShootFrames(4).map((frame, index) => ({
    ...frame,
    exif: {
      ...frame.exif,
      camera: index === 2 ? 'NIKON Z 5II' : 'NIKON Z 8',
      capturedAtMs: 1000 + index * 100,
    },
  }));
  const grouped = assignBurstGroups(frames);
  assert.equal(grouped[0].burstGroupId, 'burst-1');
  assert.equal(grouped[1].burstGroupId, 'burst-1');
  assert.equal(grouped[2].burstGroupId, null);
  assert.equal(grouped[3].burstGroupId, null);
  assert.equal(grouped[2].burstCount, 1);
  assert.equal(grouped[3].burstCount, 1);
});

test('missing camera metadata never establishes a burst', () => {
  const frames = generateDemoShootFrames(2).map((frame, index) => ({
    ...frame,
    exif: { ...frame.exif, camera: index === 0 ? undefined : 'NIKON Z 8', capturedAtMs: 1000 + index * 100 },
  }));
  const grouped = assignBurstGroups(frames);
  assert.ok(grouped.every((frame) => frame.burstGroupId === null));
});

test('unknown camera metadata cannot bridge different Nikon bodies', () => {
  const frames = generateDemoShootFrames(3).map((frame, index) => ({
    ...frame,
    exif: {
      ...frame.exif,
      camera: index === 0 ? 'NIKON Z 8' : index === 1 ? undefined : 'NIKON Z 5II',
      capturedAtMs: 1000 + index * 100,
    },
  }));
  const grouped = assignBurstGroups(frames);
  assert.ok(grouped.every((frame) => frame.burstGroupId === null));
});

test('unknown camera frames do not inherit a known-camera burst identity', () => {
  const frames = generateDemoShootFrames(3).map((frame, index) => ({
    ...frame,
    exif: {
      ...frame.exif,
      camera: index === 1 ? undefined : 'NIKON Z 8',
      capturedAtMs: 1000 + index * 100,
    },
  }));
  const grouped = assignBurstGroups(frames);
  assert.ok(grouped.every((frame) => frame.burstGroupId === null));
});

test('explicit restore invalidates stale redo of a library removal', () => {
  const removed = removeFromLibrary(projectWith(['reject', 'unreviewed']), ['f0']);
  const reviewed = applyDecisionWithHistory(removed, 'f1', 'keep', { allowAdvance: false });
  const undoneReview = undoDecision(reviewed);
  // Restore the removed photo while a different decision remains redoable.
  const restored = restoreRemoved(undoneReview, ['f0']);
  assert.equal(restored.frames[0].removedAt, undefined);
  assert.equal(restored.redoStack.length, 0);
  assert.equal(redoDecision(restored), restored);
});

test('manual culling refuses duplicate photo IDs instead of corrupting undo history', () => {
  const project = projectWith(['unreviewed', 'unreviewed', 'unreviewed']);
  const duplicated = {
    ...project,
    frames: [
      project.frames[0],
      { ...project.frames[1], id: project.frames[0].id },
      project.frames[2],
    ],
    selectedFrameId: project.frames[0].id,
  };
  for (const decision of ['keep', 'reject'] as const) {
    const updated = applyDecisionWithHistory(duplicated, project.frames[0].id, decision);
    assert.equal(updated, duplicated, 'ambiguous photo must remain unchanged');
    assert.equal(updated.undoStack.length, 0);
    assert.equal(updated.frames[0].decision, 'unreviewed');
    assert.equal(updated.frames[1].decision, 'unreviewed');
  }
  // Independent, unambiguous photos remain reviewable and reversible.
  const kept = applyDecisionWithHistory(duplicated, project.frames[2].id, 'keep', { allowAdvance: false });
  assert.equal(kept.frames[2].decision, 'keep');
  assert.equal(kept.frames[0].decision, 'unreviewed');
  assert.equal(kept.frames[1].decision, 'unreviewed');
  assert.equal(undoDecision(kept).frames[2].decision, 'unreviewed');
  assert.equal(redoDecision(undoDecision(kept)).frames[2].decision, 'keep');
});


test('compare does not fabricate a second photo in a single-frame shoot', () => {
  const [frame] = generateDemoShootFrames(1);
  assert.deepEqual(getDefaultComparePair([frame], frame.id), { leftId: frame.id, rightId: null });
});

test('compare skips removed and repeated identities rather than showing a false alternative', () => {
  const [a, b, c] = generateDemoShootFrames(3);
  const removed = { ...b, removedAt: 1234 };
  assert.deepEqual(getDefaultComparePair([a, removed, c], a.id), { leftId: a.id, rightId: c.id });
  assert.deepEqual(getDefaultComparePair([a, { ...b, id: a.id }], a.id), { leftId: a.id, rightId: null });
  assert.deepEqual(getDefaultComparePair([a, removed], a.id), { leftId: a.id, rightId: null });
});

test('explicit Restore invalidates batched removal Undo while preserving an unrelated Keep', () => {
  let state = createDemoShootState(3);
  const [first, second, third] = state.frames.map((frame) => frame.id);
  state = applyDecisionWithHistory(state, first, 'reject', { allowAdvance: false });
  state = applyDecisionWithHistory(state, third, 'reject', { allowAdvance: false });
  state = applyDecisionWithHistory(state, second, 'keep', { allowAdvance: false });
  state = removeFromLibrary(state, [first, third]);
  assert.equal(state.undoStack.length, 4);
  state = restoreRemoved(state, [first]);
  assert.equal(state.frames[0].removedAt, undefined);
  assert.ok(state.frames[2].removedAt);
  assert.equal(state.undoStack.length, 3);
  assert.equal(state.undoStack[2].frameId, second);
  const undone = undoDecision(state);
  assert.equal(undone.frames[1].decision, 'unreviewed');
  const redone = redoDecision(undone);
  assert.equal(redone.frames[0].removedAt, undefined);
  assert.equal(redone.frames[1].decision, 'keep');
});

test('restoring one photo preserves unrelated removal history', () => {
  let state = createDemoShootState(2);
  const [first, second] = state.frames.map((frame) => frame.id);
  state = applyDecisionWithHistory(state, first, 'reject', { allowAdvance: false });
  state = applyDecisionWithHistory(state, second, 'reject', { allowAdvance: false });
  state = removeFromLibrary(state, [first]);
  state = removeFromLibrary(state, [second]);
  state = restoreRemoved(state, [first]);
  assert.equal(state.undoStack.length, 3);
  assert.equal(state.undoStack[2].frameId, second);
  const undone = undoDecision(state);
  assert.equal(undone.frames[0].removedAt, undefined);
  assert.equal(undone.frames[1].removedAt, undefined);
});
