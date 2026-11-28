import { AI_REVIEW_CONSENT_VERSION, AI_REVIEW_EDGE, aiReviewPrompt, type AiReview } from '../core/aiReview';
import type { PreviewFrame, SecondOpinion } from '../core/enhanceLoop';
import { askForReview, consentFor, type AiProviderSettings } from './aiProviders';

/**
 * (A) The enhance loop's optional second opinion from the PERSON'S OWN AI provider (their key and account, set up in the
 * existing AiProviderSetup). It reuses the existing provider code and consent (`askForReview`, `consentFor`); there is no second
 * path. Off unless a provider is set up and agreed to. It is handed downsized, metadata-free previews of renders that already
 * passed every gate, never originals. Only the issues it names are read; its slider suggestions are ignored here, so it can never
 * change a recipe. Any failure is silent. InFlight's own invited-tester AI (kind 'inflight', the owner's private Gemini/Vertex
 * access (B)) is NOT used by the loop.
 */
export type EncodePreview = (frame: PreviewFrame, longEdge: number) => Promise<string | null>;

/** 1,024 px JPEG as base64, drawn on a canvas so no EXIF, location or file name survives. */
export const canvasEncodePreview: EncodePreview = async (frame, longEdge) => {
  if (typeof document === 'undefined') return null;
  const full = document.createElement('canvas');
  full.width = frame.width; full.height = frame.height;
  const ctx = full.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
  const scale = Math.min(1, longEdge / Math.max(frame.width, frame.height));
  const out = document.createElement('canvas');
  out.width = Math.max(16, Math.round(frame.width * scale)); out.height = Math.max(16, Math.round(frame.height * scale));
  out.getContext('2d')?.drawImage(full, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85).split(',')[1] || null;
};

export function secondOpinionFromSettings(
  settings: AiProviderSettings | null, languageName = 'English', encode: EncodePreview = canvasEncodePreview,
  review: typeof askForReview = askForReview, signal?: AbortSignal,
): SecondOpinion | null {
  if (!settings || settings.kind === 'inflight') return null;
  if (settings.consent !== consentFor(AI_REVIEW_CONSENT_VERSION, settings)) return null;
  return {
    async ask(_before, candidates) {
      const answers: AiReview[] = [];
      for (const candidate of candidates) {
        const jpeg = await encode(candidate, AI_REVIEW_EDGE);
        if (!jpeg) return null;
        answers.push(await review(settings, AI_REVIEW_CONSENT_VERSION, aiReviewPrompt(languageName, []), jpeg, signal));
      }
      return { concerns: answers.map((a) => a.points.map((p) => p.issue)) };
    },
  };
}
