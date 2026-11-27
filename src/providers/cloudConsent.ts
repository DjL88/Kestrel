import { CLOUD_CONSENT_UNASKED, answerCloudConsent, parseCloudConsent, type CloudConsent } from '../core/cloudConsent';

/** This device's answer to "Use InFlight's cloud for this?" (src/core/cloudConsent.ts). */
export const CLOUD_CONSENT_KEY = 'kestrel.cloudConsent.v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;
const defaultStore = (): Store => (typeof localStorage === 'undefined' ? null : localStorage);

/** The remembered answer. Unreadable storage counts as unasked, never as yes. */
export function readCloudConsent(storage: Store = defaultStore()): CloudConsent {
  try {
    const text = storage?.getItem(CLOUD_CONSENT_KEY);
    return text ? parseCloudConsent(JSON.parse(text)) : CLOUD_CONSENT_UNASKED;
  } catch { return CLOUD_CONSENT_UNASKED; }
}

/**
 * Remember the person's answer, or forget it (`'ask'`, so they are asked next time). Returns what is in force
 * afterwards: a yes that could not be saved is not in force.
 */
export function saveCloudConsent(answer: 'yes' | 'no' | 'ask', nowMs = Date.now(), storage: Store = defaultStore()): CloudConsent {
  try {
    if (answer === 'ask') storage?.removeItem(CLOUD_CONSENT_KEY);
    else storage?.setItem(CLOUD_CONSENT_KEY, JSON.stringify(answerCloudConsent(answer, nowMs)));
  } catch { return CLOUD_CONSENT_UNASKED; }
  return readCloudConsent(storage);
}
