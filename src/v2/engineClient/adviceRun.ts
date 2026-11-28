import type { OnImageAdvice, SubjectBox } from '../../core/onImageAdvice';

/**
 * One run of the on-image advice for the photo on screen (the engine starts one each time the photo, its edit, its
 * framing or its preview changes, and stops the old one). Kept apart from the React hook so the order of events can be
 * tested:
 *   1. the old advice is cleared at once, so the layer never describes an edit that is no longer on the photo;
 *   2. nothing is measured until the edit has settled (a short pause, and never while a slider is held);
 *   3. the clipping is measured and published first, with the colour "not judged", because it needs no subject;
 *   4. the subject is looked for next (the slow, machine-learning step) and the advice is published again with the
 *      colour check. A search that finds nothing, or fails, is remembered for the session so a settle does not repeat it.
 * Read-only: nothing here touches a photo.
 */

export interface AdviceRunDeps<Picture> {
  photoId: string;
  /** The picture's address now; empty while the preview is not ready (the run then ends, and starts again when it is). */
  getUrl: () => Promise<string | null | undefined>;
  loadPicture: (url: string) => Promise<Picture>;
  /** Where the main subject is, or null for none. May be slow; may reject. */
  findSubject: (url: string) => Promise<SubjectBox | null>;
  measure: (picture: Picture, subject: SubjectBox | null) => OnImageAdvice | null;
  publish: (advice: OnImageAdvice | null) => void;
  gestureActive: () => boolean;
  onGestureEnd: (listener: () => void) => () => void;
  /** Injected so a test needs no real clock. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const ADVICE_SETTLE_MS = 320;

/** Subject searches that found nothing or failed, by photo and picture, for this session. Bounded. */
const noSubject = new Set<string>();
const NO_SUBJECT_LIMIT = 500;
export const forgetNoSubject = () => noSubject.clear();

/** Starts a run; the returned function stops it (nothing more is published after that). */
export function startAdviceRun<Picture>(deps: AdviceRunDeps<Picture>): () => void {
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let live = true;
  let stopWaiting: (() => void) | undefined;
  deps.publish(null);

  const run = () => {
    if (!live) return;
    if (deps.gestureActive()) {
      stopWaiting = deps.onGestureEnd(() => { stopWaiting?.(); stopWaiting = undefined; run(); });
      return;
    }
    void (async () => {
      const url = await deps.getUrl();
      if (!url || !live) return;
      const picture = await deps.loadPicture(url);
      if (!live) return;
      const first = deps.measure(picture, null);
      if (first && live) deps.publish(first);
      const key = `${deps.photoId}|${url}`;
      if (noSubject.has(key)) return;
      const subject = await deps.findSubject(url).catch(() => null);
      if (!live) return;
      if (!subject) {
        if (noSubject.size >= NO_SUBJECT_LIMIT) noSubject.clear();
        noSubject.add(key);
        return;
      }
      const second = deps.measure(picture, subject);
      if (second && live) deps.publish(second);
    })().catch(() => { /* no advice: the layer shows nothing rather than a guess */ });
  };
  const timer = setTimer(run, ADVICE_SETTLE_MS);
  return () => { live = false; clearTimer(timer); stopWaiting?.(); stopWaiting = undefined; };
}
