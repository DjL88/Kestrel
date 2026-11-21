import { Sha256Stream } from '../core/sha256';
import { subjectPixelBounds } from '../core/subjectPixelCrop';
import { findVerifiedSubjectCandidates } from '../core/verifiedSubjectScan';
import type { SubjectGenre } from '../core/subjectDetailBurst';
import { detectorModelVersion, findSubjects, resetDetectorFailure } from './objectDetector';

const MAX_ORIGINAL_BYTES = 128 * 1024 * 1024;
const MAX_DECODED_PIXELS = 60_000_000;
const MAX_CROP_BYTES = 24 * 1024 * 1024;

export interface SubjectReviewItem {
  genre: SubjectGenre;
  crop?: HTMLCanvasElement;
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
    return candidates.map(({ evidence }) => {
      const item: SubjectReviewItem = { genre: evidence.genre };
      const box = evidence.subjectBox && subjectPixelBounds(width, height, evidence.subjectBox);
      if (!box || box.width * box.height * 4 > remaining || Math.max(box.width, box.height) > 4096)
        return item;
      const crop = document.createElement('canvas');
      crop.width = box.width;
      crop.height = box.height;
      const context = crop.getContext('2d');
      if (!context) return item;
      context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      remaining -= box.width * box.height * 4;
      return { ...item, crop };
    });
  } finally {
    bitmap.close();
  }
}
