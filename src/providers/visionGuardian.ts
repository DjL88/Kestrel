import { GUARDIAN_QUESTIONS, guardianQuestionText, readGuardianAnswer, type GuardianOpinion, type GuardianQuestion } from '../core/visionGuardian';
import { describePhoto, hasLocalVision, localVisionStatus } from './localVision';

/**
 * Ask the on-device vision model (desktop app, SmolVLM2, no network) one guardian question about a rendered JPEG data URL.
 * Null when the model is not installed or did not answer: no opinion, so nothing changes (it never upgrades a result).
 */
export async function askOnDeviceGuardian(jpegDataUrl: string, question: GuardianQuestion): Promise<GuardianOpinion | null> {
  if (!jpegDataUrl.startsWith('data:image/jpeg;base64,')) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(jpegDataUrl.slice(jpegDataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0)); } catch { return null; }
  return askGuardianAbout(new Blob([bytes], { type: 'image/jpeg' }), question, undefined, question === 'editNatural' ? GUARDIAN_QUESTIONS.editNatural : undefined);
}

/**
 * One guardian check about a claim (subject found, mask complete, species plausible), in the exact words the benchmark
 * measures (`guardianQuestionText`). For the mask checks, `jpeg` is the picture with the outside of the mask darkened.
 */
export async function askGuardianAbout(jpeg: Blob, check: GuardianQuestion, claim?: string, fixedText?: string): Promise<GuardianOpinion | null> {
  const text = fixedText ?? guardianQuestionText(check, claim);
  if (!text || !hasLocalVision()) return null;
  try {
    if (!(await localVisionStatus())?.installed) return null;
    const answer = await describePhoto(jpeg, text);
    return { source: 'on-device', verdict: answer.usable ? readGuardianAnswer(answer.text) : 'unsure', question: check };
  } catch {
    return null;
  }
}

/** A canvas as a JPEG for the on-device model, or null. */
export const canvasJpeg = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
