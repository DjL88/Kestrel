import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseWelcome,
  emailNextStep,
  profileFromSession,
  shouldSkipWelcome,
} from './launchWelcome';

const profile = { signedIn: true as const, displayName: 'Sam', initial: 'S' };

test('chooseWelcome: a profile means signedIn', () => {
  assert.equal(chooseWelcome({ profile, accountInLicence: false, launchedBefore: false, hasProjects: false }), 'signedIn');
});

test('chooseWelcome: an account in the licence means signedIn', () => {
  assert.equal(chooseWelcome({ profile: null, accountInLicence: true, launchedBefore: false, hasProjects: false }), 'signedIn');
});

test('chooseWelcome: returning users without an account are guests', () => {
  assert.equal(chooseWelcome({ profile: null, accountInLicence: false, launchedBefore: true, hasProjects: false }), 'guest');
  assert.equal(chooseWelcome({ profile: null, accountInLicence: false, launchedBefore: false, hasProjects: true }), 'guest');
});

test('chooseWelcome: a brand-new install is first', () => {
  assert.equal(chooseWelcome({ profile: null, accountInLicence: false, launchedBefore: false, hasProjects: false }), 'first');
});

test('shouldSkipWelcome: only guests who chose to skip', () => {
  assert.equal(shouldSkipWelcome('guest', true), true);
  assert.equal(shouldSkipWelcome('guest', false), false);
  assert.equal(shouldSkipWelcome('signedIn', true), false);
  assert.equal(shouldSkipWelcome('first', true), false);
});

test('profileFromSession: display name wins, initial is upper case', () => {
  assert.deepEqual(profileFromSession({ displayName: 'Sam Lee', email: 'x@y.z' }), { signedIn: true, displayName: 'Sam Lee', initial: 'S' });
});

test('profileFromSession: falls back to the email local part', () => {
  assert.deepEqual(profileFromSession({ email: 'river.k@example.com' }), { signedIn: true, displayName: 'river.k', initial: 'R' });
});

test('profileFromSession: an Apple private-relay address is never used as a name', () => {
  assert.deepEqual(profileFromSession({ email: 'x7k2mq9p4d@privaterelay.appleid.com' }), { signedIn: true, displayName: null, initial: null });
  assert.deepEqual(profileFromSession({ email: 'x7k2mq9p4d@PrivateRelay.AppleID.com' }), { signedIn: true, displayName: null, initial: null });
  assert.deepEqual(profileFromSession({ displayName: 'Ana', email: 'x7k2mq9p4d@privaterelay.appleid.com' }), { signedIn: true, displayName: 'Ana', initial: 'A' });
});

test('profileFromSession: empty session stays unknown', () => {
  assert.deepEqual(profileFromSession({}), { signedIn: true, displayName: null, initial: null });
});

test('emailNextStep decisions', () => {
  assert.equal(emailNextStep('signIn', 'wrong-or-unknown'), 'offer-create');
  assert.equal(emailNextStep('create', 'in-use'), 'say-wrong-password');
  assert.equal(emailNextStep('signIn', 'offline'), 'show-error');
  assert.equal(emailNextStep('create', 'weak-password'), 'show-error');
});
