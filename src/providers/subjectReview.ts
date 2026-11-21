import { Sha256Stream } from '../core/sha256';
import { subjectPixelBounds } from '../core/subjectPixelCrop';
import { findVerifiedSubjectCandidates } from '../core/verifiedSubjectScan';
import type { SubjectGenre, SelectEvidence } from '../core/subjectDetailBurst';
import { detectorModelVersion, findSubjects, resetDetectorFailure } from './objectDetector';

const MAX_ORIGINAL_BYTES = 128 * 1024 * 1024;
const MAX_DECODED_PIXELS = 60_000_000;
const MAX_CROP_BYTES = 24 * 1024 * 1024;

export interface SubjectReviewItem {
  genre: SubjectGenre;
  crop?: HTMLCanvasElement;
  /** Detector observation only, never a confirmed species or searchable tag. */
  evidence: SubjectReviewObservation;
}

/** Review-only source identity and subject ROI for W1 and optional W5 OCR.
 * A detector box is not proof of a bird, eye, ring or registration.
 */
export interface SubjectReviewObservation {
  photoId: string;
  sourceSha256: string;
  modelId: string;
  modelVersion: string;
  subjectBox: NonNullable<SelectEvidence['subjectBox']>;
  status: 'needs-review';
}

export function reviewOnlySubjectObservation(
  evidence: SelectEvidence,
  photoId: string,
  originalSha256: string,
): SubjectReviewObservation | null {
  const box = evidence.subjectBox;
  if (!box || evidence.photoId !== photoId ||
      evidence.sourceSha256.toLowerCase() !== originalSha256.toLowerCase() ||
      !/^[a-f0-9]{64}$/i.test(originalSha256) ||
      !evidence.modelId?.trim() || !evidence.modelVersion?.trim() ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0 || box.x < 0 || box.y < 0 ||
      box.x + box.width > 1.00000001 || box.y + box.height > 1.00000001) return null;
  return {
    photoId, sourceSha256: originalSha256.toLowerCase(),
    modelId: evidence.modelId, modelVersion: evidence.modelVersion,
    subjectBox: { ...box }, status: 'needs-review',
  };
}

export interface SubjectReviewSource {
  isCurrent: () => boolean;
  read: () => Promise<Blob | undefined>;
}

/** Read original bytes in bounded, cancellable chunks. */
async function hashPhoto(blob: Blob, signal: AbortSignal) {
  if (blob.size <= 0 || blob.size > MAX_ORIGINAL_BYTES) return null;
  const sha = new Sha256Stream();
  for (let from = 0; from < blob.size; from += 1024 * 1024) {
    signal.throwIfAborted();
    const end = Math.min(blob.size, from + 1024 * 1024);
    const bytes = new Uint8Array(await blob.slice(from, end).arrayBuffer());
    if (bytes.byteLength !== end - from) return null;
    sha.update(bytes);
  }
  signal.throwIfAborted();
  return sha.digest();
}

/** Revalidate a linked original after crop drawing, not merely after inference. */
export async function finalSubjectSourceMatches(
  original: Blob, originalSha: string, source: SubjectReviewSource, signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || !source.isCurrent()) return false;
  try {
    const latest = await source.read();
    if (!latest || signal.aborted || !source.isCurrent()) return false;
    const finalSha = latest === original ? originalSha : await hashPhoto(latest, signal);
    return !!finalSha && finalSha.toLowerCase() === originalSha.toLowerCase() &&
      !signal.aborted && source.isCurrent();
  } catch {
    return false;
  }
}

/** Inspect the current original with the local detector, using its actual pixels
 * and never the review preview. Null is unavailable, [] is a completed scan. */
export async function reviewPhotoSubjects(
  photoId: string, source: SubjectReviewSource, signal: AbortSignal,
): Promise<SubjectReviewItem[] | null> {
  const current = () => source.isCurrent() && !signal.aborted;
  if (!current()) return null;
  const original = await source.read();
  if (!original || !current()) return null;
  // Only accept JPEG and PNG bytes. In particular, a renamed RAW file must not
  // acquire an apparently verified crop from an embedded preview.
  const signature = new Uint8Array(await original.slice(0, 8).arrayBuffer());
  const jpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte);
  if (!jpeg && !png) return null;
  const sha = await hashPhoto(original, signal);
  if (!sha || !current()) return null;

  const bitmap = await createImageBitmap(original);
  try {
    const { width, height } = bitmap;
    if (!current() || width * height > MAX_DECODED_PIXELS) return null;
    resetDetectorFailure();
    const modelVersion = await detectorModelVersion();
    const candidates = await findVerifiedSubjectCandidates({
      source: bitmap,
      identity: { photoId, sourceSha256: sha, width, height, modelVersion },
      signal,
      detector: findSubjects,
      isCurrent: current,
      verifyDecodedSource: async (id, pixels) =>
        id === photoId && pixels === bitmap ? { sourceSha256: sha, width, height } : null,
      verifyOriginalSha256: async () => {
        const latest = await source.read();
        // Imported immutable Blobs can reuse their digest. A linked reader
        // returns a fresh File so same-size replacements still get hashed.
        return latest === original ? sha : latest ? hashPhoto(latest, signal) : null;
      },
    });
    if (!candidates || !current()) return null;
    let remaining = MAX_CROP_BYTES;
    const results: SubjectReviewItem[] = [];
    for (const { evidence } of candidates) {
      const observation = reviewOnlySubjectObservation(evidence, photoId, sha);
      // A malformed/mismatched box invalidates the entire multi-subject scan.
      if (!observation) return null;
      const item: SubjectReviewItem = { genre: evidence.genre, evidence: observation };
      const box = subjectPixelBounds(width, height, observation.subjectBox);
      if (!box || box.width * box.height * 4 > remaining || Math.max(box.width, box.height) > 4096) {
        results.push(item);
        continue;
      }
      const crop = document.createElement('canvas');
      crop.width = box.width;
      crop.height = box.height;
      const context = crop.getContext('2d');
      if (!context) {
        results.push(item);
        continue;
      }
      context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      remaining -= box.width * box.height * 4;
      results.push({ ...item, crop });
    }
    // Drawing every full-resolution crop can take time on a large shoot.
    // A linked original replaced during this work must never return stale
    // subject crops, even if it had passed the detector's earlier SHA checks.
    if (!await finalSubjectSourceMatches(original, sha, source, signal)) return null;
    return results;
  } finally {
    bitmap.close();
  }
}
