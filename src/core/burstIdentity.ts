import { linkedPathIdentity } from './originalSourceKey';

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


/**
 * Capture time and camera model alone are not enough to identify a burst:
 * importing two different folders can interleave the same camera's photographs.
 * Prefer the original linked folder; never rely on the displayed filename.
 *
 * Legacy browser file imports do not expose a stable folder path. When BOTH
 * sources lack a folder identity, preserve the historical camera/time fallback.
 * When only one source has a verifiable folder, abstain from grouping.
 */
export interface BurstSourceLocation {
  stableKey: string;
  sourcePath?: string;
  sourceKind?: string;
}

function folderFromIdentity(identity: string): string | null {
  const slash = identity.lastIndexOf('/');
  return slash > 0 ? identity.slice(0, slash) : null;
}

function captureFolder(frame: BurstSourceLocation): string | null {
  if (frame.sourcePath?.trim()) {
    const path = linkedPathIdentity(frame.sourcePath);
    return path ? folderFromIdentity(path) : null;
  }
  const key = frame.stableKey;
  if (key?.startsWith('local-linked://')) {
    const encoded = key.slice('local-linked://'.length).split('::')[0];
    try {
      const path = decodeURIComponent(encoded);
      // originalSourceKey() writes an already-normalised win:/posix: identity.
      if (!/^(?:win:|posix:)/.test(path)) return null;
      return folderFromIdentity(path);
    } catch { return null; }
  }
  if (frame.sourceKind === 'demo' && key?.startsWith('demo://')) {
    return folderFromIdentity(key);
  }
  return null;
}

/**
 * Never merge frames from known different source folders, including when a
 * directory was relinked. This is a conservative grouping gate, NOT proof
 * that neighbouring frames contain the same animal or scene.
 */
export function sameCaptureSourceFolder(
  candidate: BurstSourceLocation,
  others: readonly BurstSourceLocation[],
): boolean {
  if (!others.length) return false;
  const folder = captureFolder(candidate);
  return others.every((other) => {
    if (candidate.sourceKind && other.sourceKind && candidate.sourceKind !== other.sourceKind) return false;
    const otherFolder = captureFolder(other);
    if (folder === null && otherFolder === null) return true;
    return folder !== null && otherFolder !== null && folder === otherFolder;
  });
}
