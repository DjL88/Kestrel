import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoShootState } from './cullingEngine';
import { recordEdit, stepEdit } from './editHistory';
import { createSubjectMask } from './maskTypes';
import { DEFAULT_EDIT } from './photoEdits';
import { encodeProjectBackup, restoreProjectBackup } from './projectBackup';

/**
 * The JSON boundary models a cold process restart: no live File, canvas, or
 * in-memory edit-history references are allowed to carry state across it.
 */
function reopen(project: ReturnType<typeof createDemoShootState>) {
  const persistedBytes = new TextEncoder().encode(encodeProjectBackup(project));
  const onDisk = new TextDecoder().decode(persistedBytes);
  return restoreProjectBackup(onDisk, 'reopened-library', 3000);
}

test('cold reopen preserves original fingerprint, mask recipe, undo cursor and project settings', () => {
  const project = createDemoShootState(1);
  const fingerprint = '9'.repeat(64);
  const mask = createSubjectMask('subject', {
    w: 8, h: 8, data: Buffer.alloc(64, 200).toString('base64'),
  }, 'original-framing', 'high');
  const edit = { ...DEFAULT_EDIT, exposure: 0.75, masks: [mask] };
  project.frames[0].originalSha256 = fingerprint;
  project.frames[0] = recordEdit(project.frames[0], { edit }, 1000);
  project.frames[0] = recordEdit(project.frames[0], {
    framing: { turns: 0, straighten: 0, ratio: 1, x: 0.5, y: 0.5 },
  }, 2000);
  project.frames[0] = stepEdit(project.frames[0], -1);
  project.settings = { autoCull: false, autoEdit: true };
  project.selectedFrameId = project.frames[0].id;

  const reopened = reopen(project);
  const frame = reopened.frames[0];
  assert.equal(reopened.shoot.id, 'reopened-library');
  assert.equal(frame.originalSha256, fingerprint);
  assert.deepEqual(frame.edit, edit);
  assert.equal(frame.editHistory?.cursor, 1);
  assert.equal(frame.framing, undefined);
  assert.equal(stepEdit(frame, -1).edit, undefined);
  assert.equal(stepEdit(frame, 1).framing?.ratio, 1);
  assert.deepEqual(reopened.settings, { autoCull: false, autoEdit: true });
  assert.equal(reopened.selectedFrameId, frame.id);
  assert.equal(reopened.shoot.totalFrames, 1);
});

test('cold reopen retains V2 edit-group and format metadata as catalogue data', () => {
  const project = createDemoShootState(1);
  const frame = project.frames[0];
  frame.v2EditGroups = { selectedId: 'group-a', groups: [{ id: 'group-a', name: 'Feathers', edit: { exposure: 0.25 } }] };
  frame.formatHistory = { cursor: 1, steps: [{ type: 'rename', formatId: 'print-a' }] };
  frame.sizeCrops = { 'print-a': { zoom: 1.25, x: 0.4, y: 0.6 } };
  frame.overlay = { lines: [{ text: 'Copyright' }] };

  const reopened = reopen(project).frames[0];
  assert.deepEqual(reopened.v2EditGroups, frame.v2EditGroups);
  assert.deepEqual(reopened.formatHistory, frame.formatHistory);
  assert.deepEqual(reopened.sizeCrops, frame.sizeCrops);
  assert.deepEqual(reopened.overlay, frame.overlay);
});

test('damaged persisted history is rejected rather than silently resetting undo', () => {
  const project = createDemoShootState(1);
  project.frames[0] = recordEdit(project.frames[0], {
    edit: { ...DEFAULT_EDIT, exposure: 0.5 },
  }, 1000);
  const envelope = JSON.parse(encodeProjectBackup(project));
  envelope.project.frames[0].editHistory.cursor = 999;
  const damaged = new TextDecoder().decode(new TextEncoder().encode(JSON.stringify(envelope)));
  assert.throws(() => restoreProjectBackup(damaged, 'reopened-library'), /invalid catalogue data/);
  assert.equal(project.frames[0].editHistory?.cursor, 1, 'failed restore must not mutate the live catalogue');
});
