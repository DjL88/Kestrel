import { recipeAt } from './editHistory';
import type { PhotoFrame } from './types';
import type { PhotoEdit } from './photoEdits';

export type ComparisonStage = 'original' | 'previous' | 'last-export' | `step:${number}`;
export interface ComparisonSnapshot { edit?: PhotoEdit; label: string }

/** Compare a recorded edit against now; never mutate the cursor or its redo stack. */
export function beforeSnapshot(frame: PhotoFrame, stage: ComparisonStage): ComparisonSnapshot {
  if (stage === 'last-export') {
    if (frame.lastExport) return { edit: frame.lastExport.edit, label: 'Last export' };
    return { label: 'Original' };
  }
  const history = frame.editHistory;
  if (stage === 'previous') {
    if (!history?.cursor) return { label: 'Original' };
    const step = Math.max(0, history.cursor - 1);
    return { edit: recipeAt(history, step)?.edit, label: step ? `Edit ${step}` : 'Original' };
  }
  if (stage.startsWith('step:')) {
    const step = Number(stage.slice(5));
    if (!history || !Number.isInteger(step) || step < 0 || step > history.steps.length) return { label: 'Original' };
    return { edit: recipeAt(history, step)?.edit, label: step ? `Edit ${step}` : 'Original' };
  }
  return { label: 'Original' };
}

/** Store the exact edit at the moment the user starts a file download. */
export function markExportRequested(frame: PhotoFrame, at: number): PhotoFrame {
  return { ...frame, lastExport: {
    at, edit: frame.edit ? structuredClone(frame.edit) : undefined,
    framing: frame.framing ? structuredClone(frame.framing) : undefined,
  } };
}
