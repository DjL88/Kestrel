import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoiseReduction, hasNoiseReduction, noiseStrength } from './noiseReduction';
import { DEFAULT_EDIT, isEmptyEdit, isNeutralEdit } from './photoEdits';
import { sanitiseEdit } from './presets';

/** A flat grey photo with coloured speckle in red and blue, the way high-ISO shadows look. */
function speckled(size = 40) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const i = (y * size + x) * 4;
    const jitter = (((x * 17 + y * 7) % 5) - 2) * 9;
    data.set([90 + jitter, 90, 90 - jitter, 255], i);
  }
  return data;
}
const chromaError = (data: Uint8ClampedArray) => {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 2] - data[i + 1]);
  return sum;
};

test('noise reduction off leaves the very same pixels, and a slider move turns it on', () => {
  const pixels = speckled();
  assert.equal(applyNoiseReduction(pixels, 40, 40, DEFAULT_EDIT), pixels);
  assert.equal(hasNoiseReduction({ ...DEFAULT_EDIT, denoise: 0 }), false);
  assert.equal(hasNoiseReduction({ ...DEFAULT_EDIT, denoise: 0.5 }), true);
  assert.equal(noiseStrength(5), 1, 'never past full strength');
  assert.equal(noiseStrength(-1), 0);
});

test('colour speckle is reduced, more at a higher setting, and the source is untouched', () => {
  const pixels = speckled();
  const copy = pixels.slice();
  const half = applyNoiseReduction(pixels, 40, 40, { ...DEFAULT_EDIT, denoise: 1 });
  const full = applyNoiseReduction(pixels, 40, 40, { ...DEFAULT_EDIT, denoise: 2 });
  assert.deepEqual(pixels, copy);
  assert.ok(chromaError(half) < chromaError(pixels) * 0.85, 'half strength cleans up');
  assert.ok(chromaError(full) < chromaError(half), 'full strength cleans up more');
});

test('a noise-reduction-only edit counts as an edit, and survives being saved as a preset', () => {
  assert.equal(isNeutralEdit({ ...DEFAULT_EDIT, denoise: 0.8 }), false);
  assert.equal(isEmptyEdit({ ...DEFAULT_EDIT, denoise: 0.8 }), false);
  assert.equal(sanitiseEdit({ denoise: 0.8 }).denoise, 0.8);
  assert.equal(sanitiseEdit({ denoise: 9 }).denoise, 2, 'clamped to the slider');
  assert.equal(sanitiseEdit({ denoise: -1 }).denoise, undefined, 'it only goes up');
});

test('exposure past 2 is kept in a preset, up to +/-12.5', () => {
  assert.equal(sanitiseEdit({ exposure: 5 }).exposure, 5);
  assert.equal(sanitiseEdit({ exposure: 99 }).exposure, 12.5);
});
