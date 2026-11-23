import { findSubject } from '../../providers/objectDetector';
import { loadImage } from '../../providers/loadImage';
import { runSubjectDetectAction, type SubjectDetectActionResult } from '../../engine/subjectDetectAction';
import { suggestLookForPhoto } from '../../engine/lookSuggestions';
import type { Look } from '../../engine/looks';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';

/**
 * The first real caller of this session's Engine layer (`src/engine/subjectDetectAction.ts`,
 * `lookSuggestions.ts`) from the V2 frontend, wired to the already-shipped `runDeepVisionReview` action
 * (`contract.ts`). That action has had two real UI buttons since the Co-pilot/Assist panels were built
 * (`App.tsx`'s `onRunDeepVisionReview`/`onRefreshReview`) but has been a no-op the whole time - listed in
 * `NOT_CONNECTED` in `useEngineWorkspace.ts`.
 *
 * Deliberately narrow and deliberately NOT a duplicate of the existing Co-pilot Auto pass
 * (`runAuto.ts`): that one uses the guided segmentation detector (`providers/subjectDetector.ts`) for a
 * fast per-photo check. This one uses the YOLOX box detector (`objectDetector.ts`'s `findSubject`) -
 * a different, independently-shipped detector - run through this session's real trust gate
 * (`subjectDetectAction.ts`'s `judgeSubject`) and Look-recommendation rule (`lookSuggestions.ts`'s
 * `suggestLookForPhoto`). That is what makes it a genuinely DEEPER review rather than a second copy of
 * the quick one, and it is why this file exists instead of just calling `runAuto` again.
 *
 * NOT done here, honestly: the suggested Look is returned as data and summarised in plain English for
 * the notice banner (see `useEngineWorkspace.ts`) - it is not yet turned into an applyable
 * `AssistSuggestion`/`Partial<EditRecipe>` the person could accept with one click. That needs a
 * `contract.ts`/`frameToPhoto.ts` change, deliberately left out of this slice to avoid touching the
 * `assistCritique` surface while frontend work is active elsewhere. The masked, verified, retried render
 * itself (`looks.ts`'s `runLook`) is not invoked either - there is no real-photo-sized renderer plumbed
 * through to this bridge yet (`engineCanvasRenderer.ts` exists but is wired to nothing in `src/v2`).
 */

/** A proposal, not an edit or a preview render. A visual preview needs a real renderer. */
export interface DeepVisionCandidate {
  id: string;
  look: Look;
  label: string;
  description: string;
}

export interface DeepVisionReviewResult {
  detection: SubjectDetectActionResult;
  suggestedLook: Look | null;
  /** Engine-backed proposals only. Empty when the detector cannot justify a Look.
   * The UI must offer Preview and Apply separately; nothing here edits a photo. */
  candidates: DeepVisionCandidate[];
  /** Plain-English summary for the notice banner - the only thing surfaced in the UI today. */
  summary: string;
}

const REASON_WORD: Record<string, string> = {
  subjectSharp: 'sharp', subjectOk: 'reasonably sharp', subjectSoft: 'soft', noSubject: 'untrustworthy', unavailable: 'unavailable',
};

function describeDeepReview(detection: SubjectDetectActionResult, look: Look | null): string {
  if (!detection.finding) return 'Deep review: no subject the detector trusts was found in this photo.';
  const { trust, corroboration } = detection;
  const word = REASON_WORD[trust.reason] ?? trust.reason;
  const subjectPhrase = trust.decision === 'keep' ? `a ${trust.confidence}-confidence, ${word} subject` : `a subject too ${word} to trust`;
  const agreement = corroboration.state === 'agreed'
    ? `, confirmed as a ${corroboration.subject} by the scene reading`
    : corroboration.state === 'conflict'
      ? `, but the scene reading disagrees (called it a ${corroboration.reading} against the detector's ${corroboration.detector}) - treat this as unresolved`
      : '';
  const suggestion = look ? ` Suggested: "${look.name}" - ${look.description}` : '';
  return `Deep review: found ${subjectPhrase}${agreement}.${suggestion}`;
}

export async function runDeepVisionReview(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal): Promise<DeepVisionReviewResult | null> {
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted) return null;
  const source = await loadImage(url);
  if (signal?.aborted) return null;

  const detection = await runSubjectDetectAction({
    frameId: frame.id,
    detect: () => findSubject(source, signal),
  });
  if (signal?.aborted) return null;

  // A conflicting scene reading makes a subject-specific Look unsafe to propose,\n  // even when the box detector alone rated the subject highly.\n  const suggestedLook = suggestDeepReviewLook(detection);
  // The current engine supplies at most one defensible Look. Do not pad to three
  // with invented alternatives; a later ranked engine result can extend this list.
  const candidates: DeepVisionCandidate[] = suggestedLook
    ? [{ id: suggestedLook.id, look: suggestedLook, label: suggestedLook.name, description: suggestedLook.description }]
    : [];
  return { detection, suggestedLook, candidates, summary: describeDeepReview(detection, suggestedLook) };
}

/** A disagreement is not permission to offer a subject-aware edit. */
export function suggestDeepReviewLook(detection: SubjectDetectActionResult): Look | null {
  if (detection.corroboration.state === 'conflict') return null;
  return suggestLookForPhoto(detection.trust, Boolean(detection.finding));
}

/** Exported for testing only - the rest of this file needs a browser (Image/canvas/Worker) and has no
 * node-runnable test, same status as `runAuto.ts`, which also has none. */
export { describeDeepReview as describeDeepReviewForTest };
