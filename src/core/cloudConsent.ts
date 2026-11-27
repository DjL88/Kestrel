/**
 * The person's answer to "Use InFlight's cloud for this?" (cloud edit settings, x-std-cloud-recipe). Asked once, at
 * the moment it would help, never pre-ticked, and remembered on this device until they change it. Pure: storage lives
 * in src/providers/cloudConsent.ts.
 *
 * A yes is not a standing upload order: each job still needs its own press of Send, and the control plane still checks
 * `userConsent` on every job. The yes only means the explanation is not shown again before each one.
 */
export const CLOUD_CONSENT_VERSION = 1;

export type CloudConsentAnswer = 'unasked' | 'yes' | 'no';

export interface CloudConsent {
  answer: CloudConsentAnswer;
  /** When the person answered. Absent while unasked. */
  atMs?: number;
  /** The wording they answered. An answer to older wording counts as unasked, so they are asked again. */
  version?: number;
}

export const CLOUD_CONSENT_UNASKED: CloudConsent = { answer: 'unasked' };

/** A stored answer, or unasked when it is missing, damaged or for older wording. Never turns into a yes by itself. */
export function parseCloudConsent(value: unknown): CloudConsent {
  if (!value || typeof value !== 'object') return CLOUD_CONSENT_UNASKED;
  const v = value as Record<string, unknown>;
  if (v.version !== CLOUD_CONSENT_VERSION) return CLOUD_CONSENT_UNASKED;
  if (v.answer !== 'yes' && v.answer !== 'no') return CLOUD_CONSENT_UNASKED;
  if (typeof v.atMs !== 'number' || !Number.isFinite(v.atMs) || v.atMs <= 0) return CLOUD_CONSENT_UNASKED;
  return { answer: v.answer, atMs: v.atMs, version: CLOUD_CONSENT_VERSION };
}

export function answerCloudConsent(answer: 'yes' | 'no', nowMs: number): CloudConsent {
  return { answer, atMs: nowMs, version: CLOUD_CONSENT_VERSION };
}

/** Whether a Send may go ahead without asking first. */
export const cloudConsentGiven = (consent: CloudConsent) => consent.answer === 'yes';
