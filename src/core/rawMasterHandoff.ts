import { assessRawMaster, type RawMasterEvidence } from './rawMasterProvenance';

/**
 * A fail-closed boundary between provisional photo previews and a high-precision
 * edit master. This is a pure state transition: it never decodes pixels, reads
 * files, uploads data, or changes an original.
 *
 * The native decoder must provide the evidence, not the preview renderer.
 * Callers must re-check the original fingerprint at the point of consumption.
 */
export type MasterHandoff =
  | Readonly<{ state: 'preview-only'; sourceId: string; generation: number; reason: string }>
  | Readonly<{ state: 'verified'; sourceId: string; generation: number; originalSha256: string; width: number; height: number; evidence: Readonly<RawMasterEvidence> }>
  | Readonly<{ state: 'blocked'; sourceId: string; generation: number; reasons: readonly string[] }>;

export interface MasterRequest {
  /** Stable catalogue ID, not a mutable filename or NAS path. */
  sourceId: string;
  /** Monotonically increasing request generation for cancellation/races. */
  generation: number;
  /** SHA-256 recorded from the original at import, never a preview hash. */
  expectedOriginalSha256: string;
  /** Dimensions recorded from the trusted original, when known. */
  expectedWidth?: number;
  expectedHeight?: number;
}
export interface MasterCandidate {
  sourceId: string;
  generation: number;
  /** Independently recomputed from original bytes at handoff time. */
  verifiedOriginalSha256: string;
  evidence: RawMasterEvidence;
}
const SHA = /^[a-f0-9]{64}$/i;
const validId = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 256;
const validGeneration = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Never silently promote an unverified or stale decode into the editor. */
export function acceptRawMaster(request: MasterRequest, candidate?: MasterCandidate | null): MasterHandoff {
  const id = validId(request?.sourceId) ? request.sourceId : '';
  const generation = request?.generation;
  const errors: string[] = [];
  if (!id) errors.push('The catalogue photo identity is missing.');
  if (!validGeneration(generation)) errors.push('The decode generation is invalid.');
  if (!SHA.test(request?.expectedOriginalSha256 ?? '')) errors.push('The imported original fingerprint is missing.');
  for (const [expected, label] of [[request?.expectedWidth, 'width'], [request?.expectedHeight, 'height']] as const) {
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected <= 0)) errors.push(`The original ${label} is invalid.`);
  }
  if (errors.length) return { state: 'blocked', sourceId: id, generation, reasons: errors };
  if (!candidate) return { state: 'preview-only', sourceId: id, generation, reason: 'High-precision sensor data is not verified yet.' };
  if (candidate.sourceId !== id) errors.push('The decoded master belongs to a different photograph.');
  if (candidate.generation !== generation) errors.push('A newer decode has superseded this master.');
  if (!SHA.test(candidate.verifiedOriginalSha256) ||
      candidate.verifiedOriginalSha256.toLowerCase() !== request.expectedOriginalSha256.toLowerCase()) {
    errors.push('Original file bytes do not match the imported photograph.');
  }
  if (candidate.evidence?.originalSha256?.toLowerCase() !== candidate.verifiedOriginalSha256?.toLowerCase()) {
    errors.push('Decoder provenance does not match the verified original bytes.');
  }
  if (request.expectedWidth !== undefined && candidate.evidence?.width !== request.expectedWidth) errors.push('Decoded image width differs from the original.');
  if (request.expectedHeight !== undefined && candidate.evidence?.height !== request.expectedHeight) errors.push('Decoded image height differs from the original.');
  const decision = assessRawMaster(candidate.evidence);
  errors.push(...decision.reasons);
  if (errors.length) return { state: 'blocked', sourceId: id, generation, reasons: errors };
  // Snapshot the evidence so a decoder's later mutable object cannot silently
  // change what this verified handoff means.
  return Object.freeze({
    state: 'verified', sourceId: id, generation,
    originalSha256: candidate.verifiedOriginalSha256.toLowerCase(),
    width: candidate.evidence.width, height: candidate.evidence.height,
    evidence: Object.freeze({ ...candidate.evidence }),
  });
}

/**
 * A verified handoff is not a perpetual permission: recheck the current
 * catalogue identity, generation and original hash before export/reopen.
 */
export function mayUseMaster(handoff: MasterHandoff, request: MasterRequest): boolean {
  return handoff.state === 'verified' &&
    validId(request.sourceId) &&
    handoff.sourceId === request.sourceId &&
    handoff.generation === request.generation &&
    SHA.test(request.expectedOriginalSha256) &&
    handoff.originalSha256 === request.expectedOriginalSha256.toLowerCase() &&
    (request.expectedWidth === undefined || handoff.width === request.expectedWidth) &&
    (request.expectedHeight === undefined || handoff.height === request.expectedHeight) &&
    assessRawMaster(handoff.evidence).canExportHighPrecision;
}
