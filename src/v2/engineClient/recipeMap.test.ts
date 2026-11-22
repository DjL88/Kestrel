import assert from 'node:assert/strict';
import test from 'node:test';
import { isNeutralEdit } from '../../core/photoEdits.ts';
import { applyRecipePatch, editToRecipe, NEUTRAL_RECIPE } from './recipeMap.ts';

test('a photo with no edit shows a neutral recipe, never invented adjustments', () => {
  assert.deepEqual(editToRecipe(undefined), NEUTRAL_RECIPE);
  assert.equal(NEUTRAL_RECIPE.exposure, 0);
  assert.equal(NEUTRAL_RECIPE.sharpen, 0);
  assert.equal(NEUTRAL_RECIPE.lensCorrection, false);
});

test('slider values reach the engine edit in its own units', () => {
  const { edit } = applyRecipePatch(undefined, { exposure: 0.8, temperature: 50, contrast: 25, saturation: 100, sharpen: 50, denoiseColour: 100 });
  assert.equal(edit.exposure, 2, '0.8 EV is two 0.4 EV steps');
  assert.equal(edit.warmth, 1);
  assert.equal(edit.contrast, 0.5);
  assert.equal(edit.colour, 2);
  assert.equal(edit.sharpen, 1);
  assert.equal(edit.denoise, 2);
});

test('what the sliders say comes back unchanged (round trip)', () => {
  const patch = { exposure: -1.2, temperature: -30, tint: 0, highlights: -40, shadows: 22, whites: 6, blacks: -8, vibrance: 18, saturation: 14, clarity: 16, contrast: 14 };
  const back = editToRecipe(applyRecipePatch(undefined, patch).edit);
  for (const [key, value] of Object.entries(patch)) assert.ok(Math.abs((back as never as Record<string, number>)[key] - value) < 0.011, `${key}: ${(back as never as Record<string, number>)[key]} vs ${value}`);
});

test('minus 100 saturation is the engine monochrome, and it reads back as minus 100', () => {
  const { edit } = applyRecipePatch(undefined, { saturation: -100 });
  assert.equal(edit.colour, -2);
  assert.equal(editToRecipe(edit).saturation, -100);
});

test('an all-neutral patch leaves a neutral edit, and masks already on the photo are kept', () => {
  assert.equal(isNeutralEdit(applyRecipePatch(undefined, { exposure: 0, contrast: 0 }).edit), true);
  const masks = [{ id: 'm1' }] as never;
  assert.equal(applyRecipePatch({ exposure: 0, warmth: 0, colour: 0, masks }, { contrast: 10 }).edit.masks, masks);
});

test('controls the engine cannot apply yet are reported, not silently ignored', () => {
  assert.deepEqual(applyRecipePatch(undefined, { tint: 10, lensCorrection: true, denoiseLuminance: 30 }).unmapped, ['tint', 'denoiseLuminance', 'lensCorrection']);
  assert.deepEqual(applyRecipePatch(undefined, { contrast: 10, lookId: 'x' }).unmapped, []);
});

test('values outside the slider range are held inside it', () => {
  assert.equal(applyRecipePatch(undefined, { exposure: 9 }).edit.exposure, 12.5);
  assert.equal(applyRecipePatch(undefined, { contrast: 400 }).edit.contrast, 2);
});
