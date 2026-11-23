import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from './cullingEngine';
import { createSubjectMask } from './maskTypes';
import { recordEdit, stepEdit } from './editHistory';
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

test('a backup keeps kind, tags, automatic tags and declined names, and rejects damaged ones', () => {
  const project = createDemoShootState(2);
  project.frames[0] = { ...project.frames[0], subjectKind: 'wildlife', tags: ['Red kite', 'Moorland'], autoTags: ['Red kite'], declinedTags: ['Barn owl'] };
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'new-project', 1000);
  assert.equal(restored.frames[0].subjectKind, 'wildlife');
  assert.deepEqual(restored.frames[0].tags, ['Red kite', 'Moorland']);
  assert.deepEqual(restored.frames[0].autoTags, ['Red kite']);
  assert.deepEqual(restored.frames[0].declinedTags, ['Barn owl']);
  for (const damage of [{ autoTags: 'Red kite' }, { declinedTags: [3] }, { tags: [1] }, { subjectKind: 'person' }]) {
    const broken = JSON.parse(encodeProjectBackup(project));
    Object.assign(broken.project.frames[0], damage);
    assert.throws(() => restoreProjectBackup(JSON.stringify(broken), 'x'), /not a readable|invalid|could not/i, JSON.stringify(damage));
  }
});


test('portable backups preserve the edit cursor and can undo back to an untouched photo', () => {
  const project = createDemoShootState(1);
  const edit = { ...DEFAULT_EDIT, exposure: 0.5, tint: -0.4 };
  const framing = { turns: 0, straighten: 0, ratio: 1, x: 0.5, y: 0.5 };
  const toned = recordEdit(project.frames[0], { edit }, 1000);
  const cropped = recordEdit(toned, { framing }, 2000);
  project.frames[0] = stepEdit(cropped, -1);

  const [restored] = restoreProjectBackup(encodeProjectBackup(project), 'restored').frames;
  assert.equal(restored.editHistory?.cursor, 1);
  assert.equal(restored.framing, undefined);
  assert.deepEqual(restored.edit, edit);
  assert.deepEqual(stepEdit(restored, 1).framing, framing);
  assert.equal(stepEdit(restored, -1).edit, undefined);

  const olderBackup = JSON.parse(encodeProjectBackup(project));
  delete olderBackup.project.frames[0].editHistory;
  assert.deepEqual(restoreProjectBackup(JSON.stringify(olderBackup), 'old').frames[0].edit, edit);
  assert.equal(restoreProjectBackup(JSON.stringify(olderBackup), 'old').frames[0].editHistory, undefined);

  for (const damage of [
    (history: Record<string, any>) => { history.cursor = 3; },
    (history: Record<string, any>) => { history.steps[0].before = { edit: { exposure: 100 } }; },
    (history: Record<string, any>) => { history.steps[0].after.edit.tint = 3; },
  ]) {
    const broken = JSON.parse(encodeProjectBackup(project));
    damage(broken.project.frames[0].editHistory);
    assert.throws(() => restoreProjectBackup(JSON.stringify(broken), 'x'), /invalid catalogue data/);
  }
});


test('Brightness adjustments survive portable backups and old backups remain compatible', () => {
  const project = createDemoShootState(1);
  const edit = { ...DEFAULT_EDIT, exposure: 2.5, brightness: 1.4,
    masks: [{ ...createSubjectMask('subject', { w: 8, h: 8, data: Buffer.alloc(64, 255).toString('base64') },
      'o|0|0.00|0.5000|0.5000|1.000', 'high'), edit: { brightness: 0.7 } }] };
  project.frames[0].edit = edit;
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
  assert.deepEqual(restored.frames[0].edit, edit);

  const invalid = JSON.parse(encodeProjectBackup(project));
  invalid.project.frames[0].edit.brightness = 5;
  assert.throws(() => restoreProjectBackup(JSON.stringify(invalid), 'invalid'), /invalid catalogue data/);
  const older = JSON.parse(encodeProjectBackup(project));
  delete older.project.frames[0].edit.brightness;
  delete older.project.frames[0].edit.masks;
  const legacy = restoreProjectBackup(JSON.stringify(older), 'old');
  assert.equal(legacy.frames[0].edit?.brightness, undefined, 'older projects remain neutral by default');
});
