import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDetail, applyPhotoEdit, isNeutralEdit } from '../../core/photoEdits.ts';
import { applyRecipePatch, editToRecipe, NEUTRAL_RECIPE, previewLookEdit, removeLookPatch } from './recipeMap.ts';
import { INITIAL_LOOKS } from '../ui/stub.ts';

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

test('the tone curve reaches the engine and reads back; a straight or broken curve is stored as none', () => {
  const curve: Array<[number, number]> = [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]];
  const { edit } = applyRecipePatch(undefined, { toneCurve: curve });
  assert.deepEqual(edit.curve, curve);
  assert.deepEqual(editToRecipe(edit).toneCurve, curve);
  assert.equal(applyRecipePatch(edit, { toneCurve: [[0, 0], [1, 1]] }).edit.curve, undefined);
  assert.equal(applyRecipePatch(edit, { toneCurve: [[0.6, 0], [0.4, 1]] }).edit.curve, undefined);
  assert.equal(applyRecipePatch(edit, { toneCurve: undefined }).edit.curve, undefined);
  assert.equal(editToRecipe(undefined).toneCurve, undefined);
});

test('the colour mixer maps slider points to engine steps and back', () => {
  const zero = () => Array(8).fill(0);
  const saturation = zero(); saturation[5] = -60; // blue band
  const { edit } = applyRecipePatch(undefined, { colourMixer: { hue: zero(), saturation, luminance: zero() } });
  assert.equal(edit.mixer?.saturation[5], -1.2);
  assert.deepEqual(editToRecipe(edit).colourMixer?.saturation, saturation);
  assert.equal(applyRecipePatch(edit, { colourMixer: { hue: zero(), saturation: zero(), luminance: zero() } }).edit.mixer, undefined);
  const wild = zero(); wild[0] = 500;
  assert.equal(applyRecipePatch(undefined, { colourMixer: { hue: wild, saturation: zero(), luminance: zero() } }).edit.mixer?.hue[0], 2, 'clamped');
});

test('white balance in kelvin reaches the engine and reads back; back to as shot stores nothing', () => {
  const { edit } = applyRecipePatch(undefined, { whiteBalance: { asShotK: 5480, kelvin: 6500 } });
  assert.deepEqual(edit.whiteBalance, { asShotK: 5480, kelvin: 6500 });
  assert.deepEqual(editToRecipe(edit).whiteBalance, { asShotK: 5480, kelvin: 6500 });
  assert.equal(applyRecipePatch(edit, { whiteBalance: { asShotK: 5480, kelvin: 5480 } }).edit.whiteBalance, undefined);
  assert.equal(applyRecipePatch(edit, { whiteBalance: undefined }).edit.whiteBalance, undefined);
  assert.equal(applyRecipePatch(edit, { whiteBalance: { asShotK: 5480, kelvin: 90000 } }).edit.whiteBalance, undefined);
});

test('advanced colour grading and channel curves round-trip between the recipe and the engine edit', () => {
  const colourGrade = { shadows: { hue: 210, amount: 40 }, midtones: { hue: 0, amount: 0 }, highlights: { hue: 35, amount: 25 }, balance: -20 };
  const { edit } = applyRecipePatch(undefined, { colourGrade, channelCurves: { red: [[0, 0], [0.5, 0.6], [1, 1]], green: [[0, 0], [1, 1]] } });
  assert.deepEqual(edit.grade, { shadows: [210, 0.4], midtones: [0, 0], highlights: [35, 0.25], balance: -0.2 });
  assert.deepEqual(edit.channelCurves, { red: [[0, 0], [0.5, 0.6], [1, 1]] }, 'a straight channel is dropped');
  const back = editToRecipe(edit);
  assert.deepEqual(back.colourGrade, colourGrade);
  assert.deepEqual(back.channelCurves, { red: [[0, 0], [0.5, 0.6], [1, 1]] });
  // A hue chosen before its strength is kept; clearing everything removes the grade.
  const hueOnly = applyRecipePatch(undefined, { colourGrade: { ...colourGrade, shadows: { hue: 200, amount: 0 }, highlights: { hue: 0, amount: 0 }, balance: 0 } }).edit;
  assert.equal(hueOnly.grade?.shadows[0], 200);
  assert.equal(applyRecipePatch(edit, { colourGrade: undefined, channelCurves: undefined }).edit.grade, undefined);
  assert.equal(applyRecipePatch(edit, { colourGrade: undefined, channelCurves: undefined }).edit.channelCurves, undefined);
});

test('dehaze, vignette (with colour and blur), grain and calibration round-trip and switch off cleanly', () => {
  const patch = { dehaze: 40, vignette: 60, vignetteSize: 30, vignetteBlur: 20, vignetteColour: '#3a2a1e', grain: 25, grainSize: 70,
    calibration: { red: { hue: 20, saturation: -10 }, green: { hue: 0, saturation: 0 }, blue: { hue: 0, saturation: 30 } } };
  const { edit } = applyRecipePatch(undefined, patch);
  assert.equal(edit.dehaze, 0.4);
  assert.deepEqual(edit.vignette, { amount: 0.6, size: 0.3, blur: 0.2, colour: [0.2275, 0.1647, 0.1176] });
  assert.deepEqual(edit.grain, { amount: 0.25, size: 0.7 });
  assert.deepEqual(edit.calibration, { red: [0.2, -0.1], green: [0, 0], blue: [0, 0.3] });
  const back = editToRecipe(edit);
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) assert.deepEqual(back[key], patch[key], key);
  // Changing only the size keeps the rest; no strength and no blur is no vignette at all.
  assert.equal(applyRecipePatch(edit, { vignetteSize: 80 }).edit.vignette?.blur, 0.2);
  assert.equal(applyRecipePatch(edit, { vignette: 0, vignetteBlur: 0 }).edit.vignette, undefined);
  assert.equal(applyRecipePatch(edit, { vignetteColour: undefined }).edit.vignette?.colour, undefined);
  assert.equal(applyRecipePatch(edit, { grain: 0 }).edit.grain, undefined);
  // Shape, fall-off, highlight protection and grain roughness round-trip; their defaults are not stored.
  const shaped = applyRecipePatch(edit, { vignetteRoundness: -40, vignetteFeather: 80, vignetteHighlights: 60, grainRoughness: 30 }).edit;
  assert.deepEqual({ r: shaped.vignette?.roundness, f: shaped.vignette?.feather, h: shaped.vignette?.highlights }, { r: -0.4, f: 0.8, h: 0.6 });
  assert.equal(shaped.grain?.roughness, 0.3);
  const shapedBack = editToRecipe(shaped);
  assert.deepEqual([shapedBack.vignetteRoundness, shapedBack.vignetteFeather, shapedBack.vignetteHighlights, shapedBack.grainRoughness], [-40, 80, 60, 30]);
  const plain = applyRecipePatch(shaped, { vignetteRoundness: 0, vignetteFeather: 50, vignetteHighlights: 0, grainRoughness: 0 }).edit;
  assert.deepEqual(plain.vignette, edit.vignette);
  assert.deepEqual(plain.grain, edit.grain);
  assert.equal(applyRecipePatch(edit, { dehaze: 0 }).edit.dehaze, undefined);
});

test('colour fringe settings round-trip, and zero is stored as nothing', () => {
  let edit = applyRecipePatch(undefined, { caRed: 45, caBlue: -70, defringePurple: 60 }).edit;
  assert.deepEqual(edit?.lateralCa, { red: 0.45, blue: -0.7 });
  assert.deepEqual(edit?.defringe, { purple: 0.6, green: 0 });
  const recipe = editToRecipe(edit);
  assert.deepEqual([recipe.caRed, recipe.caBlue, recipe.defringePurple, recipe.defringeGreen], [45, -70, 60, 0]);
  assert.equal(isNeutralEdit(edit!), false);
  edit = applyRecipePatch(edit, { caRed: 0, caBlue: 0, defringePurple: 0 }).edit;
  assert.equal(edit?.lateralCa, undefined);
  assert.equal(edit?.defringe, undefined);
  assert.equal(applyRecipePatch(undefined, { caRed: 500 }).edit?.lateralCa?.red, 1, 'clamped to range');
});

test('lens corrections round-trip, and zero is stored as nothing', () => {
  let edit = applyRecipePatch(undefined, { lensDistortion: -40, lensVignetting: 70 }).edit;
  assert.deepEqual(edit?.lens, { distortion: -0.4, vignetting: 0.7 });
  const recipe = editToRecipe(edit);
  assert.deepEqual([recipe.lensDistortion, recipe.lensVignetting], [-40, 70]);
  edit = applyRecipePatch(edit, { lensDistortion: 0, lensVignetting: 0 }).edit;
  assert.equal(edit?.lens, undefined);
});

test('AI denoise shows as on while a stored result is in the edit, and the recipe can only remove it', async () => {
  const { applyRecipePatch, editToRecipe } = await import('./recipeMap');
  const trueDetailAi = { model: 'nafnet-sidd-w32-w16', modelSha256: 'c'.repeat(64), asset: 'a'.repeat(64), framingKey: 'k',
    rect: { x: 0, y: 0, w: 1, h: 1 }, maskId: 'auto-denoise-p', subject: 1, eyes: 0.6 };
  const edit = { exposure: 0, warmth: 0, colour: 0, trueDetailAi };
  assert.equal(editToRecipe(edit).aiDenoise, true);
  assert.equal(editToRecipe({ exposure: 0, warmth: 0, colour: 0 }).aiDenoise, undefined);
  assert.equal(applyRecipePatch(edit, { aiDenoise: false }).edit.trueDetailAi, undefined);
  assert.deepEqual(applyRecipePatch({ exposure: 0, warmth: 0, colour: 0 }, { aiDenoise: true }).edit.trueDetailAi, undefined);
});

test('a photo starts with no look, and "None" is the first look on offer', () => {
  assert.equal(NEUTRAL_RECIPE.lookId, 'none');
  assert.equal(INITIAL_LOOKS[0].id, 'none');
  assert.deepEqual(INITIAL_LOOKS[0].recipeDelta, {}, 'choosing None changes no slider by itself');
});

test('taking a look off puts back only the sliders that look set', () => {
  const look = { recipeDelta: { exposure: 0.2, shadows: 26, temperature: -12 } };
  assert.deepEqual(removeLookPatch(look), { exposure: 0, shadows: 0, temperature: 0 });
  assert.deepEqual(removeLookPatch(undefined), {}, 'no look on the photo: nothing to undo');
});
