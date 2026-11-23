/** Return the next focus stop when Tab would leave a modal drawer. */
export function drawerTabTarget(current: number, count: number, shift: boolean): number | null {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  if (!Number.isSafeInteger(current) || current < 0 || current >= count) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}
