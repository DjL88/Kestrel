import type { Photo, WorkspaceStore } from '../contract';

type AutoStatus = NonNullable<WorkspaceStore['autoStatus']>;

/** How long "Looked good, left alone" stays on the canvas. */
export const LEFT_ALONE_MS = 8000;

export type AutoBannerModel =
  | { kind: 'applied'; at: number; /** Who made it: Co-pilot or Auto-pilot, or Auto for a press of the button / an older step. */ who: 'copilot' | 'autopilot' | 'auto';
      /** Each slider Auto moved, as "Exposure +0.30 EV". Empty when only a mask or detail it cannot name was added. */ changes: string[]; why: string[] }
  | { kind: 'left-alone'; text: string }
  | null;

const ZERO = /^[+-]?0+(\.0+)?( EV)?$/;

/**
 * What the canvas banner says, from the photo's own edit history (so it is always true: it follows Undo and Redo) and what
 * Auto last did for it. "Applied" is shown while the newest step in force was made by Auto and the person has not dismissed it.
 * "Left alone" is shown briefly after an automatic check that changed nothing, and never over an applied banner.
 */
export function autoBannerModel(
  photo: Pick<Photo, 'id' | 'editHistory'> | null | undefined,
  status: AutoStatus | undefined,
  now: number,
  dismissed: ReadonlySet<string> = new Set(),
): AutoBannerModel {
  if (!photo) return null;
  const history = photo.editHistory;
  const step = history && history.cursor > 0 ? history.steps[history.cursor - 1] : undefined;
  if (step?.by === 'auto') {
    if (dismissed.has(`${photo.id}:${step.at}`)) return null;
    const mine = status?.photoId === photo.id && status.state === 'applied' && status.appliedAt === step.at ? status : undefined;
    return {
      kind: 'applied', at: step.at, who: mine?.mode ?? 'auto',
      changes: (step.changes ?? []).map((change) => ZERO.test(change.from) ? `${change.label} ${change.to}` : `${change.label} ${change.from} → ${change.to}`),
      why: step.why ?? [],
    };
  }
  if (status && status.photoId === photo.id && status.state === 'unchanged' && status.mode && typeof status.at === 'number'
      && now - status.at < LEFT_ALONE_MS && status.text) {
    return { kind: 'left-alone', text: status.text };
  }
  return null;
}
