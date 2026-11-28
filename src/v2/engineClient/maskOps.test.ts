import assert from 'node:assert/strict';
import test from 'node:test';
import { createMask, createTonalMask, createSubjectMask, MAX_MASKS, validMasks, hasActiveMasks, type Mask } from '../../core/maskTypes.ts';
import { addMaskStroke, canAddMask, isPaintable, masksToLayers, MAX_BRUSH_STROKES, MAX_STROKE_VALUES, removeMask, setMaskEdit, setMaskFeather, setMaskGeometry, setMaskInvert, setMaskLimit, setMaskParts, setMaskTonalRange, toggleMask } from './maskOps.ts';
import { applyMasks, effectiveAlpha, fullContext, lumaFromRgba8, maskAlpha } from '../../core/masks.ts';
import { recordEdit, stepEdit } from '../../core/editHistory.ts';
import type { PhotoFrame } from '../../core/types.ts';

const grid = { w: 8, h: 8, data: btoa('\x00'.repeat(64)) };
const subject = (id: string, invert = false): Mask => ({ ...createSubjectMask(id, grid, 'k', 'high'), invert });

test('layers are read from the masks: a subject, its inverse as the background, and shapes as areas', () => {
  const layers = masksToLayers([subject('a'), subject('b', true), createMask('linear', 'c'), createMask('brush', 'd')]);
  assert.deepEqual(layers.map((layer) => [layer.name, layer.type]), [['Subject', 'subject'], ['Background', 'background'], ['Gradient', 'gradient'], ['Brush mask', 'brush']]);
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

test('removing a limiting mask hides dependent adjustments and keeps a valid mask list', () => {
  const limited: Mask = { ...createMask('radial', 'b'), limit: { id: 'a', mode: 'intersect' } };
  const left = removeMask([subject('a'), limited], 'a');
  assert.equal(left.length, 1);
  assert.equal(left[0].limit, undefined);
  assert.equal(left[0].hidden, true);
  assert.ok(validMasks(setMaskFeather(setMaskEdit(toggleMask(left, 'b'), 'b', 'clarity', 0.4), 'b', 250)));
  assert.equal(setMaskFeather(left, 'b', 250)[0].feather, 1);
});

test('the number of masks is limited', () => {
  assert.equal(canAddMask(Array.from({ length: MAX_MASKS }, (_, i) => subject(String(i)))), false);
  assert.equal(canAddMask([]), true);
});

test('manual oval and gradient shapes expose their real saved geometry in the UI', () => {
  const oval = createMask('radial', 'oval');
  const gradient = createMask('linear', 'gradient');
  const layers = masksToLayers([oval, gradient]);
  assert.equal(layers[0].type, 'area');
  assert.deepEqual(layers[0].geometry, { kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.18, angle: 0 });
  assert.equal(layers[1].type, 'gradient');
  assert.deepEqual(layers[1].geometry, { kind: 'linear', x1: 0.5, y1: 0.12, x2: 0.5, y2: 0.55 });
  assert.ok(validMasks([oval, gradient]));
});

test('geometry sliders are bounded, mask-specific and always persist as a valid mask', () => {
  let masks = [createMask('radial', 'oval'), createMask('linear', 'gradient')];
  masks = setMaskGeometry(masks, 'oval', 'cx', 2);
  masks = setMaskGeometry(masks, 'oval', 'ry', 0);
  masks = setMaskGeometry(masks, 'oval', 'angle', 333);
  masks = setMaskGeometry(masks, 'gradient', 'x2', -1);
  assert.equal(masks[0].kind, 'radial');
  if (masks[0].kind === 'radial') {
    assert.equal(masks[0].cx, 1);
    assert.equal(masks[0].ry, 0.01);
    assert.equal(masks[0].angle, 180);
  }
  if (masks[1].kind === 'linear') assert.equal(masks[1].x2, 0);
  assert.deepEqual(setMaskGeometry(masks, 'oval', 'x1', 0.4), masks, 'do not change oval with gradient-only field');
  assert.deepEqual(setMaskGeometry(masks, 'gradient', 'cx', 0.4), masks, 'do not change gradient with oval-only field');
  assert.deepEqual(setMaskGeometry(masks, 'oval', 'cx', NaN), masks, 'refuse NaN');
  assert.ok(validMasks(masks), 'no invalid values can enter the catalogue');
});

test('manual oval adjustments change genuine rendered pixels and undo after JSON save/reopen', () => {
  let masks = setMaskEdit([createMask('radial', 'area')], 'area', 'exposure', 1);
  masks = setMaskGeometry(masks, 'area', 'cx', 0.35);
  masks = setMaskGeometry(masks, 'area', 'cy', 0.45);
  const alpha = maskAlpha(masks[0], 32, 32, fullContext(32, 32));
  assert.ok(alpha[14 * 32 + 11] > alpha[31 * 32 + 31], 'reposition changes mask alpha');
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 70; pixels[i + 3] = 255; }
  const before = new Uint8ClampedArray(pixels);
  applyMasks(pixels, 32, 32, masks, fullContext(32, 32));
  assert.ok(pixels[(14 * 32 + 11) * 4] > before[(14 * 32 + 11) * 4], 'real pixel engine applies the adjustment');
  assert.equal(pixels[(31 * 32 + 31) * 4], before[(31 * 32 + 31) * 4], 'outside the oval stays unchanged');
  const frame = { id: 'photo', originalSha256: 'a'.repeat(64) } as PhotoFrame;
  const edited = recordEdit(frame, { edit: { exposure: 0, warmth: 0, colour: 0, masks } }, 1000);
  const reopened = JSON.parse(JSON.stringify(edited)) as PhotoFrame;
  const undone = stepEdit(reopened, -1);
  assert.equal(undone.edit, undefined);
  assert.equal(undone.originalSha256, frame.originalSha256);
  assert.ok(validMasks(stepEdit(undone, 1).edit?.masks));
});

test('manual gradient has true directional alpha rather than an inert UI-only label', () => {
  const gradient = createMask('linear', 'g');
  const alpha = maskAlpha(gradient, 20, 20, fullContext(20, 20));
  assert.notEqual(alpha[1 * 20 + 10], alpha[18 * 20 + 10]);
  const changed = setMaskGeometry([gradient], 'g', 'y2', 0.9);
  assert.ok(validMasks(changed));
  assert.notDeepEqual(changed, [gradient]);
});


test('local colour denoise is stored on the selected layer and can be reset', () => {
  const layers = [subject('bird'), subject('background', true)];
  const masks = setMaskEdit(layers, 'background', 'denoise', 1.2);
  assert.ok(validMasks(masks));
  assert.equal(masksToLayers(masks)[1].edit.denoise, 1.2);
  assert.equal(masks[0], layers[0]);
  assert.deepEqual(setMaskEdit(masks, 'background', 'denoise', 0)[1].edit, {});
});

test('automatic subject layers stay independently editable after recipe reopen', () => {
  const id = 'auto-denoise-photo';
  const masks = [subject(id + '-instance-1-dog'), subject(id + '-instance-2-dog'), subject(id + '-instance-3-dog'), subject(id + '-background', true), subject(id)];
  const reopened = JSON.parse(JSON.stringify(masks)) as Mask[];
  assert.ok(validMasks(reopened));
  assert.deepEqual(masksToLayers(reopened).map(layer => layer.name), [
    'Subject 1 · Dog', 'Subject 2 · Dog', 'Subject 3 · Dog', 'Background · Denoise', 'All subjects · Denoise',
  ]);
  const edited = setMaskEdit(reopened, id + '-instance-2-dog', 'exposure', 0.5);
  assert.equal(edited[1].edit.exposure, 0.5);
  assert.equal(edited[0].edit.exposure, undefined);
  assert.equal(edited[2].edit.exposure, undefined);
  assert.equal(edited[4].edit.exposure, undefined);
});

test('mask combinations are reversible, validated and change the actual rendered alpha', () => {
  const base = [{ ...createMask('radial', 'left'), cx: 0.35, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0 }, { ...createMask('radial', 'right'), cx: 0.65, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0 }] as Mask[];
  const w = 100, h = 100, ctx = fullContext(w, h);
  const intersect = setMaskLimit(base, 'left', { id: 'right', mode: 'intersect' });
  const subtract = setMaskLimit(base, 'left', { id: 'right', mode: 'subtract' });
  assert.ok(validMasks(intersect) && validMasks(subtract));
  assert.deepEqual(masksToLayers(intersect)[0].parts, [{ id: 'right', mode: 'intersect' }]);
  const both = effectiveAlpha(intersect[0], intersect, w, h, ctx);
  const difference = effectiveAlpha(subtract[0], subtract, w, h, ctx);
  assert.ok(both[50 * w + 50] > 0.9 && both[50 * w + 20] < 0.1);
  assert.ok(difference[50 * w + 20] > 0.9 && difference[50 * w + 50] < 0.1);
  assert.deepEqual(setMaskLimit(base, 'left', { id: 'left', mode: 'intersect' }), base);
  assert.deepEqual(setMaskLimit(base, 'left', { id: 'missing', mode: 'intersect' }), base);
  assert.equal(setMaskLimit(intersect, 'left', null)[0].limit, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(intersect))[0].limit, { id: 'right', mode: 'intersect' });
});


test('deleting a limiter never exposes a stronger adjustment, and undo restores the original restriction', () => {
  const limiter = createMask('radial', 'limiter');
  const dependent: Mask = { ...createMask('radial', 'dependent'), edit: { exposure: 1 }, limit: { id: 'limiter', mode: 'intersect' } };
  const source = { id: 'photo', edit: { exposure: 0, warmth: 0, colour: 0, masks: [limiter, dependent] } } as PhotoFrame;
  const masks = removeMask(source.edit?.masks, 'limiter');
  assert.equal(hasActiveMasks(masks), false);
  const removed = recordEdit(source, { edit: { ...source.edit!, masks } }, 1000);
  const reopened = JSON.parse(JSON.stringify(removed)) as PhotoFrame;
  assert.deepEqual(stepEdit(reopened, -1).edit?.masks, [limiter, dependent]);
  assert.equal(hasActiveMasks(toggleMask(masks, 'dependent')), true);
});


test('collapsed linear gradients cannot affect the whole image or broaden a restricted adjustment', () => {
  const gradient = { ...createMask('linear', 'g'), kind: 'linear' as const, x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 } as Extract<Mask, { kind: 'linear' }>;
  const ctx = fullContext(10, 10);
  for (const invert of [false, true]) {
    const invalid = { ...gradient, invert };
    assert.ok(maskAlpha(invalid, 10, 10, ctx).every(a => a === 0));
    for (const mode of ['intersect', 'subtract'] as const) {
      const local: Mask = { ...createMask('radial', 'local'), limit: { id: 'g', mode } };
      assert.ok(effectiveAlpha(local, [local, invalid], 10, 10, ctx).every(a => a === 0));
    }
  }
  const valid = { ...gradient, x2: 0.75 };
  assert.deepEqual(setMaskGeometry([valid], 'g', 'x2', 0.5), [valid]);
});

/** Three round areas in a row across the middle: left (x 0.1-0.4), middle (0.35-0.65), right (0.6-0.9). */
function threeAreas(): Mask[] {
  const area = (id: string, cx: number) => ({ ...createMask('radial', id), cx, cy: 0.5, rx: 0.15, ry: 0.15, feather: 0, edit: { exposure: 1 } }) as Mask;
  return [area('left', 0.25), area('middle', 0.5), area('right', 0.75)];
}
const at = (alpha: Float32Array, x: number, w = 100) => alpha[50 * w + x];

test('a mask combines several parts in order: add, subtract and intersect', () => {
  const ctx = fullContext(100, 100);
  // left + right: both areas, not the gap between them.
  const added = setMaskParts(threeAreas(), 'left', [{ id: 'right', mode: 'add' }]);
  const union = effectiveAlpha(added[0], added, 100, 100, ctx);
  assert.ok(at(union, 25) > 0.9 && at(union, 75) > 0.9 && at(union, 50) < 0.1);
  // (left + right) - middle: the middle area's overlap with each is taken out again.
  const cut = setMaskParts(threeAreas(), 'left', [{ id: 'right', mode: 'add' }, { id: 'middle', mode: 'subtract' }]);
  const less = effectiveAlpha(cut[0], cut, 100, 100, ctx);
  assert.ok(at(less, 15) > 0.9 && at(less, 85) > 0.9 && at(less, 38) < 0.1 && at(less, 62) < 0.1);
  // (left + right) ∩ middle: only the two thin overlaps remain.
  const overlap = setMaskParts(threeAreas(), 'left', [{ id: 'right', mode: 'add' }, { id: 'middle', mode: 'intersect' }]);
  const both = effectiveAlpha(overlap[0], overlap, 100, 100, ctx);
  assert.ok(at(both, 38) > 0.9 && at(both, 62) > 0.9 && at(both, 15) < 0.1 && at(both, 50) < 0.1);
  // Saved and read back as a valid recipe, and listed for the panel in order.
  assert.ok(validMasks(JSON.parse(JSON.stringify(cut))));
  assert.deepEqual(masksToLayers(cut)[0].parts, [{ id: 'right', mode: 'add' }, { id: 'middle', mode: 'subtract' }]);
});

test('an older InFlight that only reads limit narrows the mask instead of spreading it', () => {
  const cut = setMaskParts(threeAreas(), 'left', [{ id: 'right', mode: 'add' }, { id: 'middle', mode: 'subtract' }]);
  assert.deepEqual(cut[0].limit, { id: 'middle', mode: 'subtract' });
  const addOnly = setMaskParts(threeAreas(), 'left', [{ id: 'right', mode: 'add' }]);
  assert.equal(addOnly[0].limit, undefined);
  // An older single limit is still read as one part.
  const older = { ...threeAreas()[0], limit: { id: 'middle', mode: 'subtract' as const } };
  const alpha = effectiveAlpha(older, [older, ...threeAreas().slice(1)], 100, 100, fullContext(100, 100));
  assert.ok(at(alpha, 15) > 0.9 && at(alpha, 38) < 0.1);
});

test('mask parts are validated, capped at four, and removing a part mask hides the masks that used it', () => {
  const areas = threeAreas();
  assert.deepEqual(setMaskParts(areas, 'left', [{ id: 'left', mode: 'add' }]), areas);
  assert.deepEqual(setMaskParts(areas, 'left', [{ id: 'missing', mode: 'add' }]), areas);
  assert.deepEqual(setMaskParts(areas, 'left', [{ id: 'right', mode: 'add' }, { id: 'right', mode: 'subtract' }]), areas);
  assert.deepEqual(setMaskParts(areas, 'left', [{ id: 'right', mode: 'blend' as 'add' }]), areas);
  const many = [...areas, ...['a', 'b', 'c'].map((id) => createMask('radial', id))];
  assert.deepEqual(setMaskParts(many, 'left', ['middle', 'right', 'a', 'b', 'c'].map((id) => ({ id, mode: 'add' as const }))), many);
  assert.ok(validMasks(setMaskParts(many, 'left', ['middle', 'right', 'a', 'b'].map((id) => ({ id, mode: 'add' as const })))));
  // Clearing the parts clears the older limit as well.
  const cleared = setMaskParts(setMaskParts(areas, 'left', [{ id: 'middle', mode: 'intersect' }]), 'left', []);
  assert.equal(cleared[0].parts, undefined);
  assert.equal(cleared[0].limit, undefined);
  // Removing a part mask drops that part and hides the dependent mask, so its edit never spreads.
  const combined = setMaskParts(areas, 'left', [{ id: 'right', mode: 'add' }, { id: 'middle', mode: 'subtract' }]);
  const after = removeMask(combined, 'middle');
  assert.deepEqual(after[0].parts, [{ id: 'right', mode: 'add' }]);
  assert.equal(after[0].hidden, true);
  assert.equal(after[0].limit, undefined);
});

test('invert swaps what a mask selects, applies to real pixels, and setting it twice restores the original', () => {
  const base = setMaskEdit([createMask('radial', 'area')], 'area', 'exposure', 1);
  const flipped = setMaskInvert(base, 'area', true);
  assert.equal(masksToLayers(flipped)[0].invert, true);
  assert.ok(validMasks(flipped));
  const a = maskAlpha(base[0], 32, 32, fullContext(32, 32));
  const b = maskAlpha(flipped[0], 32, 32, fullContext(32, 32));
  for (const i of [0, 500, 16 * 32 + 16, 1023]) assert.ok(Math.abs(a[i] + b[i] - 1) < 1e-6, 'alpha is complementary');
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 70; pixels[i + 3] = 255; }
  applyMasks(pixels, 32, 32, flipped, fullContext(32, 32));
  assert.equal(pixels[(16 * 32 + 16) * 4], 70, 'centre of the oval is now left alone');
  assert.ok(pixels[(31 * 32 + 31) * 4] > 70, 'the outside is adjusted');
  assert.deepEqual(setMaskInvert(flipped, 'area', false), base, 'inverting twice restores it');
});

test('inverting a subject mask reads as Background, and a combined mask can be inverted and intersected', () => {
  const masks: Mask[] = [createMask('radial', 'a'), createMask('radial', 'b')];
  const both = setMaskInvert(setMaskParts(masks, 'a', [{ id: 'b', mode: 'intersect' }]), 'a', true);
  assert.ok(validMasks(both));
  assert.equal(masksToLayers(both)[0].invert, true);
  assert.equal(masksToLayers(both)[0].parts?.[0].mode, 'intersect');
});

function ramp(): Uint8ClampedArray {
  // 16 x 1 grey ramp, black to white.
  const pixels = new Uint8ClampedArray(16 * 4);
  for (let x = 0; x < 16; x += 1) { const v = Math.round((x / 15) * 255); pixels.set([v, v, v, 255], x * 4); }
  return pixels;
}

test('tonal masks pick shadows or highlights by brightness, and select nothing when brightness is not measured', () => {
  const context = { ...fullContext(16, 1), luma: lumaFromRgba8(ramp()) };
  const shadows = createTonalMask('shadows', 's');
  const highlights = createTonalMask('highlights', 'h');
  const a = maskAlpha(shadows, 16, 1, context);
  const b = maskAlpha(highlights, 16, 1, context);
  assert.equal(a[0], 1); assert.equal(a[15], 0);
  assert.equal(b[0], 0); assert.equal(b[15], 1);
  assert.ok(a[7] < 1 && b[7] < 1, 'midtones are mostly outside both');
  // No luma: nothing selected, even inverted, so an edit is never widened to the whole picture.
  assert.ok(maskAlpha(shadows, 16, 1, fullContext(16, 1)).every(v => v === 0));
  assert.ok(maskAlpha({ ...shadows, invert: true }, 16, 1, fullContext(16, 1)).every(v => v === 0));
  // Inverting a measured tonal mask is the complement.
  const flipped = maskAlpha({ ...shadows, invert: true }, 16, 1, context);
  for (let i = 0; i < 16; i += 1) assert.ok(Math.abs(a[i] + flipped[i] - 1) < 1e-6);
});

test('a tonal mask adjusts only the chosen brightnesses in real pixels, can be ranged, intersected and saved', () => {
  let masks: Mask[] = [setMaskEdit([createTonalMask('shadows', 't')], 't', 'exposure', 1)[0]];
  assert.ok(validMasks(masks));
  const pixels = ramp();
  const before = new Uint8ClampedArray(pixels);
  applyMasks(pixels, 16, 1, masks, fullContext(16, 1));
  assert.ok(pixels[4] > before[4], 'a dark pixel is lifted');
  assert.equal(pixels[15 * 4], before[15 * 4], 'a white pixel is untouched');
  assert.equal(masksToLayers(masks)[0].type, 'tonal');
  masks = setMaskTonalRange(masks, 't', 'low', 0.9);
  const range = masksToLayers(masks)[0].tonal!;
  assert.ok(range.low < range.high, 'the ends never cross');
  masks = setMaskTonalRange(masks, 't', 'high', 0.1);
  assert.ok(masksToLayers(masks)[0].tonal!.high > masksToLayers(masks)[0].tonal!.low);
  assert.deepEqual(setMaskTonalRange(masks, 't', 'low', NaN), masks);
  assert.ok(validMasks(JSON.parse(JSON.stringify(masks))));
  assert.equal(validMasks([{ ...masks[0], low: 0.8, high: 0.2 }]), false, 'a collapsed range is refused');
  // Combine: highlights intersected with an oval keeps only their overlap.
  const both = setMaskParts([createTonalMask('highlights', 'h'), createMask('radial', 'o')], 'h', [{ id: 'o', mode: 'intersect' }]);
  const alpha = effectiveAlpha(both[0], both, 16, 1, { ...fullContext(16, 1), luma: lumaFromRgba8(ramp()) });
  assert.equal(alpha[0], 0);
});

test('a brush stroke is added to a brush mask, clamped to the photo, and stored as its opposite on an inverted mask', () => {
  const masks = addMaskStroke([createMask('brush', 'b')], 'b', { points: [-0.2, 0.5, 0.4, 1.3], radius: 0.05, erase: false });
  const brush = masks[0] as Extract<Mask, { kind: 'brush' }>;
  assert.equal(brush.strokes.length, 1);
  assert.deepEqual(brush.strokes[0], { points: [0, 0.5, 0.4, 1], radius: 0.05, erase: false });
  const inverted = addMaskStroke([{ ...createMask('brush', 'b'), invert: true }], 'b', { points: [0.5, 0.5], radius: 0.05, erase: false });
  assert.equal((inverted[0] as Extract<Mask, { kind: 'brush' }>).strokes[0].erase, true);
  assert.equal(masksToLayers(masks)[0].strokes, 1);
});

test('painting refines a subject or background mask: paint adds, erase removes', () => {
  const masks = addMaskStroke([subject('s')], 's', { points: [0.5, 0.5], radius: 0.2, erase: false });
  const before = effectiveAlpha(subject('s'), [subject('s')], 16, 16, { aspect: 1, view: { x: 0, y: 0, w: 1, h: 1 } });
  const after = effectiveAlpha(masks[0], masks, 16, 16, { aspect: 1, view: { x: 0, y: 0, w: 1, h: 1 } });
  const centre = 8 * 16 + 8;
  assert.equal(before[centre], 0);
  assert.ok(after[centre] > 0.5, `painted centre is selected (${after[centre]})`);
  const erased = addMaskStroke(masks, 's', { points: [0.5, 0.5], radius: 0.2, erase: true });
  const cleared = effectiveAlpha(erased[0], erased, 16, 16, { aspect: 1, view: { x: 0, y: 0, w: 1, h: 1 } });
  assert.ok(cleared[centre] < 0.1, `erased centre is cleared (${cleared[centre]})`);
});

test('a stroke that cannot be used leaves the masks as they were (nothing for History)', () => {
  const masks = [createMask('radial', 'r'), createMask('brush', 'b')];
  assert.equal(addMaskStroke(masks, 'r', { points: [0.5, 0.5], radius: 0.05, erase: false }), masks, 'an oval takes no paint');
  assert.equal(addMaskStroke(masks, 'b', { points: [Number.NaN, 0.5], radius: 0.05, erase: false }), masks, 'no usable point');
  assert.equal(addMaskStroke(masks, 'b', { points: [0.5, 0.5], radius: 0, erase: false }), masks, 'no radius');
  assert.equal(addMaskStroke(masks, 'missing', { points: [0.5, 0.5], radius: 0.05, erase: false }), masks);
  const full: Mask = { ...createMask('brush', 'f'), strokes: Array.from({ length: MAX_BRUSH_STROKES }, () => ({ points: [0.1, 0.1], radius: 0.01, erase: false })) } as Mask;
  assert.equal(addMaskStroke([full], 'f', { points: [0.5, 0.5], radius: 0.05, erase: false })[0], full);
  const long = addMaskStroke(masks, 'b', { points: Array.from({ length: MAX_STROKE_VALUES + 40 }, () => 0.5), radius: 0.05, erase: false });
  assert.equal((long[1] as Extract<Mask, { kind: 'brush' }>).strokes[0].points.length, MAX_STROKE_VALUES);
  assert.ok(isPaintable(masks[1]) && !isPaintable(masks[0]) && isPaintable(subject('s', true)));
});
