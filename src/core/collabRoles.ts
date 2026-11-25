/**
 * C01 — shared project identity and membership (#1387, #1255). Pure rules: who may do what in a shared project.
 * The server enforces the same table; the app uses it only to decide what to show. A project that has never been shared
 * has no SharedProject at all, and everything in the editor works exactly as it does today.
 */

export type CollabRole = 'owner' | 'editor' | 'commenter' | 'viewer' | 'client';

export type CollabCapability =
  | 'view' | 'comment' | 'edit' | 'cull' | 'export' | 'invite' | 'managePermissions' | 'releaseOthersLock';

/** The owner's per-project switches for the "Optional" cells of the permission table. All off by default. */
export interface SharingOptions {
  editorsMayInvite: boolean;
  clientsMayComment: boolean;
  clientsMayExport: boolean;
}

export const DEFAULT_SHARING_OPTIONS: SharingOptions = { editorsMayInvite: false, clientsMayComment: false, clientsMayExport: false };

export interface ProjectMember {
  /** The account id is the authorisation boundary; email is never used to decide access. */
  accountId: string;
  role: CollabRole;
  displayName: string;
  addedAtMs: number;
  addedByAccountId: string;
  /** Limits the member to these photos. Absent means the whole project. Clients always have a list. */
  photoIds?: readonly string[];
}

export interface SharedProject {
  projectId: string;
  members: readonly ProjectMember[];
  options: SharingOptions;
}

const TABLE: Record<CollabRole, readonly CollabCapability[]> = {
  owner: ['view', 'comment', 'edit', 'cull', 'export', 'invite', 'managePermissions', 'releaseOthersLock'],
  editor: ['view', 'comment', 'edit', 'cull', 'export'],
  commenter: ['view', 'comment'],
  viewer: ['view'],
  client: ['view'],
};

export function roleCan(role: CollabRole, capability: CollabCapability, options: SharingOptions = DEFAULT_SHARING_OPTIONS): boolean {
  if (TABLE[role].includes(capability)) return true;
  if (role === 'editor' && capability === 'invite') return options.editorsMayInvite;
  if (role === 'client' && capability === 'comment') return options.clientsMayComment;
  if (role === 'client' && capability === 'export') return options.clientsMayExport;
  return false;
}

export function memberOf(project: SharedProject, accountId: string): ProjectMember | undefined {
  return project.members.find((member) => member.accountId === accountId);
}

/** Whether this account may do this, to this photo when one is named. A non-member may do nothing. */
export function can(project: SharedProject, accountId: string, capability: CollabCapability, photoId?: string): boolean {
  const member = memberOf(project, accountId);
  if (!member || !roleCan(member.role, capability, project.options)) return false;
  return photoId === undefined || member.photoIds === undefined || member.photoIds.includes(photoId);
}

export type MembershipChange =
  | { kind: 'invite'; member: Omit<ProjectMember, 'addedAtMs' | 'addedByAccountId'> }
  | { kind: 'setRole'; accountId: string; role: CollabRole }
  | { kind: 'setPhotos'; accountId: string; photoIds: readonly string[] | undefined }
  | { kind: 'remove'; accountId: string };

export type MembershipRefusal =
  | 'not-a-member' | 'not-permitted' | 'already-a-member' | 'no-such-member' | 'last-owner' | 'client-needs-photos' | 'role-too-high';

export type MembershipResult = { ok: true; project: SharedProject } | { ok: false; reason: MembershipRefusal };

/** Roles an editor may hand out when the owner lets editors invite. Only the owner creates owners or editors. */
const EDITOR_MAY_GRANT: readonly CollabRole[] = ['commenter', 'viewer', 'client'];

const owners = (members: readonly ProjectMember[]) => members.filter((member) => member.role === 'owner').length;

function clientHasPhotos(role: CollabRole, photoIds: readonly string[] | undefined): boolean {
  return role !== 'client' || (photoIds !== undefined && photoIds.length > 0);
}

/** Applies one change if the actor is allowed to make it. Never leaves a project without an owner. */
export function changeMembership(project: SharedProject, actorAccountId: string, change: MembershipChange, atMs: number): MembershipResult {
  const actor = memberOf(project, actorAccountId);
  if (!actor) return { ok: false, reason: 'not-a-member' };
  const manages = roleCan(actor.role, 'managePermissions', project.options);
  const done = (members: ProjectMember[]): MembershipResult => ({ ok: true, project: { ...project, members } });

  if (change.kind === 'invite') {
    if (!roleCan(actor.role, 'invite', project.options)) return { ok: false, reason: 'not-permitted' };
    if (!manages && !EDITOR_MAY_GRANT.includes(change.member.role)) return { ok: false, reason: 'role-too-high' };
    if (memberOf(project, change.member.accountId)) return { ok: false, reason: 'already-a-member' };
    if (!clientHasPhotos(change.member.role, change.member.photoIds)) return { ok: false, reason: 'client-needs-photos' };
    return done([...project.members, { ...change.member, addedAtMs: atMs, addedByAccountId: actorAccountId }]);
  }

  const target = memberOf(project, change.accountId);
  if (!target) return { ok: false, reason: 'no-such-member' };
  const leaving = change.kind === 'remove' && change.accountId === actorAccountId;
  if (!manages && !leaving) return { ok: false, reason: 'not-permitted' };

  if (change.kind === 'remove') {
    if (target.role === 'owner' && owners(project.members) === 1) return { ok: false, reason: 'last-owner' };
    return done(project.members.filter((member) => member.accountId !== change.accountId));
  }
  if (change.kind === 'setRole') {
    if (target.role === 'owner' && change.role !== 'owner' && owners(project.members) === 1) return { ok: false, reason: 'last-owner' };
    if (!clientHasPhotos(change.role, target.photoIds)) return { ok: false, reason: 'client-needs-photos' };
    return done(project.members.map((member) => member.accountId === change.accountId ? { ...member, role: change.role } : member));
  }
  if (!clientHasPhotos(target.role, change.photoIds)) return { ok: false, reason: 'client-needs-photos' };
  return done(project.members.map((member) => {
    if (member.accountId !== change.accountId) return member;
    const { photoIds: _old, ...rest } = member;
    return change.photoIds === undefined ? rest : { ...rest, photoIds: [...change.photoIds] };
  }));
}
