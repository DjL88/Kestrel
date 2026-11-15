import type { PhotoFrame } from './types';
import type { PhotoEdit } from './photoEdits';
import type { PhotoFraming } from './photoFraming';

type Snapshot = { edit?: PhotoEdit; framing?: PhotoFraming };
export type EditKind = 'light' | 'warmth' | 'colour' | 'adjustments' | 'crop' | 'rotation' | 'straighten' | 'contrast' | 'highlights' | 'shadows';

export interface EditHistory {
  cursor: number;
  steps: { kind: EditKind; before: Snapshot; after: Snapshot; at: number }[];
}

function classify(before: Snapshot, after: Snapshot): EditKind {
  if (JSON.stringify(before.framing) !== JSON.stringify(after.framing)) {
    if ((before.framing?.turns ?? 0) !== (after.framing?.turns ?? 0)) return 'rotation';
    if ((before.framing?.straighten ?? 0) !== (after.framing?.straighten ?? 0)) return 'straighten';
    return 'crop';
  }
  const fields = (['exposure', 'warmth', 'colour', 'contrast', 'highlights', 'shadows'] as const).filter((field) =>
    (before.edit?.[field] ?? 0) !== (after.edit?.[field] ?? 0));
  if (fields.length !== 1) return 'adjustments';
  return fields[0] === 'exposure' ? 'light' : fields[0];
}

export function recordEdit(frame: PhotoFrame, patch: Snapshot, at: number): PhotoFrame {
  const before = { edit: frame.edit, framing: frame.framing };
  const after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return frame;
  const history = frame.editHistory;
  const steps = history ? history.steps.slice(0, history.cursor) : [];
  const kind = classify(before, after);
  const last = steps.at(-1);
  if (last && history?.cursor === history?.steps.length && last.kind === kind && at >= last.at && at - last.at < 550) {
    steps.pop();
    if (JSON.stringify(last.before) !== JSON.stringify(after)) steps.push({ kind, before: last.before, after, at });
  } else {
    steps.push({ kind, before, after, at });
  }
  const retained = steps.slice(-60);
  return { ...frame, ...after, editHistory: { steps: retained, cursor: retained.length } };
}

export function stepEdit(frame: PhotoFrame, direction: -1 | 1): PhotoFrame {
  const history = frame.editHistory;
  if (!history) return frame;
  const index = direction === -1 ? history.cursor - 1 : history.cursor;
  const step = history.steps[index];
  if (!step) return frame;
  return {
    ...frame, ...(direction === -1 ? step.before : step.after),
    editHistory: { ...history, cursor: history.cursor + direction },
  };
}
