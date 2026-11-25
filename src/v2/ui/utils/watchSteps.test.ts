import test from 'node:test';
import assert from 'node:assert/strict';
import { previewAfterSteps, readableValue, watchStepsFor } from './watchSteps.ts';
import type { EditRecipe } from '../contract';

const current = { exposure: 0, shadows: 0, highlights: 0, temperature: 0, vibrance: 0 } as unknown as EditRecipe;
const delta = { vibrance: 18, temperature: 10, shadows: 22, highlights: -18 } as Partial<EditRecipe>;

test('a suggestion with only a recipe change is watched in working order: balance, then light, then colour', () => {
  const steps = watchStepsFor(delta, current);
  assert.deepEqual(steps.map((step) => step.key), ['temperature', 'highlights', 'shadows', 'vibrance']);
  assert.deepEqual(steps.map((step) => step.group), ['white-balance', 'light', 'light', 'colour']);
  assert.ok(steps.every((step) => step.previewable));
});

test('each step adds exactly one more setting to the preview, and the last shows the whole suggestion', () => {
  const steps = watchStepsFor(delta, current);
  assert.deepEqual(previewAfterSteps(steps, delta, 0), {});
  assert.deepEqual(previewAfterSteps(steps, delta, 1), { temperature: 10 });
  assert.deepEqual(previewAfterSteps(steps, delta, 2), { temperature: 10, highlights: -18 });
  assert.deepEqual(previewAfterSteps(steps, delta, steps.length), delta);
  assert.deepEqual(previewAfterSteps(steps, delta, 99), delta);
});

test('Auto\'s own steps are used when present; a local adjustment step is shown but cannot be previewed', () => {
  const steps = watchStepsFor({ exposure: 0.4 } as Partial<EditRecipe>, current, [
    { id: 'step-1-exposure', key: 'exposure' }, { id: 'step-2-masks', key: 'masks' },
  ]);
  assert.deepEqual(steps.map((step) => [step.key, step.previewable]), [['exposure', true], ['masks', false]]);
  assert.deepEqual(previewAfterSteps(steps, { exposure: 0.4 } as Partial<EditRecipe>, 2), { exposure: 0.4 });
});

test('a setting already at its target makes no step', () => {
  const steps = watchStepsFor({ exposure: 0, vibrance: 5 } as Partial<EditRecipe>, current);
  assert.deepEqual(steps.map((step) => step.key), ['vibrance']);
});

test('values are written as a person reads them', () => {
  const words = { on: 'on', off: 'off', changed: 'changed' };
  assert.equal(readableValue(0.30000001, words), '0.3');
  assert.equal(readableValue(true, words), 'on');
  assert.equal(readableValue(undefined, words), '0');
  assert.equal(readableValue({ points: [] }, words), 'changed');
});
