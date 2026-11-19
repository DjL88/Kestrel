/** A jump uses the number a photographer sees, starting at 1, never an internal ID.
 * Invalid or stale entries never silently select a different photograph.
 */
export function photoIndexFromNumber(raw: string, total: number): number | null {
  if (!Number.isSafeInteger(total) || total < 1) return null;
  const trimmed = raw.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
  const numbered = Number(trimmed);
  if (!Number.isSafeInteger(numbered) || numbered > total) return null;
  return numbered - 1;
}

/** The same label in Review and Edit, including when no photo is selected. */
export function photoPositionLabel(index: number, total: number): string {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isInteger(index) || index < 0 || index >= total) {
    return total > 0 ? `— of ${total}` : 'No photos';
  }
  return `${index + 1} of ${total}`;
}
