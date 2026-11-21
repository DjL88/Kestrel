import assert from 'node:assert/strict';
import test from 'node:test';
import { commitCompletedAutoResult } from './progressiveAutoCommit';
import { DEFAULT_EDIT } from './photoEdits';
import { DEFAULT_FRAMING } from './photoFraming';
import type { CullingState, PhotoFrame } from './types';

const frame = (id: string, decision: PhotoFrame['decision'] = 'keep'): PhotoFrame => ({
  id, stableKey: id, filename: id + '.nef', sequenceIndex: 1, decision,
  burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
});
function project(frames: PhotoFrame[], autoEdit = true): CullingState {
  return {
    shoot: { id: 'shoot-a', title: 'Birds', sourceKind: 'local-files', totalFrames: frames.length, createdAt: 1, lastUpdatedAt: 1 },
    frames, settings: { autoCull: true, autoEdit }, selectedFrameId: frames[0]?.id ?? null,
    compareRightFrameId: null, filter: 'all', searchQuery: '', keeperTarget: 50,
    autoAdvance: false, undoStack: [], redoStack: [],
  };
}
const update = (frameId: string, exposure = 0.4) => ({
  projectId: 'shoot-a', frameId, edit: { ...DEFAULT_EDIT, exposure }, at: 1000,
});

test('the first successful keeper develops immediately; later frames need not finish', () => {
  const initial = project([frame('first'), frame('second'), frame('third')]);
  const first = commitCompletedAutoResult(initial, update('first'));
  assert.equal(first.frames[0].edit?.exposure, 0.4);
  assert.equal(first.frames[0].editHistory?.steps.length, 1);
  assert.strictEqual(first.frames[1], initial.frames[1]);
  assert.strictEqual(first.frames[2], initial.frames[2]);
  assert.equal(first.shoot.lastUpdatedAt, 1000);
  assert.strictEqual(initial.frames[0].edit, undefined, 'original state is immutable');
  // A cancelled scan can leave the first photo edited and the others untouched.
  assert.equal(first.frames[1].edit, undefined);
});

test('manual edit, crop, removal and changed decision block delayed work', () => {
  const kept = frame('manual');
  const versions = [
    { ...kept, edit: { ...DEFAULT_EDIT, warmth: 0.5 } },
    { ...kept, framing: DEFAULT_FRAMING },
    { ...kept, removedAt: 0 },
    { ...kept, decision: 'reject' as const },
    { ...kept, decision: 'unreviewed' as const },
  ];
  for (const altered of versions) {
    const current = project([altered]);
    const next = commitCompletedAutoResult(current, update('manual'));
    assert.strictEqual(next, current);
    assert.strictEqual(next.frames[0], altered);
  }
});

test('cannot apply an Auto result from a different project or while its photo is in the editor', () => {
  const initial = project([frame('bird'), frame('other')]);
  assert.strictEqual(commitCompletedAutoResult(initial, { ...update('bird'), projectId: 'shoot-b' }), initial);
  assert.strictEqual(commitCompletedAutoResult(initial, { ...update('bird'), editingFrameId: 'bird' }), initial);
  assert.notStrictEqual(commitCompletedAutoResult(initial, { ...update('bird'), editingFrameId: 'other' }), initial);
});

test('ambiguous duplicate IDs, disabled Auto and neutral suggestions preserve state', () => {
  const original = frame('same');
  const duplicated = project([original, { ...original, stableKey: 'different-original' }]);
  assert.strictEqual(commitCompletedAutoResult(duplicated, update('same')), duplicated);
  const single = project([original]);
  const disabled = project([original], false);
  assert.strictEqual(commitCompletedAutoResult(disabled, update('same')), disabled);
  assert.strictEqual(commitCompletedAutoResult(single, { ...update('same'), edit: DEFAULT_EDIT }), single);
  assert.strictEqual(commitCompletedAutoResult(single, { ...update('same'), at: Number.NaN }), single);
});

test('a finished recipe is fully undoable, with all unrelated frames untouched', () => {
  const original = project([frame('one'), frame('two')]);
  const after = commitCompletedAutoResult(original, update('one', 0.6));
  const step = after.frames[0].editHistory!.steps[0];
  assert.equal(step.before.edit, undefined);
  assert.equal(step.after.edit?.exposure, 0.6);
  assert.strictEqual(after.frames[1], original.frames[1]);
  const stale = commitCompletedAutoResult(after, update('one', -0.6));
  assert.strictEqual(stale, after, 'a completed Auto pass may not run again on edited history');
});
