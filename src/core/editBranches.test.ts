import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from './types';
import { recordEdit } from './editHistory';
import {
  describeEditVersions, forkEditCheckpoint, MAX_EDIT_VERSIONS,
  readEditVersions, ROOT_VERSION_ID, switchEditVersion,
} from './editBranches';

function source(): PhotoFrame {
  return {
    id: 'photograph-1', stableKey: 'originals/wildlife.NEF',
    originalSha256: 'a'.repeat(64), filename: 'wildlife.NEF',
    sequenceIndex: 1, decision: 'keep', rating: 4, burstGroupId: null,
    burstIndex: 0, burstCount: 1, exif: { width: 8256, height: 5504 },
    isDemo: false, sourceKind: 'file', sourcePath: '/photos/wildlife.NEF',
    sizeCrops: { 'orig-3x2': { zoom: 1, panX: 0 } },
    overlay: { text: 'original version' },
    formats: { disabled: [], custom: [] },
  };
}

function edited(): PhotoFrame {
  let frame = source();
  frame = recordEdit(frame, { edit: { exposure: 0.2, warmth: 0, colour: 0 } }, 1000);
  frame = recordEdit(frame, { edit: { exposure: 0.2, warmth: 0, colour: 1 } }, 2000);
  frame = recordEdit(frame, { edit: { exposure: 0.5, warmth: 0, colour: 1 } }, 3000);
  return frame;
}

test('fork restores selected edit checkpoint but preserves the whole existing parent timeline', () => {
  const parent = edited();
  const newVersion = forkEditCheckpoint(parent, 1, 'fork-a', 4000);
  assert.notEqual(newVersion, parent);
  assert.equal(newVersion.edit?.exposure, 0.2);
  assert.equal(newVersion.edit?.colour, 0);
  assert.equal(newVersion.editHistory?.cursor, 1);
  assert.equal(newVersion.editHistory?.steps.length, 1);
  assert.equal(parent.editHistory?.steps.length, 3);
  assert.equal(parent.edit?.exposure, 0.5);
  const tree = readEditVersions(newVersion.editVersions)!;
  assert.deepEqual(tree.versions.map(v => [v.id, v.parentId, v.forkCursor]), [
    [ROOT_VERSION_ID, null, 0], ['fork-a', ROOT_VERSION_ID, 1],
  ]);
  assert.equal(tree.versions[0].snapshot.editHistory?.steps.length, 3);
});

test('switching A/B retains independent later edits and independent crop/overlay values', () => {
  const parent = edited();
  const first = forkEditCheckpoint(parent, 1, 'fork-a', 4000);
  const branchEdited = recordEdit({
    ...first,
    sizeCrops: { 'orig-3x2': { zoom: 2, panX: 11 } },
    overlay: { text: 'fork text' },
  }, { edit: { exposure: 0.7, warmth: 0, colour: 0 } }, 5000);

  const parentAgain = switchEditVersion(branchEdited, ROOT_VERSION_ID);
  assert.equal(parentAgain.edit?.exposure, 0.5);
  assert.equal(parentAgain.edit?.colour, 1);
  assert.equal(parentAgain.editHistory?.steps.length, 3);
  assert.deepEqual(parentAgain.sizeCrops, source().sizeCrops);
  assert.deepEqual(parentAgain.overlay, { text: 'original version' });

  const branchAgain = switchEditVersion(parentAgain, 'fork-a');
  assert.equal(branchAgain.edit?.exposure, 0.7);
  assert.equal(branchAgain.editHistory?.steps.length, 2);
  assert.deepEqual(branchAgain.sizeCrops, { 'orig-3x2': { zoom: 2, panX: 11 } });
  assert.deepEqual(branchAgain.overlay, { text: 'fork text' });
});

test('only recipe metadata forks; the original file SHA, source and catalogue identity never change', () => {
  const original = edited();
  const fork = forkEditCheckpoint(original, 0, 'fork-a', 4000);
  assert.equal(fork.edit, undefined);
  for (const key of ['id','stableKey','originalSha256','sourcePath','filename','decision','rating'] as const) {
    assert.deepEqual(fork[key], original[key], key);
  }
  const roundTrip = JSON.parse(JSON.stringify(fork)) as PhotoFrame;
  const back = switchEditVersion(roundTrip, ROOT_VERSION_ID);
  assert.equal(back.originalSha256, original.originalSha256);
  assert.equal(back.sourcePath, original.sourcePath);
  assert.equal(back.edit?.exposure, 0.5);
});

test('a branch may fork again, preserving lineage and the first fork', () => {
  const a = forkEditCheckpoint(edited(), 2, 'fork-a', 4000);
  const b = forkEditCheckpoint(a, 1, 'fork-b', 5000);
  assert.deepEqual(describeEditVersions(b.editVersions).map(v => [v.id, v.parentId]), [
    [ROOT_VERSION_ID, null], ['fork-a', ROOT_VERSION_ID], ['fork-b', 'fork-a'],
  ]);
  assert.equal(switchEditVersion(b, 'fork-a').editHistory?.steps.length, 2);
});

test('invalid cursor/IDs, corrupted saved branch record and unknown switch fail closed', () => {
  const frame = edited();
  for (const [cursor, id] of [[-1,'bad'],[4,'too-far'],[1,'../unsafe'],[1,ROOT_VERSION_ID]] as const) {
    assert.equal(forkEditCheckpoint(frame, cursor, id, 4000), frame);
  }
  const fork = forkEditCheckpoint(frame, 1, 'fork-a', 4000);
  assert.equal(switchEditVersion(fork, 'missing'), fork);
  const corrupted = { ...fork, editVersions: { version: 1, activeId:'unknown', versions: [] } } as unknown as PhotoFrame;
  assert.equal(forkEditCheckpoint(corrupted, 1, 'next', 5000), corrupted);
  assert.equal(readEditVersions(corrupted.editVersions), undefined);
});

test('bounded branch count prevents unbounded metadata growth without mutating existing versions', () => {
  let frame = edited();
  for (let i = 1; i < MAX_EDIT_VERSIONS; i++) {
    frame = forkEditCheckpoint(frame, 0, `branch-${i}`, 4000 + i);
  }
  assert.equal(describeEditVersions(frame.editVersions).length, MAX_EDIT_VERSIONS);
  assert.equal(forkEditCheckpoint(frame, 0, 'too-many', 9999), frame);
});

test('a damaged saved branch cannot rewrite the identity or source path of the physical original', () => {
  const live = forkEditCheckpoint(edited(), 1, 'fork-a', 4000);
  const tree = readEditVersions(live.editVersions)!;
  const tainted = {
    ...live,
    editVersions: {
      ...tree,
      versions: tree.versions.map((version) => version.id === ROOT_VERSION_ID
        ? { ...version, snapshot: {
          ...version.snapshot,
          id: 'forged-photo',
          originalSha256: 'b'.repeat(64),
          stableKey: 'another-photo',
          sourcePath: '/wrong-original.NEF',
          rating: 0,
        } as typeof version.snapshot }
        : version),
    },
  };
  const switched = switchEditVersion(tainted, ROOT_VERSION_ID);
  assert.equal(switched.id, live.id);
  assert.equal(switched.stableKey, live.stableKey);
  assert.equal(switched.sourcePath, live.sourcePath);
  assert.equal(switched.originalSha256, live.originalSha256);
  assert.equal(switched.rating, 4);
});
