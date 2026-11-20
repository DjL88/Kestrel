import {
  evaluateCullGroundTruth, passesCullSafetyGate,
  type CullEvaluation, type GroundTruthDecision, type GroundTruthSubject, type ProposedDecision,
} from './cullGroundTruth';

/**
 * Offline evidence join. Labels must be made independently of predictions;
 * all records must refer to the same immutable original bytes by SHA-256.
 * This is a validation boundary, not a model runner or a claim of accuracy.
 */
export interface CullOriginalEvidence {
  photoId: string;
  sha256: string;
  byteLength: number;
}
export interface IndependentCullLabel {
  photoId: string;
  sha256: string;
  truth: GroundTruthDecision;
  subject: GroundTruthSubject;
}
export interface LocalCullPrediction {
  photoId: string;
  sha256: string;
  modelId: string;
  modelVersion: string;
  /** Human review and automatic decisions are distinct. */
  suggestion: ProposedDecision;
  predictedSubject: GroundTruthSubject;
}
export interface CullEvidenceBatch {
  originals: readonly CullOriginalEvidence[];
  labels: readonly IndependentCullLabel[];
  predictions: readonly LocalCullPrediction[];
  expectedModelId: string;
  expectedModelVersion: string;
}
export interface CullEvidenceReport {
  accepted: boolean;
  reasons: string[];
  evaluated: number;
  evaluation: CullEvaluation | null;
  passesSafetyGate: boolean;
}
const hashPattern = /^[0-9a-f]{64}$/;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id === id.trim() && !/[\u0000-\u001f\u007f]/.test(id);
const validHash = (hash: unknown): hash is string =>
  typeof hash === 'string' && hashPattern.test(hash);
const validModel = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value === value.trim();
const subjects = new Set<GroundTruthSubject>(['bird', 'aircraft', 'other', 'unknown']);
const truths = new Set<GroundTruthDecision>(['keep', 'reject']);
const suggestions = new Set<ProposedDecision>(['keep', 'reject', 'review']);

/**
 * Fail the entire batch on any missing, duplicate, mismatched or unverifiable
 * identity. Never silently drop difficult cases from accuracy denominators.
 * SHA-256 must be calculated over original file bytes, not a thumbnail.
 */
export function evaluateCullEvidence(batch: CullEvidenceBatch, minimumEvaluated = 500): CullEvidenceReport {
  const reasons: string[] = [];
  if (!validModel(batch.expectedModelId) || !validModel(batch.expectedModelVersion))
    reasons.push('Expected model identity and version are required');
  const originalById = new Map<string, CullOriginalEvidence>();
  const originalHashes = new Set<string>();
  for (const original of batch.originals) {
    if (!validId(original.photoId) || !validHash(original.sha256) ||
        !Number.isSafeInteger(original.byteLength) || original.byteLength <= 0) {
      reasons.push('Original identity, full-file SHA-256 or byte length is invalid');
      continue;
    }
    if (originalById.has(original.photoId) || originalHashes.has(original.sha256))
      reasons.push('Duplicate photo ID or identical original bytes need explicit resolution');
    originalById.set(original.photoId, original);
    originalHashes.add(original.sha256);
  }
  const labelById = new Map<string, IndependentCullLabel>();
  for (const label of batch.labels) {
    if (!validId(label.photoId) || !validHash(label.sha256) ||
        !truths.has(label.truth) || !subjects.has(label.subject)) {
      reasons.push('Invalid independent label');
      continue;
    }
    if (labelById.has(label.photoId)) reasons.push('Duplicate independent label');
    labelById.set(label.photoId, label);
  }
  const predictionById = new Map<string, LocalCullPrediction>();
  for (const prediction of batch.predictions) {
    if (!validId(prediction.photoId) || !validHash(prediction.sha256) ||
        !suggestions.has(prediction.suggestion) || !subjects.has(prediction.predictedSubject)) {
      reasons.push('Invalid local-model prediction');
      continue;
    }
    if (predictionById.has(prediction.photoId)) reasons.push('Duplicate local-model prediction');
    if (prediction.modelId !== batch.expectedModelId ||
        prediction.modelVersion !== batch.expectedModelVersion)
      reasons.push('Mixed, stale or unverified local-model version');
    // Never allow a model to automatically reject when it cannot identify
    // the subject. Unknown stays available for human review.
    if (prediction.predictedSubject === 'unknown' && prediction.suggestion === 'reject')
      reasons.push('Unknown subject must not be automatically rejected');
    predictionById.set(prediction.photoId, prediction);
  }
  if (!batch.originals.length || batch.originals.length !== batch.labels.length ||
      batch.originals.length !== batch.predictions.length ||
      originalById.size !== batch.originals.length ||
      labelById.size !== batch.labels.length ||
      predictionById.size !== batch.predictions.length)
    reasons.push('Evidence must have complete one-to-one original, label and prediction coverage');
  const joined = [];
  for (const original of batch.originals) {
    const label = labelById.get(original.photoId);
    const prediction = predictionById.get(original.photoId);
    if (!label || !prediction || label.sha256 !== original.sha256 ||
        prediction.sha256 !== original.sha256) {
      reasons.push('Missing or mismatched SHA-256 evidence for photo ID');
      continue;
    }
    joined.push({
      id: original.photoId, truth: label.truth, subject: label.subject,
      predictedSubject: prediction.predictedSubject, suggestion: prediction.suggestion,
    });
  }
  for (const id of labelById.keys()) if (!originalById.has(id)) reasons.push('Orphan independent label');
  for (const id of predictionById.keys()) if (!originalById.has(id)) reasons.push('Orphan local-model prediction');
  if (reasons.length) return { accepted: false, reasons: [...new Set(reasons)], evaluated: 0, evaluation: null, passesSafetyGate: false };
  const evaluation = evaluateCullGroundTruth(joined);
  return {
    accepted: evaluation.invalid === 0,
    reasons: evaluation.errors,
    evaluated: evaluation.evaluated,
    evaluation,
    passesSafetyGate: passesCullSafetyGate(evaluation, minimumEvaluated),
  };
}
