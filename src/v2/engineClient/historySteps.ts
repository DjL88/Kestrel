import type { EditHistory, EditKind } from '../../core/editHistory';

export interface HistoryStepInfo { label: string; at: number }
export interface HistoryInfo { steps: HistoryStepInfo[]; cursor: number }

const LABEL: Record<EditKind, string> = {
  light: 'Brightness', warmth: 'Warmth', colour: 'Colour', adjustments: 'Several adjustments', tone: 'Tone', detail: 'Detail and noise',
  mask: 'Mask', crop: 'Crop', rotation: 'Rotate', straighten: 'Straighten',
};

/** Plain words for each recorded step, in the order they were made. Nothing is invented: only what the history recorded. */
export function describeHistory(history: EditHistory | undefined): HistoryInfo | undefined {
  if (!history || !history.steps.length) return undefined;
  return { steps: history.steps.map((step) => ({ label: LABEL[step.kind] ?? 'Edit', at: step.at })), cursor: history.cursor };
}
