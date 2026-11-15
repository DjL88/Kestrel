import test from 'node:test';
import assert from 'node:assert/strict';
import { appendProjectPhotos, createEmptyProject } from './projects';
import { generateDemoShootFrames } from './cullingEngine';

test('adding photos is additive, keeps decisions, and deduplicates originals across imports', () => {
  const [a, b] = generateDemoShootFrames(2);
  const empty = createEmptyProject('shoot', 'Dogs');
  const first = appendProjectPhotos(empty, [{ ...a, decision: 'keep', rating: 5 }], 'first');
  const second = appendProjectPhotos(first, [a, b], 'second');
  assert.equal(second.shoot.title, 'Dogs');
  assert.equal(second.shoot.totalFrames, 2);
  assert.equal(second.selectedFrameId, first.selectedFrameId);
  assert.equal(second.frames[0].decision, 'keep');
  assert.equal(second.frames[0].rating, 5);
  assert.equal(second.frames[1].sequenceIndex, 2);
  assert.notEqual(second.frames[0].id, second.frames[1].id);
});

import { setArchived, splitProjects, unreferencedBlobKeys } from './projects';

function withFiles(id: string, keys: string[], kind: 'file' | 'directory-handle' = 'file') {
  const base = createEmptyProject(id, id);
  return { ...base, frames: keys.map((key, index) => ({ id: `${id}-${index}`, stableKey: key, sourceKind: kind } as import('./types').PhotoFrame)) };
}

test('deleting a project frees only the stored photo copies nothing else uses', () => {
  const doomed = withFiles('a', ['x', 'y', 'z']);
  const other = withFiles('b', ['y']);
  assert.deepEqual(unreferencedBlobKeys(doomed, [other]).sort(), ['x', 'z']);
  assert.deepEqual(unreferencedBlobKeys(doomed, []).sort(), ['x', 'y', 'z']);
});

test('photos read from a folder have no stored copies to free', () => {
  assert.deepEqual(unreferencedBlobKeys(withFiles('a', ['x'], 'directory-handle'), []), []);
});

test('archiving sets a date, restoring clears it, and the lists split cleanly', () => {
  const project = createEmptyProject('p', 'P');
  const archived = setArchived(project, 1000);
  assert.equal(archived.shoot.archivedAt, 1000);
  assert.equal('archivedAt' in setArchived(archived, undefined).shoot, false);
  const { active, archived: gone } = splitProjects([project.shoot, archived.shoot]);
  assert.equal(active.length, 1);
  assert.equal(gone.length, 1);
});
