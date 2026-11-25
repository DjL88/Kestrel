import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentToEdit, type CommentRecipe } from './commentToEdit.ts';

const base: CommentRecipe = { exposure: 0, highlights: 0, shadows: 0, contrast: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, sharpen: 40, denoiseLuminance: 0 };

test('plain requests become small slider steps', () => {
  assert.deepEqual(commentToEdit('Could it be a bit brighter?', base).delta, { exposure: 0.15 });
  assert.deepEqual(commentToEdit('The sky is blown and it feels too warm', base).delta, { highlights: -25, whites: -10, temperature: -10 });
  assert.deepEqual(commentToEdit('Much more contrast please', base).delta, { contrast: 23 });
  assert.deepEqual(commentToEdit('Looks soft', base).delta, { sharpen: 55, clarity: 8 });
});

test('steps stay inside the slider range and a slider moves once', () => {
  assert.deepEqual(commentToEdit('brighter, much brighter', { ...base, exposure: 4.9 }).delta, { exposure: 5 });
  assert.deepEqual(commentToEdit('darker', { ...base, exposure: -5 }).delta, {});
  assert.deepEqual(commentToEdit('too dark, brighter', base).rules, ['brighter']);
});

test('anything it does not recognise changes nothing', () => {
  assert.deepEqual(commentToEdit('Love this one! Can we crop the left branch?', base), { rules: [], delta: {} });
});

test('comments in the app’s other languages are read too', () => {
  assert.deepEqual(commentToEdit('Un peu plus clair, s’il vous plaît', base).delta, { exposure: 0.15 });
  assert.deepEqual(commentToEdit('Der Himmel ist ausgebrannt und das Bild zu warm', base).delta, { highlights: -25, whites: -10, temperature: -10 });
  assert.deepEqual(commentToEdit('Mucho más contraste', base).delta, { contrast: 23 });
  assert.deepEqual(commentToEdit('Liian tumma', base).delta, { exposure: 0.3 });
  assert.deepEqual(commentToEdit('Rhy oer', base).delta, { temperature: 10 });
  assert.deepEqual(commentToEdit('Lichter retten bitte', base).rules, ['highlights-recover']);
  assert.deepEqual(commentToEdit('Bellissima, grazie!', base), { rules: [], delta: {} });
});
