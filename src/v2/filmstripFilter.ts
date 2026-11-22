import type { CullDecision, PhotoFrame } from '../core/types';

/**
 * Pure filmstrip logic for the V2 workspace (docs/V2-WORKSPACE.md section 2):
 * "Flag or unflag replaces the Keep, Review and Reject buckets. The filmstrip filter is All or Flagged...
 * Data: ... No data migration: flagged = keep, unflagged = unreviewed."
 *
 * This slice implements All/Flagged only. The doc's "Set aside" entry for existing rejects and camera
 * metadata-rejects is NOT built yet in this slice (it needs its own filter UI); an old reject currently
 * appears, unflagged, under "All" like any other unreviewed photo, until that entry is added.
 */

export type FilmstripFilter = 'all' | 'flagged';

/** flagged = keep. Reject and unreviewed both read as "not flagged" here (see module note on "Set aside"). */
export function isFlagged(decision: CullDecision): boolean {
  return decision === 'keep';
}

/** Flag sets keep; unflag sets unreviewed. Never writes 'reject' — that bucket is retired in this UI. */
export function nextFlagToggle(current: CullDecision): CullDecision {
  return current === 'keep' ? 'unreviewed' : 'keep';
}

/** Frames the filmstrip shows: never a removed photo, and only flagged ones when the filter says so. */
export function visibleFrames(frames: readonly PhotoFrame[], filter: FilmstripFilter): PhotoFrame[] {
  return frames.filter((frame) => {
    if (frame.removedAt !== undefined) return false;
    if (filter === 'flagged') return isFlagged(frame.decision);
    return true;
  });
}

export type FilmstripReadiness = 'importing' | 'analysing' | 'ready';

/**
 * Per-thumbnail state (section 2: "Importing, Analysing, Ready to edit"). This slice has no real async
 * import/analysis pipeline wired into the V2 shell yet (it still loads a demo shoot) — every frame with
 * real pixels on disk is simply "ready". Honest placeholder until the real import task feed is connected
 * (docs/V2-WORKSPACE.md build order step 1/2); not a claim that import or analysis progress is shown yet.
 */
export function filmstripReadiness(frame: PhotoFrame): FilmstripReadiness {
  return frame.sourcePath || frame.isDemo ? 'ready' : 'importing';
}
