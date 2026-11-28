import type { PhotoEdit } from './photoEdits';
import type { PhotoFrame } from './types';
import { isCullOriginal } from './autoCull';
import { prioritizePhotoProcessing } from './photoProcessingOrder';

/**
 * What each Flight mode does with a photo, in the owner's words (27 Nov 2026):
 * - Auto-pilot just does it and says why: every edit Auto found that passed its quality gate is applied, as one undo step.
 * - Co-pilot does some of it and leaves the edit decisions to the person: only the small, safe subset below is applied
 *   (as one undo step); everything else stays a suggestion that needs a click.
 * - Solo is the person's own work: InFlight never changes the photo. It gives advice when asked.
 */
export type FlightMode = 'solo' | 'copilot' | 'autopilot';

export interface FlightPolicy {
  /** Whether InFlight looks at the open photo by itself (Solo only looks when the person asks). */
  looksByItself: boolean;
  /** What may be applied without a click: the whole checked edit, only the safe subset, or nothing. */
  applies: 'all' | 'safe' | 'none';
}

export function flightPolicy(mode: FlightMode): FlightPolicy {
  if (mode === 'autopilot') return { looksByItself: true, applies: 'all' };
  if (mode === 'copilot') return { looksByItself: true, applies: 'safe' };
  return { looksByItself: false, applies: 'none' };
}

/** Co-pilot changes exposure by at most this many EV by itself. Anything bigger is a suggestion. */
export const COPILOT_MAX_EXPOSURE_EV = 0.3;
/** Co-pilot straightens by at most this many degrees by itself. Anything bigger is a suggestion. */
export const COPILOT_MAX_STRAIGHTEN_DEGREES = 2;
/** The engine's exposure unit: 1 step is 0.4 EV (src/core/naturalAuto.ts). */
const EV_PER_STEP = 0.4;

/** A tolerance for floating-point sums, far below anything a person could see or a slider could set. */
const EPSILON = 1e-6;

export interface SafeSubset {
  /** The photo's recipe with only the safe changes made. Never touches colour, warmth, tint or masks. */
  edit: PhotoEdit;
  /** Which safe kinds of change were applied, for the banner and for tests. */
  kinds: ('exposure' | 'straighten')[];
  /** The straighten angle to apply, in degrees, when the safe subset includes one. */
  straighten?: number;
}

/**
 * The part of Auto's proposal Co-pilot may apply by itself: an exposure change within +/-0.3 EV and a straighten within
 * 2 degrees, and nothing that touches colour, white balance or masks. A change over the limit is not clamped (that would
 * be a change nobody proposed): it is left whole as a suggestion. Returns null when nothing in the proposal is safe.
 * Only the exposure part is wired into the app today: nothing passes `straightenFrom`, so Co-pilot does not straighten by
 * itself yet and nothing may say it does. The straighten rule is kept (and tested) for when Auto proposes an angle.
 */
export function safeSubset(
  base: PhotoEdit,
  proposal: PhotoEdit,
  straightenFrom?: { current: number; proposed: number },
): SafeSubset | null {
  const kinds: SafeSubset['kinds'] = [];
  let edit = base;
  const stops = (Number(proposal.exposure ?? 0) - Number(base.exposure ?? 0)) * EV_PER_STEP;
  if (Number.isFinite(stops) && Math.abs(stops) > EPSILON && Math.abs(stops) <= COPILOT_MAX_EXPOSURE_EV + EPSILON) {
    edit = { ...edit, exposure: proposal.exposure };
    kinds.push('exposure');
  }
  let straighten: number | undefined;
  if (straightenFrom) {
    const turn = straightenFrom.proposed - straightenFrom.current;
    if (Number.isFinite(turn) && Math.abs(turn) > EPSILON && Math.abs(turn) <= COPILOT_MAX_STRAIGHTEN_DEGREES + EPSILON) {
      straighten = straightenFrom.proposed;
      kinds.push('straighten');
    }
  }
  if (!kinds.length) return null;
  return { edit, kinds, ...(straighten !== undefined ? { straighten } : {}) };
}

/**
 * The reasons Auto gave that belong to the safe change Co-pilot actually made. Auto's detail also explains changes
 * Co-pilot left as suggestions, so those sentences are never recorded as the reason for this step.
 */
export function reasonsForSafeChange(detail: readonly string[], kinds: SafeSubset['kinds']): string[] {
  const words = kinds.map((kind) => (kind === 'exposure' ? /\bexposure\b/i : /\b(straighten|level|horizon)/i));
  return detail.filter((line) => words.some((word) => word.test(line)));
}

export interface AutoBatchPlan {
  /** Photos to check, best first (rated, then picked, then the rest spread across the shoot). */
  todo: PhotoFrame[];
  /** Photos left alone because the file says another app already edited them. */
  editedElsewhere: number;
}

/**
 * The imported photos Auto-pilot may edit in the background, in order. Skipped, never touched: a photo that is removed, a
 * hidden RAW+JPEG partner, a rejected photo (a decision, kept as it is), one that already has an edit or edit history (the
 * person's or an earlier Auto's), and one the file says was edited in another app (that look is the photographer's).
 */
export function planAutoBatch(frames: readonly PhotoFrame[], importedIds: ReadonlySet<string>, hidden: (frame: PhotoFrame) => boolean = () => false): AutoBatchPlan {
  let editedElsewhere = 0;
  const candidates: PhotoFrame[] = [];
  for (const frame of frames) {
    if (!importedIds.has(frame.id) || !batchMayEdit(frame, hidden)) continue;
    if (frame.exif?.editStatus?.kind === 'edited-elsewhere') { editedElsewhere += 1; continue; }
    candidates.push(frame);
  }
  return { todo: prioritizePhotoProcessing(candidates), editedElsewhere };
}

/**
 * Whether the background batch may still edit this photo, as it is now. The plan uses it when it is made and the batch uses
 * it again, on the live photo, before each photo is checked and just before its edit is written, because the batch runs long
 * after the import: Auto-cull or the person may have rejected, edited or removed the photo in the meantime.
 * (The "edited in another app" rule is separate, because the plan counts those photos for its summary.)
 */
export function batchMayEdit(frame: PhotoFrame | undefined, hidden: (frame: PhotoFrame) => boolean = () => false): frame is PhotoFrame {
  if (!frame || frame.removedAt != null || !isCullOriginal(frame) || hidden(frame)) return false;
  if (frame.decision === 'reject' || frame.exif?.rejectedByMetadata) return false;
  return !frame.edit && !frame.editHistory?.steps.length;
}

/** Only Auto-pilot edits photos it was not asked about. Co-pilot and Solo never run the background batch. */
export function batchAllowedIn(mode: FlightMode): boolean {
  return mode === 'autopilot';
}
