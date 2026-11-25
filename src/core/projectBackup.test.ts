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

test('portable restore rejects corrupt original SHA-256 and preserves legacy missing fingerprint', () => {
  const project = createDemoShootState(1);
  const digest = 'a'.repeat(64);
  project.frames[0].originalSha256 = digest;
  const valid = encodeProjectBackup(project);
  assert.equal(restoreProjectBackup(valid, 'restored').frames[0].originalSha256, digest);
  for (const invalid of ['', 'unknown', 'A'.repeat(64), 'f'.repeat(63), 'z'.repeat(64), 123, null]) {
    const damaged = JSON.parse(valid);
    damaged.project.frames[0].originalSha256 = invalid;
    assert.throws(() => restoreProjectBackup(JSON.stringify(damaged), 'restored'), /invalid catalogue data/, String(invalid));
  }
  const legacy = JSON.parse(valid);
  delete legacy.project.frames[0].originalSha256;
  assert.equal(restoreProjectBackup(JSON.stringify(legacy), 'restored').frames[0].originalSha256, undefined);
});


test('restore refuses conflicting original byte identities on a virtual copy', () => {
  const project = createDemoShootState(1);
  project.frames[0].originalSha256 = 'a'.repeat(64);
  const copy = createVirtualCopy(project.frames[0], project.frames, 'copy-sha');
  copy.originalSha256 = 'b'.repeat(64);
  project.frames.push(copy);
  assert.throws(() => restoreProjectBackup(encodeProjectBackup(project), 'restored'), /conflicting original byte identities/);

  // A virtual copy must never bypass this check by reusing the same stable key.
  copy.originalSha256 = project.frames[0].originalSha256;
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
  assert.equal(restored.frames[1].originalSha256, 'a'.repeat(64));

  // Older catalogues did not always record hashes. They may be restored, but
  // source bytes still need to be independently verified before any relink.
  delete copy.originalSha256;
  const legacy = restoreProjectBackup(encodeProjectBackup(project), 'legacy');
  assert.equal(legacy.frames[1].originalSha256, undefined);
});

test('restore rejects conflicting SHA-256 for the same original stable key even without virtual copies', () => {
  const project = createDemoShootState(2);
  const first = project.frames[0];
  const second = project.frames[1];
  first.originalSha256 = 'a'.repeat(64);
  second.stableKey = first.stableKey;
  second.originalSha256 = 'b'.repeat(64);
  assert.throws(
    () => restoreProjectBackup(encodeProjectBackup(project), 'restored'),
    /conflicting original byte identities/,
  );
});

test('same-key matching hashes survive backup roundtrip; legacy missing hashes remain unverified', () => {
  const project = createDemoShootState(2);
  project.frames[0].originalSha256 = 'c'.repeat(64);
  project.frames[1].stableKey = project.frames[0].stableKey;
  project.frames[1].originalSha256 = 'c'.repeat(64);
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
  assert.deepEqual(restored.frames.map((frame) => frame.originalSha256), ['c'.repeat(64), 'c'.repeat(64)]);
  delete project.frames[1].originalSha256;
  const legacy = restoreProjectBackup(encodeProjectBackup(project), 'legacy');
  assert.equal(legacy.frames[1].originalSha256, undefined);
  assert.equal(legacy.frames[0].originalSha256, 'c'.repeat(64));
});


test('portable restore rejects fractional and unsafe catalogue sequence and burst indices', () => {
  const project = createDemoShootState(2);
  const baseline = encodeProjectBackup(project);
  for (const field of ['sequenceIndex', 'burstIndex', 'burstCount'] as const) {
    for (const invalid of [0.5, -0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const damaged = JSON.parse(baseline);
      damaged.project.frames[0][field] = invalid;
      assert.throws(() => restoreProjectBackup(JSON.stringify(damaged), 'restored'), /invalid catalogue data/,
        `${field}=${invalid}`);
    }
  }
  const restored = restoreProjectBackup(baseline, 'restored');
  assert.deepEqual(restored.frames.map(frame => frame.sequenceIndex), project.frames.map(frame => frame.sequenceIndex));
});

test('collage backup preserves pages, repeat appearances and rejects orphan slots', async () => {
  const { createCollage, duplicateCollagePage } = await import('./collage');
  const project = createDemoShootState(3);
  project.shoot.collage = duplicateCollagePage(createCollage(project.frames.map(f => f.id), 'a4-portrait'));
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
  assert.deepEqual(restored.shoot.collage, project.shoot.collage);
  const bad = JSON.parse(encodeProjectBackup(project));
  bad.project.shoot.collage.pages[0].slots[0].photoId = 'missing';
  assert.throws(() => restoreProjectBackup(JSON.stringify(bad), 'restored'), /invalid collage layout or photo links/);
});


test('portable restore never opens a removed photo but retains it for recovery', () => {
  const project = createDemoShootState(3);
  project.frames[0].removedAt = 0;
  project.frames[1].removedAt = 1000;
  project.selectedFrameId = project.frames[0].id;
  project.compareRightFrameId = project.frames[1].id;
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
  assert.equal(restored.selectedFrameId, null);
  assert.equal(restored.compareRightFrameId, null);
  assert.equal(restored.frames.length, 3);
  assert.equal(restored.frames[0].removedAt, 0);
  project.selectedFrameId = project.frames[2].id;
  assert.equal(restoreProjectBackup(encodeProjectBackup(project), 'restored').selectedFrameId, project.frames[2].id);
});
