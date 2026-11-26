import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from '../../core/cullingEngine';
import { cameraRawSettings, recipeFromCameraRaw } from './cameraRawMap';
import { applyRecipePatch, editToRecipe } from './recipeMap';
import { sidecarEdits } from './xmpOps';

test('InFlight\'s Camera Raw settings read back to the same sliders', () => {
  const edit = applyRecipePatch(undefined, { exposure: 0.7, contrast: 20, highlights: -40, shadows: 35, whites: 5, blacks: -10, clarity: 12, vibrance: 8, dehaze: 15, vignette: -20 }).edit;
  const back = recipeFromCameraRaw(cameraRawSettings({ edit })!)!;
  const original = editToRecipe(edit);
  for (const key of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'clarity', 'vibrance', 'dehaze', 'vignette'] as const) {
    assert.equal(back.patch[key], original[key], key);
  }
});

test('Lightroom settings as Lightroom writes them are read; older process versions and empty blocks are left out', () => {
  const read = recipeFromCameraRaw({ ProcessVersion: '15.4', Exposure2012: '+1.25', Contrast2012: '-12', ConvertToGrayscale: 'True', Texture: '+20' })!;
  assert.equal(read.patch.exposure, 1.25);
  assert.equal(read.patch.contrast, -12);
  assert.equal(read.patch.saturation, -100);
  assert.equal(read.patch.detailRecovery, 20);
  assert.equal(recipeFromCameraRaw({ ProcessVersion: '5.0', Exposure2012: '+1' }), null, 'Process Version 2010 sliders mean other things');
  assert.equal(recipeFromCameraRaw({ ProcessVersion: '11.0' }), null);
  assert.equal(recipeFromCameraRaw({ Exposure2012: '1; os.exit()' }), null, 'only plain numbers are read');
});

test('a sidecar\'s edit goes only into photos not edited here yet', () => {
  const state = createDemoShootState(2);
  const [a, b] = state.frames;
  const edited = { ...state, frames: [a, { ...b, edit: applyRecipePatch(undefined, { exposure: 0.3 }).edit }] };
  const metadata = { keywords: [], cameraRaw: { ProcessVersion: '11.0', Exposure2012: '+0.50' } };
  const { patches, kept } = sidecarEdits(edited, [{ frameId: a.id, metadata }, { frameId: b.id, metadata }]);
  assert.deepEqual([...patches.keys()], [a.id]);
  assert.equal(patches.get(a.id)!.exposure, 0.5);
  assert.equal(kept, 1);
});
