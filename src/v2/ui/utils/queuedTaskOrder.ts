/** Move one queued task without changing the relative order of other jobs. */
export function moveQueuedTask(order: readonly number[], id: number, direction: -1 | 1): number[] {
  const result = [...order];
  const from = result.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= result.length) return result;
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}

export interface OrderableTask {
  id: string;
  priority?: number;
}

/**
 * The Tasks list keeps each row in its place while it waits, runs, pauses and finishes.
 * The scheduler hands a batch back to the queue between photographs, so ordering by
 * status or progress makes rows jump on every photograph. Rows already shown keep their
 * order; rows no longer present drop out; new rows join at the end, highest priority first.
 */
export function stableTaskOrder(previous: readonly string[], tasks: readonly OrderableTask[]): string[] {
  const present = new Set(tasks.map(task => task.id));
  const kept = previous.filter(id => present.has(id));
  const known = new Set(kept);
  const added = tasks
    .filter(task => !known.has(task.id))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || Number(a.id) - Number(b.id))
    .map(task => task.id);
  return [...kept, ...added];
}

/**
 * Apply a new order for some rows (for example the queued ones after the person moves one)
 * by refilling only the places those rows already held. Every other row stays where it is.
 */
export function placeSubset(order: readonly string[], subset: readonly string[]): string[] {
  const members = new Set(subset);
  const held = order.filter(id => members.has(id));
  if (held.length !== subset.length) return [...order];
  let next = 0;
  return order.map(id => members.has(id) ? subset[next++] : id);
}
