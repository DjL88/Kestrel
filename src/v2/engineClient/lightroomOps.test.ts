import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from '../../core/cullingEngine';
import type { LightroomPhoto } from '../../core/lightroomCatalogue';
import { planLightroomImport } from '../../core/lightroomImport';
import type { CullingState } from '../../core/types';
import { source } from '../../i18n/areas/v2/source';
import { applyLightroomImport, developToRecipe, lightroomNotice } from './lightroomOps';
import { editToRecipe } from './recipeMap';

function shoot(): CullingState {
  const base = createDemoShootState(4);
  return {
    ...base,
    frames: base.frames.map((frame, i) => ({ ...frame, isDemo: false, removedAt: undefined, filename: `DSC_000${i}.NEF`, decision: 'unreviewed', rating: 0, tags: [], autoTags: [], edit: undefined, editHistory: undefined, exif: {} })),
  };
}

function photo(id: number, extra: Partial<LightroomPhoto> = {}): LightroomPhoto {
  return { id, path: `C:/P/DSC_000${id}.NEF`, filename: `DSC_000${id}.NEF`, flag: null, keywords: [], collections: [], develop: null, virtualCopy: false, ...extra };
}

test('Lightroom ratings, flags, keywords, collections and basic edits arrive on the matching photo', () => {
  const state = shoot();
  const photos = [
    photo(0, { rating: 4, flag: 'pick', keywords: ['Golden eagle'], collections: ['Portfolio'],
      develop: { exposure: 0.7, contrast: 20, shadows: 35, highlights: -40, monochrome: true, notCarried: ['crop'] } }),
    photo(1, { flag: 'reject' }),
  ];
  const plan = planLightroomImport(photos, state.frames);
  const { state: next, result } = applyLightroomImport(state, plan, 1000);
  const [a, b, c] = next.frames;
  assert.equal(a.rating, 4);
  assert.equal(a.decision, 'keep');
  assert.deepEqual(a.tags, ['Golden eagle', 'Portfolio']);
  const recipe = editToRecipe(a.edit);
  assert.equal(recipe.exposure, 0.7);
  assert.equal(recipe.contrast, 20);
  assert.equal(recipe.shadows, 35);
  assert.equal(recipe.highlights, -40);
  assert.equal(recipe.saturation, -100, 'black and white');
  assert.equal(a.editHistory?.steps.length, 1, 'one undoable step');
  assert.equal(b.decision, 'reject');
  assert.equal(c, state.frames[2], 'an unrelated photo is untouched');
  assert.deepEqual(result, { photos: 2, edits: 1, keptYours: 0, partialEdits: 1 });
  const words = lightroomNotice(source.lightroom, plan, 2, result);
  assert.match(words, /2 of the 2 photos/);
  assert.match(words, /not exact copies/);
});

test('choices already made in InFlight are kept, never overwritten by the catalogue', () => {
  const state = shoot();
  state.frames[0] = { ...state.frames[0], rating: 2, decision: 'keep', edit: { exposure: 1, warmth: 0, colour: 0 } };
  const plan = planLightroomImport([photo(0, { rating: 5, flag: 'reject', develop: { exposure: -2, notCarried: [] } })], state.frames);
  const { state: next, result } = applyLightroomImport(state, plan, 1000);
  assert.equal(next.frames[0].rating, 2);
  assert.equal(next.frames[0].decision, 'keep');
  assert.deepEqual(next.frames[0].edit, { exposure: 1, warmth: 0, colour: 0 });
  assert.equal(result.keptYours, 1);
  assert.equal(result.photos, 0);
  assert.equal(next, state, 'nothing to change is no change at all');
});

test('develop mapping: Lightroom sliders map one to one; texture only adds detail', () => {
  assert.deepEqual(developToRecipe({ exposure: -1.5, whites: 10, blacks: -5, clarity: 12, vibrance: 8, saturation: -10, dehaze: 15, texture: -20, luminanceNoise: 30, notCarried: [] }),
    { exposure: -1.5, whites: 10, blacks: -5, clarity: 12, vibrance: 8, saturation: -10, dehaze: 15, denoiseLuminance: 30 });
  assert.equal(developToRecipe({ texture: 25, notCarried: [] }).detailRecovery, 25);
});
