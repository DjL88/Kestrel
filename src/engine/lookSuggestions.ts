import type { CullSuggestion } from '../core/autoCull';
import { LIFT_SUBJECT_BLUR_BACKGROUND, type Look } from './looks';

/**
 * A first, deliberately narrow rule for the Decision Maker to PROPOSE a Look itself, rather than only
 * running one a person already picked (owner direction, 22 Nov 2026: Looks are "User sets but also our
 * intelligence could utilise").
 *
 * This does NOT detect a "busy background". No engine today measures background texture separately from
 * the subject - `autoCull.ts`'s whole-frame `detail` figure isn't carried on `CullSuggestion`, so there is
 * no real per-photo "background is busy" signal to read. This function does not pretend otherwise (CLAUDE.md:
 * unknown stays unknown). It proposes `LIFT_SUBJECT_BLUR_BACKGROUND` on the one thing that IS actually
 * measured: a real, sharp, reasonably-confident subject (`reason === 'subjectSharp'`, from
 * `scoreWithSubject`) with a subject mask available to apply the Look to. The bet is that separating a
 * confirmed-sharp subject from its surroundings is a reasonable suggestion regardless of how busy that
 * background actually turns out to be - not that the background has been checked and found busy.
 *
 * Returns the existing builtin Look, not a freshly composed one - this is a RECOMMENDATION of a known
 * preset for this photo, not the engine inventing a new Look. A later slice that measures background
 * texture directly, or composes a new Look from scratch, is real further work, not implied by this.
 */
export function suggestLookForPhoto(cull: CullSuggestion, hasSubjectMask: boolean): Look | null {
  if (!hasSubjectMask) return null; // nothing to apply a subject-aware Look's subject step to.
  if (cull.decision !== 'keep' || cull.reason !== 'subjectSharp' || cull.confidence !== 'high') return null;
  return LIFT_SUBJECT_BLUR_BACKGROUND;
}

/** Convenience for a whole shoot. Only frames a Look is actually suggested for are present in the result;
 * `hasSubjectMaskFor` lets the caller answer "does this frame have a usable subject mask" however it
 * currently knows that (a stored mask, a fresh detector result, etc.) without this module needing to care. */
export function suggestLooksForPhotos(
  suggestions: readonly CullSuggestion[],
  hasSubjectMaskFor: (frameId: string) => boolean,
): Map<string, Look> {
  const suggested = new Map<string, Look>();
  for (const cull of suggestions) {
    const look = suggestLookForPhoto(cull, hasSubjectMaskFor(cull.frameId));
    if (look) suggested.set(cull.frameId, look);
  }
  return suggested;
}
