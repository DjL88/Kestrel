import assert from 'node:assert/strict';
import test from 'node:test';
import { autoEnhance, mergeAutoSuggestion } from './autoEnhance';
import { DEFAULT_EDIT } from './photoEdits';

function image(fill: (x: number, y: number) => [number, number, number], size = 32) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) data.set([...fill(x, y), 255], (y * size + x) * 4);
  return data;
}

test('a dark photo gets brighter and its shadows are lifted', () => {
  const { edit } = autoEnhance(image((x) => [10 + x, 10 + x, 10 + x]));
  assert.ok(edit.exposure > 0);
  assert.ok(edit.shadows > 0);
});

test('a photo with blown-out brights is pulled down', () => {
  const { edit } = autoEnhance(image((x) => [Math.min(255, 215 + x * 2), Math.min(255, 215 + x * 2), Math.min(255, 215 + x * 2)]));
  assert.ok(edit.exposure < 0);
});

test('a pale sky that is bright on purpose is not darkened, and a balanced photo is left alone', () => {
  // Measured on 30 real telephoto frames: a helicopter in pale sky has a median tone near 0.87 and nothing clipped.
  const sky = autoEnhance(image((x) => [185 + x / 8, 205 + x / 8, 235 + x / 12]));
  assert.ok(sky.edit.exposure >= 0, `exposure ${sky.edit.exposure}`);
  const balanced = autoEnhance(image((x) => [30 + x * 7, 30 + x * 7, 30 + x * 7]));
  assert.equal(balanced.edit.contrast, 0);
});

test('a cool cast on neutral midtones warms the photo, a warm cast cools it', () => {
  assert.ok(autoEnhance(image((x) => [118 + x, 122 + x, 134 + x])).edit.warmth > 0);
  assert.ok(autoEnhance(image((x) => [130 + x, 122 + x, 112 + x])).edit.warmth < 0);
});

test('saturated scenery is not mistaken for a colour cast', () => {
  const { edit, notes } = autoEnhance(image(() => [40, 160, 50]));
  assert.equal(edit.warmth, 0);
  assert.ok(notes.some((note) => note.includes('No clear neutral')));
});

test('a well exposed neutral photo is left almost alone', () => {
  const { edit } = autoEnhance(image((x, y) => { const v = 40 + ((x + y) * 3.2); return [v, v, v]; }));
  assert.equal(edit.warmth, 0);
  assert.ok(Math.abs(edit.exposure) <= 0.3);
});

test('tiny images are refused politely', () => {
  assert.deepEqual(autoEnhance(new Uint8ClampedArray(16)).notes, ['Too small to analyse.']);
});


test('neutral Auto suggestion preserves user adjustments without a phantom change', () => {
  const current = { ...DEFAULT_EDIT, exposure: 0.6, warmth: -0.25, contrast: 0.4 };
  const before = JSON.stringify(current);
  const suggestion = { exposure: 0, warmth: 0, shadows: 0, highlights: 0, contrast: 0, vibrance: 0 };
  const result = mergeAutoSuggestion(current, suggestion);
  assert.equal(result.changed, false);
  assert.deepEqual(result.edit, current);
  assert.equal(JSON.stringify(current), before);
});

test('Auto only updates suggested axes; never clears other hand-tuned adjustments', () => {
  const current = { ...DEFAULT_EDIT, exposure: -0.4, warmth: 0.3, shadows: 0.5, contrast: 0.25 };
  const suggestion = { exposure: 0.8, warmth: 0, shadows: 0, highlights: -0.2, contrast: 0, vibrance: 0 };
  const result = mergeAutoSuggestion(current, suggestion);
  assert.equal(result.changed, true);
  assert.deepEqual(result.edit, { ...current, exposure: 0.8, highlights: -0.2 });
  assert.deepEqual(current, { ...DEFAULT_EDIT, exposure: -0.4, warmth: 0.3, shadows: 0.5, contrast: 0.25 });
});

test('malformed suggestion values never overwrite a valid edit', () => {
  const current = { ...DEFAULT_EDIT, exposure: 0.25 };
  const suggestion = { exposure: Number.NaN, warmth: Number.POSITIVE_INFINITY, shadows: 0, highlights: 0, contrast: 0, vibrance: 0 };
  assert.deepEqual(mergeAutoSuggestion(current, suggestion), { edit: current, changed: false });
});
