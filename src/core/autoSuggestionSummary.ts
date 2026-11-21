import type { PhotoEdit } from './photoEdits';

const PRIORITY = [
  'exposure', 'highlights', 'shadows', 'warmth', 'vibrance',
  'contrast', 'brightness', 'colour', 'whites', 'blacks',
  'denoise', 'texture', 'clarity', 'sharpen',
] as const satisfies readonly (keyof PhotoEdit)[];

export type AutoAdjustmentKey = typeof PRIORITY[number];
export type AutoChange = { key: AutoAdjustmentKey; direction: 'up' | 'down' } | { key: 'subjectMask' };

/**
 * Explain what the final, quality-gated recipe ACTUALLY changes, rather than
 * displaying Natural Auto's earlier hypothetical analysis (which can describe
 * adjustments the safety gate later declines). This is language-neutral:
 * translation happens in the editor, not in the sensor/ML pipeline.
 */
export function acceptedAutoChanges(before: PhotoEdit, after: PhotoEdit, addedSubjectMask = false): AutoChange[] {
  const changes: AutoChange[] = [];
  for (const key of PRIORITY) {
    const oldValue = Number(before[key] ?? 0);
    const newValue = Number(after[key] ?? 0);
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue) ||
        Math.abs(newValue - oldValue) <= 1e-6) continue;
    changes.push({ key, direction: newValue > oldValue ? 'up' : 'down' });
  }
  if (addedSubjectMask) changes.push({ key: 'subjectMask' });
  return changes;
}
