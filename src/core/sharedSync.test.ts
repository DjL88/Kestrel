import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, recipeFingerprint, sharedPhotoKey } from './sharedSync.ts';

const sha = 'a'.repeat(64);

test('the shared key follows the original’s fingerprint, so the same file matches on every device', () => {
  assert.equal(sharedPhotoKey(sha), `o_${sha}`);
  assert.equal(sharedPhotoKey(sha.toUpperCase(), 2), `v2_${sha}`);
  assert.equal(sharedPhotoKey(undefined), undefined);
  assert.equal(sharedPhotoKey('not-a-hash'), undefined);
  assert.ok(`v99_${sha}`.length <= 96);
});

test('recipe fingerprints ignore key order and spot any change', () => {
  assert.equal(recipeFingerprint({ a: 1, b: { c: 2, d: [1, 2] } }), recipeFingerprint({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(recipeFingerprint({ a: 1 }), recipeFingerprint({ a: 2 }));
});

test('first sync: share a new edit, take a shared edit into an untouched photo, and never overwrite an edited one', () => {
  assert.deepEqual(planSync(null, 'h', null, true), { action: 'in-sync' });
  assert.deepEqual(planSync(null, 'h', null, false), { action: 'push', baseRevisionId: null });
  assert.deepEqual(planSync(null, 'h', 'r1', true), { action: 'pull', headId: 'r1' });
  assert.deepEqual(planSync(null, 'h', 'r1', false), { action: 'conflict', headId: 'r1' });
});

test('after a sync: only one side moving pulls or pushes; both moving is a conflict', () => {
  const last = { revisionId: 'r1', recipeHash: 'h1' };
  assert.deepEqual(planSync(last, 'h1', 'r1', false), { action: 'in-sync' });
  assert.deepEqual(planSync(last, 'h2', 'r1', false), { action: 'push', baseRevisionId: 'r1' });
  assert.deepEqual(planSync(last, 'h1', 'r2', false), { action: 'pull', headId: 'r2' });
  assert.deepEqual(planSync(last, 'h2', 'r2', false), { action: 'conflict', headId: 'r2' });
});

test('a shared edit is applied only when it is plain bounded data', async () => {
  const { readSharedEdit } = await import('./sharedSync.ts');
  assert.equal(readSharedEdit(null), null);
  assert.deepEqual(readSharedEdit({ exposure: 0.5, masks: [{ x: 1 }] }), { exposure: 0.5, masks: [{ x: 1 }] });
  assert.equal(readSharedEdit([1, 2]), false);
  assert.equal(readSharedEdit('text'), false);
  assert.equal(readSharedEdit({ exposure: Number.NaN }), false);
  assert.equal(readSharedEdit({ big: 'x'.repeat(300_000) }), false);
});
