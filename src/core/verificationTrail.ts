/**
 * Verification chain (a preview, off by default: feature `verificationChain`). Pure rules, no fetching.
 *
 * A specialist model PROPOSES a step (edit, colour, subject/mask). The on-device vision AI CONFIRMS or disputes it.
 * A cloud model is a quiet third opinion, asked only when the cloud is enabled and permitted, the input is a preview
 * (never an original), and the step is disputed or high-impact. A cloud failure is silent: it never blocks and shows
 * nothing. Nothing is ever auto-rejected: anything not clearly confirmed is kept for review. The interface names only
 * where a check ran ("on this device" or "in the cloud"), never a model.
 */

export type ChainStep = 'edit' | 'colour' | 'subject';
export const CHAIN_STEPS: readonly ChainStep[] = ['edit', 'colour', 'subject'];

export type ChainImpact = 'normal' | 'high';
/** `unavailable` = no answer (not installed, timed out, errored). It is never read as agree or disagree. */
export type ChainVerdict = 'agree' | 'disagree' | 'unsure' | 'unavailable';

/** `confirmed`: the device agreed. `review`: kept for the person to look at. `unchecked`: nothing could check it. */
export type ChainOutcome = 'confirmed' | 'review' | 'unchecked';
export type ChainWhere = 'device' | 'cloud';

export interface ChainInput {
  step: ChainStep;
  /** High-impact steps (large or hard-to-notice changes) also get the cloud opinion when allowed. */
  impact: ChainImpact;
  /** The on-device check, or undefined when it has not run. */
  device?: ChainVerdict;
  /** The cloud check, or undefined when it was not asked or failed. */
  cloud?: ChainVerdict;
}

export interface ChainPolicy {
  /** The `verificationChain` feature (admin flag or this device's preview switch). */
  flag: boolean;
  /** The person has turned the cloud on and given consent. */
  cloudPermitted: boolean;
  /** True only when the image that would be sent is a preview, not the original file. */
  previewOnly: boolean;
}

export interface ChainResult {
  step: ChainStep;
  outcome: ChainOutcome;
  /** Where the answer that decided the outcome came from. Absent when unchecked. */
  where?: ChainWhere;
  /** True when the device disputed the proposal. A dispute is never overridden by the cloud. */
  disputed: boolean;
}

/** Whether the quiet cloud opinion may be asked for this step now. Never for originals, never without permission. */
export function shouldAskCloud(input: Pick<ChainInput, 'impact' | 'device'>, policy: ChainPolicy): boolean {
  if (!policy.flag || !policy.cloudPermitted || !policy.previewOnly) return false;
  return input.device === 'disagree' || input.impact === 'high';
}

/**
 * Settles one step. The device is the authority on this device; the cloud can only make a result more cautious
 * (confirmed → review) or add "also checked in the cloud" to a confirmation. It can never confirm a disputed step,
 * and a missing or failed cloud answer changes nothing.
 */
export function settleStep(input: ChainInput, policy: ChainPolicy): ChainResult {
  const base = { step: input.step };
  if (!policy.flag) return { ...base, outcome: 'unchecked', disputed: false };
  const device = input.device ?? 'unavailable';
  if (device === 'unavailable') return { ...base, outcome: 'unchecked', disputed: false };
  if (device === 'disagree') return { ...base, outcome: 'review', where: 'device', disputed: true };
  if (device === 'unsure') return { ...base, outcome: 'review', where: 'device', disputed: false };
  // Device agreed. The cloud counts only if we were allowed to ask it.
  const cloud = shouldAskCloud(input, policy) ? input.cloud : undefined;
  if (cloud === 'disagree') return { ...base, outcome: 'review', where: 'cloud', disputed: true };
  if (cloud === 'agree') return { ...base, outcome: 'confirmed', where: 'cloud', disputed: false };
  return { ...base, outcome: 'confirmed', where: 'device', disputed: false };
}

export interface ChainTrail {
  results: ChainResult[];
  /** Every step confirmed. Anything else leaves the photo's edit for the person to review. */
  allConfirmed: boolean;
  needsReview: boolean;
}

export function settleTrail(inputs: readonly ChainInput[], policy: ChainPolicy): ChainTrail {
  const results = CHAIN_STEPS.flatMap((step) => inputs.filter((i) => i.step === step).map((i) => settleStep(i, policy)));
  return {
    results,
    allConfirmed: results.length > 0 && results.every((r) => r.outcome === 'confirmed'),
    needsReview: results.some((r) => r.outcome === 'review'),
  };
}

/** The text key for a result. Only "on this device" or "in the cloud" is ever named; never a model. */
export type ChainLabelKey = 'checkedDevice' | 'checkedCloud' | 'review' | 'unchecked';
export function chainLabelKey(r: ChainResult): ChainLabelKey {
  if (r.outcome === 'unchecked') return 'unchecked';
  if (r.outcome === 'review') return 'review';
  return r.where === 'cloud' ? 'checkedCloud' : 'checkedDevice';
}

/** Runs the cloud opinion without ever letting it throw, block or show anything. Failure becomes `undefined`. */
export async function quietCloudOpinion(ask: () => Promise<ChainVerdict | undefined>, timeoutMs = 8000): Promise<ChainVerdict | undefined> {
  try {
    const timeout = new Promise<undefined>((resolve) => { setTimeout(() => resolve(undefined), timeoutMs); });
    const v = await Promise.race([ask(), timeout]);
    return v === 'unavailable' ? undefined : v;
  } catch { return undefined; }
}
