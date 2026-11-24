/** Move one queued task without changing the relative order of other jobs. */
export function moveQueuedTask(order: readonly number[], id: number, direction: -1 | 1): number[] {
  const result = [...order];
  const from = result.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= result.length) return result;
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}
