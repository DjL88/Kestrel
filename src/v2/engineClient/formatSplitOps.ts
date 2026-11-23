/** Selected-format only split layout; never apply to all copies of a photo. */
export interface FormatSplit { enabled: boolean; offset: number; /** Omitted means the existing two-frame split. */ count?: 3 }
export type FormatSplits = Record<string, FormatSplit>;
const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function readFormatSplits(raw: unknown): FormatSplits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: FormatSplits = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!validId(id) || !value || typeof value !== 'object') continue;
    const split = value as Record<string, unknown>;
    if (split.enabled !== true) continue;
    const offset = typeof split.offset === 'number' && Number.isFinite(split.offset)
      ? Math.max(-25, Math.min(25, split.offset)) : 0;
    // Two-frame projects retain their old serialised shape; only three frames need a count.
    result[id] = { enabled: true, offset, ...(split.count === 3 ? { count: 3 as const } : {}) };
    if (Object.keys(result).length >= 30) break;
  }
  return result;
}
export function isFormatSplit(raw: unknown, sizeId: string): boolean {
  return readFormatSplits(raw)[sizeId]?.enabled === true;
}
/** An unsplit format has one frame; legacy split metadata always means two. */
export function splitFrameCount(raw: unknown, sizeId: string): 1 | 2 | 3 {
  const split = readFormatSplits(raw)[sizeId];
  return !split ? 1 : split.count === 3 ? 3 : 2;
}
/** Set an existing split to two or three frames; count=1 rejoins it. */
export function setSplitFrameCount(raw: unknown, sizeId: string, count: 1 | 2 | 3): FormatSplits {
  const current = readFormatSplits(raw);
  if (!validId(sizeId) || ![1, 2, 3].includes(count)) return current;
  if (count === 1) {
    const next = { ...current };
    delete next[sizeId];
    return next;
  }
  return { ...current, [sizeId]: { enabled: true, offset: current[sizeId]?.offset ?? 0, ...(count === 3 ? { count: 3 as const } : {}) } };
}
export function formatSplitOffset(raw: unknown, sizeId: string): number {
  return readFormatSplits(raw)[sizeId]?.offset ?? 0;
}
export function toggleFormatSplit(raw: unknown, sizeId: string): FormatSplits {
  const current = readFormatSplits(raw);
  if (!validId(sizeId)) return current;
  if (current[sizeId]) {
    const remaining = { ...current };
    delete remaining[sizeId];
    return remaining;
  }
  return { ...current, [sizeId]: { enabled: true, offset: 0 } };
}
export function setFormatSplitOffset(raw: unknown, sizeId: string, offset: number): FormatSplits {
  const current = readFormatSplits(raw);
  if (!current[sizeId] || !Number.isFinite(offset)) return current;
  return { ...current, [sizeId]: { ...current[sizeId], enabled: true, offset: Math.max(-25, Math.min(25, offset)) } };
}
