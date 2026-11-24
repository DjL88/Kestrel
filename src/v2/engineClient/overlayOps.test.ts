import assert from 'node:assert/strict';
import test from 'node:test';
import { addRow, alignOverlays, anchorOverlay, moveRow, patchOverlay, readOverlay, removeRow, updateRow } from './overlayOps.ts';

test('a photo with no stored overlay has text and watermark off', () => {
  for (const raw of [undefined, null, 'x', 5, []]) {
    const overlay = readOverlay(raw);
    assert.equal(overlay.textEnabled, false);
    assert.equal(overlay.watermarkEnabled, false);
  }
});

test('a stored overlay is read defensively: bad values fall back and ranges are held', () => {
  const overlay = readOverlay({ textEnabled: true, textX: 500, textPosition: 'sideways', watermarkOpacity: -3, rows: [{ id: 'a', fields: ['camera', 'nonsense'], fontId: 'lora', sizePx: 9999, weight: 650 }, { fields: ['lens'] }, 'junk'] });
  assert.equal(overlay.textEnabled, true);
  assert.equal(overlay.textX, 96);
  assert.equal(overlay.textPosition, 'bottom-left');
  assert.equal(overlay.watermarkOpacity, 10);
  assert.equal(overlay.rows.length, 1, 'rows without an id or that are not objects are dropped');
  assert.deepEqual(overlay.rows[0].fields, ['camera']);
  assert.equal(overlay.rows[0].sizePx, 120);
  assert.equal(overlay.rows[0].weight, 600, 'an invalid weight falls back to the default row weight');
  assert.equal(overlay.rows[0].fontId, 'lora');
});

test('rows can be added, changed and removed, and adding a row switches text on', () => {
  let overlay = readOverlay(undefined);
  overlay = addRow(overlay, 'row-x');
  assert.equal(overlay.textEnabled, true);
  assert.equal(overlay.rows.at(-1)?.id, 'row-x');
  overlay = updateRow(overlay, 'row-x', { fontId: 'oswald', sizePx: 24, uppercase: true });
  const row = overlay.rows.find((entry) => entry.id === 'row-x')!;
  assert.deepEqual([row.fontId, row.sizePx, row.uppercase], ['oswald', 24, true]);
  overlay = removeRow(overlay, 'row-x');
  assert.equal(overlay.rows.some((entry) => entry.id === 'row-x'), false);
});

test('patching keeps the overlay valid, and a clean alignment resets the offsets', () => {
  const moved = patchOverlay(readOverlay(undefined), { textOffsetX: 30, watermarkScale: 999 });
  assert.equal(moved.watermarkScale, 160);
  const aligned = alignOverlays(moved, 'right');
  assert.equal(aligned.textOffsetX, 0);
  assert.equal(aligned.watermarkPosition, 'bottom-right');
  assert.equal(aligned.textPosition, 'bottom-right');
  assert.equal(aligned.textAlign, 'right');
  assert.equal(aligned.textPlacement, 'anchor');
  assert.equal(aligned.watermarkPlacement, 'anchor');
});

test('a watermark starts on auto contrast, and an explicit choice is kept', () => {
  assert.equal(readOverlay(undefined).watermarkContrast, 'auto');
  assert.equal(readOverlay({ watermarkContrast: 'dark-on-light' }).watermarkContrast, 'dark-on-light');
  assert.equal(readOverlay({ watermarkContrast: 'light-on-dark' }).watermarkContrast, 'light-on-dark');
  assert.equal(readOverlay({ watermarkContrast: 'weird' }).watermarkContrast, 'auto');
});

test('stacking left, centre or right puts both boxes at the bottom on that side; older names still work', () => {
  const before = patchOverlay(readOverlay(undefined), { textOffsetX: 20, textOffsetY: -10 });
  for (const side of ['left', 'center', 'right'] as const) {
    const aligned = alignOverlays(before, side);
    assert.equal(aligned.textPosition, `bottom-${side}`);
    assert.equal(aligned.watermarkPosition, `bottom-${side}`);
    assert.equal(aligned.textAlign, side);
    assert.equal(aligned.textOffsetX, 0);
    assert.equal(aligned.textOffsetY, 0);
  }
  assert.equal(alignOverlays(before, 'stacked-right').textPosition, 'bottom-right');
  assert.equal(alignOverlays(before, 'centred-pair').watermarkPosition, 'bottom-center');
});

test('choosing a place on the grid anchors that box and lines the text up with that side', () => {
  const dragged = patchOverlay(readOverlay(undefined), { textPlacement: 'free', textX: 40, textY: 30 });
  assert.equal(dragged.textPlacement, 'free');
  const placed = anchorOverlay(dragged, 'text', 'top-right');
  assert.deepEqual([placed.textPlacement, placed.textPosition, placed.textAlign], ['anchor', 'top-right', 'right']);
  const mark = anchorOverlay(dragged, 'watermark', 'middle-left');
  assert.deepEqual([mark.watermarkPlacement, mark.watermarkPosition], ['anchor', 'middle-left']);
});

test('older overlays: a box still on a grid place is anchored, a dragged one stays free', () => {
  assert.equal(readOverlay({ textX: 8, textY: 90 }).textPlacement, 'anchor');
  assert.equal(readOverlay({ watermarkX: 92, watermarkY: 90 }).watermarkPlacement, 'anchor');
  assert.equal(readOverlay({ textX: 37.5, textY: 61 }).textPlacement, 'free');
  assert.equal(readOverlay({ textPosition: 'top-center' }).textAlign, 'center');
  assert.equal(readOverlay({ edgeMargin: 99 }).edgeMargin, 12);
  assert.equal(readOverlay(undefined).edgeMargin, 4);
});

test('any number of rows up to the bound, new rows start empty, and rows can be reordered', () => {
  let overlay = readOverlay(undefined);
  for (let i = 0; i < 20; i += 1) overlay = addRow(overlay, `row-${i}`);
  assert.equal(overlay.rows.length, 12);
  assert.deepEqual(overlay.rows.at(-1)?.fields, []);
  const first = overlay.rows[0].id, second = overlay.rows[1].id;
  overlay = moveRow(overlay, second, -1);
  assert.deepEqual([overlay.rows[0].id, overlay.rows[1].id], [second, first]);
  assert.deepEqual(moveRow(overlay, second, -1).rows.map((row) => row.id), overlay.rows.map((row) => row.id), 'the first row cannot move up');
  assert.equal(readOverlay({ rows: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, fields: ['camera'] })) }).rows.length, 12);
});

test('extended photo metadata fields persist in selection order, without duplicates or unknown fields', () => {
  const overlay = readOverlay({ rows: [{ id: 'r', fields: ['capturedAt', 'filename', 'capturedAt', 'dimensions', 'privatePath', 'colourProfile'] }] });
  assert.deepEqual(overlay.rows[0].fields, ['capturedAt', 'filename', 'dimensions', 'colourProfile']);
  assert.deepEqual(readOverlay(JSON.parse(JSON.stringify(overlay))).rows[0].fields, overlay.rows[0].fields);
});

test('duplicate stored row IDs cannot cause one edit to change multiple text rows', () => {
  const overlay = readOverlay({ rows: [{ id: 'same', fields: ['camera'] }, { id: 'same', fields: ['lens'] }, { id: ' ' }] });
  assert.equal(overlay.rows.length, 1);
  assert.deepEqual(overlay.rows[0].fields, ['camera']);
  assert.equal(addRow(overlay, 'same'), overlay);
  assert.equal(addRow(overlay, ' '), overlay);
  assert.equal(updateRow(overlay, 'same', { sizePx: 32 }).rows[0].sizePx, 32);
});
