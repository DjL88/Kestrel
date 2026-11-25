/**
 * The person's own data rights on the control plane (UK GDPR articles 15, 17 and 20; x-account-delete, 25 Nov 2026).
 *
 * Download my data: everything this service holds about the signed-in account, in plain JSON the app turns into a zip of
 * JSON and CSV files: the account, licences and their devices, shared projects, the cloud photo list, comments written,
 * purchases (our order records; Paddle keeps its own), alert devices, email preferences and the cloud balance.
 *
 * Delete my account: the person types DELETE; nothing goes at once. A record in `account_deletions/{accountId}` holds
 * the date it will happen, 30 days on, and the person can undo it until then by signing in. Once due, the daily
 * scheduler (POST /v1/admin/account-deletions/run) deletes for real, in keyed, resumable steps:
 *   - shared projects where this account is the only owner, with their cloud photos and galleries (CollabStore says
 *     which); in other projects the account leaves and its comments lose its name;
 *   - alert devices and preferences, notice inbox, email contact record, learning records (if any were shared);
 *   - the account row, its email link, refresh tokens, AI allowance and licence devices (Store.eraseAccount). Licences
 *     are revoked and detached but kept as rows, because purchase records are kept for six years under UK tax law.
 * Refused up front, in plain words: a safe copy still online (its files are kept under the account's own key and must
 * be restored or deleted by the person first, exactly as for a merge).
 *
 * Never touched, by design: projects and original photos on the person's devices (this service never had them),
 * Paddle's own records (Paddle is the merchant of record, an independent controller), and the append-only audit log,
 * which keeps only the opaque account id.
 */
import type { FirestoreLike, FsData } from './firestoreStore.ts';
import type { AuditRecord, Store } from './store.ts';
import type { CloudBalance } from './cloudBalance.ts';
import type { CollabStore } from './collaboration.ts';
import type { CloudPhotoStore } from './cloudPhotos.ts';
import type { GalleryStore } from './gallery.ts';
import type { PushService } from './push.ts';
import type { NoticeContacts } from './noticeContacts.ts';
import type { NoticeStore } from './notices.ts';
import type { SafeCopyCatalog } from './safeCopy.ts';

export const DELETION_GRACE_MS = 30 * 86_400_000;
/** What the person types to confirm. The app shows it in their language, but the word itself is fixed. */
export const DELETION_CONFIRM_WORD = 'DELETE';
export const EXPORT_FORMAT = 'inflight-account-data/1';

export type DeletionStatus = 'scheduled' | 'cancelled' | 'deleting' | 'deleted';
export interface DeletionRecord {
  accountId: string;
  status: DeletionStatus;
  requestedAtMs: number;
  deleteAfterMs: number;
  cancelledAtMs?: number;
  deletedAtMs?: number;
  /** Counts only, written when the deletion runs. */
  counts?: Record<string, number>;
}

/** What deleting would do, shown before the person confirms. */
export interface DeletionPreview {
  ownedSharedProjects: number;
  /** People who would lose access because a project they are in is deleted with this account. */
  peopleInOwnedProjects: number;
  otherSharedProjects: number;
  cloudPhotos: number;
  licences: number;
  balanceMillicredits: number;
  blocked: null | 'safe-copy';
}

export class ErasureRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface ErasureDependencies {
  db: FirestoreLike;
  store: Pick<Store, 'getAccount' | 'listLicencesForAccount' | 'listActivationsForLicence' | 'eraseAccount' | 'audit'>;
  collab?: Pick<CollabStore, 'myProjects' | 'soleOwnerOf' | 'commentsBy' | 'eraseAccount'>;
  cloudPhotos?: Pick<CloudPhotoStore, 'records' | 'removeProject'>;
  gallery?: Pick<GalleryStore, 'list' | 'revoke'>;
  push?: Pick<PushService, 'devices' | 'preferences' | 'forget'>;
  contacts?: Pick<NoticeContacts, 'preferences' | 'forget'>;
  notices?: Pick<NoticeStore, 'forget'>;
  balance?: CloudBalance;
  safeCopy?: Pick<SafeCopyCatalog, 'usage'>;
  /** Learning records shared under the pseudonym for this account (deleted with it). */
  learning?: { forget(accountId: string): Promise<number> };
  now: () => number;
}

const clean = (v: object): FsData => JSON.parse(JSON.stringify(v)) as FsData;
const iso = (ms: number | null | undefined) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

export function accountErasure(d: ErasureDependencies) {
  const ref = (accountId: string) => d.db.collection('account_deletions').doc(accountId);
  const read = async (accountId: string) => (await ref(accountId).get()).data() as unknown as DeletionRecord | undefined;

  async function audit(accountId: string, action: string, detail: string) {
    const entry: AuditRecord = { atMs: d.now(), actor: accountId, action, outcome: 'allowed', detail: detail.slice(0, 480) };
    await d.store.audit(entry);
  }

  async function status(accountId: string): Promise<DeletionRecord | null> {
    const record = await read(accountId);
    return record && (record.status === 'scheduled' || record.status === 'deleting') ? record : null;
  }

  async function preview(accountId: string): Promise<DeletionPreview> {
    const [owned, mine, licences, balanceMillicredits, safeCopyBytes] = await Promise.all([
      d.collab ? d.collab.soleOwnerOf(accountId) : Promise.resolve([]),
      d.collab ? d.collab.myProjects(accountId) : Promise.resolve([]),
      d.store.listLicencesForAccount(accountId),
      d.balance ? d.balance.millicredits(accountId) : Promise.resolve(0),
      d.safeCopy ? d.safeCopy.usage(accountId) : Promise.resolve(0),
    ]);
    let cloudPhotos = 0;
    if (d.cloudPhotos) for (const p of owned) cloudPhotos += (await d.cloudPhotos.records(p.projectId)).length;
    return {
      ownedSharedProjects: owned.length,
      peopleInOwnedProjects: owned.reduce((n, p) => n + p.others, 0),
      otherSharedProjects: mine.length - owned.length,
      cloudPhotos, licences: licences.length, balanceMillicredits,
      blocked: safeCopyBytes > 0 ? 'safe-copy' : null,
    };
  }

  /** Starts the 30 days. Idempotent: asking again while scheduled returns the same date. */
  async function schedule(accountId: string, confirm: string): Promise<DeletionRecord> {
    if (confirm.trim().toUpperCase() !== DELETION_CONFIRM_WORD) throw new ErasureRefusal(400, 'DELETION_NOT_CONFIRMED', `Type ${DELETION_CONFIRM_WORD} to confirm.`);
    const account = await d.store.getAccount(accountId);
    if (!account || account.status !== 'active') throw new ErasureRefusal(409, 'DELETION_NOT_ACTIVE', 'This account is not active.');
    const current = await status(accountId);
    if (current) return current;
    if ((await preview(accountId)).blocked) throw new ErasureRefusal(409, 'DELETION_SAFE_COPY', 'You still have a safe copy online. Restore or download it and turn safe copy off first, then delete your account.');
    const record: DeletionRecord = { accountId, status: 'scheduled', requestedAtMs: d.now(), deleteAfterMs: d.now() + DELETION_GRACE_MS };
    await ref(accountId).set(clean(record));
    await audit(accountId, 'account.deletion.scheduled', `delete after ${iso(record.deleteAfterMs)}`);
    return record;
  }

  /** Keeps the account. Works any time before the deletion starts. */
  async function cancel(accountId: string): Promise<DeletionRecord> {
    const record = await read(accountId);
    if (!record || record.status === 'cancelled') throw new ErasureRefusal(404, 'NOT_FOUND', 'This account is not waiting to be deleted.');
    if (record.status !== 'scheduled') throw new ErasureRefusal(409, 'DELETION_STARTED', 'The deletion has already started and cannot be stopped.');
    const next: DeletionRecord = { ...record, status: 'cancelled', cancelledAtMs: d.now() };
    await ref(accountId).set(clean(next));
    await audit(accountId, 'account.deletion.cancelled', `requested ${iso(record.requestedAtMs)}`);
    return next;
  }

  /** Everything held about the account, for "Download my data". */
  async function exportData(accountId: string): Promise<Record<string, unknown>> {
    const account = await d.store.getAccount(accountId);
    if (!account) throw new ErasureRefusal(404, 'NOT_FOUND', 'No such account.');
    const licences = await d.store.listLicencesForAccount(accountId);
    const devices = (await Promise.all(licences.map((l) => d.store.listActivationsForLicence(l.licenceId)))).flat();
    const projects = d.collab ? await d.collab.myProjects(accountId) : [];
    const cloudPhotos: Record<string, unknown>[] = [];
    if (d.cloudPhotos) {
      for (const p of projects) {
        for (const r of await d.cloudPhotos.records(p.projectId)) {
          // Photos in other people's projects are theirs: only the ones this account added are listed there.
          if (p.role !== 'owner' && r.addedBy !== accountId) continue;
          cloudPhotos.push({ projectId: p.projectId, project: p.name, photoKey: r.photoKey, name: r.name, addedByYou: r.addedBy === accountId, addedAt: iso(r.addedAtMs),
            previewBytes: r.preview?.committed ? r.preview.bytes : null, thumbBytes: r.thumb?.committed ? r.thumb.bytes : null, originalBytes: r.original?.committed ? r.original.bytes : null });
        }
      }
    }
    const comments = d.collab ? (await d.collab.commentsBy(accountId)).map((c) => ({
      id: c.id, projectId: c.projectId, photoId: c.photoId, text: c.text, point: c.point, replyTo: c.replyTo, createdAt: iso(c.createdAtMs), resolvedAt: iso(c.resolvedAtMs),
    })) : [];
    const orders = await d.db.collection('paddle_pro_orders').where('accountId', '==', accountId).get();
    const purchases = orders.docs.map((o) => o.data()!).map((o) => ({
      transactionId: String(o.transactionId ?? ''), invoiceNumber: String(o.invoiceNumber ?? ''), majorVersion: Number(o.majorVersion ?? 0), createdAt: typeof o.createdAt === 'string' ? o.createdAt : null,
    }));
    const deletion = await status(accountId);
    return {
      format: EXPORT_FORMAT,
      generatedAt: iso(d.now()),
      account: { accountId, createdAt: iso(account.createdAtMs), role: account.role, status: account.status, standingAiConsent: account.aiConsent, emailHash: account.emailHash },
      licences: licences.map((l) => ({ licenceId: l.licenceId, plan: l.plan, status: l.status, source: l.source, paid: l.paid, majorVersion: l.majorVersion, maxDevices: l.maxDevices, validUntil: iso(l.validUntilMs), updatedAt: iso(l.updatedAtMs) })),
      devices: devices.map((a) => ({ licenceId: a.licenceId, platform: a.platform, appVersion: a.appVersion, deviceHash: a.deviceHash, lastSeen: iso(a.lastSeenMs) })),
      sharedProjects: projects.map((p) => ({ projectId: p.projectId, name: p.name, role: p.role })),
      cloudPhotos,
      comments,
      purchases,
      alertDevices: d.push ? (await d.push.devices(accountId)).map((x) => ({ platform: x.platform, registeredAt: iso(x.createdAtMs), lastSeen: iso(x.lastSeenAtMs) })) : [],
      alertPreferences: d.push ? await d.push.preferences(accountId) : null,
      emailPreferences: d.contacts ? await d.contacts.preferences(accountId) : null,
      cloudBalanceMillicredits: d.balance ? await d.balance.millicredits(accountId) : 0,
      deletion: deletion ? { requestedAt: iso(deletion.requestedAtMs), deleteAfter: iso(deletion.deleteAfterMs) } : null,
    };
  }

  /** Deletes one account for real. Safe to run again: each step either finds nothing left or repeats harmlessly. */
  async function erase(accountId: string): Promise<DeletionRecord> {
    const record = await read(accountId);
    if (!record) throw new ErasureRefusal(404, 'NOT_FOUND', 'No deletion was asked for.');
    if (record.status === 'deleted' || record.status === 'cancelled') return record;
    if (record.status === 'scheduled' && d.now() < record.deleteAfterMs) throw new ErasureRefusal(409, 'DELETION_NOT_DUE', 'The 30 days have not passed yet.');
    let working: DeletionRecord = { ...record, status: 'deleting' };
    await ref(accountId).set(clean(working));
    const account = await d.store.getAccount(accountId);
    const counts: Record<string, number> = { projectsDeleted: 0, projectsLeft: 0, cloudPhotos: 0, galleries: 0, alertDevices: 0, notices: 0, learningRecords: 0, licences: 0 };
    if (d.collab) {
      const owned = await d.collab.soleOwnerOf(accountId);
      for (const p of owned) {
        if (d.cloudPhotos) counts.cloudPhotos += await d.cloudPhotos.removeProject(p.projectId);
        if (d.gallery) for (const g of await d.gallery.list(p.projectId)) { await d.gallery.revoke(g.galleryId); counts.galleries += 1; }
      }
      const result = await d.collab.eraseAccount(accountId, account?.emailHash);
      counts.projectsDeleted = result.deleted.length; counts.projectsLeft = result.left.length;
    }
    if (d.push) counts.alertDevices = await d.push.forget(accountId);
    if (d.notices) counts.notices = await d.notices.forget(accountId);
    if (d.contacts) await d.contacts.forget(accountId);
    if (d.learning) counts.learningRecords = await d.learning.forget(accountId);
    counts.licences = (await d.store.eraseAccount(accountId, d.now())).licences;
    working = { accountId, status: 'deleted', requestedAtMs: record.requestedAtMs, deleteAfterMs: record.deleteAfterMs, deletedAtMs: d.now(), counts };
    await ref(accountId).set(clean(working));
    await audit(accountId, 'account.deletion.done', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
    return working;
  }

  /** The daily scheduler: every deletion whose 30 days have passed (and any that stopped part-way). */
  async function runDue(): Promise<{ deleted: number; failed: number }> {
    const due: string[] = [];
    for (const s of ['scheduled', 'deleting'] as const) {
      const snap = await d.db.collection('account_deletions').where('status', '==', s).get();
      for (const doc of snap.docs) {
        const r = doc.data()! as unknown as DeletionRecord;
        if (s === 'deleting' || r.deleteAfterMs <= d.now()) due.push(r.accountId);
      }
    }
    let deleted = 0; let failed = 0;
    for (const accountId of due) {
      try { await erase(accountId); deleted += 1; } catch { failed += 1; }
    }
    return { deleted, failed };
  }

  return { status, preview, schedule, cancel, exportData, erase, runDue };
}
export type AccountErasure = ReturnType<typeof accountErasure>;
