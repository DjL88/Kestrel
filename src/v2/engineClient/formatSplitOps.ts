/** Selected-format only split layout; never apply to all copies of a photo. */
export interface FormatSplit { enabled: boolean; offset: number }
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
    result[id] = { enabled: true, offset };
    if (Object.keys(result).length >= 30) break;
  }
  return result;
}
export function isFormatSplit(raw: unknown, sizeId: string): boolean {
  return readFormatSplits(raw)[sizeId]?.enabled === true;
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
  return { ...current, [sizeId]: { enabled: true, offset: Math.max(-25, Math.min(25, offset)) } };
}
