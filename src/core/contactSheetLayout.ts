/** One calm, non-overflowing contact-sheet layout for phones through desktop. */
export const SHEET_GAP_PX = 12;
export const SHEET_PADDING_PX = 16;
export const MIN_CULL_CARD_WIDTH_PX = 176;
export const MIN_TOUCH_TARGET_PX = 44;

export function contactSheetLayout(viewportWidth: number) {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 320;
  const desiredColumns = width >= 1280 ? 5 : width >= 960 ? 4 : width >= 640 ? 3 : width >= 420 ? 2 : 1;
  const fittingColumns = Math.max(1, Math.floor(
    (width - SHEET_PADDING_PX * 2 + SHEET_GAP_PX) / (MIN_CULL_CARD_WIDTH_PX + SHEET_GAP_PX)
  ));
  const columns = Math.min(desiredColumns, fittingColumns);
  const available = Math.max(1, width - SHEET_PADDING_PX * 2 - SHEET_GAP_PX * (columns - 1));
  const cardWidth = Math.max(1, Math.floor(available / columns));
  const stacked = cardWidth < 360;
  // Two stacked rows of 44 px touch targets, plus gap and breathing room.
  const footerHeight = stacked ? 100 : 52;
  const cardHeight = Math.round(cardWidth * 2 / 3) + footerHeight;
  return { columns, cardWidth, stacked, footerHeight, cardHeight, rowStride: cardHeight + SHEET_GAP_PX };
}
