import { GUARDIAN_QUESTIONS, readGuardianAnswer, type GuardianOpinion, type GuardianQuestion } from '../core/visionGuardian';
import { describePhoto, hasLocalVision, localVisionStatus } from './localVision';

/**
 * Ask the on-device vision model (desktop app, SmolVLM2, no network) one guardian question about a rendered JPEG data URL.
 * Null when the model is not installed or did not answer: no opinion, so nothing changes (it never upgrades a result).
 */
export async function askOnDeviceGuardian(jpegDataUrl: string, question: GuardianQuestion): Promise<GuardianOpinion | null> {
  if (!jpegDataUrl.startsWith('data:image/jpeg;base64,')) return null;
  const bytes = Uint8Array.from(atob(jpegDataUrl.slice(jpegDataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0));
  return askOnDeviceGuardianAbout(new Blob([bytes], { type: 'image/jpeg' }), question);
}

/** True when the on-device model can answer at all (desktop app with the pack installed). Asked once per pass. */
export async function onDeviceGuardianReady(): Promise<boolean> {
  if (!hasLocalVision()) return false;
  return (await localVisionStatus().catch(() => null))?.installed === true;
}

/** The same question about a picture already in hand (a JPEG or PNG preview). Null means no opinion. */
export async function askOnDeviceGuardianAbout(picture: Blob, question: GuardianQuestion): Promise<GuardianOpinion | null> {
  if (!(await onDeviceGuardianReady())) return null;
  try {
    const answer = await describePhoto(picture, GUARDIAN_QUESTIONS[question]);
    return { source: 'on-device', verdict: answer.usable ? readGuardianAnswer(answer.text) : 'unsure', question };
  } catch {
    return null;
  }
}
