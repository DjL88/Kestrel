import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMasks, fullContext, maskAlpha } from './masks';
import { createBrushStroke, createSubjectMask, createMask, hasActiveMasks, validMasks, type Mask } from './maskTypes';

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
  assert.equal(validMasks([{ ...good[0], edit: { bogus: 1 } }]), false);
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

import { effectiveAlpha } from './masks';

test('limiting a mask to another keeps only the overlap, and subtracting removes the overlap', () => {
  const left: Mask = { ...createMask('radial', 'left'), kind: 'radial', cx: 0.35, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0 };
  const right: Mask = { ...createMask('radial', 'right'), kind: 'radial', cx: 0.65, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0 };
  const masks = [left, right];
  const both = effectiveAlpha({ ...left, limit: { id: 'right', mode: 'intersect' } }, masks, W, H, ctx);
  assert.ok(at(both, 50, 40) > 0.95, 'the overlap in the middle stays');
  assert.ok(at(both, 12, 40) < 0.01, 'the part of the first mask outside the second goes');
  const only = effectiveAlpha({ ...left, limit: { id: 'right', mode: 'subtract' } }, masks, W, H, ctx);
  assert.ok(at(only, 50, 40) < 0.01, 'the overlap is removed');
  assert.ok(at(only, 12, 40) > 0.95, 'the rest of the first mask stays');
});

test('a limit pointing at a deleted mask or at itself is ignored', () => {
  const mask: Mask = { ...createMask('radial', 'a'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, limit: { id: 'gone', mode: 'intersect' } };
  const plain = maskAlpha({ ...mask, limit: undefined }, W, H, ctx);
  assert.deepEqual(effectiveAlpha(mask, [mask], W, H, ctx), plain);
  assert.deepEqual(effectiveAlpha({ ...mask, limit: { id: 'a', mode: 'subtract' } }, [mask], W, H, ctx), plain);
});

test('limits are validated, and self references are rejected', () => {
  const base = createMask('radial', 'a');
  assert.equal(validMasks([{ ...base, limit: { id: 'b', mode: 'intersect' } }]), true);
  assert.equal(validMasks([{ ...base, limit: { id: 'a', mode: 'intersect' } }]), false);
  assert.equal(validMasks([{ ...base, limit: { id: 'b', mode: 'merge' } }]), false);
  assert.equal(validMasks([{ ...base, limit: 'b' }]), false);
});

test('a mask can sharpen and add clarity locally, and only inside its area', () => {
  const size = 80;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const v = x < size / 2 ? 90 : 160;
    pixels.set([v, v, v, 255], (y * size + x) * 4);
  }
  const copy = new Uint8ClampedArray(pixels);
  const mask: Mask = { ...createMask('linear', 'g'), kind: 'linear', x1: 0.5, y1: 0, x2: 0.5, y2: 0.6, feather: 0, edit: { sharpen: 2, clarity: 1 } };
  applyMasks(pixels, size, size, [mask], { ...fullContext(size, size), imageEdge: 2200 });
  const row = (y: number, x: number) => pixels[(y * size + x) * 4];
  assert.ok(row(10, 38) < 90, 'inside the mask the dark side of the edge gets darker');
  assert.ok(row(10, 41) > 160, 'and the bright side gets brighter');
  assert.equal(row(75, 38), copy[(75 * size + 38) * 4], 'outside the mask nothing changes');
  assert.equal(validMasks([mask]), true);
});

test('Add and Remove refine the visible background mask in the chosen direction', () => {
  const grid = { w: 8, h: 8, data: Buffer.alloc(64, 255).toString('base64') };
  const background = { ...createSubjectMask('background', grid, 'framing', 'high'), invert: true };
  const point = [0.5, 0.5];
  const add = createBrushStroke(point, 0.12, false, background.invert);
  const remove = createBrushStroke(point, 0.12, true, background.invert);
  const alpha = (strokes: typeof background.strokes) => maskAlpha({ ...background, strokes }, W, H, ctx);
  assert.ok(at(alpha([]), 50, 40) < 0.05);
  assert.ok(at(alpha([add]), 50, 40) > 0.95);
  assert.ok(at(alpha([add, remove]), 50, 40) < 0.05);
  assert.equal(createBrushStroke(point, 0.12, false, false).erase, false);
});


test('local Brightness raises subject midtones without brightening outside a soft mask', () => {
  const pixels = new Uint8ClampedArray(W * H * 4).fill(110);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const mask: Mask = { ...createMask('radial', 'bright-subject'), kind: 'radial',
    cx: 0.5, cy: 0.5, rx: 0.15, ry: 0.15, feather: 0.3, edit: { brightness: 1.3 } };
  assert.equal(validMasks([mask]), true);
  applyMasks(pixels, W, H, [mask], ctx);
  assert.ok(pixels[(40 * W + 50) * 4] > 110);
  assert.equal(pixels[(2 * W + 2) * 4], 110);
  assert.equal(pixels[(40 * W + 50) * 4 + 3], 255);
});

/** A w × h grid, encoded as the recipe stores it, from a function giving 0 to 1 per cell. */
function encodedGrid(w: number, h: number, value: (x: number, y: number) => number) {
  let binary = '';
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) binary += String.fromCharCode(Math.round(value(x, y) * 255));
  return { w, h, data: btoa(binary) };
}

test('a subject\'s fine outline is used inside its region, and the coarse grid outside it', () => {
  // Coarse: a blurry blob. Fine: a crisp disc in the region x 0.4–0.6, y 0.4–0.6 (of the framed photo).
  const coarse = encodedGrid(16, 13, (x, y) => Math.max(0, 1 - Math.hypot(x - 8, y - 6.5) / 4));
  const detail = { region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, grid: encodedGrid(64, 64, (x, y) => Math.hypot(x - 32, y - 32) < 20 ? 1 : 0) };
  const mask = { ...createSubjectMask('s', coarse, 'k', 'high', detail), feather: 0 };
  assert.equal(validMasks([mask]), true);
  const alpha = maskAlpha(mask, W, H, ctx);
  // Centre of the disc: fully selected. Just outside the disc but inside the region: clear, though the blur says otherwise.
  assert.ok(at(alpha, 50, 40) > 0.99);
  const insideRegionOutsideDisc = at(alpha, 59, 47); // nx 0.595, ny 0.594: outside the disc (radius ~0.0625)
  assert.ok(insideRegionOutsideDisc < 0.01, `${insideRegionOutsideDisc}`);
  // Without the detail the same point is in the coarse blob.
  const coarseOnly = maskAlpha({ ...mask, detail: undefined }, W, H, ctx);
  assert.ok(at(coarseOnly, 50, 40) > 0.99);
});

test('brush strokes still win over the fine outline where they touch', () => {
  const coarse = encodedGrid(16, 13, () => 0);
  const detail = { region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, grid: encodedGrid(32, 32, () => 1) };
  const base = { ...createSubjectMask('s', coarse, 'k', 'high', detail), feather: 0 };
  const erased = { ...base, strokes: [createBrushStroke([0.5, 0.5], 0.08, true, false)] };
  const alpha = maskAlpha(erased, W, H, ctx);
  assert.ok(at(alpha, 50, 40) < 0.05, 'erased at the stroke centre');
  assert.ok(at(alpha, 30, 25) > 0.95, 'untouched parts of the region keep the fine outline');
});

test('damaged subject detail is refused', () => {
  const coarse = encodedGrid(16, 13, () => 0.5);
  const good = createSubjectMask('s', coarse, 'k', 'high', { region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, grid: encodedGrid(16, 16, () => 1) });
  assert.equal(validMasks([good]), true);
  assert.equal(validMasks([{ ...good, detail: { ...good.detail!, region: { x: 0.9, y: 0.1, w: 0.3, h: 0.3 } } }]), false);
  assert.equal(validMasks([{ ...good, detail: { ...good.detail!, region: { x: Number.NaN, y: 0, w: 0.3, h: 0.3 } } }]), false);
  assert.equal(validMasks([{ ...good, detail: { ...good.detail!, grid: { w: 16, h: 16, data: 'short' } } }]), false);
  assert.equal(validMasks([{ ...good, detail: null }]), false);
});

test('only slider changes count as adjustments; moving, painting, adding or deleting a mask does not', async () => {
  const { onlyAdjustmentsChanged } = await import('./maskTypes');
  const radial: Mask = { ...createMask('radial', 'r'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 };
  const brush = createMask('brush', 'b');
  const masks = [radial, brush];
  assert.equal(onlyAdjustmentsChanged(masks, [{ ...radial, edit: { exposure: 0.3 } }, brush]), true, 'a slider');
  assert.equal(onlyAdjustmentsChanged(masks, [{ ...radial, feather: 0.9 }, brush]), true, 'edge softness');
  assert.equal(onlyAdjustmentsChanged(masks, [{ ...radial, cx: 0.6 }, brush]), false, 'moved');
  assert.equal(onlyAdjustmentsChanged(masks, [radial, { ...brush, strokes: [createBrushStroke([0.1, 0.1], 0.05, false, false)] } as Mask]), false, 'painted');
  assert.equal(onlyAdjustmentsChanged(masks, [radial]), false, 'deleted');
  assert.equal(onlyAdjustmentsChanged(masks, masks), false, 'nothing changed');
  assert.equal(onlyAdjustmentsChanged([], []), false);
});

test('rotated oval changes orientation without changing its centre or invalidating old recipes', () => {
  const oldMask = { ...createMask('radial', 'rotation'), kind: 'radial' as const, cx: 0.5, cy: 0.5, rx: 0.35, ry: 0.08, feather: 0.2 };
  const unrotated = maskAlpha(oldMask, W, H, ctx);
  const rotated = { ...oldMask, angle: 90 };
  const turned = maskAlpha(rotated, W, H, ctx);
  assert.equal(validMasks([oldMask]), true, 'earlier saved masks without angle remain valid');
  assert.equal(validMasks([rotated]), true);
  assert.equal(validMasks([{ ...rotated, angle: Number.NaN }]), false);
  assert.ok(at(unrotated, 75, 40) > 0.9, 'wide oval covers horizontal point');
  assert.ok(at(turned, 75, 40) < 0.1, 'rotating no longer covers horizontal point');
  assert.ok(at(turned, 50, 62) > 0.9, 'rotated oval covers vertical point');
  assert.ok(at(unrotated, 50, 62) < 0.1);
  assert.ok(at(turned, 50, 40) > 0.95, 'centre stays selected');
});

test('local noise reduction changes chroma only inside its mask and respects neutral recipes', () => {
  const width = 64, height = 48;
  const base = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const noise = ((x * 7 + y * 11) % 5) - 2;
    const index = (y * width + x) * 4;
    base.set([112 + noise * 5, 120, 128 - noise * 4, 255], index);
  }
  const local = { ...createMask('radial', 'local-denoise'), kind: 'radial' as const,
    cx: 0.3, cy: 0.5, rx: 0.22, ry: 0.18, feather: 0.1, edit: { denoise: 2 } };
  assert.equal(validMasks([local]), true, 'local denoise recipe is persisted');
  assert.equal(validMasks([{ ...local, edit: { denoise: -1 } }]), false, 'invalid negative denoise is rejected');
  const unchanged = new Uint8ClampedArray(base);
  applyMasks(unchanged, width, height, [{ ...local, edit: { denoise: 0 } }], fullContext(width, height));
  assert.deepEqual(unchanged, base, 'neutral mask does not alter pixels');

  const result = new Uint8ClampedArray(base);
  applyMasks(result, width, height, [local], fullContext(width, height));
  const inside = (24 * width + 20) * 4;
  const outside = (24 * width + 61) * 4;
  assert.notDeepEqual(Array.from(result.slice(inside, inside + 3)), Array.from(base.slice(inside, inside + 3)),
    'chromatic noise changes within the mask');
  assert.deepEqual(result.slice(outside, outside + 4), base.slice(outside, outside + 4),
    'pixels beyond the oval are untouched');
});

test('intersected local denoise only acts where both masks overlap', () => {
  const width = 64, height = 48;
  const base = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const noise = ((x + y * 3) % 5) - 2;
    base.set([110 + noise * 5, 120, 130 - noise * 4, 255], (y * width + x) * 4);
  }
  const left: Mask = { ...createMask('radial', 'left'), kind: 'radial', cx: 0.25, cy: 0.5, rx: 0.24, ry: 0.22, feather: 0.15 };
  const right: Mask = { ...createMask('radial', 'right'), kind: 'radial', cx: 0.55, cy: 0.5, rx: 0.27, ry: 0.22, feather: 0.15 };
  const constrained: Mask = { ...left, edit: { denoise: 2 }, limit: { id: right.id, mode: 'intersect' } };
  const result = new Uint8ClampedArray(base);
  applyMasks(result, width, height, [constrained, right], fullContext(width, height));
  const index = (24 * width + 15) * 4;
  assert.deepEqual(result.slice(index, index + 4), base.slice(index, index + 4),
    'inside the first oval but outside intersection is unchanged');
  assert.ok(result.some((value, i) => value !== base[i]), 'the intersecting region is denoised');
});
