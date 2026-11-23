import { MAX_EDIT_HISTORY_STEPS, type EditHistory, type EditKind } from '../../core/editHistory';

export interface HistoryStepInfo { label: string; at: number }
export interface HistoryInfo { steps: HistoryStepInfo[]; cursor: number; /** False if the import baseline was already compacted away. */ originalAvailable: boolean }

const LABEL: Record<EditKind, string> = {
  light: 'Brightness', warmth: 'Warmth', colour: 'Colour', adjustments: 'Several adjustments', tone: 'Tone', detail: 'Detail and noise',
  mask: 'Mask', crop: 'Crop', rotation: 'Rotate', straighten: 'Straighten',
};

/** Plain words for each recorded step, in the order they were made. Nothing is invented: only what the history recorded. */
export function describeHistory(history: EditHistory | undefined): HistoryInfo | undefined {
  if (!history || !history.steps.length) return undefined;
  return {
    steps: history.steps.map((step) => ({ label: LABEL[step.kind] ?? 'Edit', at: step.at })),
    cursor: history.cursor,
    // Old 60-step catalogues have no counter: assume truncated when full.
    originalAvailable: history.discarded === 0 ||
      (history.discarded === undefined && history.steps.length < MAX_EDIT_HISTORY_STEPS),
  };
}
