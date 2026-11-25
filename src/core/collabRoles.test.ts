import test from 'node:test';
import assert from 'node:assert/strict';
import { can, changeMembership, roleCan, DEFAULT_SHARING_OPTIONS, type SharedProject } from './collabRoles';

const project: SharedProject = {
  projectId: 'p1',
  options: DEFAULT_SHARING_OPTIONS,
  members: [
    { accountId: 'own', role: 'owner', displayName: 'Owner', addedAtMs: 0, addedByAccountId: 'own' },
    { accountId: 'ed', role: 'editor', displayName: 'Editor', addedAtMs: 0, addedByAccountId: 'own' },
    { accountId: 'cl', role: 'client', displayName: 'Client', addedAtMs: 0, addedByAccountId: 'own', photoIds: ['a'] },
  ],
};

test('the permission table matches the proposal, with optional cells off by default', () => {
  assert.equal(roleCan('owner', 'releaseOthersLock'), true);
  assert.equal(roleCan('editor', 'edit'), true);
  assert.equal(roleCan('editor', 'invite'), false);
  assert.equal(roleCan('editor', 'managePermissions'), false);
  assert.equal(roleCan('commenter', 'comment'), true);
  assert.equal(roleCan('commenter', 'edit'), false);
  assert.equal(roleCan('viewer', 'comment'), false);
  assert.equal(roleCan('client', 'comment'), false);
  assert.equal(roleCan('client', 'comment', { ...DEFAULT_SHARING_OPTIONS, clientsMayComment: true }), true);
  assert.equal(roleCan('client', 'export', { ...DEFAULT_SHARING_OPTIONS, clientsMayExport: true }), true);
  assert.equal(roleCan('client', 'edit', { editorsMayInvite: true, clientsMayComment: true, clientsMayExport: true }), false);
});

test('a client sees only the selected photos, and a stranger sees nothing', () => {
  assert.equal(can(project, 'cl', 'view', 'a'), true);
  assert.equal(can(project, 'cl', 'view', 'b'), false);
  assert.equal(can(project, 'ed', 'edit', 'b'), true);
  assert.equal(can(project, 'nobody', 'view', 'a'), false);
});

test('only the owner manages roles; editors invite below editor only when allowed', () => {
  const invite = { kind: 'invite' as const, member: { accountId: 'v', role: 'viewer' as const, displayName: 'V' } };
  assert.deepEqual(changeMembership(project, 'ed', invite, 1), { ok: false, reason: 'not-permitted' });
  const open = { ...project, options: { ...DEFAULT_SHARING_OPTIONS, editorsMayInvite: true } };
  const invited = changeMembership(open, 'ed', invite, 5);
  assert.ok(invited.ok);
  assert.equal(invited.project.members.at(-1)?.addedByAccountId, 'ed');
  assert.equal(invited.project.members.at(-1)?.addedAtMs, 5);
  assert.deepEqual(changeMembership(open, 'ed', { kind: 'invite', member: { accountId: 'x', role: 'editor', displayName: 'X' } }, 1), { ok: false, reason: 'role-too-high' });
  assert.deepEqual(changeMembership(project, 'ed', { kind: 'setRole', accountId: 'cl', role: 'viewer' }, 1), { ok: false, reason: 'not-permitted' });
  assert.deepEqual(changeMembership(project, 'own', invite, 1).ok, true);
  assert.deepEqual(changeMembership(project, 'own', { kind: 'invite', member: { accountId: 'ed', role: 'viewer', displayName: 'E' } }, 1), { ok: false, reason: 'already-a-member' });
});

test('a project never loses its last owner, and members may leave', () => {
  assert.deepEqual(changeMembership(project, 'own', { kind: 'remove', accountId: 'own' }, 1), { ok: false, reason: 'last-owner' });
  assert.deepEqual(changeMembership(project, 'own', { kind: 'setRole', accountId: 'own', role: 'editor' }, 1), { ok: false, reason: 'last-owner' });
  const left = changeMembership(project, 'ed', { kind: 'remove', accountId: 'ed' }, 1);
  assert.ok(left.ok);
  assert.equal(left.project.members.some((m) => m.accountId === 'ed'), false);
});

test('a client always has a photo selection', () => {
  assert.deepEqual(changeMembership(project, 'own', { kind: 'invite', member: { accountId: 'c2', role: 'client', displayName: 'C' } }, 1), { ok: false, reason: 'client-needs-photos' });
  assert.deepEqual(changeMembership(project, 'own', { kind: 'setPhotos', accountId: 'cl', photoIds: undefined }, 1), { ok: false, reason: 'client-needs-photos' });
  assert.deepEqual(changeMembership(project, 'own', { kind: 'setRole', accountId: 'ed', role: 'client' }, 1), { ok: false, reason: 'client-needs-photos' });
  const whole = changeMembership(project, 'own', { kind: 'setPhotos', accountId: 'ed', photoIds: ['a', 'b'] }, 1);
  assert.ok(whole.ok);
  assert.deepEqual(whole.project.members.find((m) => m.accountId === 'ed')?.photoIds, ['a', 'b']);
  const cleared = whole.ok && changeMembership(whole.project, 'own', { kind: 'setPhotos', accountId: 'ed', photoIds: undefined }, 1);
  assert.ok(cleared && cleared.ok && !('photoIds' in cleared.project.members.find((m) => m.accountId === 'ed')!));
});
