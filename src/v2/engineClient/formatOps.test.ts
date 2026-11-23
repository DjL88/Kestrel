import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CROP } from './cropOps.ts';
import { addFormat, applyFormats, applySizeLinked, isSizeLinked, newCustomId, ratioLabelFor, readFormats, readSizeLinked, setOriginalOutputSize, resetOriginalOutputSize, removeFormat, swapFormatOrientation, toggleFormat, toggleSizeLinked } from './formatOps.ts';
import { createDefaultSizes } from '../ui/stub.ts';
import type { CropTransform, SizePreset } from '../ui/contract.ts';

const size = (cropOverrides: Partial<CropTransform> = {}): SizePreset => ({
  id: 'ig-portrait', label: 'Instagram Portrait', platform: 'instagram', width: 1080, height: 1350,
  ratioLabel: '4:5', kind: 'photo', enabled: true, linked: true, boardX: 0, boardY: 0,
  crop: { ...DEFAULT_CROP, panX: 10, panY: -5, flipV: true, rotateDeg: 90, borderWidth: 2, ...cropOverrides },
});

test('a photo with no stored formats has the built-in list unchanged', () => {
  const defaults = createDefaultSizes();
  assert.deepEqual(applyFormats(defaults, undefined).map((size) => size.id), defaults.map((size) => size.id));
  assert.deepEqual(readFormats('x'), { disabled: [], custom: [] });
});

test('built-in opt-in starts hidden, can be enabled then switched off again on one photo', () => {
  const defaults = createDefaultSizes();
  assert.equal(applyFormats(defaults, undefined).find((size) => size.id === 'ig-portrait')?.enabled, false);
  const on = toggleFormat(undefined, 'ig-portrait', false);
  assert.equal(applyFormats(defaults, on).find((size) => size.id === 'ig-portrait')?.enabled, true);
  const off = toggleFormat(on, 'ig-portrait', false);
  assert.equal(applyFormats(defaults, off).find((size) => size.id === 'ig-portrait')?.enabled, false);
  assert.equal(applyFormats(defaults, undefined).find((size) => size.id === 'ig-portrait')?.enabled, false);
  assert.deepEqual(readFormats(off), { disabled: ['ig-portrait'], custom: [] });
});

test('Original remains enabled by default but can be explicitly toggled off and on', () => {
  const off = toggleFormat(undefined, 'orig-3x2', true);
  assert.equal(applyFormats(createDefaultSizes(), off, { width: 8256, height: 5504 }).find((size) => size.id === 'orig-3x2')?.enabled, false);
  const on = toggleFormat(off, 'orig-3x2', true);
  assert.equal(applyFormats(createDefaultSizes(), on, { width: 8256, height: 5504 }).find((size) => size.id === 'orig-3x2')?.enabled, true);
});

test('legacy disabled lists and user-selected opt-in formats survive a save/reopen', () => {
  const stored = JSON.parse(JSON.stringify(toggleFormat({disabled:['orig-3x2'],custom:[]}, 'ig-square', false)));
  const sizes = applyFormats(createDefaultSizes(), stored);
  assert.equal(sizes.find((size) => size.id === 'orig-3x2')?.enabled, false);
  assert.equal(sizes.find((size) => size.id === 'ig-square')?.enabled, true);
  assert.equal(sizes.find((size) => size.id === 'ig-portrait')?.enabled, false);
});

test('a custom format is added with a plain ratio, switched off, and removed for good', () => {
  const id = newCustomId('a1b2c3');
  const added = addFormat(undefined, '  Poster  ', 2400, 3000, id)!;
  const sizes = applyFormats(createDefaultSizes(), added);
  const poster = sizes.find((size) => size.id === id)!;
  assert.equal(poster.label, 'Poster');
  assert.equal(poster.ratioLabel, '4:5');
  assert.equal(poster.platform, 'custom');
  assert.equal(removeFormat(added, id).custom.length, 0);
});

test('deleting a built-in switches it off instead of losing it', () => {
  const removed = removeFormat(undefined, 'yt-wide');
  assert.deepEqual(removed.disabled, ['yt-wide']);
  assert.equal(removed.custom.length, 0);
});

test('bad sizes and bad stored values are refused or dropped, never trusted', () => {
  assert.equal(addFormat(undefined, 'x', 0, 100, 'custom-abc'), undefined);
  assert.equal(addFormat(undefined, 'x', 100.5, 100, 'custom-abc'), undefined);
  assert.equal(addFormat(undefined, 'x', 99999, 100, 'custom-abc'), undefined);
  assert.equal(addFormat(undefined, 'x', 100, 100, 'not a safe id'), undefined);
  const damaged = readFormats({ disabled: [1, 'a', 'a'], custom: [{ id: 'custom-ok1', width: 10, height: 20 }, { id: '../evil', width: 10, height: 10 }, { id: 'custom-bad', width: -1, height: 5 }, 7] });
  assert.deepEqual(damaged.disabled, ['a']);
  assert.deepEqual(damaged.custom.map((c) => c.id), ['custom-ok1']);
  assert.equal(ratioLabelFor(1080, 1350), '4:5');
  assert.equal(ratioLabelFor(1234, 777), '1234×777');
});

test('a photo with known dimensions starts with one enabled photo format and no automatic social variants', () => {
  const dimensions = { width: 8256, height: 5504 };
  const active = applyFormats(createDefaultSizes(), undefined, dimensions).filter((size) => size.enabled && size.kind === 'photo');
  assert.deepEqual(active.map((size) => size.id), ['orig-3x2']);
  // User-created format stays enabled and independent for only the chosen photo.
  const personal = addFormat(undefined, 'A4 print', 2480, 3508, 'custom-a4p')!;
  assert.deepEqual(applyFormats(createDefaultSizes(), personal, dimensions).filter((size) => size.enabled && size.kind === 'photo')
    .map((size) => size.id), ['orig-3x2', 'custom-a4p']);
  assert.deepEqual(applyFormats(createDefaultSizes(), undefined, dimensions).filter((size) => size.enabled && size.kind === 'photo')
    .map((size) => size.id), ['orig-3x2']);
});

test('every format starts linked, with no stored overrides', () => {
  assert.deepEqual(readSizeLinked(undefined), {});
  assert.equal(isSizeLinked(undefined, 'ig-portrait'), true);
  assert.equal(isSizeLinked('not an object', 'ig-portrait'), true);
});

test('toggling linked is reversible and only touches the one format', () => {
  const unlinked = toggleSizeLinked(undefined, 'ig-portrait');
  assert.equal(isSizeLinked(unlinked, 'ig-portrait'), false);
  assert.equal(isSizeLinked(unlinked, 'yt-wide'), true);
  const relinked = toggleSizeLinked(unlinked, 'ig-portrait');
  assert.equal(isSizeLinked(relinked, 'ig-portrait'), true);
});

test('bad stored linked values are dropped, never trusted', () => {
  const damaged = readSizeLinked({ 'ig-portrait': 'yes', 'yt-wide': false, '': true, [`x`.repeat(90)]: true });
  assert.deepEqual(damaged, { 'yt-wide': false });
});

test('applySizeLinked only changes formats with a stored override', () => {
  const sizes = applyFormats(createDefaultSizes(), undefined);
  const unlinked = toggleSizeLinked(undefined, 'ig-portrait');
  const applied = applySizeLinked(sizes, unlinked);
  assert.equal(applied.find((size) => size.id === 'ig-portrait')?.linked, false);
  const other = applied.find((size) => size.id !== 'ig-portrait');
  const original = sizes.find((size) => size.id === other?.id);
  assert.equal(other?.linked, original?.linked);
});

test('rotate format swaps width, height and the ratio label, never the id, platform or board position', () => {
  const swapped = swapFormatOrientation(size());
  assert.equal(swapped.width, 1350);
  assert.equal(swapped.height, 1080);
  assert.equal(swapped.ratioLabel, '5:4');
  assert.equal(swapped.id, 'ig-portrait');
  assert.equal(swapped.platform, 'instagram');
  assert.equal(swapped.boardX, 0);
  assert.equal(swapped.boardY, 0);
});

test('rotate format resets zoom to the safe fit baseline but never touches the focal point, flips, photo rotation or border', () => {
  const swapped = swapFormatOrientation(size({ zoom: 2.4 }));
  assert.equal(swapped.crop.zoom, DEFAULT_CROP.zoom);
  assert.equal(swapped.crop.panX, 10);
  assert.equal(swapped.crop.panY, -5);
  assert.equal(swapped.crop.flipV, true);
  assert.equal(swapped.crop.flipH, false);
  // rotateDeg is the photograph's own 90-degree rotate command - a different, separately-labelled thing from
  // the canvas orientation this function swaps - and must survive untouched.
  assert.equal(swapped.crop.rotateDeg, 90);
  assert.equal(swapped.crop.borderWidth, 2);
  assert.equal(swapped.crop.borderColour, DEFAULT_CROP.borderColour);
});

test('rotate format is its own inverse: swapping twice returns the original width, height and ratio label', () => {
  const original = size();
  const twice = swapFormatOrientation(swapFormatOrientation(original));
  assert.equal(twice.width, original.width);
  assert.equal(twice.height, original.height);
  assert.equal(twice.ratioLabel, original.ratioLabel);
});

test('rotate format on a square leaves its width, height and ratio label unchanged', () => {
  const square = { ...size(), width: 480, height: 480, ratioLabel: '1:1' };
  const swapped = swapFormatOrientation(square);
  assert.equal(swapped.width, 480);
  assert.equal(swapped.height, 480);
  assert.equal(swapped.ratioLabel, '1:1');
});

test('Original shape follows the imported photograph, never a fixed 3:2 preset', () => {
  const defaults = createDefaultSizes();
  for (const native of [{ width: 8256, height: 5504 }, { width: 4000, height: 3000 }, { width: 3000, height: 4000 }]) {
    const original = applyFormats(defaults, undefined, native).find((size) => size.id === 'orig-3x2')!;
    assert.equal(original.label, 'Original');
    assert.equal(original.width, native.width);
    assert.equal(original.height, native.height);
    assert.equal(original.enabled, true);
  }
  const unknown = applyFormats(defaults, undefined).find((size) => size.id === 'orig-3x2')!;
  assert.equal(unknown.enabled, false);
  assert.equal(unknown.ratioLabel, 'Unknown');
});

test('Original can be resized only as output canvas, reset to import, and hidden without deletion', () => {
  const formats = setOriginalOutputSize(undefined, 2000, 3000)!;
  const original = applyFormats(createDefaultSizes(), formats, { width: 8256, height: 5504 })[0];
  assert.deepEqual([original.width, original.height, original.ratioLabel], [2000, 3000, '2:3']);
  const reset = resetOriginalOutputSize(formats);
  const restored = applyFormats(createDefaultSizes(), reset, { width: 8256, height: 5504 })[0];
  assert.equal(restored.width, 8256);
  const hidden = removeFormat(reset, 'orig-3x2');
  const item = applyFormats(createDefaultSizes(), hidden, { width: 8256, height: 5504 })[0];
  assert.equal(item.enabled, false);
  assert.equal(item.id, 'orig-3x2');
});

test('3:2 is a separate optional format', () => {
  const defaults = createDefaultSizes();
  const extra = defaults.find((size) => size.id === 'format-3x2')!;
  assert.equal(extra.enabled, false);
  assert.deepEqual([extra.width, extra.height], [3000, 2000]);
  const enabled = toggleFormat(undefined, 'format-3x2', false);
  assert.equal(applyFormats(defaults, enabled, { width: 4000, height: 3000 }).find((size) => size.id === 'format-3x2')?.enabled, true);
});
