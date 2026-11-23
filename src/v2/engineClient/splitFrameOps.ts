const MIN_OFFSET = -25;
const MAX_OFFSET = 25;

/**
 * Whether this photo's (single, synthetic) edit group is split into two panes. Stored as a plain boolean; anything else
 * falls back to "not split" rather than guessing.
 */
export function readSplitFrames(raw: unknown): boolean {
  return raw === true;
}

export function toggleSplitFrames(raw: unknown): boolean {
  return !readSplitFrames(raw);
}

/**
 * How far each pane is panned when split, as a percentage (-25 to 25, matching `EditGroup.splitPanOffset`). Read
 * defensively, because a stored value can come from an older build or a damaged file; anything unreadable falls back
 * to centred (0) rather than an invented offset.
 */
export function readSplitPanOffset(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, raw)) : 0;
}

export function setSplitPanOffset(offset: number): number {
  return readSplitPanOffset(offset);
}
