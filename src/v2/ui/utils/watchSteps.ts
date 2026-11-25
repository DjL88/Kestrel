import { buildEditingSequence, STEP_ORDER, type StepGroup } from '../../../core/editingSequence';
import type { EditRecipe } from '../contract';

/**
 * Watch: play an Auto suggestion one step at a time. Pure helpers only; the player is `WatchSteps.tsx`.
 *
 * Steps come from the suggestion itself: the ordered steps Auto produced when it has them, or, for a suggestion that
 * only carries its recipe change, the same ordering built from the photo's current settings. Each step's preview is
 * the photo's current edit with the first n steps' target values on top, shown through the non-destructive Look
 * preview path: nothing is stored or applied until the person chooses Apply.
 */

export interface WatchStep {
  id: string;
  /** The recipe setting this step changes, e.g. "exposure". */
  key: string;
  /** Where it belongs in the usual working order, for the plain-words reason. */
  group: StepGroup;
  /** Whether the preview can show this step. A local adjustment (mask) shows only once applied. */
  previewable: boolean;
}

const groupOf = (key: string): StepGroup => STEP_ORDER.find((entry) => entry.key === key)?.group ?? 'other';

/**
 * The steps to watch, in working order. `steps` are Auto's own (each with its setting key); without them the steps are
 * built from the recipe change against the current settings, so any suggestion can be watched.
 */
export function watchStepsFor(
  recipeDelta: Partial<EditRecipe>,
  current: EditRecipe | undefined,
  steps?: readonly { id: string; key?: string }[],
): WatchStep[] {
  const keyed = steps?.filter((step): step is { id: string; key: string } => typeof step.key === 'string');
  if (keyed && keyed.length > 0) {
    return keyed.map((step) => ({ id: step.id, key: step.key, group: groupOf(step.key), previewable: step.key in recipeDelta }));
  }
  const before = (current ?? {}) as Record<string, unknown>;
  return buildEditingSequence(before, { ...before, ...recipeDelta }, ['lookId'])
    .map((step) => ({ id: step.id, key: step.key, group: step.group, previewable: step.key in recipeDelta }));
}

/** The recipe change to preview after the first `count` steps: only those steps' target values. */
export function previewAfterSteps(watch: readonly WatchStep[], recipeDelta: Partial<EditRecipe>, count: number): Partial<EditRecipe> {
  const shown: Record<string, unknown> = {};
  const delta = recipeDelta as Record<string, unknown>;
  for (const step of watch.slice(0, Math.max(0, Math.min(count, watch.length)))) {
    if (step.previewable) shown[step.key] = delta[step.key];
  }
  return shown as Partial<EditRecipe>;
}

/** A value as a person reads it: numbers as written, true and false as on and off, anything structured as "changed". */
export function readableValue(value: unknown, words: { on: string; off: string; changed: string }): string {
  if (typeof value === 'number') return String(Number(value.toFixed(2)));
  if (typeof value === 'boolean') return value ? words.on : words.off;
  if (value === undefined || value === null) return '0';
  return words.changed;
}
