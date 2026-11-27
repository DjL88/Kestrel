import test from 'node:test';
import assert from 'node:assert/strict';
import { groupChanged, groupResetPatch, readClosedGroups, writeClosedGroups } from './sliderGroups.ts';
import { NEUTRAL_RECIPE } from '../../engineClient/recipeMap.ts';
import type { EditRecipe } from '../contract';

const recipe = (over: Partial<EditRecipe> = {}) => ({ ...NEUTRAL_RECIPE, ...over }) as EditRecipe;

test('a neutral photo has no group marked changed', () => {
  for (const id of ['light', 'colour', 'detail', 'effects', 'curve', 'mixer', 'grading'] as const) {
    assert.equal(groupChanged(recipe(), id), false, id);
  }
});

test('one slider off its default marks only its own group', () => {
  const r = recipe({ shadows: 20 });
  assert.equal(groupChanged(r, 'light'), true);
  assert.equal(groupChanged(r, 'colour'), false);
  assert.equal(groupChanged(recipe({ sharpen: 30 }), 'detail'), true);
  assert.equal(groupChanged(recipe({ vignette: -20 }), 'effects'), true);
  // A vignette shape value with no vignette does nothing, so it does not count.
  assert.equal(groupChanged(recipe({ vignetteSize: 80 } as Partial<EditRecipe>), 'effects'), false);
  assert.equal(groupChanged(recipe({ toneCurve: [[0, 0], [0.5, 0.6], [1, 1]] } as Partial<EditRecipe>), 'curve'), true);
  assert.equal(groupChanged(recipe({ toneCurve: [[0, 0], [1, 1]] } as Partial<EditRecipe>), 'curve'), false);
});

test('Reset puts back only its own group', () => {
  const patch = groupResetPatch('light');
  assert.deepEqual(Object.keys(patch).sort(), ['blacks', 'contrast', 'exposure', 'highlights', 'shadows', 'whites']);
  assert.equal(patch.exposure, NEUTRAL_RECIPE.exposure);
  const effects = groupResetPatch('effects');
  assert.ok('vignetteSize' in effects && effects.vignetteSize === undefined);
  assert.equal(groupChanged(recipe({ ...recipe({ vignette: -20, grain: 30 }), ...effects }), 'effects'), false);
});

test('closed groups are kept on this device, and nonsense is ignored', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  writeClosedGroups(store, new Set(['curve', 'mixer']));
  assert.deepEqual([...readClosedGroups(store)].sort(), ['curve', 'mixer']);
  data.set('inflight.v2.adjustGroupsClosed', '["light","nope",3]');
  assert.deepEqual([...readClosedGroups(store)], ['light']);
  data.set('inflight.v2.adjustGroupsClosed', '{bad');
  assert.equal(readClosedGroups(store).size, 0);
});
