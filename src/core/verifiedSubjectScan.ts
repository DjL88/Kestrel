import { findSubjects, type FoundSubject } from '../providers/objectDetector';
import { multiSubjectSelectEvidence, type MultiSubjectSource, type SubjectCandidate } from './multiSubjectEvidence';

/** Source identity is verified by the original-file reader, not by the detector,
 * thumbnail, EXIF, or an untrusted caller-supplied digest.
 */
export interface VerifiedSubjectScan {
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  identity: MultiSubjectSource;
  /** Trusted decoder attests these exact input pixels came from this original SHA. */
  verifyDecodedSource: (photoId: string, source: VerifiedSubjectScan['source'], signal?: AbortSignal) => Promise<{ sourceSha256: string; width: number; height: number } | null>;
  signal?: AbortSignal;
  /** Re-read the current original's SHA-256 from a trusted source service. */
  verifyOriginalSha256: (photoId: string, signal?: AbortSignal) => Promise<string | null>;
  /** True only while the same photo and source revision remain selected. */
  isCurrent: (photoId: string, sourceSha256: string) => boolean;
  /** Supplied for isolated tests; production always uses the local detector. */
  detector?: (source: VerifiedSubjectScan['source'], signal?: AbortSignal) => Promise<FoundSubject[]>;
}

const digest = /^[a-f0-9]{64}$/i;
const dimensions = (source: VerifiedSubjectScan['source']) => {
  const image = source as HTMLImageElement;
  return typeof image.naturalWidth === 'number'
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: source.width, height: source.height };
};
const sameDimensions = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  Number.isSafeInteger(a.width) && Number.isSafeInteger(a.height) &&
  a.width > 0 && a.height > 0 && a.width === b.width && a.height === b.height;

/** A single bounded, source-verified path from local YOLOX to manual Select
 * candidates. A photo switch, failed original verification or detector error
 * produces NO evidence; never fall back to a guessed bird, eye or species.
 * Nothing here changes cull flags or original files.
 */
export async function scanVerifiedSubjects(request: VerifiedSubjectScan): Promise<SubjectCandidate[]> {
  const { identity, signal, isCurrent, verifyOriginalSha256, verifyDecodedSource } = request;
  const current = () => !signal?.aborted && isCurrent(identity.photoId, identity.sourceSha256);
  if (!identity.photoId?.trim() || !digest.test(identity.sourceSha256) ||
      !identity.modelVersion?.trim() || !current() ||
      !sameDimensions(dimensions(request.source), identity)) return [];
  try {
    const verified = await verifyOriginalSha256(identity.photoId, signal);
    if (!current() || !verified || !digest.test(verified) ||
        verified.toLowerCase() !== identity.sourceSha256.toLowerCase()) return [];
    // A matching file hash alone does not establish that a thumbnail/canvas
    // contains that file's pixels. The decoder must attest the actual input.
    const decoded = await verifyDecodedSource(identity.photoId, request.source, signal);
    if (!current() || !decoded || !digest.test(decoded.sourceSha256) ||
        decoded.sourceSha256.toLowerCase() !== verified.toLowerCase() ||
        !sameDimensions(decoded, identity) ||
        !sameDimensions(dimensions(request.source), identity)) return [];
    const detections = await (request.detector ?? findSubjects)(request.source, signal);
    if (!current() || !sameDimensions(dimensions(request.source), identity) ||
        detections.length > 20) return [];
    // Recheck the original after potentially lengthy tiled inference. A file
    // replaced in place must not inherit the previous photo's subject boxes.
    const after = await verifyOriginalSha256(identity.photoId, signal);
    if (!current() || !after || after.toLowerCase() !== verified.toLowerCase() ||
        !sameDimensions(dimensions(request.source), identity)) return [];
    const decodedAfter = await verifyDecodedSource(identity.photoId, request.source, signal);
    if (!current() || !decodedAfter || !digest.test(decodedAfter.sourceSha256) ||
        decodedAfter.sourceSha256.toLowerCase() !== verified.toLowerCase() ||
        !sameDimensions(decodedAfter, identity)) return [];
    return multiSubjectSelectEvidence(identity, detections);
  } catch {
    // Offline/model unavailable and cancellation are safe abstentions.
    return [];
  }
}
