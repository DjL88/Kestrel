/**
 * Only transient, observed work states: the provider still makes its keeper
 * recommendations globally after duplicate detection, model fallback and the
 * shoot-wide keeper limit. None of these stages are persisted as cull scores.
 */
export type CullScanStage = 'queued' | 'analysing' | 'analysed' | 'unavailable';

export interface CullScanProgress {
  projectId: string;
  runId: number;
  stages: Readonly<Record<string, CullScanStage>>;
}

export function beginCullScan(projectId: string, runId: number, frameIds: readonly string[]): CullScanProgress {
  const stages: Record<string, CullScanStage> = Object.create(null);
  for (const id of frameIds) {
    if (id) stages[id] = 'queued';
  }
  return { projectId, runId, stages };
}

/** Ignore stale callbacks, unknown identities and stage reversals. */
export function advanceCullScan(
  current: CullScanProgress | null,
  projectId: string,
  runId: number,
  frameId: string,
  next: CullScanStage,
): CullScanProgress | null {
  if (!current || current.projectId !== projectId || current.runId !== runId ||
      !Object.prototype.hasOwnProperty.call(current.stages, frameId)) return current;
  const previous = current.stages[frameId];
  const allowed = (previous === 'queued' && next === 'analysing') ||
    (previous === 'analysing' && (next === 'analysed' || next === 'unavailable'));
  if (!allowed) return current;
  return { ...current, stages: { ...current.stages, [frameId]: next } };
}

/** Stop/completion clears only the original run, not a newer restart. */
export function endCullScan(current: CullScanProgress | null, projectId: string, runId: number): CullScanProgress | null {
  return current?.projectId === projectId && current.runId === runId ? null : current;
}
