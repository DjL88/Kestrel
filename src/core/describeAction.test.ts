import assert from 'node:assert/strict';
import test from 'node:test';
import { describeEntry, redoLabel, undoLabel } from './describeAction';
import { applyDecisionWithHistory, removeFromLibrary, undoDecision } from './cullingEngine';
import { createEmptyProject } from './projects';
import type { DecisionHistoryEntry, PhotoFrame } from './types';

const project = (decisions: PhotoFrame['decision'][]) => {
  const base = createEmptyProject('p', 'P');
  const frames = decisions.map((decision, i) => ({ id: `f${i}`, stableKey: `k${i}`, filename: `bird-${i}.jpg`, sequenceIndex: i + 1, decision, burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file' } as PhotoFrame));
  return { ...base, frames, selectedFrameId: frames[0]?.id ?? null };
};

test('each kind of flag change is named in plain English', () => {
  const keep = applyDecisionWithHistory(project(['unreviewed']), 'f0', 'keep');
  assert.equal(undoLabel(keep), 'Keep bird-0.jpg');
  const trash = applyDecisionWithHistory(project(['keep']), 'f0', 'reject');
  assert.equal(undoLabel(trash), 'Move bird-0.jpg to Trash');
  const back = applyDecisionWithHistory(project(['keep']), 'f0', 'unreviewed');
  assert.equal(undoLabel(back), 'Move bird-0.jpg back to review');
});

test('removals and batches say how many photos they touch', () => {
  const removed = removeFromLibrary(project(['reject', 'reject']), ['f0', 'f1']);
  assert.equal(undoLabel(removed), 'Remove 2 photos from the library');
  assert.equal(undoLabel(removeFromLibrary(project(['reject']), ['f0'])), 'Remove bird-0.jpg from the library');
  const entry: DecisionHistoryEntry = { frameId: 'f0', batch: [{ frameId: 'f0', prevDecision: 'unreviewed', nextDecision: 'keep' }, { frameId: 'f1', prevDecision: 'unreviewed', nextDecision: 'reject' }], prevDecision: 'unreviewed', nextDecision: 'keep', prevSelectedId: null, nextSelectedId: null };
  assert.equal(describeEntry(entry, []), 'Auto-cull (2 photos)');
});

test('there is no label when there is nothing to undo or redo, and redo names the undone step', () => {
  const state = project(['unreviewed']);
  assert.equal(undoLabel(state), undefined);
  assert.equal(redoLabel(state), undefined);
  const undone = undoDecision(applyDecisionWithHistory(state, 'f0', 'keep'));
  assert.equal(undoLabel(undone), undefined);
  assert.equal(redoLabel(undone), 'Keep bird-0.jpg');
});

test('an entry for a photo that is no longer listed still reads sensibly', () => {
  const entry: DecisionHistoryEntry = { frameId: 'gone', prevDecision: 'unreviewed', nextDecision: 'keep', prevSelectedId: null, nextSelectedId: null };
  assert.equal(describeEntry(entry, []), 'Keep photo');
});
