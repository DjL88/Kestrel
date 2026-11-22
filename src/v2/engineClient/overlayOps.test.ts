import assert from 'node:assert/strict';
import test from 'node:test';
import { addRow, alignOverlays, patchOverlay, readOverlay, removeRow, updateRow } from './overlayOps.ts';

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
  const aligned = alignOverlays(moved, 'opposite-bottom');
  assert.equal(aligned.textOffsetX, 0);
  assert.equal(aligned.watermarkPosition, 'bottom-right');
  assert.equal(aligned.watermarkX, 92);
});
