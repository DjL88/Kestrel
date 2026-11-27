/**
 * What a cloud job's refusal or failure means, in plain words (x-std-cloud-recipe, cloud denoise). Pure: the transport
 * passes in the HTTP status and the control plane's error code; nothing here reads the network.
 *
 * Every message says what happened to the photo, because people worry about that first: nothing was changed on this
 * device, and a job that never ran was not charged (the control plane refunds the allowance and the balance).
 */
export type CloudJobStep = 'start' | 'upload' | 'status' | 'result' | 'failed' | 'timeout' | 'network';

export interface CloudJobProblem {
  /** The words shown to the person. */
  message: string;
  /** True when a top-up would let this go ahead (the month's cloud photos and the balance are used up). */
  topUp: boolean;
  /** True when signing in again would help. */
  signIn: boolean;
}

const NOTHING_CHANGED = 'Nothing was changed on this device.';

const BY_CODE: Record<string, Omit<CloudJobProblem, 'topUp' | 'signIn'> & { topUp?: boolean; signIn?: boolean }> = {
  CONSENT_REQUIRED: { message: `InFlight needs your yes before a photo goes to the cloud. Nothing was sent.` },
  CLOUD_NOT_CONFIGURED: { message: `Cloud processing is not set up on InFlight's server yet. Nothing was sent. Everything on this device keeps working.` },
  CLOUD_DISABLED: { message: `Cloud processing is switched off for now. Nothing was sent. Everything on this device keeps working.` },
  CLOUD_RECIPE_DISABLED: { message: `Cloud edit settings are switched off for now. Nothing was sent.` },
  CLOUD_NOT_ENTITLED: { message: `Your account does not include cloud processing. Nothing was sent.` },
  CLOUD_QUOTA_EXHAUSTED: {
    message: `This month's cloud photos are used up and your cloud balance cannot pay for more. Top up to carry on, or keep working on this device. Nothing was sent or charged.`,
    topUp: true,
  },
  CLOUD_INPUT_TOO_LARGE: { message: `This picture is larger than cloud processing accepts. Nothing was sent.` },
  CLOUD_RECIPE_INPUT_KIND: { message: `This build sent the cloud an incomplete request. Nothing was sent. Updating InFlight should fix it.` },
  CLOUD_RUNNER_FAILED: { message: `The cloud could not start this job. You were not charged. ${NOTHING_CHANGED} Try again in a few minutes.` },
  CLOUD_INPUT_MISSING: { message: `The photo did not reach the cloud. You were not charged. ${NOTHING_CHANGED}` },
  SPEND_CEILING_REACHED: { message: `InFlight's cloud has reached its limit for this month. Nothing was sent or charged. Everything on this device keeps working.` },
  RATE_LIMITED: { message: `Too many cloud requests in a short time. Wait a minute and try again. Nothing was sent.` },
  NOT_FOUND: { message: `The cloud no longer has this job. ${NOTHING_CHANGED}` },
  FORBIDDEN: { message: `This account is suspended, so nothing was sent.` },
};

/**
 * The problem for one step of a cloud job. `code` is the control plane's error code when it sent one. Unknown codes
 * fall back to wording by status, never to the raw code or status number.
 */
export function cloudJobProblem(step: CloudJobStep, status = 0, code = ''): CloudJobProblem {
  const known = BY_CODE[code];
  if (known) return { message: known.message, topUp: known.topUp === true, signIn: known.signIn === true };
  if (status === 401) return { message: `Your sign-in has run out. Sign in again in Settings › Account, then try again. Nothing was sent.`, topUp: false, signIn: true };
  if (status === 402) return { message: `Your cloud balance cannot pay for this. Top up to carry on. Nothing was sent or charged.`, topUp: true, signIn: false };
  if (status === 429) return plain(BY_CODE.RATE_LIMITED!.message);
  switch (step) {
    case 'start': return plain(`The cloud could not start this job. ${NOTHING_CHANGED} Try again in a few minutes.`);
    case 'upload': return plain(`The photo could not be sent to the cloud. You were not charged. ${NOTHING_CHANGED}`);
    case 'status': return plain(`InFlight lost touch with the cloud while it worked. ${NOTHING_CHANGED}`);
    case 'result': return plain(`The cloud's answer could not be downloaded. ${NOTHING_CHANGED}`);
    case 'failed': return plain(`The cloud could not finish this photo. You were not charged. ${NOTHING_CHANGED}`);
    case 'timeout': return plain(`The cloud took too long, so InFlight stopped waiting. ${NOTHING_CHANGED}`);
    case 'network': return plain(`InFlight could not reach its cloud. Check your connection and try again. ${NOTHING_CHANGED}`);
  }
}

const plain = (message: string): CloudJobProblem => ({ message, topUp: false, signIn: false });

/** An error a cloud job throws, carrying its plain-English problem. */
export class CloudJobError extends Error {
  readonly problem: CloudJobProblem;
  constructor(problem: CloudJobProblem) { super(problem.message); this.name = 'CloudJobError'; this.problem = problem; }
}
