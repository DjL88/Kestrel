import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactSheetLayout, MIN_CULL_CARD_WIDTH_PX, MIN_TOUCH_TARGET_PX, SHEET_GAP_PX, SHEET_PADDING_PX } from './contactSheetLayout';

test('cards never overflow at the required responsive breakpoints', () => {
  for (const [width, wanted] of [[320, 1], [375, 1], [420, 2], [640, 3], [960, 4], [1280, 5], [1440, 5], [1920, 5]] as const) {
    const grid = contactSheetLayout(width);
    assert.equal(grid.columns, wanted, 'column count at ' + width);
    assert.ok(grid.cardWidth >= MIN_CULL_CARD_WIDTH_PX, 'minimum width at ' + width);
    const occupied = SHEET_PADDING_PX * 2 + grid.columns * grid.cardWidth + (grid.columns - 1) * SHEET_GAP_PX;
    assert.ok(occupied <= width, 'card row overshoots at ' + width);
    assert.ok(grid.footerHeight >= (grid.stacked ? 2 : 1) * MIN_TOUCH_TARGET_PX);
  }
});
test('500 photos use finite, consistent virtualised row geometry', () => {
  for (const width of [320, 375, 420, 640, 960, 1280, 1440]) {
    const layout = contactSheetLayout(width);
    const totalHeight = Math.ceil(500 / layout.columns) * layout.rowStride + SHEET_PADDING_PX * 2;
    assert.ok(Number.isSafeInteger(totalHeight) && totalHeight > 0);
    assert.equal(layout.rowStride, layout.cardHeight + SHEET_GAP_PX);
  }
});
test('invalid dimensions do not produce NaN or negative card sizes', () => {
  for (const width of [0, -100, NaN, Infinity]) assert.deepEqual(contactSheetLayout(width), contactSheetLayout(320));
});
