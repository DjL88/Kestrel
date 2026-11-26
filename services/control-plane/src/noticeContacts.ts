/**
 * Who to email when push cannot reach someone (owner, 25 Nov 2026: "only send an email where FCM is not available for a
 * user, or fails to reach them"), and who asked for product news by email.
 *
 * - No address is ever stored or logged here. At each app sign-in (POST /v1/auth/firebase) we keep the account's Firebase
 *   user id and the SHA-256 of the email it signed in with (the same hash the account already holds). When an email is
 *   due, the address is looked up from Firebase Auth server-side (Identity Toolkit `accounts:lookup`, with the Cloud Run
 *   identity) and used for that one message only.
 * - Only a VERIFIED address that still matches the hash the account signed in with is used. Anything else, or a failed
 *   lookup, is "no address": the in-app inbox still has the notice.
 * - The app language (for the unsubscribe words) is the one the app last told us.
 * - Product news by email (marketing) is off unless the person turned it on (UK PECR: feature announcements are marketing).
 * - Product emails (team notices about the person's own shared projects, sent only when push cannot reach them) are on
 *   unless the person turned them off in Settings → Account → Communication preferences, or used the link in one.
 * - Account and security emails (a bought licence key) are not optional while the account exists.
 *
 * Firestore `notify_contacts/<accountId>`: { firebaseUid, emailHash, language?, productNewsEmail, productNewsAtMs?, noticeEmail? }.
 */
import type { FirestoreLike, FsData } from './firestoreStore.ts';
import { emailHashOf } from './entitlement.ts';
import { isMailAddress, type NoticeAddressBook } from './mailer.ts';

const C = 'notify_contacts';

export interface ContactDoc { firebaseUid?: string; emailHash?: string; language?: string; productNewsEmail?: boolean; productNewsAtMs?: number; noticeEmail?: boolean }

/** One Firebase Auth user, as Identity Toolkit answers it. Undefined when there is no such user or the lookup failed. */
export type FirebaseUserLookup = (uid: string) => Promise<{ email?: string; emailVerified?: boolean } | undefined>;

const FIREBASE_UID = /^[A-Za-z0-9_-]{1,128}$/;

export class NoticeContacts {
  /** What this instance last wrote per account, so a sign-in on every API call does not write every time. */
  private readonly written = new Map<string, string>();
  constructor(private readonly db: FirestoreLike, private readonly lookup: FirebaseUserLookup | undefined, private readonly log: (m: string) => void = () => undefined) {}

  private ref(accountId: string) { return this.db.collection(C).doc(accountId); }
  async get(accountId: string): Promise<ContactDoc> {
    const got = await this.ref(accountId).get();
    return (got.exists ? got.data() : {}) as ContactDoc;
  }
  private async merge(accountId: string, change: ContactDoc): Promise<ContactDoc> {
    const next = { ...(await this.get(accountId)), ...change };
    await this.ref(accountId).set(JSON.parse(JSON.stringify(next)) as FsData);
    return next;
  }

  /** Account deletion (accountErasure.ts): the Firebase user id, email hash, language and news opt-in go. */
  async forget(accountId: string): Promise<void> {
    const ref = this.ref(accountId);
    await this.db.runTransaction(async (tx) => { if ((await tx.get(ref)).exists) tx.delete(ref); });
    this.written.delete(accountId);
  }

  /** At an app sign-in: the Firebase user id and the hash of the verified email it signed in with. */
  async rememberSignIn(accountId: string, firebaseUid: string, emailHash: string): Promise<void> {
    if (!FIREBASE_UID.test(firebaseUid) || !/^[0-9a-f]{64}$/.test(emailHash)) return;
    const key = `${firebaseUid}|${emailHash}`;
    if (this.written.get(accountId) === key) return;
    const now = await this.get(accountId);
    if (now.firebaseUid !== firebaseUid || now.emailHash !== emailHash) await this.merge(accountId, { firebaseUid, emailHash });
    this.written.set(accountId, key);
  }

  async setLanguage(accountId: string, language: string): Promise<void> {
    if ((await this.get(accountId)).language !== language) await this.merge(accountId, { language });
  }

  async preferences(accountId: string): Promise<{ productNews: boolean; productEmail: boolean; language: string | null }> {
    const c = await this.get(accountId);
    return { productNews: c.productNewsEmail === true, productEmail: c.noticeEmail !== false, language: c.language ?? null };
  }

  /** Product emails (team notices when push cannot reach the person). On unless switched off. */
  async setProductEmail(accountId: string, on: boolean): Promise<boolean> {
    await this.merge(accountId, { noticeEmail: on });
    return on;
  }

  /** Whether this account still wants team notices by email (the notice fallback asks before every email). */
  readonly wantsNoticeEmail = async (accountId: string): Promise<boolean> => (await this.get(accountId)).noticeEmail !== false;

  /** Turning product news by email on or off. The time it was turned on is kept as the record of consent. */
  async setProductNews(accountId: string, on: boolean, atMs: number): Promise<boolean> {
    await this.merge(accountId, on ? { productNewsEmail: true, productNewsAtMs: atMs } : { productNewsEmail: false, productNewsAtMs: undefined });
    return on;
  }

  /** Accounts that asked for product news by email. */
  async productNewsAccounts(): Promise<string[]> {
    const snap = await this.db.collection(C).where('productNewsEmail', '==', true).get();
    return snap.docs.map((d) => d.id);
  }

  /** The verified address to email now, never kept. */
  readonly addressBook: NoticeAddressBook = async (accountId) => {
    if (!this.lookup) return undefined;
    const c = await this.get(accountId);
    if (!c.firebaseUid || !c.emailHash) return undefined;
    const user = await this.lookup(c.firebaseUid).catch(() => undefined);
    if (!user || user.emailVerified !== true || typeof user.email !== 'string') return undefined;
    const address = user.email.trim();
    if (!isMailAddress(address) || emailHashOf(address) !== c.emailHash) {
      this.log('notice email: the Firebase address no longer matches the one this account signed in with; not emailed');
      return undefined;
    }
    return { address, ...(c.language ? { language: c.language } : {}) };
  };
}

/**
 * Firebase Auth user lookup through Identity Toolkit, as the service's own Cloud Run identity (the metadata server's
 * token), which needs roles/firebaseauth.viewer on the Firebase project. Never logs the answer.
 */
export function identityToolkitLookup(projectId: string, token: () => Promise<string>, fetcher: typeof fetch = fetch, log: (m: string) => void = () => undefined): FirebaseUserLookup {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('KCP_FIREBASE_PROJECT_ID must be a Firebase project id');
  return async (uid) => {
    if (!FIREBASE_UID.test(uid)) return undefined;
    const r = await fetcher(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
      method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ localId: [uid] }),
    });
    if (!r.ok) { log(`notice email: Firebase Auth lookup refused (${r.status})`); return undefined; }
    const body = (await r.json().catch(() => ({}))) as { users?: { localId?: string; email?: unknown; emailVerified?: unknown }[] };
    const user = body.users?.find((u) => u.localId === uid);
    if (!user) return undefined;
    return { email: typeof user.email === 'string' ? user.email : undefined, emailVerified: user.emailVerified === true };
  };
}
