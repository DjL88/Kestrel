import assert from 'node:assert/strict';
import test from 'node:test';
import { createMask, createSubjectMask, MAX_MASKS, validMasks, hasActiveMasks, type Mask } from '../../core/maskTypes.ts';
import { canAddMask, masksToLayers, removeMask, setMaskEdit, setMaskFeather, toggleMask } from './maskOps.ts';

const grid = { w: 1, h: 1, data: 'AA==' };
const subject = (id: string, invert = false): Mask => ({ ...createSubjectMask(id, grid, 'k', 'high'), invert });

test('layers are read from the masks: a subject, its inverse as the background, and shapes as areas', () => {
  const layers = masksToLayers([subject('a'), subject('b', true), createMask('linear', 'c'), createMask('brush', 'd')]);
  assert.deepEqual(layers.map((layer) => [layer.name, layer.type]), [['Subject', 'subject'], ['Background', 'background'], ['Gradient', 'area'], ['Brush mask', 'brush']]);
  assert.equal(masksToLayers(undefined).length, 0);
});

test('a slider is held inside its range, and zero reads as unset', () => {
  let masks = setMaskEdit([subject('a')], 'a', 'exposure', 9);
  assert.equal(masks[0].edit.exposure, 2);
  masks = setMaskEdit(masks, 'a', 'sharpen', -1);
  assert.equal(masks[0].edit.sharpen, undefined);
  masks = setMaskEdit(masks, 'a', 'exposure', 0);
  assert.deepEqual(masks[0].edit, {});
  assert.deepEqual(setMaskEdit(masks, 'a', 'nonsense', 1)[0].edit, {});
  assert.deepEqual(setMaskEdit(masks, 'a', 'exposure', Number.NaN)[0].edit, {});
});

test('hiding a mask keeps it but it stops changing the picture; showing it again restores it', () => {
  let masks = setMaskEdit([subject('a')], 'a', 'exposure', 0.5);
  assert.equal(hasActiveMasks(masks), true);
  masks = toggleMask(masks, 'a');
  assert.equal(masks[0].hidden, true);
  assert.equal(masks[0].edit.exposure, 0.5);
  assert.equal(hasActiveMasks(masks), false);
  assert.equal(masksToLayers(masks)[0].visible, false);
  masks = toggleMask(masks, 'a');
  assert.equal(hasActiveMasks(masks), true);
});

test('removing a mask drops a limit that pointed at it, and everything stays a valid mask list', () => {
  const limited: Mask = { ...createMask('radial', 'b'), limit: { id: 'a', mode: 'intersect' } };
  const left = removeMask([subject('a'), limited], 'a');
  assert.equal(left.length, 1);
  assert.equal(left[0].limit, undefined);
  assert.ok(validMasks(setMaskFeather(setMaskEdit(toggleMask(left, 'b'), 'b', 'clarity', 0.4), 'b', 250)));
  assert.equal(setMaskFeather(left, 'b', 250)[0].feather, 1);
});

test('the number of masks is limited', () => {
  assert.equal(canAddMask(Array.from({ length: MAX_MASKS }, (_, i) => subject(String(i)))), false);
  assert.equal(canAddMask([]), true);
});
