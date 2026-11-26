import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPILED_FLAGS } from '../../core/features.ts';
import { WORKFLOW_PREVIEW_KEYS, workflowPreviewOn } from './workflowPreview.ts';

test('saved views and next-to-review ship off: compiled flags and the device switch both default to off', () => {
  assert.equal(COMPILED_FLAGS.savedViews.default, false);
  assert.equal(COMPILED_FLAGS.nextToReview.default, false);
  assert.equal(workflowPreviewOn('savedViews', null), false);
  assert.equal(workflowPreviewOn('nextToReview', { getItem: () => null }), false);
  assert.equal(workflowPreviewOn('nextToReview', { getItem: () => 'true' }), false);
});

test('only this device switch, set to exactly 1, turns a preview on, and a storage error leaves it off', () => {
  const store = new Map<string, string>([[WORKFLOW_PREVIEW_KEYS.savedViews, '1']]);
  const storage = { getItem: (key: string) => store.get(key) ?? null };
  assert.equal(workflowPreviewOn('savedViews', storage), true);
  assert.equal(workflowPreviewOn('nextToReview', storage), false);
  assert.equal(workflowPreviewOn('savedViews', { getItem: () => { throw new Error('denied'); } }), false);
});
