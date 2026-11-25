import { GUARDIAN_QUESTIONS, readGuardianAnswer, type GuardianOpinion, type GuardianQuestion } from '../core/visionGuardian';
import { describePhoto, hasLocalVision, localVisionStatus } from './localVision';

/**
 * Ask the on-device vision model (desktop app, SmolVLM2, no network) one guardian question about a rendered JPEG data URL.
 * Null when the model is not installed or did not answer: no opinion, so nothing changes (it never upgrades a result).
 */
export async function askOnDeviceGuardian(jpegDataUrl: string, question: GuardianQuestion): Promise<GuardianOpinion | null> {
  if (!hasLocalVision() || !jpegDataUrl.startsWith('data:image/jpeg;base64,')) return null;
  const status = await localVisionStatus();
  if (!status?.installed) return null;
  try {
    const bytes = Uint8Array.from(atob(jpegDataUrl.slice(jpegDataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0));
    const answer = await describePhoto(new Blob([bytes], { type: 'image/jpeg' }), GUARDIAN_QUESTIONS[question]);
    return { source: 'on-device', verdict: answer.usable ? readGuardianAnswer(answer.text) : 'unsure', question };
  } catch {
    return null;
  }
}
