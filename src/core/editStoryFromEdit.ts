import { makeEditStory, type EditStory, type StoryFormat, type StoryStepKind } from './editStories';
import { isNeutralGlobal, type PhotoEdit } from './photoEdits';
import type { Mask } from './maskTypes';

type StepInput = { kind: StoryStepKind; title: string; details?: string };
const LABELS: Record<Mask['kind'], { kind: StoryStepKind; title: string }> = {
  subject: { kind: 'subject-mask', title: 'Subject selection' },
  linear: { kind: 'linear-mask', title: 'Linear gradient' },
  radial: { kind: 'radial-mask', title: 'Radial gradient' },
  brush: { kind: 'adjustments', title: 'Brush adjustment' },
};
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const activeMask = (mask: Mask): boolean => Object.values(mask.edit).some((value) => numeric(value) && value !== 0);

/**
 * A storyboard based on the CURRENT saved edit, not a claim to reconstruct
 * historical slider actions. Does not expose filenames, EXIF or RAW paths.
 */
export function storyFromCurrentEdit(edit: PhotoEdit, format: StoryFormat = 'portrait'): EditStory {
  const steps: StepInput[] = [{ kind: 'original', title: 'Original photograph' }];
  if (!isNeutralGlobal(edit)) {
    steps.push({ kind: 'adjustments', title: 'Whole-photo adjustments' });
  }
  for (const mask of edit.masks ?? []) {
    if (!activeMask(mask)) continue;
    const label = LABELS[mask.kind];
    steps.push({ kind: label.kind, title: label.title });
  }
  steps.push({ kind: 'final', title: 'Final photograph' });
  // A corrupt or unusually complex edit should not silently drop any masks.
  // Ask the user to simplify the story instead of misrepresenting the edit.
  return makeEditStory(steps, format);
}
