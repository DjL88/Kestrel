import type { FoundSubject } from '../providers/objectDetector';
import type { SelectEvidence, SubjectGenre } from './subjectDetailBurst';

export interface MultiSubjectSource {
  photoId: string;
  sourceSha256: string;
  width: number;
  height: number;
  modelVersion: string;
  burstId?: string;
}
const sha = /^[0-9a-f]{64}$/i;
const genreOf = (label: string): SubjectGenre =>
  label === 'bird' ? 'bird' : label === 'aeroplane' ? 'aircraft' :
  label === 'person' ? 'person' : ['cat', 'dog', 'horse', 'sheep', 'cow'].includes(label) ? 'pet' : 'unknown';

/** Real local detector boxes; never fabricated eye, identity, species or blur evidence.
 * The caller must independently verify the original source digest and current photo.
 */
export interface SubjectCandidate { index: number; evidence: SelectEvidence }

export function multiSubjectSelectEvidence(
  source: MultiSubjectSource, detections: readonly FoundSubject[],
): SubjectCandidate[] {
  if (!source.photoId.trim() || !sha.test(source.sourceSha256) ||
      !source.modelVersion.trim() || !Number.isSafeInteger(source.width) ||
      !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1 ||
      detections.length > 20) return [];
  const valid = detections.filter(({ detection: d }) =>
    Number.isFinite(d.score) && d.score >= 0.5 && d.score <= 1 &&
    Number.isFinite(d.box.x) && Number.isFinite(d.box.y) &&
    Number.isFinite(d.box.w) && Number.isFinite(d.box.h) &&
    d.box.w > 0 && d.box.h > 0 && d.box.x >= 0 && d.box.y >= 0 &&
    d.box.x + d.box.w <= source.width && d.box.y + d.box.h <= source.height);
  // A malformed bird box must not silently reduce the count to one.
  if (valid.length !== detections.length) return [];
  const birds = valid.filter(v => v.detection.label === 'bird').length;
  return valid.map(({ detection: d }, index) => ({ index, evidence: ({
    photoId: source.photoId,
    sourceSha256: source.sourceSha256,
    modelId: 'yolox-tiny',
    modelVersion: source.modelVersion,
    genre: genreOf(d.label),
    subjectScore: d.score,
    subjectCount: d.label === 'bird' ? birds : valid.length,
    subjectBox: {
      x: d.box.x / source.width, y: d.box.y / source.height,
      width: d.box.w / source.width, height: d.box.h / source.height,
    },
    // Review-only until independent aircraft negatives and per-bird tracking.
    manualDecision: 'review',
    burstId: source.burstId,
  } satisfies SelectEvidence) }));
}
