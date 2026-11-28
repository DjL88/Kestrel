import { CLOUD_CONSENT_UNASKED, CLOUD_CONSENT_VERSION, answerCloudConsent, parseCloudConsent, type CloudConsent } from '../core/cloudConsent';

/** This device's answer to "Use InFlight's cloud for this?" (src/core/cloudConsent.ts). */
export const CLOUD_CONSENT_KEY = 'kestrel.cloudConsent.v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;
const defaultStore = (): Store => (typeof localStorage === 'undefined' ? null : localStorage);

/** The remembered answer, exactly as stored. Unreadable storage counts as unasked, never as yes. */
export function readStoredCloudConsent(storage: Store = defaultStore()): CloudConsent {
  try {
    const text = storage?.getItem(CLOUD_CONSENT_KEY);
    return text ? parseCloudConsent(JSON.parse(text)) : CLOUD_CONSENT_UNASKED;
  } catch { return CLOUD_CONSENT_UNASKED; }
}

/**
 * The answer in force. A paid plan (Pro or Pro Plus; Basic, the free plan, has no cloud and is never pre-opted-in) is pre-opted-in: an unasked answer counts as yes for them, shown
 * to the person with a first-use notice and a visible off switch. An explicit no always wins.
 */
export function readCloudConsent(storage: Store = defaultStore(), opts: { paying?: boolean } = {}): CloudConsent {
  const stored = readStoredCloudConsent(storage);
  return stored.answer === 'unasked' && opts.paying ? { answer: 'yes', version: CLOUD_CONSENT_VERSION } : stored;
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
  return readStoredCloudConsent(storage);
}
