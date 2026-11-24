import assert from 'node:assert/strict';
import test from 'node:test';
import { composeDenoiseRecipe, renderDenoiseRecipe, verifyDenoiseRecipe } from './denoiseRecipe';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { createMask } from '../../core/maskTypes';
import { applyPhotoEdit } from '../../core/photoEdits';

test('denoise preserves manual recipe and individual override, replacing only automatic pair', () => {
  const id = 'auto-denoise-p';
  const manual = { ...createMask('radial', 'manual'), edit: { exposure: 0.4 } };
  const individual = { ...createMask('radial', id + '-instance-1-dog'), edit: { denoise: 0 } };
  const old = createMask('radial', id);
  const background = createMask('radial', id + '-background');
  const next = { ...old, edit: { denoise: 0.4 } };
  const base = { ...DEFAULT_EDIT, exposure: 0.8, sharpen: 0.4, masks: [manual, old, individual, background] };
  const result = composeDenoiseRecipe(base, id, 0, [background, next]);
  assert.deepEqual(result.masks, [manual, individual, background, next]);
  assert.equal(result.exposure, 0.8);
  assert.equal(result.sharpen, 0.4);
  assert.deepEqual(base.masks, [manual, old, individual, background]);
});

test('verification renders existing tone instead of comparing to the untouched source', () => {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([100, 100, 100, 255], i);
  const source = { data, width: 32, height: 32 };
  const base = { ...DEFAULT_EDIT, exposure: 1 };
  const before = renderDenoiseRecipe(source, base);
  const expected = data.slice();
  applyPhotoEdit(expected, base);
  assert.deepEqual(before.data, expected);
  const after = renderDenoiseRecipe(source, composeDenoiseRecipe(base, 'auto-denoise-p', 0.4, []));
  assert.equal(verifyDenoiseRecipe(before, after, []).ok, true);
  assert.equal(data[0], 100);
});

test('a small protected individual cannot be hidden by an unchanged larger frame', () => {
  const width = 128, height = 128;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = x % 4 < 2 ? 90 : 170;
    data.set([v,v,v,255], (y * width + x) * 4);
  }
  const after = data.slice();
  for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) after.fill(130, (y * width + x) * 4, (y * width + x) * 4 + 3);
  const subject = { ...createMask('radial', 'small'), kind: 'radial' as const, cx: 0.25, cy: 0.25, rx: 0.11, ry: 0.11, feather: 0 };
  const verification = verifyDenoiseRecipe({ data, width, height }, { data: after, width, height }, [subject]);
  assert.equal(verification.ok, false);
  assert.ok(verification.reasons.some(reason => reason.includes('subject 1')));
});
