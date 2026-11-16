import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDecisionWithHistory, createDemoShootState, redoDecision, undoDecision } from './cullingEngine';

test('undo refuses a photo ID duplicated after a valid decision', () => {
  const initial = createDemoShootState(3);
  const decided = applyDecisionWithHistory(initial, initial.frames[0].id, 'keep', { allowAdvance: false });
  const damaged = { ...decided, frames: [
    decided.frames[0], { ...decided.frames[1], id: decided.frames[0].id }, decided.frames[2],
  ] };
  assert.equal(undoDecision(damaged), damaged);
  assert.equal(damaged.frames[0].decision, 'keep');
  assert.equal(damaged.frames[1].decision, 'unreviewed');
  const repaired = { ...damaged, frames: decided.frames };
  assert.equal(undoDecision(repaired).frames[0].decision, 'unreviewed');
});

test('redo refuses a newly ambiguous ID without consuming history', () => {
  const initial = createDemoShootState(3);
  const decided = applyDecisionWithHistory(initial, initial.frames[0].id, 'reject', { allowAdvance: false });
  const undone = undoDecision(decided);
  const damaged = { ...undone, frames: [
    undone.frames[0], { ...undone.frames[1], id: undone.frames[0].id }, undone.frames[2],
  ] };
  assert.equal(redoDecision(damaged), damaged);
  assert.equal(damaged.frames[0].decision, 'unreviewed');
  assert.equal(damaged.frames[1].decision, 'unreviewed');
  const repaired = { ...damaged, frames: undone.frames };
  assert.equal(redoDecision(repaired).frames[0].decision, 'reject');
});

test('unrelated duplicate IDs do not block independent undo', () => {
  const initial = createDemoShootState(4);
  const decided = applyDecisionWithHistory(initial, initial.frames[3].id, 'keep', { allowAdvance: false });
  const damaged = { ...decided, frames: [
    decided.frames[0], { ...decided.frames[1], id: decided.frames[0].id },
    decided.frames[2], decided.frames[3],
  ] };
  const undone = undoDecision(damaged);
  assert.equal(undone.frames[3].decision, 'unreviewed');
  assert.equal(undone.frames[0].decision, 'unreviewed');
  assert.equal(undone.frames[1].decision, 'unreviewed');
});
