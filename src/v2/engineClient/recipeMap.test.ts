import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDetail, applyPhotoEdit, isNeutralEdit } from '../../core/photoEdits.ts';
import { applyRecipePatch, editToRecipe, NEUTRAL_RECIPE, previewLookEdit } from './recipeMap.ts';

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
  const patch = { exposure: -1.2, temperature: -30, tint: 22, highlights: -40, shadows: 22, whites: 6, blacks: -8, vibrance: 18, saturation: 14, clarity: 16, contrast: 14 };
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
  assert.deepEqual(applyRecipePatch(undefined, { lensCorrection: true, denoiseLuminance: 30, upscaleFactor: 2 }).unmapped, ['lensCorrection']);
  assert.deepEqual(applyRecipePatch(undefined, { contrast: 10, lookId: 'x' }).unmapped, []);
});

test('values outside the slider range are held inside it', () => {
  assert.equal(applyRecipePatch(undefined, { exposure: 9 }).edit.exposure, 12.5);
  assert.equal(applyRecipePatch(undefined, { contrast: 400 }).edit.contrast, 2);
  const { edit, unmapped } = applyRecipePatch(undefined, { tint: -120 });
  assert.equal(edit.tint, -2);
  assert.deepEqual(unmapped, []);
  assert.equal(applyRecipePatch(edit, { tint: 0 }).edit.tint, undefined);
});

test('upscale is a real edit: it maps both ways, is not "unmapped", and a neutral factor removes it', () => {
  const two = applyRecipePatch(undefined, { upscaleFactor: 2 });
  assert.equal(two.edit.upscale, 2);
  assert.deepEqual(two.unmapped, []);
  assert.equal(editToRecipe(two.edit).upscaleFactor, 2);
  assert.equal(isNeutralEdit(two.edit), false, 'an upscaled photo counts as edited, so it is kept and undoable');
  assert.equal('upscale' in applyRecipePatch(two.edit, { upscaleFactor: 1 }).edit, false);
  assert.equal(editToRecipe(undefined).upscaleFactor, 1);
});

test('V2 existing-detail control round-trips through the real texture edit and can be reset', () => {
  const added = applyRecipePatch(undefined, { detailRecovery: 55 });
  assert.equal(added.edit.texture, 1.1);
  assert.deepEqual(added.unmapped, []);
  assert.equal(editToRecipe(added.edit).detailRecovery, 55);
  assert.equal(isNeutralEdit(added.edit), false, 'a real texture edit is undoable');
  const removed = applyRecipePatch(added.edit, { detailRecovery: 0 });
  assert.equal(removed.edit.texture, undefined);
  assert.equal(editToRecipe(removed.edit).detailRecovery, 0);
  assert.equal(isNeutralEdit(removed.edit), true);
});

test('texture changes actual sampled pixels, not merely a visible slider', () => {
  const width = 30;
  const height = 30;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const luminance = Math.floor(x / 5) % 2 ? 180 : 60;
    source[i] = source[i + 1] = source[i + 2] = luminance;
    source[i + 3] = 255;
  }
  const edited = new Uint8ClampedArray(source);
  const { edit } = applyRecipePatch(undefined, { detailRecovery: 80 });
  applyDetail(edited, width, height, edit, Math.max(width, height));
  assert.notDeepEqual(edited, source, 'texture changes sampled pixels in the shared editing maths');
});

test('non-existent engines stay honestly unavailable while output upscale and texture work', () => {
  assert.deepEqual(
    applyRecipePatch(undefined, {
      detailRecovery: 80, denoiseRawAi: true, denoiseLuminance: 20, lensCorrection: true, upscaleFactor: 2,
    }).unmapped,
    ['denoiseRawAi', 'lensCorrection'],
  );
});

test('hover Look preview edits real pixels without storing or mutating the current recipe', () => {
  const original = applyRecipePatch(undefined, { exposure: 0.4 }).edit;
  const savedExposure = original.exposure;
  const suggestion = { exposure: -1.2, saturation: -100, contrast: 32 };
  const hovered = previewLookEdit(original, suggestion);
  assert.ok(hovered);
  assert.notStrictEqual(hovered, original, 'hover produces a temporary recipe');
  assert.equal(original.exposure, savedExposure, 'saved recipe is unchanged');
  assert.equal(hovered.exposure, -3, 'the candidate uses requested Look values');
  assert.equal(hovered.colour, -2, 'monochrome preview is a real edit');
  const before = new Uint8ClampedArray([100, 145, 210, 255]);
  const after = new Uint8ClampedArray(before);
  applyPhotoEdit(before, original);
  applyPhotoEdit(after, hovered);
  assert.notDeepEqual(after, before, 'look hover changes actual rendered colours');
  assert.strictEqual(previewLookEdit(original, undefined), original, 'leaving a Look restores the exact existing edit');
  assert.strictEqual(previewLookEdit(undefined, undefined), undefined, 'unedited photos stay neutral');
});
