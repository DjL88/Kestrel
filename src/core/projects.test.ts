import test from 'node:test';
import assert from 'node:assert/strict';
import { appendProjectPhotos, createEmptyProject, filterProjects, projectSearchText, sortProjects } from './projects';
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

import { INBOX_ID, createInboxProject, inboxFirst, moveFrames } from './projects';

function framesFor(project: CullingState, keys: string[]) {
  return { ...project, frames: keys.map((key, i) => ({ id: `${project.shoot.id}-${i}`, stableKey: key, filename: `${key}.jpg`, sequenceIndex: i + 1, decision: 'keep', burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', edit: { exposure: 1, warmth: 0, colour: 0 } } as PhotoFrame)) };
}
import type { CullingState, PhotoFrame } from './types';

test('the Quick edits bucket is flagged, has the helpers off and sorts first', () => {
  const inbox = createInboxProject();
  assert.equal(inbox.shoot.id, INBOX_ID);
  assert.equal(inbox.shoot.inbox, true);
  assert.deepEqual(inbox.settings, { autoCull: false, autoEdit: false });
  const list = inboxFirst([{ id: 'a' }, { id: 'q', inbox: true }, { id: 'b' }] as { id: string; inbox?: boolean }[]);
  assert.deepEqual(list.map((p) => p.id), ['q', 'a', 'b']);
});

test('moving photos takes their edits along and leaves the rest', () => {
  const source = framesFor(createInboxProject(), ['a', 'b', 'c']);
  const target = framesFor(createEmptyProject('t', 'Target'), ['z']);
  const result = moveFrames(source, target, [source.frames[0].id, source.frames[2].id], 'mv1');
  assert.equal(result.moved, 2);
  assert.deepEqual(result.source.frames.map((f) => f.stableKey), ['b']);
  assert.deepEqual(result.target.frames.map((f) => f.stableKey), ['z', 'a', 'c']);
  assert.equal(result.target.frames[1].edit?.exposure, 1, 'edits travel with the photo');
  assert.equal(result.target.frames[1].sequenceIndex, 2);
  assert.equal(result.target.shoot.totalFrames, 3);
  assert.equal(result.source.shoot.totalFrames, 1);
  assert.equal(new Set(result.target.frames.map((f) => f.id)).size, 3, 'ids stay unique');
  assert.deepEqual(result.source.undoStack, []);
});

test('a photo already in the target stays put, and nothing happens if nothing can move', () => {
  const source = framesFor(createInboxProject(), ['a', 'b']);
  const target = framesFor(createEmptyProject('t', 'Target'), ['a']);
  const result = moveFrames(source, target, source.frames.map((f) => f.id), 'mv2');
  assert.equal(result.moved, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.source.frames.map((f) => f.stableKey), ['a'], 'the duplicate was not removed from the source');
  const none = moveFrames(source, target, [source.frames[0].id], 'mv3');
  assert.equal(none.moved, 0);
  assert.equal(none.source, source);
  assert.equal(none.target, target);
});

test('a photo and its virtual copies always move together, with links kept', () => {
  const base = framesFor(createInboxProject(), ['a', 'b']);
  const copy = { ...base.frames[0], id: 'copy-1', virtualCopy: { originalFrameId: base.frames[0].id, number: 1 }, sequenceIndex: 3 } as PhotoFrame;
  const source = { ...base, frames: [...base.frames, copy] };
  const result = moveFrames(source, createEmptyProject('t', 'T'), ['copy-1'], 'mv4');
  assert.equal(result.moved, 2);
  const movedCopy = result.target.frames.find((f) => f.virtualCopy)!;
  assert.ok(result.target.frames.some((f) => f.id === movedCopy.virtualCopy!.originalFrameId), 'the link points at the moved original');
  assert.deepEqual(result.source.frames.map((f) => f.stableKey), ['b']);
});

test('removed photos are never moved', () => {
  const source = framesFor(createInboxProject(), ['a']);
  const removed = { ...source, frames: [{ ...source.frames[0], removedAt: 5 }] };
  assert.equal(moveFrames(removed, createEmptyProject('t', 'T'), [removed.frames[0].id], 'mv5').moved, 0);
});

test('search finds projects by title and by the photos inside them', () => {
  const projects = [
    { id: 'a', title: 'Spring walk', createdAt: 1, lastUpdatedAt: 5 },
    { id: 'b', title: 'Hide day', createdAt: 2, lastUpdatedAt: 9 },
  ];
  const text = {
    a: projectSearchText([{ filename: 'DSC_0001.NEF' }]),
    b: projectSearchText([{ filename: 'DSC_0107.NEF', subjectNames: ['Red Kite'], tags: ['Bird of Prey'] }, { filename: 'gone.jpg', tags: ['Fox'], removedAt: 1 }]),
  };
  assert.deepEqual(filterProjects(projects, '', text).map((hit) => hit.project.id), ['a', 'b']);
  assert.deepEqual(filterProjects(projects, 'spring', text), [{ project: projects[0], viaPhotos: false }]);
  assert.deepEqual(filterProjects(projects, 'red kite', text), [{ project: projects[1], viaPhotos: true }]);
  assert.deepEqual(filterProjects(projects, 'hide prey', text), [{ project: projects[1], viaPhotos: true }]);
  assert.equal(filterProjects(projects, 'fox', text).length, 0, 'removed photos are not searched');
  assert.equal(filterProjects(projects, 'unicorn', text).length, 0);
});

test('projects sort by last edited, created or name', () => {
  const items = [
    { title: 'Trip 10', createdAt: 3, lastUpdatedAt: 1 },
    { title: 'trip 2', createdAt: 1, lastUpdatedAt: 3 },
    { title: 'Alps', createdAt: 2, lastUpdatedAt: 2 },
  ];
  assert.deepEqual(sortProjects(items, 'edited').map((p) => p.title), ['trip 2', 'Alps', 'Trip 10']);
  assert.deepEqual(sortProjects(items, 'created').map((p) => p.title), ['Trip 10', 'Alps', 'trip 2']);
  assert.deepEqual(sortProjects(items, 'name').map((p) => p.title), ['Alps', 'trip 2', 'Trip 10']);
});

import { applyImportBursts } from './projects';
import { assignBurstGroups } from './cullingEngine';

test('a progressive import in batches ends with the same photos and bursts as adding them all at once', () => {
  // Six shots: a burst of four (one second apart) that straddles the batch boundary, then two lone shots.
  const times = [0, 1000, 2000, 3000, 600_000, 1_200_000];
  const shots = times.map((ms, i) => ({
    ...generateDemoShootFrames(1)[0], id: `file-${i + 1}-p${i}.nef`, stableKey: `local-file://p${i}.nef::1::${i}`,
    filename: `p${i}.nef`, sequenceIndex: i + 1, decision: 'unreviewed' as const,
    exif: { ...generateDemoShootFrames(1)[0].exif, capturedAtMs: 1_700_000_000_000 + ms },
  }));
  const empty = createEmptyProject('shoot', 'Dippers');
  const allAtOnce = appendProjectPhotos(empty, assignBurstGroups(shots), 'imp');

  // Batches as the loader reports them: each is grouped only with what has been read so far.
  let progressive = appendProjectPhotos(empty, assignBurstGroups(shots.slice(0, 2)), 'imp');
  progressive = appendProjectPhotos(progressive, assignBurstGroups(shots.slice(0, 4)).slice(2), 'imp');
  progressive = appendProjectPhotos(progressive, assignBurstGroups(shots).slice(4), 'imp');
  // A decision made during the import must survive the final regrouping.
  progressive = { ...progressive, frames: progressive.frames.map((f, i) => (i === 0 ? { ...f, decision: 'keep' as const } : f)) };
  const finished = applyImportBursts(progressive, assignBurstGroups(shots), 'imp');

  const view = (s: typeof finished) => s.frames.map((f) => [f.id, f.sequenceIndex, f.burstGroupId, f.burstIndex, f.burstCount]);
  assert.deepEqual(view(finished), view(allAtOnce));
  assert.equal(finished.frames[0].decision, 'keep');
  assert.equal(finished.frames.filter((f) => f.burstCount === 4).length, 4, 'the burst across batches is whole again');
  assert.equal(applyImportBursts(finished, assignBurstGroups(shots), 'imp'), finished, 'nothing to change returns the same state');
  assert.equal(applyImportBursts(finished, assignBurstGroups(shots), 'other'), finished, 'other imports are untouched');
});
