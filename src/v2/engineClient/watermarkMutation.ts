import type { StoredWatermark } from './watermarkLibrary';

/** An asynchronous edit may only replace the entry it actually read. Other marks are untouched. */
export function replaceWatermarkIfUnchanged(current: StoredWatermark[], before: StoredWatermark, after: StoredWatermark): StoredWatermark[] {
  const entry = current.find((item) => item.id === before.id);
  if (!entry || after.id !== before.id || entry.forDark !== before.forDark || entry.forLight !== before.forLight || entry.label !== before.label) return current;
  return current.map((item) => item.id === before.id ? after : item);
}
