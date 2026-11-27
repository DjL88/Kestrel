import { AccountAiConsentError, request, withSession } from './accountAiConsent';
import { onlineHelperFromEntitlements, type OnlineHelperAccess } from '../core/onlineHelperAccess';

/**
 * Contributors (owner, 26 Nov 2026): an admin-granted free Pro for people who help with translations. Signed in as a
 * contributor, the app offers "Feedback on this" on right-click; the feedback goes to the admin inbox (POST /v1/me/feedback).
 * Nothing is sent until the person presses Send. Offline or signed out, the option simply is not offered.
 */
export interface ContributorFeedbackPayload {
  comment: string;
  target: string;
  text: string;
  screen: string;
  language: string;
  appVersion: string;
}

/**
 * What the account's plan offers beyond Basic, from the one read the app already makes (GET /v1/me/entitlements):
 * "Feedback on this" for contributors, and InFlight's own online helper (invite-only). True or available only when the
 * server says so; any failure (offline, signed out, older server) reads as not offered.
 */
export async function readAccountOffers(baseUrl: string | null, firebaseIdToken: string | null, fetcher: typeof fetch = fetch): Promise<{ contributor: boolean; onlineHelper: OnlineHelperAccess }> {
  try {
    return await withSession(baseUrl, firebaseIdToken, fetcher, async (origin, session) => {
      const data = await request(origin + '/v1/me/entitlements', fetcher, 'GET', undefined, session);
      return { contributor: data.contributor === true, onlineHelper: onlineHelperFromEntitlements(data) };
    });
  } catch {
    return { contributor: false, onlineHelper: 'unavailable' };
  }
}

/** True only when the server says so; any failure reads as "not a contributor". */
export async function readContributorStatus(baseUrl: string | null, firebaseIdToken: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  return (await readAccountOffers(baseUrl, firebaseIdToken, fetcher)).contributor;
}

export class ContributorFeedbackError extends Error {
  constructor() { super('Feedback could not be sent. Nothing was lost: try again when you are online.'); this.name = 'ContributorFeedbackError'; }
}

export async function sendContributorFeedback(
  baseUrl: string | null, firebaseIdToken: string | null, payload: ContributorFeedbackPayload, fetcher: typeof fetch = fetch,
): Promise<void> {
  try {
    await withSession(baseUrl, firebaseIdToken, fetcher, async (origin, session) => {
      const data = await request(origin + '/v1/me/feedback', fetcher, 'POST', { ...payload }, session);
      if (data.received !== true) throw new AccountAiConsentError();
    });
  } catch {
    throw new ContributorFeedbackError();
  }
}
