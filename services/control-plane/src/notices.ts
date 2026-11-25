/**
 * Team notifications for shared projects (G20, owner decision 11). Rules: src/core/collabNotices.ts.
 *
 * Every notice is written to the person's in-app inbox (`collab_notices`), read through `GET /v1/collab/notices` when
 * the app is open. A new notice (not a merge into an unread one) is then pushed through Firebase Cloud Messaging when
 * the person has a device for it; only if not, and the app has not been open in the last 15 minutes, it goes by email,
 * always from hello@inflight.studio through the backend's mailer and its daily counter (decision 11a), which may hold
 * non-urgent mail for the next day.
 *
 * The push sender and mailer belong to the backend lane and plug in through `NoticeDelivery`. Until they are wired,
 * `NO_DELIVERY` sends nothing: the in-app inbox still works. A failed push or email never fails the action that caused
 * the notice; the inbox entry is already written.
 */
import { docId, type FirestoreLike, type FsData } from './firestoreStore.ts';
import { uuid } from './crypto.ts';
import { pushData } from '../../../src/core/pushNotices.ts';
import { chooseDelivery, mergeNotice, noticeKey, noticeWords, type Notice, type NoticeEvent } from '../../../src/core/collabNotices.ts';

export interface NoticeDelivery {
  /** FCM to the account's registered devices. 'no-device' when it has none; 'off' when the person switched this kind
   * off (then it is not emailed either: the inbox still has it). */
  push(accountId: string, message: { title: string; body: string; data: Record<string, string> }): Promise<'sent' | 'no-device' | 'off'>;
  /** Email from hello@ in the recipient's language, through the daily counter. Never urgent here. */
  email(accountId: string, message: { subject: string; text: string; urgent: false }): Promise<'sent' | 'held' | 'no-address'>;
}

/** Nothing is pushed or emailed until the backend wires its FCM sender and mailer. */
export const NO_DELIVERY: NoticeDelivery = { push: async () => 'no-device', email: async () => 'no-address' };

export const NOTICE_INBOX_LIMIT = 50;
const N = { notices: 'collab_notices', seen: 'collab_notice_seen' };
const clean = (value: object): FsData => JSON.parse(JSON.stringify(value)) as FsData;

export class NoticeStore {
  constructor(private readonly db: FirestoreLike, private readonly delivery: NoticeDelivery = NO_DELIVERY, private readonly newId: () => string = uuid,
    private readonly log: (message: string) => void = () => undefined) {}

  /** Writes each recipient's inbox entry, then pushes or emails new ones. Returns how many were sent by which route. */
  async deliver(event: NoticeEvent, atMs: number): Promise<{ inbox: number; push: number; email: number }> {
    const counts = { inbox: 0, push: 0, email: 0 };
    const key = noticeKey(event);
    for (const accountId of [...new Set(event.recipients)].slice(0, 50)) {
      const { notice, isNew } = await this.db.runTransaction(async (tx) => {
        const unread = await tx.get(this.db.collection(N.notices).where('accountId', '==', accountId).where('key', '==', key));
        const existing = unread.docs.map((d) => d.data()! as unknown as Notice).find((n) => n.readAtMs === null) ?? null;
        const merged = mergeNotice(existing, event, accountId, this.newId(), atMs);
        tx.set(this.db.collection(N.notices).doc(docId(accountId, merged.notice.id)), clean(merged.notice));
        return merged;
      });
      counts.inbox += 1;
      if (!isNew) continue;
      try {
        const words = noticeWords(notice);
        const pushed = await this.delivery.push(accountId, { ...words, data: pushData(notice) });
        if (pushed === 'sent') { counts.push += 1; continue; }
        if (pushed === 'off') continue;
        const seen = await this.db.collection(N.seen).doc(accountId).get();
        const lastInboxReadMs = seen.exists ? Number(seen.data()!.atMs) : null;
        if (!chooseDelivery({ pushDevices: 0, hasEmail: true, lastInboxReadMs }, true, atMs).email) continue;
        const mailed = await this.delivery.email(accountId, { subject: words.title, text: `${words.body}\n\nOpen InFlight to see it.`, urgent: false });
        if (mailed === 'sent' || mailed === 'held') counts.email += 1;
      } catch (error) {
        this.log(`notice delivery failed (inbox kept): ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    return counts;
  }

  /** The person's newest notices. Reading the inbox also says "the app is open", so email is not sent meanwhile. */
  async inbox(accountId: string, atMs: number): Promise<{ notices: Notice[]; unread: number }> {
    const snap = await this.db.collection(N.notices).where('accountId', '==', accountId).get();
    const all = snap.docs.map((d) => d.data()! as unknown as Notice).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    await this.db.collection(N.seen).doc(accountId).set({ accountId, atMs });
    return { notices: all.slice(0, NOTICE_INBOX_LIMIT), unread: all.filter((n) => n.readAtMs === null).length };
  }

  async markRead(accountId: string, ids: readonly string[] | 'all', atMs: number): Promise<number> {
    const snap = await this.db.collection(N.notices).where('accountId', '==', accountId).get();
    const targets = snap.docs.map((d) => d.data()! as unknown as Notice).filter((n) => n.readAtMs === null && (ids === 'all' || ids.includes(n.id)));
    if (!targets.length) return 0;
    await this.db.runTransaction(async (tx) => {
      for (const n of targets) tx.set(this.db.collection(N.notices).doc(docId(accountId, n.id)), clean({ ...n, readAtMs: atMs }));
    });
    return targets.length;
  }
}
