import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from './cullingEngine';
import { createVirtualCopy } from './virtualCopies';
import { encodeProjectBackup, restoreProjectBackup } from './projectBackup';

test('restoring a backup creates a separate catalogue and retains edits, flags, labels and virtual links', () => {
  const project = createDemoShootState(3);
  project.frames[0] = {
    ...project.frames[0], decision: 'keep', rating: 5, subjectNames: ['Coco'],
    edit: { exposure: 0.5, warmth: 0, colour: 0 },
  };
  const copy = createVirtualCopy(project.frames[0], project.frames, 'copy-test');
  project.frames.push(copy);
  project.selectedFrameId = copy.id;
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'new-project', 1000);
  assert.equal(restored.shoot.id, 'new-project');
  assert.notEqual(restored.shoot.id, project.shoot.id);
  assert.equal(restored.shoot.totalFrames, 4);
  assert.equal(restored.selectedFrameId, copy.id);
  assert.deepEqual(restored.frames, JSON.parse(JSON.stringify(project.frames)));
});

test('restore rejects invalid catalogue data and orphaned virtual copies', () => {
  const project = createDemoShootState(1);
  assert.throws(() => restoreProjectBackup('invalid', 'new'), /not a readable/);
  const copy = createVirtualCopy(project.frames[0], project.frames, 'copy-test');
  project.frames = [copy];
  assert.throws(() => restoreProjectBackup(encodeProjectBackup(project), 'new'), /invalid photo links/);
  copy.framing = { turns: 0, straighten: 0, ratio: -1, x: 0.5, y: 0.5 };
  assert.throws(() => restoreProjectBackup(encodeProjectBackup(project), 'new'), /invalid catalogue data/);
});
