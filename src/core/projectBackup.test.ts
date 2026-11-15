import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from './cullingEngine';
import { createSubjectMask } from './maskTypes';
import { DEFAULT_EDIT } from './photoEdits';
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

test('a portable backup restores complete subject grids and rejects the wrong decoded byte count', () => {
  const project = createDemoShootState(1);
  for (const [w, h] of [[8, 8], [8, 10], [9, 9]]) {
    const data = Buffer.alloc(w * h, 127).toString('base64');
    const mask = createSubjectMask('subject', { w, h, data }, 'original-framing', 'medium');
    project.frames[0].edit = { ...DEFAULT_EDIT, masks: [mask] };
    const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
    assert.deepEqual(restored.frames[0].edit?.masks, [mask]);

    // Same text length and plausible characters, but a different decoded byte count.
    mask.grid.data = data.endsWith('=') ? data.replace(/=+$/, (padding) => 'A'.repeat(padding.length))
      : data.slice(0, -1) + '=';
    assert.throws(() => restoreProjectBackup(encodeProjectBackup(project), 'restored'), /invalid catalogue data/);
  }
});
