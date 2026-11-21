import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conservativeReviewTargets } from './photoReviewStep';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';

test('a model cannot apply an enormous exposure or colour change in one press', () => {
  const actual = conservativeReviewTargets(DEFAULT_EDIT, { exposure: 2, warmth: -2, colour: 2, highlights: -2 });
  assert.deepEqual(actual, { exposure: 0.2, warmth: -0.3, colour: 0.3, highlights: -0.3 });
});

test('positive, negative and return-to-neutral targets are relative to the current edit', () => {
  const current: PhotoEdit = { exposure: 0.6, warmth: 0.15, colour: -0.5, masks: [] };
  const got = conservativeReviewTargets(current, { exposure: 0, warmth: -0.15, colour: -0.4 });
  assert.deepEqual(got, { exposure: 0.4, warmth: -0.15, colour: -0.4 });
  assert.equal('masks' in got, false);
});

test('no-op, unsupported and invalid values cannot enter an edit recipe', () => {
  const got = conservativeReviewTargets(DEFAULT_EDIT, { warmth: 0, colour: Number.NaN, exposure: Infinity, masks: [] } as never);
  assert.deepEqual(got, {});
  assert.deepEqual(conservativeReviewTargets(DEFAULT_EDIT, {}), {});
});
