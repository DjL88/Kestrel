/** Selected-format only split layout; never apply to all copies of a photo. */
/** A format exports as one frame, or as two to five continuous frames of the same picture. */
export type SplitFrameCount = 1 | 2 | 3 | 4 | 5;
export const MAX_SPLIT_FRAMES = 5;
export const isSplitFrameCount = (value: unknown): value is SplitFrameCount =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SPLIT_FRAMES;
export interface FormatSplit { enabled: boolean; offset: number; /** Omitted means the existing two-frame split. */ count?: 3 | 4 | 5 }
export type FormatSplits = Record<string, FormatSplit>;
const MAX_SAVED_SPLITS = 64;
const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !Object.hasOwn(Object.prototype, value);
const countField = (count: unknown): { count?: 3 | 4 | 5 } =>
  count === 3 || count === 4 || count === 5 ? { count } : {};
export function readFormatSplits(raw: unknown): FormatSplits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: FormatSplits = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!validId(id) || !value || typeof value !== 'object') continue;
    const split = value as Record<string, unknown>;
    if (split.enabled !== true) continue;
    const offset = typeof split.offset === 'number' && Number.isFinite(split.offset)
      ? Math.max(-25, Math.min(25, split.offset)) : 0;
    // Two-frame projects retain their old serialised shape; only three or more frames need a count.
    result[id] = { enabled: true, offset, ...countField(split.count) };
    if (Object.keys(result).length >= MAX_SAVED_SPLITS) break;
  }
  return result;
}
export function isFormatSplit(raw: unknown, sizeId: string): boolean {
  return readFormatSplits(raw)[sizeId]?.enabled === true;
}
/** An unsplit format has one frame; legacy split metadata always means two. */
export function splitFrameCount(raw: unknown, sizeId: string): SplitFrameCount {
  if (!validId(sizeId)) return 1;
  const split = readFormatSplits(raw)[sizeId];
  return !split ? 1 : split.count ?? 2;
}
/** Set a format to two to five frames; count=1 rejoins it. */
export function setSplitFrameCount(raw: unknown, sizeId: string, count: SplitFrameCount): FormatSplits {
  const current = readFormatSplits(raw);
  if (!validId(sizeId) || !isSplitFrameCount(count)) return current;
  if (count === 1) {
    const next = { ...current };
    delete next[sizeId];
    return next;
  }
  if (!current[sizeId] && Object.keys(current).length >= MAX_SAVED_SPLITS) return current;
  return { ...current, [sizeId]: { enabled: true, offset: current[sizeId]?.offset ?? 0, ...countField(count) } };
}
export function formatSplitOffset(raw: unknown, sizeId: string): number {
  return validId(sizeId) ? readFormatSplits(raw)[sizeId]?.offset ?? 0 : 0;
}
export function toggleFormatSplit(raw: unknown, sizeId: string): FormatSplits {
  const current = readFormatSplits(raw);
  if (!validId(sizeId)) return current;
  if (current[sizeId]) {
    const remaining = { ...current };
    delete remaining[sizeId];
    return remaining;
  }
  if (Object.keys(current).length >= MAX_SAVED_SPLITS) return current;
  return { ...current, [sizeId]: { enabled: true, offset: 0 } };
}
export function setFormatSplitOffset(raw: unknown, sizeId: string, offset: number): FormatSplits {
  const current = readFormatSplits(raw);
  if (!validId(sizeId) || !current[sizeId] || !Number.isFinite(offset)) return current;
  return { ...current, [sizeId]: { ...current[sizeId], enabled: true, offset: Math.max(-25, Math.min(25, offset)) } };
}
