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
  aircraftLabelledBird: number;
  aircraftCount: number;
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
    if (frame && typeof frame.id === 'string') counts.set(frame.id, (counts.get(frame.id) ?? 0) + 1);
  }
  const errors: string[] = [];
  let evaluated = 0, invalid = 0, abstained = 0, proposedKeep = 0;
  let proposedReject = 0, keeperCount = 0, keptKeepers = 0;
  let falseRejects = 0, aircraftCount = 0, aircraftLabelledBird = 0;
  frames.forEach((frame, index) => {
    if (!frame || typeof frame.id !== 'string' || !frame.id.trim() ||
      counts.get(frame.id) !== 1 ||
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
      else falseRejects++;
    }
    if (frame.suggestion === 'review') abstained++;
    if (frame.suggestion === 'keep') proposedKeep++;
    if (frame.suggestion === 'reject') proposedReject++;
    if (frame.subject === 'aircraft') {
      aircraftCount++;
      if (frame.predictedSubject === 'bird') aircraftLabelledBird++;
    }
  });
  return {
    total: frames.length, evaluated, invalid, abstained, proposedKeep,
    proposedReject, keeperCount,
    // Safety recall: a true keeper sent to Review is retained, not falsely rejected.
    keeperRecall: keeperCount ? keptKeepers / keeperCount : null,
    falseRejects,
    falseRejectRate: keeperCount ? falseRejects / keeperCount : null,
    aircraftLabelledBird, aircraftCount,
    aircraftBirdConfusionRate: aircraftCount ? aircraftLabelledBird / aircraftCount : null,
    errors,
  };
}
/** Release gate is fail-closed: incomplete/invalid fixtures cannot pass. */
export function passesCullSafetyGate(
  evaluation: CullEvaluation,
  minimumEvaluated: number,
  maximumFalseRejectRate = 0,
): boolean {
  return Number.isInteger(minimumEvaluated) && minimumEvaluated > 0 &&
    Number.isFinite(maximumFalseRejectRate) &&
    maximumFalseRejectRate >= 0 && maximumFalseRejectRate <= 1 &&
    evaluation.invalid === 0 && evaluation.evaluated >= minimumEvaluated &&
    evaluation.keeperCount > 0 && evaluation.aircraftCount > 0 &&
    evaluation.falseRejectRate !== null &&
    evaluation.falseRejectRate <= maximumFalseRejectRate &&
    evaluation.aircraftLabelledBird === 0;
}
