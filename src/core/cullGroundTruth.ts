/**
 * Offline evaluation of culling suggestions against independently labelled photos.
 * Never mutates catalogue decisions, source pixels, or original files.
 * This measures an evaluation set; it does not establish field accuracy.
 */
export type GroundTruthSubject = 'bird' | 'aircraft' | 'other' | 'unknown';
export type GroundTruthDecision = 'keep' | 'reject';
export type ProposedDecision = 'keep' | 'reject' | 'review';
export interface LabelledCullFrame {
  id: string;
  truth: GroundTruthDecision;
  subject: GroundTruthSubject;
  /** Independent reviewer confirms a bird/aircraft classification. */
  predictedSubject?: GroundTruthSubject | null;
  suggestion: ProposedDecision;
}
export interface CullEvaluation {
  total: number;
  evaluated: number;
  invalid: number;
  abstained: number;
  proposedKeep: number;
  proposedReject: number;
  keeperCount: number;
  keeperRecall: number | null;
  falseRejects: number;
  falseRejectRate: number | null;
  /** Keepers explicitly recommended Keep; Review is not counted as an automatic success. */
  automaticKeeperRecall: number | null;
  /** Non-keepers incorrectly recommended Keep. */
  falseKeeps: number;
  nonKeeperCount: number;
  falseKeepRate: number | null;
  aircraftLabelledBird: number;
  aircraftCount: number;
  /** Aircraft frames without an explicit prediction cannot certify classification safety. */
  aircraftPredictionsMissing: number;
  /** Explicit unknown predictions are safe abstentions, not correct aircraft detections. */
  aircraftAbstained: number;
  aircraftClassified: number;
  aircraftClassificationCoverage: number | null;
  aircraftCorrectlyClassified: number;
  aircraftConditionalAccuracy: number | null;
  aircraftBirdConfusionRate: number | null;
  errors: string[];
}
const subjects: readonly GroundTruthSubject[] = ['bird', 'aircraft', 'other', 'unknown'];
const decisions: readonly ProposedDecision[] = ['keep', 'reject', 'review'];
/**
 * Ambiguous identities are excluded from all denominators and reported.
 * Unknown labels remain in the denominator for decision safety, but not the
 * aircraft-specific classification metric.
 */
export function evaluateCullGroundTruth(frames: readonly LabelledCullFrame[]): CullEvaluation {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    if (frame && typeof frame.id === 'string') counts.set(frame.id.trim(), (counts.get(frame.id.trim()) ?? 0) + 1);
  }
  const errors: string[] = [];
  let evaluated = 0, invalid = 0, abstained = 0, proposedKeep = 0;
  let proposedReject = 0, keeperCount = 0, keptKeepers = 0;
  let falseRejects = 0, aircraftCount = 0, aircraftLabelledBird = 0, aircraftPredictionsMissing = 0;
  let automaticKeptKeepers = 0, nonKeeperCount = 0, falseKeeps = 0;
  let aircraftAbstained = 0, aircraftClassified = 0, aircraftCorrectlyClassified = 0;
  frames.forEach((frame, index) => {
    if (!frame || typeof frame.id !== 'string' || !frame.id.trim() ||
      frame.id !== frame.id.trim() || counts.get(frame.id.trim()) !== 1 ||
      !subjects.includes(frame.subject) ||
      !['keep', 'reject'].includes(frame.truth) ||
      !decisions.includes(frame.suggestion) ||
      (frame.predictedSubject != null && !subjects.includes(frame.predictedSubject))) {
      invalid++;
      errors.push(`Invalid or duplicate labelled frame at index ${index}`);
      return;
    }
    evaluated++;
    if (frame.truth === 'keep') {
      keeperCount++;
      if (frame.suggestion !== 'reject') keptKeepers++;
      if (frame.suggestion === 'keep') automaticKeptKeepers++;
      if (frame.suggestion === 'reject') falseRejects++;
    }
    if (frame.truth === 'reject') {
      nonKeeperCount++;
      if (frame.suggestion === 'keep') falseKeeps++;
    }
    if (frame.suggestion === 'review') abstained++;
    if (frame.suggestion === 'keep') proposedKeep++;
    if (frame.suggestion === 'reject') proposedReject++;
    if (frame.subject === 'aircraft') {
      aircraftCount++;
      if (frame.predictedSubject == null) aircraftPredictionsMissing++;
      if (frame.predictedSubject === 'bird') aircraftLabelledBird++;
      if (frame.predictedSubject === 'unknown') aircraftAbstained++;
      if (frame.predictedSubject != null && frame.predictedSubject !== 'unknown') {
        aircraftClassified++;
        if (frame.predictedSubject === 'aircraft') aircraftCorrectlyClassified++;
      }
    }
  });
  return {
    total: frames.length, evaluated, invalid, abstained, proposedKeep,
    proposedReject, keeperCount,
    // Safety recall: a true keeper sent to Review is retained, not falsely rejected.
    keeperRecall: keeperCount ? keptKeepers / keeperCount : null,
    falseRejects,
    falseRejectRate: keeperCount ? falseRejects / keeperCount : null,
    automaticKeeperRecall: keeperCount ? automaticKeptKeepers / keeperCount : null,
    falseKeeps, nonKeeperCount,
    falseKeepRate: nonKeeperCount ? falseKeeps / nonKeeperCount : null,
    aircraftLabelledBird, aircraftCount, aircraftPredictionsMissing,
    aircraftAbstained, aircraftClassified, aircraftCorrectlyClassified,
    aircraftClassificationCoverage: aircraftCount ? aircraftClassified / aircraftCount : null,
    aircraftConditionalAccuracy: aircraftClassified ? aircraftCorrectlyClassified / aircraftClassified : null,
    aircraftBirdConfusionRate: aircraftCount ? aircraftLabelledBird / aircraftCount : null,
    errors,
  };
}
/** Release gate is fail-closed: incomplete/invalid fixtures cannot pass. */
export function passesCullSafetyGate(
  evaluation: CullEvaluation,
  minimumEvaluated: number,
  maximumFalseRejectRate = 0,
  minimumAutomaticKeeperRecall = 0.5,
  minimumAircraftClassificationCoverage = 0.5,
): boolean {
  return Number.isInteger(minimumEvaluated) && minimumEvaluated > 0 &&
    Number.isFinite(maximumFalseRejectRate) &&
    maximumFalseRejectRate >= 0 && maximumFalseRejectRate <= 1 &&
    Number.isFinite(minimumAutomaticKeeperRecall) &&
    minimumAutomaticKeeperRecall > 0 && minimumAutomaticKeeperRecall <= 1 &&
    Number.isFinite(minimumAircraftClassificationCoverage) &&
    minimumAircraftClassificationCoverage > 0 && minimumAircraftClassificationCoverage <= 1 &&
    evaluation.invalid === 0 && evaluation.total === evaluation.evaluated &&
    evaluation.errors.length === 0 &&
    evaluation.evaluated === evaluation.keeperCount + evaluation.nonKeeperCount &&
    evaluation.evaluated === evaluation.proposedKeep + evaluation.proposedReject + evaluation.abstained &&
    evaluation.falseRejects >= 0 && evaluation.falseRejects <= evaluation.keeperCount &&
    evaluation.falseKeeps >= 0 && evaluation.falseKeeps <= evaluation.nonKeeperCount &&
    evaluation.aircraftLabelledBird >= 0 && evaluation.aircraftLabelledBird <= evaluation.aircraftCount &&
    evaluation.aircraftPredictionsMissing === 0 &&
    evaluation.aircraftAbstained >= 0 && evaluation.aircraftClassified >= 0 &&
    evaluation.aircraftCorrectlyClassified >= 0 &&
    evaluation.aircraftCorrectlyClassified <= evaluation.aircraftClassified &&
    evaluation.aircraftClassified + evaluation.aircraftAbstained === evaluation.aircraftCount &&
    evaluation.aircraftClassificationCoverage === evaluation.aircraftClassified / evaluation.aircraftCount &&
    evaluation.aircraftClassificationCoverage >= minimumAircraftClassificationCoverage &&
    evaluation.aircraftConditionalAccuracy === evaluation.aircraftCorrectlyClassified / evaluation.aircraftClassified &&
    evaluation.keeperRecall !== null &&
    evaluation.keeperRecall === 1 - evaluation.falseRejects / evaluation.keeperCount &&
    evaluation.falseRejectRate === evaluation.falseRejects / evaluation.keeperCount &&
    evaluation.falseKeepRate === evaluation.falseKeeps / evaluation.nonKeeperCount &&
    evaluation.automaticKeeperRecall !== null && evaluation.automaticKeeperRecall <= evaluation.keeperRecall &&
    evaluation.evaluated >= minimumEvaluated &&
    evaluation.nonKeeperCount > 0 && evaluation.falseKeeps === 0 &&
    evaluation.falseKeepRate === 0 &&
    evaluation.automaticKeeperRecall !== null &&
    evaluation.automaticKeeperRecall >= minimumAutomaticKeeperRecall && evaluation.automaticKeeperRecall <= 1 &&
    evaluation.keeperCount > 0 && evaluation.aircraftCount > 0 &&
    evaluation.falseRejectRate !== null &&
    evaluation.falseRejectRate <= maximumFalseRejectRate &&
    evaluation.aircraftLabelledBird === 0 &&
    evaluation.aircraftBirdConfusionRate === evaluation.aircraftLabelledBird / evaluation.aircraftCount;
}
