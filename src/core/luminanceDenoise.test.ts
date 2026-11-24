import assert from 'node:assert/strict';
import test from 'node:test';
import { denoiseLuminance } from './luminanceDenoise';
import { applyNoiseReduction } from './noiseReduction';
import { editRgb16, master16Blocker } from './master16';
import { DEFAULT_EDIT, isNeutralEdit } from './photoEdits';
import { sanitiseEdit } from './presets';
import { recordEdit, stepEdit } from './editHistory';
import { createDemoShootState } from './cullingEngine';
import { encodeProjectBackup, restoreProjectBackup } from './projectBackup';
import { applyRecipePatch, editToRecipe } from '../v2/engineClient/recipeMap';

const width = 40, height = 30;
function fixture() {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (x < width / 2 ? 75 : 180) + ((x + y) % 2 ? 6 : -6);
    data.set([v + 10, v, v - 5, 255], (y * width + x) * 4);
  }
  return data;
}
test('luminance noise falls while strong boundaries, chroma and source survive', () => {
  const source = fixture(), original = source.slice();
  const edit = { ...DEFAULT_EDIT, denoiseLuminance: 2 };
  const output = applyNoiseReduction(source, width, height, edit);
  assert.deepEqual(source, original);
  const a = (10 * width + 10) * 4, b = a + 4;
  assert.ok(Math.abs(output[a] - output[b]) < Math.abs(source[a] - source[b]));
  const edge = (10 * width + 19) * 4;
  assert.ok(output[edge + 4] - output[edge] > 90);
  for (let i = 0; i < output.length; i += 4) {
    assert.equal(output[i] - output[i+1], 10);
    assert.equal(output[i+1] - output[i+2], 5);
    assert.equal(output[i+3], 255);
  }
  assert.strictEqual(applyNoiseReduction(source, width, height, DEFAULT_EDIT), source);
});
test('RGB16 output matches the same kernel without 8-bit quantisation or band seams', () => {
  const rgba = fixture(), data = Uint16Array.from(Array.from(rgba).filter((_, i) => i % 4 !== 3), v => v * 257);
  const single = data.slice(), banded = data.slice();
  denoiseLuminance(single, width, height, 1, width * height);
  denoiseLuminance(banded, width, height, 1, width);
  assert.deepEqual(banded, single);
  editRgb16({ width, height, data }, { ...DEFAULT_EDIT, denoiseLuminance: 2 });
  assert.deepEqual(data, single);
  const eight = applyNoiseReduction(rgba, width, height, { ...DEFAULT_EDIT, denoiseLuminance: 2 });
  for (let i = 0; i < data.length; i++) assert.ok(Math.abs(data[i] / 257 - eight[Math.floor(i / 3) * 4 + i % 3]) <= 1);
  assert.ok(data.some(v => v % 257 !== 0));
});
test('slider persists in presets, backup and undo, and resets to neutral', () => {
  const { edit, unmapped } = applyRecipePatch(undefined, { denoiseLuminance: 65 });
  assert.deepEqual(unmapped, []);
  assert.equal(editToRecipe(edit).denoiseLuminance, 65);
  assert.equal(isNeutralEdit(edit), false);
  assert.equal(sanitiseEdit(edit).denoiseLuminance, 1.3);
  assert.equal(master16Blocker(edit, undefined), null);
  assert.ok(master16Blocker({ ...edit, denoiseLuminance: 3 }, undefined));
  const project = createDemoShootState(1);
  project.frames[0] = recordEdit(project.frames[0], { edit }, 1000);
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'restored');
  const frame = restored.frames[0];
  assert.equal(frame.edit?.denoiseLuminance, 1.3);
  assert.equal(frame.editHistory?.steps.at(-1)?.kind, 'detail');
  assert.equal(stepEdit(frame, -1).edit?.denoiseLuminance, undefined);
  assert.equal(isNeutralEdit(applyRecipePatch(edit, { denoiseLuminance: 0 }).edit), true);
});
test('transparent pixels are never borrowed into opaque pixels', () => {
  const data = new Uint8ClampedArray([100,100,100,255, 120,120,120,0]);
  const before = data.slice();
  denoiseLuminance(data, 2, 1, 1);
  assert.deepEqual(data, before);
});
