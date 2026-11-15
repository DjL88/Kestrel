import type { CullDecision } from './types';

/** A repeated Keep/Reject click clears the decision without deleting the photo. */
export function toggleCompareDecision(
  current: CullDecision,
  requested: 'keep' | 'reject',
): CullDecision {
  return current === requested ? 'unreviewed' : requested;
}
