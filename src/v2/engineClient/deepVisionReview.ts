import { findSubject } from '../../providers/objectDetector';
import { loadImage } from '../../providers/loadImage';
import { runSubjectDetectAction, type SubjectDetectActionResult } from '../../engine/subjectDetectAction';
import { suggestLookForPhoto } from '../../engine/lookSuggestions';
import type { Look } from '../../engine/looks';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { engineText } from '../../i18n/areas/engine';

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

/** The notice after a deep vision review, in the person's language. Each part is a whole sentence, so it translates cleanly. */
function describeDeepReview(detection: SubjectDetectActionResult, look: Look | null): string {
  const t = engineText.deepReview;
  if (!detection.finding) return t.none;
  const { trust, corroboration } = detection;
  const sharpness = (t.sharpness as Record<string, string>)[trust.reason] ?? t.sharpness.unavailable;
  const confidence = (t.confidence as Record<string, string>)[trust.confidence] ?? t.confidence.low;
  const witness = (name: string) => (t.witness as Record<string, string>)[name] ?? name;
  const parts = [trust.decision === 'keep' ? t.trusted(confidence, sharpness) : t.untrusted(sharpness)];
  if (corroboration.state === 'agreed') parts.push(t.agreed(witness(corroboration.subject)));
  else if (corroboration.state === 'conflict') parts.push(t.conflict(witness(corroboration.reading), witness(corroboration.detector)));
  if (look) parts.push(t.suggested(look.name, look.description));
  return parts.join(' ');
}

export async function runDeepVisionReview(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal): Promise<DeepVisionReviewResult | null> {
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted) return null;
  const source = await loadImage(url);
  if (signal?.aborted) return null;

  const detection = await runSubjectDetectAction({
    frameId: frame.id,
    detect: () => findSubject(source, signal),
    signal,
  });
  if (signal?.aborted) return null;

  // A conflicting scene reading makes a subject-specific Look unsafe to propose,
  // even when the box detector alone rated the subject highly.
  // A detector box is not a usable subject mask. Until a real mask is supplied
  // by the editing pipeline, a subject-local Look cannot be previewed honestly.
  const suggestedLook = suggestDeepReviewLook(detection, false);
  // The current engine supplies at most one defensible Look. Do not pad to three
  // with invented alternatives; a later ranked engine result can extend this list.
  const candidates = candidatesForSuggestedLook(suggestedLook);
  return { detection, suggestedLook, candidates, summary: describeDeepReview(detection, suggestedLook) };
}

/** A candidate is only a proposal. Never create filler Looks or mutate an edit here. */
export function candidatesForSuggestedLook(look: Look | null): DeepVisionCandidate[] {
  return look ? [{ id: look.id, look, label: look.name, description: look.description }] : [];
}

/** A disagreement is not permission to offer a subject-aware edit. */
export function suggestDeepReviewLook(detection: SubjectDetectActionResult, hasUsableSubjectMask = false): Look | null {
  // A detector box is not a pixel mask. Only explicit, usable mask evidence
  // permits a subject-local Look; uncertainty and scene disagreement still veto it.
  if (!hasUsableSubjectMask || detection.corroboration.state === 'conflict') return null;
  return suggestLookForPhoto(detection.trust, Boolean(detection.finding));
}

/** Exported for testing only - the rest of this file needs a browser (Image/canvas/Worker) and has no
 * node-runnable test, same status as `runAuto.ts`, which also has none. */
export { describeDeepReview as describeDeepReviewForTest };
