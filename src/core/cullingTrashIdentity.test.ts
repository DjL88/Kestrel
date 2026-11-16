import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState, removeFromLibrary, restoreRemoved, undoDecision, redoDecision } from './cullingEngine';

test('Trash removal skips ambiguous IDs but removes independent rejected photos', () => {
  const base = createDemoShootState(4);
  const frames = base.frames.map((frame, index) => ({
    ...frame,
    id: index === 1 ? base.frames[0].id : frame.id,
    decision: 'reject' as const,
  }));
  const damaged = { ...base, frames };
  const next = removeFromLibrary(damaged, [frames[0].id, frames[2].id]);
  assert.equal(next.frames[0].removedAt, undefined);
  assert.equal(next.frames[1].removedAt, undefined);
  assert.ok(next.frames[2].removedAt);
  assert.deepEqual(next.undoStack.at(-1)?.batch?.map((change) => change.frameId), [frames[2].id]);
  const undone = undoDecision(next);
  assert.equal(undone.frames[2].removedAt, undefined);
  assert.ok(redoDecision(undone).frames[2].removedAt);
});

test('Trash removal of only ambiguous IDs is a no-op without history', () => {
  const base = createDemoShootState(2);
  const frames = base.frames.map((frame) => ({ ...frame, id: base.frames[0].id, decision: 'reject' as const }));
  const damaged = { ...base, frames };
  assert.equal(removeFromLibrary(damaged, [frames[0].id]), damaged);
});

test('Restore skips ambiguous IDs while restoring an independent removed photo', () => {
  const base = createDemoShootState(4);
  const frames = base.frames.map((frame, index) => ({
    ...frame,
    id: index === 1 ? base.frames[0].id : frame.id,
    decision: 'reject' as const,
    removedAt: 1234,
  }));
  const damaged = { ...base, frames };
  const restored = restoreRemoved(damaged, [frames[0].id, frames[2].id]);
  assert.equal(restored.frames[0].removedAt, 1234);
  assert.equal(restored.frames[1].removedAt, 1234);
  assert.equal(restored.frames[2].removedAt, undefined);
  assert.equal(restored.frames[3].removedAt, 1234);
});

test('Restore of only ambiguous IDs does not clear redo history', () => {
  const base = createDemoShootState(2);
  const frames = base.frames.map((frame) => ({ ...frame, id: base.frames[0].id, removedAt: 1234 }));
  const damaged = { ...base, frames };
  assert.equal(restoreRemoved(damaged, [frames[0].id]), damaged);
});
