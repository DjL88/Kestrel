/**
 * Conservative burst membership policy. A camera identity must be known on
 * both frames before timestamps alone can group them: two devices can capture
 * at the same instant, and a missing camera tag cannot establish identity.
 *
 * This is metadata-only and does not touch photographs or edits.
 */
export function sameCaptureCamera(
  candidateCamera: string | undefined,
  existingCameras: readonly (string | undefined)[],
): boolean {
  const camera = candidateCamera?.trim();
  if (!camera || existingCameras.length === 0) return false;
  return existingCameras.every((value) => value?.trim() === camera);
}

/** Bad time-window settings must never group unrelated photos together. */
export function safeBurstGapMs(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 60_000) return 0;
  return value;
}
