import assert from 'node:assert/strict';
import test from 'node:test';
import { autoEnhance } from './autoEnhance';

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

test('a bright photo is pulled down', () => {
  const { edit } = autoEnhance(image((x) => [200 + x, 200 + x, 200 + x]));
  assert.ok(edit.exposure < 0);
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
