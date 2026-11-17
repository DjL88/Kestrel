import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storyFromCurrentEdit } from './editStoryFromEdit';
import { DEFAULT_EDIT } from './photoEdits';
import type { Mask } from './maskTypes';

test('neutral edit creates honest original and final slides only', () => {
  const story = storyFromCurrentEdit(DEFAULT_EDIT);
  assert.deepEqual(story.steps.map((step) => step.kind), ['original', 'final']);
});

test('global adjustments appear without claiming historic slider order', () => {
  const story = storyFromCurrentEdit({ ...DEFAULT_EDIT, exposure: 0.7 }, 'square');
  assert.deepEqual(story.steps.map((step) => step.kind), ['original', 'adjustments', 'final']);
  assert.equal(story.format, 'square');
});

test('local subject and gradient steps follow saved mask order without file metadata', () => {
  const masks = [
    { id: 'subject', kind: 'subject', edit: { exposure: 0.5 } },
    { id: 'gradient', kind: 'linear', edit: { contrast: -0.4 } },
    { id: 'unused', kind: 'radial', edit: { exposure: 0 } },
  ] as unknown as Mask[];
  const story = storyFromCurrentEdit({ ...DEFAULT_EDIT, masks });
  assert.deepEqual(story.steps.map((step) => step.kind),
    ['original', 'subject-mask', 'linear-mask', 'final']);
  assert.ok(story.steps.every((step) => !JSON.stringify(step).includes('subject\":')));
});
