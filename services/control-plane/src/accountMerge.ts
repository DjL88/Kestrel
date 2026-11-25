/**
 * Merging two InFlight accounts (owner, 25 Nov 2026). The person proves both sign-ins, sees exactly what will move,
 * confirms, and can undo it for 30 days. Nothing is ever merged silently, and no decision or photo is lost: photos,
 * edits and decisions live on devices and in project records, which only change owner here.
 *
 * 1. Signed in to the account that will close (B), the app asks for a merge ticket: a short-lived HMAC statement "B
 *    agrees to be merged", signed with the server's session secret.
 * 2. Signed in to the account that stays (A), it shows the preview, then confirms with the ticket.
 * 3. The move runs as keyed, resumable steps recorded in `account_merges/{mergeId}` (mergeId comes from the ticket, so a
 *    retried request resumes the same merge and repeats nothing):
 *      - B is suspended first, so nothing new happens on it mid-move;
 *      - each Pro licence and grant moves to A (its devices come with it);
 *      - the prepaid balance moves as one keyed debit of B and one keyed credit of A (`merge:<id>:out`, `merge:<id>:in`);
 *      - each shared-project place moves to A, keeping the higher role (cloud photos follow, as billing goes to an owner);
 *      - push devices are re-registered to A;
 *      - B is marked 'merged' and an audit entry records the counts.
 * 4. Undo (A, within 30 days) reverses each step with its own keys. The balance comes back only if A still holds it.
 *
 * Refused up front, with the reason in plain words: the same account twice, either account not active, an expired or
 * forged ticket, or a safe copy still held on B (its files are kept under B's own key, and moving them is not built,
 * so merging would strand them: restore or download them and turn safe copy off on B first).
 * Paddle records are never rewritten: an order stays tied to the transaction it was paid with, and a refund finds the
 * licence by that order (paddleRefunds.ts), wherever the licence now lives.
 */
import crypto from 'node:crypto';
import type { FirestoreLike, FsData } from './firestoreStore.ts';
import type { AuditRecord, Store } from './store.ts';
import type { CloudBalance } from './cloudBalance.ts';
import type { CollabStore } from './collaboration.ts';
import type { PushService } from './push.ts';
import type { SafeCopyCatalog } from './safeCopy.ts';
import type { ProjectMember } from '../../../src/core/collabRoles.ts';

export const MERGE_TICKET_TTL_MS = 15 * 60_000;
export const MERGE_UNDO_MS = 30 * 86_400_000;

export interface MergePreview {
  from: { accountId: string };
  to: { accountId: string };
  licences: number;
  balanceMillicredits: number;
  projects: number;
  pushDevices: number;
  blocked: null | 'same-account' | 'not-active' | 'safe-copy';
}

export interface MergeRecord {
  mergeId: string;
  fromAccountId: string;
  toAccountId: string;
  createdAtMs: number;
  undoUntilMs: number;
  status: 'moving' | 'done' | 'undoing' | 'undone';
  balanceMillicredits: number;
  licences: string[];
  projects: { projectId: string; fromMember: ProjectMember; toBefore: ProjectMember | null }[];
  pushTokens: number;
}

export class MergeRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface MergeDependencies {
  db: FirestoreLike;
  store: Pick<Store, 'getAccount' | 'setAccountStatus' | 'listLicencesForAccount' | 'reassignLicence' | 'audit'>;
  secret: Buffer;
  balance?: CloudBalance;
  collab?: Pick<CollabStore, 'myProjects' | 'transferMembership' | 'restoreMembership'>;
  push?: Pick<PushService, 'devices' | 'register'>;
  safeCopy?: Pick<SafeCopyCatalog, 'usage'>;
  now: () => number;
}

const clean = (v: object): FsData => JSON.parse(JSON.stringify(v)) as FsData;
const b64 = (b: Buffer) => b.toString('base64url');

export function accountMerges(d: MergeDependencies) {
  const ref = (id: string) => d.db.collection('account_merges').doc(id);
  const sign = (body: string) => b64(crypto.createHmac('sha256', d.secret).update('merge-ticket:' + body).digest());

  function ticketFor(fromAccountId: string): { ticket: string; expiresAtMs: number } {
    const expiresAtMs = d.now() + MERGE_TICKET_TTL_MS;
    const body = b64(Buffer.from(JSON.stringify({ from: fromAccountId, nonce: crypto.randomBytes(12).toString('hex'), exp: expiresAtMs })));
    return { ticket: `${body}.${sign(body)}`, expiresAtMs };
  }

  function openTicket(ticket: string): { from: string; nonce: string } {
    const [body, mac] = ticket.split('.');
    if (!body || !mac || mac.length !== 43) throw new MergeRefusal(400, 'MERGE_TICKET_INVALID', 'Sign in to the other account again to start the merge.');
    const expected = sign(body);
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new MergeRefusal(400, 'MERGE_TICKET_INVALID', 'Sign in to the other account again to start the merge.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { from?: unknown; nonce?: unknown; exp?: unknown };
    if (typeof claims.from !== 'string' || typeof claims.nonce !== 'string' || !/^[0-9a-f]{24}$/.test(claims.nonce) || typeof claims.exp !== 'number') {
      throw new MergeRefusal(400, 'MERGE_TICKET_INVALID', 'Sign in to the other account again to start the merge.');
    }
    if (claims.exp < d.now()) throw new MergeRefusal(400, 'MERGE_TICKET_EXPIRED', 'That was more than 15 minutes ago. Sign in to the other account again.');
    return { from: claims.from, nonce: claims.nonce };
  }

  async function preview(ticket: string, toAccountId: string): Promise<MergePreview & { mergeId: string }> {
    const { from, nonce } = openTicket(ticket);
    const [a, b] = await Promise.all([d.store.getAccount(toAccountId), d.store.getAccount(from)]);
    const blocked: MergePreview['blocked'] = from === toAccountId ? 'same-account'
      : a?.status !== 'active' || b?.status !== 'active' ? 'not-active'
      : d.safeCopy && (await d.safeCopy.usage(from)) > 0 ? 'safe-copy' : null;
    const [licences, balanceMillicredits, projects, devices] = await Promise.all([
      d.store.listLicencesForAccount(from),
      d.balance ? d.balance.millicredits(from) : Promise.resolve(0),
      d.collab ? d.collab.myProjects(from) : Promise.resolve([]),
      d.push ? d.push.devices(from) : Promise.resolve([]),
    ]);
    return { mergeId: `mrg_${nonce}`, from: { accountId: from }, to: { accountId: toAccountId }, licences: licences.length, balanceMillicredits, projects: projects.length, pushDevices: devices.length, blocked };
  }

  const refusalFor = (blocked: NonNullable<MergePreview['blocked']>) => blocked === 'same-account'
    ? new MergeRefusal(400, 'MERGE_SAME_ACCOUNT', 'That is the account you are signed in to. Sign in to the other account to merge it.')
    : blocked === 'not-active' ? new MergeRefusal(409, 'MERGE_NOT_ACTIVE', 'One of the two accounts is not active, so they cannot be merged.')
    : new MergeRefusal(409, 'MERGE_SAFE_COPY', 'The other account still has a safe copy online. Restore or download it, turn safe copy off there, then merge.');

  async function audit(accountId: string, action: string, detail: string) {
    const entry: AuditRecord = { atMs: d.now(), actor: accountId, action, outcome: 'allowed', detail: detail.slice(0, 480) };
    await d.store.audit(entry);
  }

  /** Runs (or resumes) the merge. Safe to call again with the same ticket: every step is keyed and recorded. */
  async function merge(ticket: string, toAccountId: string): Promise<MergeRecord> {
    const { from, nonce } = openTicket(ticket);
    const mergeId = `mrg_${nonce}`;
    let record = (await ref(mergeId).get()).data() as unknown as MergeRecord | undefined;
    if (record && (record.toAccountId !== toAccountId || record.fromAccountId !== from)) throw new MergeRefusal(409, 'MERGE_TICKET_USED', 'That merge ticket was already used.');
    if (record?.status === 'done' || record?.status === 'undone' || record?.status === 'undoing') return record;
    if (!record) {
      const p = await preview(ticket, toAccountId);
      if (p.blocked) throw refusalFor(p.blocked);
      record = { mergeId, fromAccountId: from, toAccountId, createdAtMs: d.now(), undoUntilMs: d.now() + MERGE_UNDO_MS, status: 'moving', balanceMillicredits: p.balanceMillicredits, licences: [], projects: [], pushTokens: 0 };
      try { await ref(mergeId).create(clean(record)); } catch { record = (await ref(mergeId).get()).data() as unknown as MergeRecord; }
      await d.store.setAccountStatus(from, 'suspended'); // nothing new happens on B while it moves
    }
    const save = () => ref(mergeId).set(clean(record!));

    for (const licence of await d.store.listLicencesForAccount(from)) {
      if (await d.store.reassignLicence(licence.licenceId, from, toAccountId)) { record.licences.push(licence.licenceId); await save(); }
    }
    if (d.balance && record.balanceMillicredits > 0) {
      if (!(await d.balance.debit(from, record.balanceMillicredits, `merge:${mergeId}:out`))) throw new MergeRefusal(409, 'MERGE_BALANCE_CHANGED', 'The other account’s balance changed during the merge. Try again.');
      await d.balance.credit(toAccountId, record.balanceMillicredits, `merge:${mergeId}:in`);
    }
    if (d.collab) {
      for (const project of await d.collab.myProjects(from)) {
        const moved = await d.collab.transferMembership(project.projectId, from, toAccountId);
        if (moved) { record.projects.push({ projectId: project.projectId, ...moved }); await save(); }
      }
    }
    if (d.push) {
      for (const device of await d.push.devices(from)) { await d.push.register(toAccountId, device.token, device.platform, d.now()); record.pushTokens += 1; }
    }
    record.status = 'done';
    await save();
    await d.store.setAccountStatus(from, 'merged');
    await audit(toAccountId, 'account.merge', `${mergeId}: ${from} merged into ${toAccountId}; licences=${record.licences.length} balance=${record.balanceMillicredits}mc projects=${record.projects.length} devices=${record.pushTokens}; undo until ${new Date(record.undoUntilMs).toISOString()}`);
    return record;
  }

  async function list(toAccountId: string): Promise<MergeRecord[]> {
    const snap = await d.db.collection('account_merges').where('toAccountId', '==', toAccountId).get();
    return snap.docs.map((doc) => doc.data()! as unknown as MergeRecord).sort((x, y) => y.createdAtMs - x.createdAtMs);
  }

  /** Puts everything back where it was (within 30 days). Refuses, changing nothing, if A has spent the moved balance. */
  async function undo(mergeId: string, toAccountId: string): Promise<MergeRecord> {
    const record = (await ref(mergeId).get()).data() as unknown as MergeRecord | undefined;
    if (!record || record.toAccountId !== toAccountId) throw new MergeRefusal(404, 'NOT_FOUND', 'No such merge.');
    if (record.status === 'undone') return record;
    if (record.status !== 'done' && record.status !== 'undoing') throw new MergeRefusal(409, 'MERGE_IN_PROGRESS', 'That merge has not finished yet.');
    if (d.now() > record.undoUntilMs) throw new MergeRefusal(409, 'MERGE_UNDO_EXPIRED', 'The 30 days to undo this merge have passed.');
    const from = record.fromAccountId;
    if (d.balance && record.balanceMillicredits > 0 && record.status === 'done' && (await d.balance.millicredits(toAccountId)) < record.balanceMillicredits) {
      throw new MergeRefusal(409, 'MERGE_UNDO_BALANCE_SPENT', 'Part of the moved cloud balance has been used since, so the merge cannot be undone automatically. Contact support.');
    }
    record.status = 'undoing';
    await ref(mergeId).set(clean(record));
    if (d.balance && record.balanceMillicredits > 0) {
      if (!(await d.balance.debit(toAccountId, record.balanceMillicredits, `merge:${mergeId}:undo-out`))) throw new MergeRefusal(409, 'MERGE_UNDO_BALANCE_SPENT', 'Part of the moved cloud balance has been used since, so the merge cannot be undone automatically. Contact support.');
      await d.balance.credit(from, record.balanceMillicredits, `merge:${mergeId}:undo-in`);
    }
    for (const licenceId of record.licences) await d.store.reassignLicence(licenceId, toAccountId, from);
    if (d.collab) for (const p of record.projects) await d.collab.restoreMembership(p.projectId, p.fromMember, toAccountId, p.toBefore);
    // Push devices stay with A: each device registers again for whoever signs in on it next.
    record.status = 'undone';
    await ref(mergeId).set(clean(record));
    await d.store.setAccountStatus(from, 'active');
    await audit(toAccountId, 'account.merge_undo', `${mergeId}: ${from} restored from ${toAccountId}; licences=${record.licences.length} balance=${record.balanceMillicredits}mc projects=${record.projects.length}`);
    return record;
  }

  return { ticketFor, preview, merge, list, undo };
}
export type AccountMerges = ReturnType<typeof accountMerges>;
