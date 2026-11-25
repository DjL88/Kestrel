/**
 * Shared projects on the control plane (#1387 C01–C03): membership, per-photo leases and revision history, each
 * changed inside one Firestore transaction so two people can never both win. The rules are the app's own pure
 * modules (src/core/collabRoles.ts, photoLease.ts, sharedRevisions.ts), so app and server cannot drift apart.
 *
 * Collections: `collab_projects/{projectId}` (name, members, pending invites by email hash, options, lease timings),
 * `collab_memberships/{account|project}` (so "my projects" is one equality query), `collab_leases/{project|photo}`,
 * `collab_heads/{project|photo}` (head id and count) and `collab_revisions/{project|photo|revision}` (the recipe).
 * `collab_audit` keeps lease takeovers and overrides. `collab_comments/{project|photo|thread}` holds comment threads pinned
 * to a relative point on a photo (src/core/photoComments.ts): text only. No photo, preview, file name or EXIF is ever stored: photo ids are
 * the app's opaque ids and a recipe is edit settings only.
 */
import { docId, type FirestoreLike, type FsData, type FsTransaction } from './firestoreStore.ts';
import { randomId, uuid } from './crypto.ts';
import {
  changeMembership, can, memberOf, roleCan, DEFAULT_SHARING_OPTIONS,
  type CollabCapability, type CollabRole, type MembershipChange, type MembershipRefusal, type ProjectMember, type SharedProject, type SharingOptions,
} from '../../../src/core/collabRoles.ts';
import {
  acquireLease, clampLeaseSettings, heartbeat, leaseStatus, overrideLease, releaseLease, DEFAULT_LEASE_SETTINGS,
  type LeaseAuditEntry, type LeaseBoard, type LeaseSettings, type PhotoLease,
} from '../../../src/core/photoLease.ts';
import {
  orderThreads, reopenThread, reply, resolveThread, startThread, threadVisibleTo,
  type CommentRefusal, type CommentThread,
} from '../../../src/core/photoComments.ts';

export const MAX_MEMBERS = 50;
export const MAX_RECIPE_BYTES = 256_000;

export interface PendingInvite { emailHash: string; role: CollabRole; displayName: string; photoIds?: string[]; invitedBy: string; atMs: number }

export interface ProjectRecord extends SharedProject {
  name: string;
  createdAtMs: number;
  invites: PendingInvite[];
  leaseSettings: LeaseSettings;
}

export interface RevisionMeta { id: string; number: number; parentId: string | null; authorAccountId: string; createdAtMs: number; virtualCopyOf?: string }

/** A refusal the routes turn into an HTTP answer. */
export class CollabRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: Record<string, unknown>) { super(message); }
}

const C = { projects: 'collab_projects', memberships: 'collab_memberships', leases: 'collab_leases', heads: 'collab_heads', revisions: 'collab_revisions', audit: 'collab_audit', invites: 'collab_invites', comments: 'collab_comments' };

/** Firestore refuses `undefined`; drop absent optional fields before writing. */
const clean = <T extends object>(value: T): FsData => JSON.parse(JSON.stringify(value)) as FsData;

const MEMBERSHIP_MESSAGES: Record<MembershipRefusal, [number, string]> = {
  'not-a-member': [404, 'You are not a member of this project.'],
  'not-permitted': [403, 'Your role in this project does not allow that.'],
  'already-a-member': [409, 'That person is already a member.'],
  'no-such-member': [404, 'That person is not a member.'],
  'last-owner': [409, 'A shared project always keeps at least one owner.'],
  'client-needs-photos': [400, 'Choose which photos a client can see.'],
  'role-too-high': [403, 'Only the owner can add editors or owners.'],
};

const COMMENT_MESSAGES: Record<CommentRefusal, [number, string]> = {
  empty: [400, 'Write something first.'],
  'too-long': [400, 'That comment is too long.'],
  'bad-pin': [400, 'A pin must be on the photo.'],
  'thread-full': [409, 'This thread is full. Start a new one.'],
  'photo-full': [409, 'This photo has too many comment threads.'],
  'already-resolved': [409, 'This thread is already resolved.'],
  'not-resolved': [409, 'This thread is already open.'],
};
const commentRefusal = (reason: CommentRefusal) => { const [status, message] = COMMENT_MESSAGES[reason]; return new CollabRefusal(status, 'COMMENT_' + reason.toUpperCase().replace(/-/g, '_'), message); };

/** What a comment change tells the notice sender: who acted, on what, and who should hear about it. */
export interface CommentEvent { projectId: string; projectName: string; photoId: string; threadId: string; actorAccountId: string; actorName: string; kind: 'comment' | 'reply' | 'resolve' | 'reopen'; recipients: string[] }

export class CollabStore {
  constructor(private readonly db: FirestoreLike, private readonly newId: () => string = uuid, private readonly newToken: () => string = () => randomId(24)) {}
  private ref(collection: string, ...parts: string[]) { return this.db.collection(collection).doc(docId(...parts)); }

  private async readProject(tx: FsTransaction, projectId: string): Promise<ProjectRecord> {
    const snap = await tx.get(this.ref(C.projects, projectId));
    if (!snap.exists) throw new CollabRefusal(404, 'NOT_FOUND', 'No such shared project.');
    const data = snap.data()! as unknown as ProjectRecord;
    return { ...data, options: { ...DEFAULT_SHARING_OPTIONS, ...data.options }, leaseSettings: clampLeaseSettings(data.leaseSettings ?? {}), invites: data.invites ?? [] };
  }

  private memberOrRefuse(project: ProjectRecord, accountId: string, capability: CollabCapability, photoId?: string): ProjectMember {
    const member = memberOf(project, accountId);
    if (!member) throw new CollabRefusal(404, 'NOT_FOUND', 'No such shared project.');
    if (!can(project, accountId, capability, photoId)) throw new CollabRefusal(403, 'COLLAB_NOT_PERMITTED', 'Your role in this project does not allow that.');
    return member;
  }

  /** For other shared-project features (galleries): refuses unless this account may do this here. */
  async requireMember(projectId: string, accountId: string, capability: CollabCapability, photoId?: string): Promise<ProjectMember> {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    return this.memberOrRefuse(project, accountId, capability, photoId);
  }

  private writeMemberships(tx: FsTransaction, before: ProjectRecord | null, after: ProjectRecord) {
    const was = new Set(before?.members.map((m) => m.accountId) ?? []);
    const now = new Set(after.members.map((m) => m.accountId));
    for (const m of after.members) tx.set(this.ref(C.memberships, m.accountId, after.projectId), { accountId: m.accountId, projectId: after.projectId, role: m.role, name: after.name });
    for (const id of was) if (!now.has(id)) tx.delete(this.ref(C.memberships, id, after.projectId));
  }

  async createProject(owner: { accountId: string; displayName: string }, name: string, atMs: number): Promise<ProjectRecord> {
    const projectId = this.newId();
    const project: ProjectRecord = {
      projectId, name, createdAtMs: atMs, options: { ...DEFAULT_SHARING_OPTIONS }, invites: [], leaseSettings: { ...DEFAULT_LEASE_SETTINGS },
      members: [{ accountId: owner.accountId, role: 'owner', displayName: owner.displayName, addedAtMs: atMs, addedByAccountId: owner.accountId }],
    };
    await this.db.runTransaction(async (tx) => {
      tx.create(this.ref(C.projects, projectId), clean(project));
      this.writeMemberships(tx, null, project);
    });
    return project;
  }

  async myProjects(accountId: string): Promise<{ projectId: string; name: string; role: CollabRole }[]> {
    const snap = await this.db.collection(C.memberships).where('accountId', '==', accountId).get();
    return snap.docs.map((d) => d.data()!).map((d) => ({ projectId: String(d.projectId), name: String(d.name), role: d.role as CollabRole }));
  }

  /** Invitations waiting for this email hash: the project name and role only. */
  async invitesFor(emailHash: string): Promise<{ projectId: string; name: string; role: CollabRole }[]> {
    const snap = await this.db.collection(C.invites).where('emailHash', '==', emailHash).get();
    return snap.docs.map((d) => d.data()!).map((d) => ({ projectId: String(d.projectId), name: String(d.name), role: d.role as CollabRole }));
  }

  /** What a member may see of the project. Clients see only themselves; only those who manage see pending invites. */
  async project(projectId: string, accountId: string) {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    const me = this.memberOrRefuse(project, accountId, 'view');
    const manages = roleCan(me.role, 'invite', project.options);
    return {
      projectId, name: project.name, me, options: project.options, leaseSettings: project.leaseSettings,
      members: me.role === 'client' ? [me] : project.members,
      invites: manages ? project.invites.map(({ emailHash: _hidden, ...rest }) => rest) : [],
    };
  }

  /** Invite by email hash (the person may not have an account yet), or change an existing member. */
  async change(projectId: string, actorAccountId: string, change: MembershipChange | { kind: 'inviteEmail'; invite: Omit<PendingInvite, 'invitedBy' | 'atMs'> } | { kind: 'options'; options: Partial<SharingOptions>; leaseSettings?: Partial<LeaseSettings> }, atMs: number) {
    return this.db.runTransaction(async (tx) => {
      const before = await this.readProject(tx, projectId);
      let after: ProjectRecord;
      if (change.kind === 'inviteEmail') {
        // Checked with the same rule as a direct invite, against a placeholder account.
        const check = changeMembership(before, actorAccountId, { kind: 'invite', member: { accountId: `invite:${change.invite.emailHash}`, role: change.invite.role, displayName: change.invite.displayName, photoIds: change.invite.photoIds } }, atMs);
        if (!check.ok) { const [status, message] = MEMBERSHIP_MESSAGES[check.reason]; throw new CollabRefusal(status, 'COLLAB_' + check.reason.toUpperCase().replace(/-/g, '_'), message); }
        if (before.members.length + before.invites.length >= MAX_MEMBERS) throw new CollabRefusal(409, 'COLLAB_TOO_MANY_MEMBERS', `A shared project has at most ${MAX_MEMBERS} people.`);
        const invites = before.invites.filter((i) => i.emailHash !== change.invite.emailHash);
        after = { ...before, invites: [...invites, { ...change.invite, invitedBy: actorAccountId, atMs }] };
        tx.set(this.ref(C.invites, change.invite.emailHash, projectId), { emailHash: change.invite.emailHash, projectId, name: before.name, role: change.invite.role, atMs });
      } else if (change.kind === 'options') {
        if (!can(before, actorAccountId, 'managePermissions')) throw new CollabRefusal(403, 'COLLAB_NOT_PERMITTED', 'Only the owner changes project settings.');
        after = { ...before, options: { ...before.options, ...change.options }, leaseSettings: clampLeaseSettings({ ...before.leaseSettings, ...change.leaseSettings }) };
      } else {
        const result = changeMembership(before, actorAccountId, change, atMs);
        if (!result.ok) { const [status, message] = MEMBERSHIP_MESSAGES[result.reason]; throw new CollabRefusal(status, 'COLLAB_' + result.reason.toUpperCase().replace(/-/g, '_'), message); }
        after = { ...before, members: [...result.project.members] };
      }
      tx.set(this.ref(C.projects, projectId), clean(after));
      this.writeMemberships(tx, before, after);
      return after;
    });
  }

  /** Accepts a pending invite addressed to this account's email hash. */
  async accept(projectId: string, account: { accountId: string; emailHash: string; displayName: string }, atMs: number) {
    return this.db.runTransaction(async (tx) => {
      const before = await this.readProject(tx, projectId);
      const invite = before.invites.find((i) => i.emailHash === account.emailHash);
      if (!invite) throw new CollabRefusal(404, 'NOT_FOUND', 'No invitation for this account.');
      const others = before.invites.filter((i) => i !== invite);
      const already = memberOf(before, account.accountId);
      const member: ProjectMember = clean({ accountId: account.accountId, role: invite.role, displayName: invite.displayName || account.displayName, addedAtMs: atMs, addedByAccountId: invite.invitedBy, photoIds: invite.photoIds }) as unknown as ProjectMember;
      const after: ProjectRecord = { ...before, invites: others, members: already ? before.members : [...before.members, member] };
      tx.set(this.ref(C.projects, projectId), clean(after));
      tx.delete(this.ref(C.invites, account.emailHash, projectId));
      this.writeMemberships(tx, before, after);
      return memberOf(after, account.accountId)!;
    });
  }

  private async leaseTx<T>(projectId: string, photoId: string, body: (tx: FsTransaction, project: ProjectRecord, board: LeaseBoard) => Promise<{ board: LeaseBoard; value: T }> | { board: LeaseBoard; value: T }): Promise<T> {
    return this.db.runTransaction(async (tx) => {
      const project = await this.readProject(tx, projectId);
      const leaseRef = this.ref(C.leases, projectId, photoId);
      const snap = await tx.get(leaseRef);
      const board: LeaseBoard = { leases: snap.exists ? { [photoId]: snap.data()! as unknown as PhotoLease } : {}, audit: [] };
      const result = await body(tx, project, board);
      const lease = result.board.leases[photoId];
      if (lease) tx.set(leaseRef, clean({ ...lease, projectId })); else if (snap.exists) tx.delete(leaseRef);
      for (const entry of result.board.audit) tx.set(this.db.collection(C.audit).doc(this.newId()), clean({ ...entry, projectId }));
      return result.value;
    });
  }

  /** Taken on the first edit. Refused while someone else holds a live lease. */
  async acquire(projectId: string, photoId: string, accountId: string, deviceId: string, atMs: number) {
    return this.leaseTx(projectId, photoId, async (tx, project, board) => {
      this.memberOrRefuse(project, accountId, 'edit', photoId);
      const head = await tx.get(this.ref(C.heads, projectId, photoId));
      const baseRevisionId = head.exists ? (head.data()!.headId as string | null) : null;
      const result = acquireLease(board, { photoId, accountId, deviceId, token: this.newToken(), baseRevisionId }, atMs, project.leaseSettings);
      if (!result.ok) {
        const holder = memberOf(project, result.holderAccountId);
        throw new CollabRefusal(409, 'COLLAB_PHOTO_CHECKED_OUT', result.sameAccount ? 'You are editing this photo on another device. Finish or release it there first.' : `${holder?.displayName ?? 'Someone'} is editing this photo.`, { holder: holder?.displayName ?? null, sameAccount: result.sameAccount });
      }
      return { board: result.board, value: { lease: result.lease, settings: project.leaseSettings } };
    });
  }

  async heartbeat(projectId: string, photoId: string, token: string, editing: boolean, atMs: number) {
    return this.leaseTx(projectId, photoId, (_tx, project, board) => {
      const result = heartbeat(board, photoId, token, atMs, editing, project.leaseSettings);
      if (!result.ok) throw new CollabRefusal(409, 'COLLAB_LEASE_LOST', 'This photo is no longer checked out to you. Your changes are kept as a draft on this device.');
      return { board: result.board, value: { status: leaseStatus(result.board.leases[photoId], atMs, project.leaseSettings) } };
    });
  }

  async release(projectId: string, photoId: string, token: string, action: 'checked-in' | 'released', atMs: number) {
    return this.leaseTx(projectId, photoId, (_tx, _project, board) => {
      const result = releaseLease(board, photoId, token, atMs, action);
      return { board: result.ok ? result.board : board, value: { released: result.ok } };
    });
  }

  async override(projectId: string, photoId: string, actorAccountId: string, reason: string, atMs: number) {
    return this.leaseTx(projectId, photoId, (_tx, project, board) => {
      this.memberOrRefuse(project, actorAccountId, 'releaseOthersLock', photoId);
      const result = overrideLease(board, photoId, actorAccountId, reason, atMs);
      if (!result.ok && result.reason === 'reason-required') throw new CollabRefusal(400, 'COLLAB_REASON_REQUIRED', 'Say why you are releasing this photo. It is recorded.');
      return { board: result.ok ? result.board : board, value: { released: result.ok } };
    });
  }

  /** Who holds which photo right now, for outlines in the filmstrip. Lapsed leases are left out. */
  async leases(projectId: string, accountId: string, atMs: number) {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    this.memberOrRefuse(project, accountId, 'view');
    const snap = await this.db.collection(C.leases).where('projectId', '==', projectId).get();
    return snap.docs.map((d) => d.data()! as unknown as PhotoLease & { projectId: string })
      .filter((lease) => leaseStatus(lease, atMs, project.leaseSettings).state !== 'expired' && can(project, accountId, 'view', lease.photoId))
      .map((lease) => ({ photoId: lease.photoId, holder: memberOf(project, lease.holderAccountId)?.displayName ?? null, mine: lease.holderAccountId === accountId }));
  }

  /**
   * A shared save. Never last-write-wins: the author must hold the live lease (token) and start from the current head.
   * A stale base answers 409 with the head, so the app keeps the edit as a draft and offers keep mine, keep theirs or a
   * virtual copy (src/core/sharedRevisions.ts).
   */
  async publish(projectId: string, photoId: string, accountId: string, request: { token: string; baseRevisionId: string | null; recipe: Record<string, unknown>; virtualCopyOf?: string }, atMs: number): Promise<RevisionMeta> {
    return this.db.runTransaction(async (tx) => {
      const project = await this.readProject(tx, projectId);
      this.memberOrRefuse(project, accountId, 'edit', photoId);
      const headRef = this.ref(C.heads, projectId, photoId);
      const leaseSnap = await tx.get(this.ref(C.leases, projectId, photoId));
      const headSnap = await tx.get(headRef);
      const lease = leaseSnap.exists ? leaseSnap.data()! as unknown as PhotoLease : undefined;
      const headId = headSnap.exists ? (headSnap.data()!.headId as string | null) : null;
      const count = headSnap.exists ? Number(headSnap.data()!.count ?? 0) : 0;
      if (!lease || lease.token !== request.token || lease.holderAccountId !== accountId) throw new CollabRefusal(409, 'COLLAB_LEASE_LOST', 'This photo is not checked out to you. Your edit is kept as a draft.', { headId });
      if (leaseStatus(lease, atMs, project.leaseSettings).state === 'expired') throw new CollabRefusal(409, 'COLLAB_LEASE_LOST', 'Your checkout lapsed. Your edit is kept as a draft.', { headId });
      if (request.virtualCopyOf === undefined && request.baseRevisionId !== headId) throw new CollabRefusal(409, 'COLLAB_STALE_BASE', 'Someone else saved this photo since you started. Both versions are kept: choose which to use.', { headId });
      if (request.virtualCopyOf !== undefined && !(await tx.get(this.ref(C.revisions, projectId, photoId, request.virtualCopyOf))).exists) throw new CollabRefusal(404, 'NOT_FOUND', 'No such revision.');
      const meta: RevisionMeta = {
        id: this.newId(), number: count + 1, parentId: request.virtualCopyOf ?? request.baseRevisionId, authorAccountId: accountId, createdAtMs: atMs,
        ...(request.virtualCopyOf !== undefined ? { virtualCopyOf: request.virtualCopyOf } : {}),
      };
      tx.create(this.ref(C.revisions, projectId, photoId, meta.id), clean({ ...meta, projectId, photoId, recipe: request.recipe }));
      tx.set(headRef, { projectId, photoId, headId: request.virtualCopyOf === undefined ? meta.id : headId, count: count + 1 });
      // Saving is editing: it keeps the lease alive.
      tx.set(this.ref(C.leases, projectId, photoId), clean({ ...lease, projectId, lastActivityMs: atMs, lastHeartbeatMs: atMs, baseRevisionId: request.virtualCopyOf === undefined ? meta.id : lease.baseRevisionId }));
      return meta;
    });
  }

  async history(projectId: string, photoId: string, accountId: string) {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    this.memberOrRefuse(project, accountId, 'view', photoId);
    const head = await this.ref(C.heads, projectId, photoId).get();
    const snap = await this.db.collection(C.revisions).where('projectId', '==', projectId).where('photoId', '==', photoId).get();
    const revisions = snap.docs.map((d) => d.data()!).map(({ recipe: _recipe, projectId: _p, photoId: _ph, ...meta }) => meta as unknown as RevisionMeta).sort((a, b) => a.number - b.number);
    return { headId: head.exists ? (head.data()!.headId as string | null) : null, revisions };
  }

  async revision(projectId: string, photoId: string, revisionId: string, accountId: string) {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    this.memberOrRefuse(project, accountId, 'view', photoId);
    const snap = await this.ref(C.revisions, projectId, photoId, revisionId).get();
    if (!snap.exists) throw new CollabRefusal(404, 'NOT_FOUND', 'No such revision.');
    const { projectId: _p, photoId: _ph, ...rest } = snap.data()!;
    return rest;
  }

  async auditFor(projectId: string, accountId: string): Promise<(LeaseAuditEntry & { projectId: string })[]> {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    this.memberOrRefuse(project, accountId, 'managePermissions');
    const snap = await this.db.collection(C.audit).where('projectId', '==', projectId).get();
    return snap.docs.map((d) => d.data()! as unknown as LeaseAuditEntry & { projectId: string }).sort((a, b) => a.atMs - b.atMs);
  }

  // ---- Comments on photos: threads pinned to a point, with replies, resolve and reopen -------------------------------

  private async readThread(tx: FsTransaction, projectId: string, photoId: string, threadId: string): Promise<CommentThread> {
    const snap = await tx.get(this.ref(C.comments, projectId, photoId, threadId));
    if (!snap.exists) throw new CollabRefusal(404, 'NOT_FOUND', 'No such comment thread.');
    const { projectId: _p, ...thread } = snap.data()! as unknown as CommentThread & { projectId: string };
    return thread;
  }

  /** Everyone who wrote in the thread and is still a member, except the person acting. */
  private static participants(thread: CommentThread, actor: string, project: ProjectRecord): string[] {
    const ids = new Set(thread.entries.map((e) => e.authorAccountId));
    ids.delete(actor);
    return [...ids].filter((id) => memberOf(project, id));
  }

  /** Threads on one photo that this person may see (a client only their own), open first. */
  async comments(projectId: string, photoId: string, accountId: string) {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    const me = this.memberOrRefuse(project, accountId, 'view', photoId);
    const snap = await this.db.collection(C.comments).where('projectId', '==', projectId).where('photoId', '==', photoId).get();
    const threads = snap.docs.map((d) => { const { projectId: _p, ...t } = d.data()! as unknown as CommentThread & { projectId: string }; return t as CommentThread; })
      .filter((t) => threadVisibleTo(t, { accountId, isClient: me.role === 'client' }));
    return { threads: orderThreads(threads), canComment: can(project, accountId, 'comment', photoId) };
  }

  /** Open thread counts per photo, for the filmstrip. Clients count only their own threads on their own photos. */
  async commentCounts(projectId: string, accountId: string): Promise<Record<string, number>> {
    const project = await this.db.runTransaction((tx) => this.readProject(tx, projectId));
    const me = this.memberOrRefuse(project, accountId, 'view');
    const snap = await this.db.collection(C.comments).where('projectId', '==', projectId).get();
    const counts: Record<string, number> = {};
    for (const doc of snap.docs) {
      const t = doc.data()! as unknown as CommentThread;
      if (t.resolved || !can(project, accountId, 'view', t.photoId) || !threadVisibleTo(t, { accountId, isClient: me.role === 'client' })) continue;
      counts[t.photoId] = (counts[t.photoId] ?? 0) + 1;
    }
    return counts;
  }

  async startComment(projectId: string, photoId: string, accountId: string, input: { pin: unknown; text: string }, atMs: number): Promise<{ thread: CommentThread; event: CommentEvent }> {
    return this.db.runTransaction(async (tx) => {
      const project = await this.readProject(tx, projectId);
      const me = this.memberOrRefuse(project, accountId, 'comment', photoId);
      const existing = await tx.get(this.db.collection(C.comments).where('projectId', '==', projectId).where('photoId', '==', photoId));
      const result = startThread({ id: this.newId(), entryId: this.newId(), photoId, pin: input.pin, authorAccountId: accountId, authorName: me.displayName, text: input.text }, existing.docs.length, atMs);
      if (!result.ok) throw commentRefusal(result.reason);
      tx.create(this.ref(C.comments, projectId, photoId, result.thread.id), clean({ ...result.thread, projectId }));
      // A new thread goes to the people who may edit this photo, never to clients.
      const recipients = project.members.filter((m) => m.accountId !== accountId && can(project, m.accountId, 'edit', photoId)).map((m) => m.accountId);
      return { thread: result.thread, event: { projectId, projectName: project.name, photoId, threadId: result.thread.id, actorAccountId: accountId, actorName: me.displayName, kind: 'comment' as const, recipients } };
    });
  }

  async changeComment(projectId: string, photoId: string, threadId: string, accountId: string, change: { kind: 'reply'; text: string } | { kind: 'resolve' } | { kind: 'reopen' }, atMs: number): Promise<{ thread: CommentThread; event: CommentEvent }> {
    return this.db.runTransaction(async (tx) => {
      const project = await this.readProject(tx, projectId);
      const me = this.memberOrRefuse(project, accountId, 'comment', photoId);
      const thread = await this.readThread(tx, projectId, photoId, threadId);
      // A client may only touch a thread they started; any other is invisible to them.
      if (!threadVisibleTo(thread, { accountId, isClient: me.role === 'client' })) throw new CollabRefusal(404, 'NOT_FOUND', 'No such comment thread.');
      const result = change.kind === 'reply' ? reply(thread, { id: this.newId(), authorAccountId: accountId, authorName: me.displayName, text: change.text }, atMs)
        : change.kind === 'resolve' ? resolveThread(thread, { accountId, name: me.displayName }, atMs)
        : reopenThread(thread, atMs);
      if (!result.ok) throw commentRefusal(result.reason);
      tx.set(this.ref(C.comments, projectId, photoId, threadId), clean({ ...result.thread, projectId }));
      return { thread: result.thread, event: { projectId, projectName: project.name, photoId, threadId, actorAccountId: accountId, actorName: me.displayName, kind: change.kind, recipients: CollabStore.participants(thread, accountId, project) } };
    });
  }
}
