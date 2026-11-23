import assert from 'node:assert/strict';
import test from 'node:test';
import { recordEdit, stepEdit } from '../../core/editHistory';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING } from '../../core/photoFraming';
import { createEmptyProject } from '../../core/projects';
import type { PhotoFrame } from '../../core/types';
import { commitAutoEdit } from './commitAutoEdit';

const original: PhotoFrame = {
  id: 'photo', stableKey: 'original.jpg', filename: 'original.jpg', sequenceIndex: 1,
  decision: 'unreviewed', burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
};
const proposal = { ...DEFAULT_EDIT, exposure: 0.3 };
const project = (frame: PhotoFrame) => ({
  ...createEmptyProject('project', 'Test'), frames: [frame], selectedFrameId: frame.id,
});

test('commits a fresh Auto-pilot recipe as one undoable edit without changing the photo identity or rating', () => {
  const rated = { ...original, rating: 4 };
  const result = commitAutoEdit(project(rated), 'project', original, proposal, 2000);
  const updated = result.frames[0];
  assert.equal(updated.edit, proposal);
  assert.equal(updated.stableKey, original.stableKey);
  assert.equal(updated.rating, 4);
  assert.equal(updated.editHistory?.steps.length, 1);
  assert.equal(result.shoot.lastUpdatedAt, 2000);
  assert.equal(stepEdit(updated, -1).edit, undefined);
});

test('preserves a manual edit even when it was undone before Auto-pilot finished', () => {
  const edited = recordEdit(original, { edit: { ...DEFAULT_EDIT, exposure: -0.4 } }, 1500);
  for (const current of [edited, stepEdit(edited, -1)]) {
    const state = project(current);
    assert.equal(commitAutoEdit(state, 'project', original, proposal, 2000), state);
  }
});

test('refuses delayed results after reframing, removing, replacing or reselecting the photo', () => {
  for (const current of [
    { ...original, framing: { ...DEFAULT_FRAMING, turns: 1 as const } },
    { ...original, removedAt: 0 },
    { ...original, stableKey: 'another.jpg' },
    { ...original, originalSha256: 'a'.repeat(64) },
  ]) {
    const state = project(current);
    assert.equal(commitAutoEdit(state, 'project', original, proposal, 2000), state);
  }
  const otherSelection = { ...project(original), selectedFrameId: 'other-photo' };
  assert.equal(commitAutoEdit(otherSelection, 'project', original, proposal, 2000), otherSelection);
});

test('refuses a result from another project open in the meantime', () => {
  const state = project(original);
  assert.equal(commitAutoEdit(state, 'previous-project', original, proposal, 2000), state);
});
