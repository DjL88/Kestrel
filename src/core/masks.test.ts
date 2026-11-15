import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMasks, fullContext, maskAlpha } from './masks';
import { createMask, hasActiveMasks, validMasks, type Mask } from './maskTypes';

const W = 100;
const H = 80;
const ctx = fullContext(W, H);
const at = (alpha: Float32Array, x: number, y: number) => alpha[y * W + x];

test('a linear gradient is full at its start, half in the middle and clear at its end', () => {
  const mask: Mask = { ...createMask('linear', 'a'), kind: 'linear', x1: 0.5, y1: 0, x2: 0.5, y2: 1, feather: 1 };
  const alpha = maskAlpha(mask, W, H, ctx);
  assert.ok(at(alpha, 50, 0) > 0.99);
  assert.ok(Math.abs(at(alpha, 50, 40) - 0.5) < 0.05);
  assert.ok(at(alpha, 50, 79) < 0.01);
  assert.equal(at(alpha, 5, 40), at(alpha, 90, 40), 'a vertical gradient does not vary sideways');
});

test('a radial mask is full in the middle, clear outside and round whatever the aspect ratio', () => {
  const mask: Mask = { ...createMask('radial', 'r'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, feather: 0.3 };
  const alpha = maskAlpha(mask, W, H, ctx);
  assert.ok(at(alpha, 50, 40) > 0.99);
  assert.ok(at(alpha, 2, 2) < 0.01);
  // 0.15 widths away is 15 px sideways or 15 px down, since lengths are in widths.
  assert.ok(Math.abs(at(alpha, 65, 40) - at(alpha, 50, 55)) < 0.05);
});

test('invert flips the mask', () => {
  const base: Mask = { ...createMask('radial', 'r'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 };
  const a = maskAlpha(base, W, H, ctx);
  const b = maskAlpha({ ...base, invert: true }, W, H, ctx);
  assert.ok(Math.abs(at(a, 50, 40) + at(b, 50, 40) - 1) < 1e-6);
});

test('a brush paints under the stroke, not far from it, and an erase stroke removes it', () => {
  const painted: Mask = { ...createMask('brush', 'b'), kind: 'brush', strokes: [{ radius: 0.08, erase: false, points: [0.2, 0.5, 0.8, 0.5] }] };
  const alpha = maskAlpha(painted, W, H, ctx);
  assert.ok(at(alpha, 50, 40) > 0.95);
  assert.ok(at(alpha, 50, 5) < 0.01);
  const erased: Mask = { ...painted, strokes: [...painted.strokes, { radius: 0.08, erase: true, points: [0.5, 0.5] }] };
  const after = maskAlpha(erased, W, H, ctx);
  assert.ok(at(after, 50, 40) < 0.05);
  assert.ok(at(after, 25, 40) > 0.9);
});

test('a zoomed region matches the same pixels of the whole photo', () => {
  const mask: Mask = { ...createMask('radial', 'r'), kind: 'radial', cx: 0.4, cy: 0.5, rx: 0.3, ry: 0.2, feather: 0.6 };
  const full = maskAlpha(mask, W, H, ctx);
  const region = maskAlpha(mask, 50, 40, { aspect: H / W, view: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
  // Region pixel (10, 20) centres on x = 0.355 and y = 0.506 of the photo, which is whole-photo pixel (35, 40).
  assert.ok(Math.abs(region[20 * 50 + 10] - at(full, 35, 40)) < 0.03);
});

test('local exposure brightens only inside the mask', () => {
  const pixels = new Uint8ClampedArray(W * H * 4).fill(100);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const mask: Mask = { ...createMask('radial', 'r'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.15, ry: 0.15, feather: 0.2, edit: { exposure: 1.5 } };
  applyMasks(pixels, W, H, [mask], ctx);
  assert.ok(pixels[(40 * W + 50) * 4] > 110);
  assert.equal(pixels[(2 * W + 2) * 4], 100);
  assert.equal(pixels[(40 * W + 50) * 4 + 3], 255);
});

test('masks with no adjustments do nothing and are not active', () => {
  const masks = [createMask('radial', 'r')];
  assert.equal(hasActiveMasks(masks), false);
  const pixels = new Uint8ClampedArray(W * H * 4).fill(77);
  const copy = new Uint8ClampedArray(pixels);
  applyMasks(pixels, W, H, masks, ctx);
  assert.deepEqual(pixels, copy);
});

test('validation accepts good masks and rejects bad ones', () => {
  const good = [{ ...createMask('linear', 'a'), edit: { exposure: 1 } }, createMask('radial', 'b'), createMask('brush', 'c')];
  assert.equal(validMasks(good), true);
  assert.equal(validMasks([{ ...good[0], edit: { exposure: 9 } }]), false);
  assert.equal(validMasks([{ ...good[0], edit: { sharpen: 1 } }]), false);
  assert.equal(validMasks([{ ...good[1], rx: 0 }]), false);
  assert.equal(validMasks([{ ...good[2], strokes: [{ radius: 0.1, erase: false, points: [0.1] }] }]), false);
  assert.equal(validMasks([{ id: 'x', kind: 'weird', invert: false, feather: 0, edit: {} }]), false);
  assert.equal(validMasks('nope'), false);
  assert.equal(validMasks(Array.from({ length: 13 }, (_, i) => createMask('radial', String(i)))), false);
});

import { isNeutralEdit, isNeutralGlobal, DEFAULT_EDIT } from './photoEdits';
import { recordEdit } from './editHistory';
import type { PhotoFrame } from './types';

test('an edit with only an active mask is not neutral but its whole-photo part is', () => {
  const edit = { ...DEFAULT_EDIT, masks: [{ ...createMask('radial', 'a'), edit: { exposure: 1 } }] };
  assert.equal(isNeutralEdit(edit), false);
  assert.equal(isNeutralGlobal(edit), true);
  assert.equal(isNeutralEdit({ ...DEFAULT_EDIT, masks: [createMask('radial', 'b')] }), true);
});

test('mask changes are recorded as their own undoable step', () => {
  const frame = { id: 'f', edit: DEFAULT_EDIT } as PhotoFrame;
  const next = recordEdit(frame, { edit: { ...DEFAULT_EDIT, masks: [createMask('linear', 'a')] } }, 1000);
  assert.equal(next.editHistory?.steps[0].kind, 'mask');
});

import { isEmptyEdit } from './photoEdits';

test('an edit that only holds an empty mask is kept, so the mask can be adjusted', () => {
  assert.equal(isEmptyEdit(DEFAULT_EDIT), true);
  assert.equal(isEmptyEdit({ ...DEFAULT_EDIT, masks: [createMask('radial', 'a')] }), false);
});
