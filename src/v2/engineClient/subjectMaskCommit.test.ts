import assert from 'node:assert/strict';
import test from 'node:test';
import { stepEdit } from '../../core/editHistory';
import { createMask, createSubjectMask, framingKey, MAX_MASKS } from '../../core/maskTypes';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING } from '../../core/photoFraming';
import { createEmptyProject } from '../../core/projects';
import type { PhotoFrame } from '../../core/types';
import { addSavedEditGroup } from './editGroupState';
import { commitSubjectMask } from './subjectMaskCommit';

const source: PhotoFrame = {
  id: 'photo', stableKey: 'robin.nef', filename: 'robin.nef', sequenceIndex: 1,
  decision: 'unreviewed', burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
};
const mask = createSubjectMask('subject', { w: 8, h: 8, data: btoa('a'.repeat(64)) }, framingKey(source.framing), 'high');
const project = (frame: PhotoFrame, id = 'project') => ({ ...createEmptyProject(id, 'Mask check'), frames: [frame] });

test('a valid mask preserves edits made during inference and can be undone', () => {
  const edit = { ...DEFAULT_EDIT, exposure: 0.5, masks: [createMask('radial', 'oval')] };
  const current = { ...source, edit, rating: 4 };
  const result = commitSubjectMask(project(current), 'project', source, mask, 3000);
  assert.deepEqual(result.frames[0].edit, { ...edit, masks: [...edit.masks, mask] });
  assert.equal(result.frames[0].rating, 4);
  assert.equal(result.shoot.lastUpdatedAt, 3000);
  assert.deepEqual(stepEdit(result.frames[0], -1).edit, edit);
});

test('a stale mask leaves the catalogue and its history untouched', () => {
  const anotherGroup = addSavedEditGroup(source, 'second');
  assert.ok(anotherGroup);
  for (const state of [
    project(source, 'other-project'),
    project({ ...source, framing: { ...DEFAULT_FRAMING, turns: 1 } }),
    project({ ...source, removedAt: 0 }),
    project({ ...source, originalSha256: 'a'.repeat(64) }),
    project(anotherGroup),
    project({ ...source, editVersions: { version: 1, activeId: 'fork', versions: [] } }),
    project({ ...source, edit: { ...DEFAULT_EDIT, masks: Array.from({ length: MAX_MASKS }, (_, i) => createMask('radial', String(i))) } }),
  ]) {
    assert.equal(commitSubjectMask(state, 'project', source, mask, 3000), state);
  }
});

test('invalid grids and repeated mask identifiers leave history untouched', () => {
  const current = project({ ...source, edit: { ...DEFAULT_EDIT, masks: [mask] } });
  assert.equal(commitSubjectMask(current, 'project', source, mask, 3000), current);
  const empty = project(source);
  assert.equal(commitSubjectMask(empty, 'project', source, { ...mask, grid: { ...mask.grid, data: 'A' } }, 3000), empty);
});
