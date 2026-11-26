import { AI_REVIEW_CONSENT_VERSION, AI_REVIEW_EDGE, aiReviewPrompt, type AiReview } from '../../core/aiReview';
import { applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { applyFix } from '../../core/critique';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { conservativeReviewTargets } from '../../core/photoReviewStep';
import { isRawPreviewFile } from '../../core/rawFormats';
import type { RecipeProposal } from '../../core/recipeProposal';
import type { PhotoFrame } from '../../core/types';
import { aiReviewText as t } from '../../i18n/areas/aiReview';
import { AiReviewError, askForReview, consentFor, destinationHost, staysOnThisComputer, type AiProviderSettings } from '../../providers/aiProviders';
import { loadAnalysisPicture } from '../../providers/analysisPicture';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import type { AiSecondOpinionView } from '../ui/contract';

/**
 * A second opinion on colour and light from the person's own AI (their key, or a model on this computer such as
 * Ollama or LM Studio), for the V2 Assist panel. Off until they set a provider up in Settings and agree, by host name,
 * to where a small preview goes. The AI only describes and suggests; the suggestion is held to one small step from the
 * current recipe (`conservativeReviewTargets`) and applied only when the person presses Apply, as one undoable edit.
 */

/** What the workspace keeps for the photo that was asked about. */
export interface AiOpinionRecord {
  photoId: string;
  /** The recipe the AI looked at; Apply is refused if the photo has changed since. */
  base: PhotoEdit;
  stableKey: string;
  phase: 'asking' | 'ready' | 'failed' | 'applied';
  review?: AiReview;
  targets?: RecipeProposal;
  message?: string;
}

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2).replace(/0$/, '')}`;

/**
 * A 1,024-pixel JPEG of the photo as edited (global sliders and framing), base64, with no metadata: drawing it again
 * on a canvas drops location, camera details and the file name. A RAW uses its own develop, never the embedded JPEG.
 */
export async function previewForAi(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal): Promise<string | null> {
  const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
  const developed = raw ? await loadAnalysisPicture(frame, provider, signal).catch(() => null) : null;
  if (raw && !developed) return null;
  const url = raw ? null : await provider.getFullPreviewUrl(frame, 'selected');
  if (signal?.aborted || (!raw && !url)) return null;
  const source = developed ?? await loadImage(url!);
  if (signal?.aborted) return null;
  const canvas = document.createElement('canvas');
  const edge = Math.max(source.naturalWidth, source.naturalHeight) || 1;
  drawFramedPhoto(source, canvas, frame.framing ?? DEFAULT_FRAMING, { scale: Math.min(1, AI_REVIEW_EDGE / edge) });
  if (canvas.width < 16 || canvas.height < 16) return null;
  applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || null;
}

/** Ask the person's AI about one photo. Throws an AiReviewError the caller turns into words. */
export async function askAiSecondOpinion(
  frame: PhotoFrame, provider: BrowserPreviewProvider, settings: AiProviderSettings, languageName: string,
  localFindings: string[], signal?: AbortSignal,
): Promise<{ review: AiReview; targets: RecipeProposal }> {
  const jpeg = await previewForAi(frame, provider, signal);
  if (!jpeg) throw new AiReviewError('other');
  const review = await askForReview(settings, AI_REVIEW_CONSENT_VERSION, aiReviewPrompt(languageName, localFindings), jpeg, signal);
  return { review, targets: conservativeReviewTargets(frame.edit ?? DEFAULT_EDIT, review.suggestion) };
}

/** The checked targets as an edit: absolute slider positions turned into changes from the recipe the AI saw. */
export function applyTargets(edit: PhotoEdit, targets: RecipeProposal): PhotoEdit {
  const delta = Object.fromEntries(Object.entries(targets).map(([slider, value]) => [slider, (value as number) - (Number(edit[slider as keyof PhotoEdit]) || 0)]));
  return applyFix(edit, { kind: 'global', delta });
}

export function errorWords(error: unknown): string {
  return t.errors[error instanceof AiReviewError ? error.reason : 'other'];
}

/** The view the Assist panel shows: whether a provider is set up and agreed to, and the answer for this photo. */
export function aiOpinionView(settings: AiProviderSettings | null, record: AiOpinionRecord | null, activePhotoId: string | null): AiSecondOpinionView {
  if (!settings) return { setup: 'none' };
  const agreed = settings.consent === consentFor(AI_REVIEW_CONSENT_VERSION, settings);
  const local = staysOnThisComputer(settings);
  const host = destinationHost(settings);
  const base = { setup: agreed ? 'ready' : 'consent', destination: host, onThisComputer: local,
    consentText: local ? t.consentLocal(host) : t.consentCloud(host) } as const;
  if (!agreed || !record || record.photoId !== activePhotoId) return base;
  const review = record.review;
  return {
    ...base,
    photoId: record.photoId,
    phase: record.phase,
    message: record.phase === 'applied' ? t.applied : record.message,
    ...(review && record.phase === 'ready' ? {
      summary: review.summary,
      points: review.points.map((point) => ({ label: t.issue[point.issue], detail: point.detail })),
      changes: Object.entries(record.targets ?? {}).map(([slider, value]) => t.changeLine(t.slider[slider as keyof typeof t.slider] ?? slider, signed(value as number))),
    } : {}),
  };
}
