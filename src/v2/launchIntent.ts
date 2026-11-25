/**
 * The bridge from the launch welcome (which lives in the splash layer, outside the V2 React tree) into V2.
 * The welcome calls requestLaunch; the workspace takes the intent once and resolves it against the projects it has
 * loaded. A single pending intent is held at module level, so it survives whichever side is ready first.
 */
export type LaunchIntent = { kind: 'project'; id: string } | { kind: 'projects' };

let pending: LaunchIntent | null = null;
const listeners = new Set<() => void>();

export function requestLaunch(intent: LaunchIntent): void {
  pending = intent;
  for (const fn of [...listeners]) fn();
}

/** Returns the pending intent and clears it, so one choice can never open a project twice. */
export function takeLaunchIntent(): LaunchIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}

/** Calls `fn` whenever an intent is requested. Returns the function that stops listening. */
export function onLaunchIntent(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Pure: what to do with an intent given the projects that are actually here. A missing project is never guessed at. */
export function resolveLaunchIntent(
  intent: LaunchIntent,
  projectIds: readonly string[],
): { open: string | null; notice: 'missing-project' | null } {
  if (intent.kind === 'projects') return { open: null, notice: null };
  return projectIds.includes(intent.id)
    ? { open: intent.id, notice: null }
    : { open: null, notice: 'missing-project' };
}
