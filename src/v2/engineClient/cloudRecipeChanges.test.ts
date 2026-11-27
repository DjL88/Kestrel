import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudRecipeChanges } from './cloudRecipeChanges';

const names = { exposure: 'Exposure', highlights: 'Highlights', shadows: 'Shadows', temperature: 'Temperature' };

test('what the cloud changed, in plain words, in the Adjust order, with the old values kept for a compare', () => {
  const was = { exposure: 0.2, highlights: 0, shadows: 10, temperature: 5 };
  const result = cloudRecipeChanges(was, { shadows: 25, exposure: 0.5, highlights: -20, temperature: 5 }, names);
  assert.deepEqual(result.lines, ['Exposure +0.3', 'Highlights −20', 'Shadows +15']);
  assert.deepEqual(result.before, { exposure: 0.2, highlights: 0, shadows: 10 });
});

test('a setting left where it was, or moved too little to see, is not a change', () => {
  const result = cloudRecipeChanges({ exposure: 0.5, highlights: -20 }, { exposure: 0.52, highlights: -20.4 }, names);
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.before, {});
});

test('a setting the photo never had counts from zero, and an unnamed one keeps its key', () => {
  const result = cloudRecipeChanges({}, { dehaze: 12 }, names);
  assert.deepEqual(result.lines, ['dehaze +12']);
  assert.deepEqual(result.before, { dehaze: 0 });
});
