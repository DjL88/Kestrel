import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoShootFrames } from './cullingEngine';
import { appendProjectPhotos, createEmptyProject, moveFrames, projectSearchText } from './projects';

test('re-import revives an epoch-zero removed photo without adding a ghost duplicate', () => {
  const [photo] = generateDemoShootFrames(1);
  const first = appendProjectPhotos(createEmptyProject('shoot', 'Shoot'), [
    { ...photo, decision: 'reject' },
  ], 'first');
  const removed = {
    ...first,
    frames: first.frames.map((frame) => ({ ...frame, removedAt: 0 })),
  };

  const revived = appendProjectPhotos(removed, [photo], 'second');
  assert.notEqual(revived, removed, 'a removed photo should not be considered an active duplicate');
  assert.equal(revived.frames.length, 1);
  assert.equal(revived.frames[0].id, first.frames[0].id, 're-import keeps catalogue identity');
  assert.equal(revived.frames[0].removedAt, undefined);
  assert.equal(revived.frames[0].decision, 'unreviewed');
  assert.equal(revived.shoot.totalFrames, 1);
  assert.equal(removed.frames[0].removedAt, 0, 'the original state is not mutated');
});

test('moving a project never accidentally moves a removed-at-zero photo', () => {
  const [removedPhoto, activePhoto] = generateDemoShootFrames(2);
  const imported = appendProjectPhotos(createEmptyProject('from', 'From'), [removedPhoto, activePhoto], 'import');
  const source = {
    ...imported,
    frames: imported.frames.map((frame, i) => i === 0 ? { ...frame, removedAt: 0 } : frame),
  };
  const target = createEmptyProject('to', 'To');

  const result = moveFrames(source, target, source.frames.map((frame) => frame.id), 'move');
  assert.equal(result.moved, 1);
  assert.equal(result.target.frames[0].stableKey, activePhoto.stableKey);
  assert.equal(result.source.frames.length, 1);
  assert.equal(result.source.frames[0].stableKey, removedPhoto.stableKey);
  assert.equal(result.source.frames[0].removedAt, 0);
  assert.equal(source.frames.length, 2, 'the source project is immutable');
});

test('a removed-at-zero record in the destination cannot block an active photo move', () => {
  const [photo] = generateDemoShootFrames(1);
  const source = appendProjectPhotos(createEmptyProject('from', 'From'), [photo], 'import');
  const old = appendProjectPhotos(createEmptyProject('to', 'To'), [photo], 'old');
  const target = { ...old, frames: old.frames.map((frame) => ({ ...frame, removedAt: 0 })) };

  const result = moveFrames(source, target, [source.frames[0].id], 'move');
  assert.equal(result.moved, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.source.frames.length, 0);
  assert.equal(result.target.frames.filter((frame) => frame.removedAt == null).length, 1);
  assert.equal(result.target.frames.filter((frame) => frame.removedAt != null).length, 1, 'Trash history is retained');
});

test('project searches never surface photos removed at timestamp zero', () => {
  const searchable = projectSearchText([
    { filename: 'DSC_0001.NEF', tags: ['Osprey'], removedAt: 0 },
    { filename: 'DSC_0002.NEF', tags: ['Red Kite'] },
  ]);
  assert.equal(searchable.includes('osprey'), false);
  assert.equal(searchable.includes('dsc_0001'), false);
  assert.equal(searchable.includes('red kite'), true);
  assert.equal(searchable.includes('dsc_0002'), true);
});
