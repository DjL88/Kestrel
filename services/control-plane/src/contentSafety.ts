/**
 * Reports about shared content (site/acceptable-use.html). InFlight does not scan photos: automated image scanning
 * (hash matching, AI classifiers, CyberTipline reporting and evidence keeping) was removed on 27 November 2026.
 * Anyone can report a client gallery or photo; an admin reviews the report from its details and can take no action,
 * remove the photo or revoke the gallery. Child sexual abuse material that we are made aware of is removed and reported
 * by hand to the UK National Crime Agency and the Internet Watch Foundation (docs/safety/README.md).
 */
import { createHash } from 'node:crypto';
import { randomId } from './crypto.ts';
import type { FirestoreLike, FsData } from './firestoreStore.ts';

export const NOTICE_CATEGORIES = ['child-sexual-abuse', 'intimate-image-abuse', 'terrorism-or-violence', 'harassment-or-privacy', 'copyright', 'other-illegal', 'policy-breach'] as const;
export type NoticeCategory = typeof NOTICE_CATEGORIES[number];
export type NoticeOutcome = 'no-action' | 'photo-removed' | 'gallery-revoked';
export interface SafetyNotice {
  noticeId: string; receiptHash: string; atMs: number; galleryId: string; ownerAccountId: string; photoId: string | null;
  category: NoticeCategory; explanation: string; notifierName: string | null; notifierEmail: string | null; goodFaith: true;
  status: 'open' | 'decided'; urgent: boolean;
  decision: { by: string; atMs: number; outcome: NoticeOutcome; reason: string } | null;
}

export class SafetyRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) { super(message); }
}

const clean = (value: object): FsData => JSON.parse(JSON.stringify(value)) as FsData;
const S = { notices: 'safety_notices' };

export class SafetyService {
  constructor(private readonly db: FirestoreLike, private readonly now: () => number = Date.now) {}
  private nref(id: string) { return this.db.collection(S.notices).doc(id); }

  // ---- EU DSA Art. 16 notice and action ----

  async addNotice(input: Omit<SafetyNotice, 'noticeId' | 'receiptHash' | 'atMs' | 'status' | 'urgent' | 'decision'>): Promise<{ notice: SafetyNotice; receipt: string }> {
    const receipt = randomId(24);
    const notice: SafetyNotice = {
      ...input, noticeId: `ntc_${randomId(12)}`, receiptHash: createHash('sha256').update(`notice:${receipt}`).digest('hex'), atMs: this.now(),
      status: 'open', urgent: input.category === 'child-sexual-abuse' || input.category === 'intimate-image-abuse' || input.category === 'terrorism-or-violence', decision: null,
    };
    await this.nref(notice.noticeId).create(clean(notice));
    return { notice, receipt };
  }

  async getNotice(noticeId: string): Promise<SafetyNotice> {
    const snap = await this.nref(noticeId).get();
    if (!snap.exists) throw new SafetyRefusal(404, 'NOT_FOUND', 'No such report.');
    return snap.data()! as unknown as SafetyNotice;
  }

  /** The notifier's view, with the receipt they were given (so report ids cannot be enumerated). */
  async noticeStatus(noticeId: string, receipt: string) {
    const n = await this.getNotice(noticeId).catch(() => null);
    if (!n || n.receiptHash !== createHash('sha256').update(`notice:${receipt}`).digest('hex')) throw new SafetyRefusal(404, 'NOT_FOUND', 'No such report.');
    return { noticeId: n.noticeId, receivedAtMs: n.atMs, status: n.status, outcome: n.decision?.outcome ?? null, reason: n.decision?.reason ?? null, decidedAtMs: n.decision?.atMs ?? null };
  }

  async notices(): Promise<SafetyNotice[]> {
    const snap = await this.db.collection(S.notices).get();
    return snap.docs.map((d) => d.data()! as unknown as SafetyNotice).sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || Number(b.urgent) - Number(a.urgent) || a.atMs - b.atMs);
  }

  async decideNotice(noticeId: string, by: string, outcome: NoticeOutcome, reason: string): Promise<SafetyNotice> {
    const n = await this.getNotice(noticeId);
    const next: SafetyNotice = { ...n, status: 'decided', decision: { by, atMs: this.now(), outcome, reason } };
    await this.nref(noticeId).set(clean(next));
    return next;
  }
}
