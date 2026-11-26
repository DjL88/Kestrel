import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../core/cloudInterfaces';
import type { LaunchProfile } from '../core/launchWelcome';
import { LinkingError } from '../core/accountLinking';
import {
  KEEP_SESSION_FAILED, availableProviders, continueWithEmail, createWithEmail, linkLicenceOutcome, signInWithProvider, signOutEverywhere,
  type SignInDeps,
} from './accountSignIn';
import { emailFailureOf } from './firebaseAuth';

/** A Firebase error as withAuth throws it: the friendly message, with Firebase's own error (and code) on `cause`. */
const firebaseError = (code: string, message = `friendly ${code}`) => new Error(message, { cause: Object.assign(new Error(code), { code }) });
const session = (over: Partial<Session> = {}): Session => ({ accountId: 'uid-1', provider: 'password', email: 'sam@example.com', expiresAtMs: 1, ...over });

function fakes(over: { auth?: Partial<SignInDeps['auth']>; licence?: Partial<SignInDeps['licence']> } = {}) {
  const calls: string[] = [];
  const profiles: { profile: LaunchProfile; keep: boolean }[] = [];
  let cleared = 0;
  const deps: SignInDeps = {
    auth: {
      signIn: async (provider) => { calls.push(`signIn:${provider}`); return session({ provider }); },
      signInWithEmail: async () => { calls.push('signInWithEmail'); return session(); },
      createAccount: async () => { calls.push('createAccount'); return session(); },
      signOut: async () => { calls.push('signOut'); },
      idToken: async () => { calls.push('idToken'); return 'token-1'; },
      setKeepSignedIn: async (keep) => { calls.push(`keep:${keep}`); },
      consumeLinkedMethod: () => { calls.push('consumeLinkedMethod'); return null; },
      signInPlatform: () => 'web',
      isDesktopAppleConfigured: () => false,
      isDesktopGoogleConfigured: () => false,
      ...over.auth,
    },
    licence: {
      attachDeviceKeyToAccount: async (token) => { calls.push(`attach:${token}`); return 'none'; },
      activateFromAccount: async (token) => { calls.push(`activate:${token}`); return 'pro'; },
      leaveAccount: () => { calls.push('leaveAccount'); },
      ...over.licence,
    },
    memory: {
      writeProfile: (profile, keep) => { calls.push('writeProfile'); profiles.push({ profile, keep }); },
      clearProfile: () => { calls.push('clearProfile'); cleared += 1; },
    },
  };
  return { deps, calls, profiles, cleared: () => cleared };
}

test('a wrong or unknown email sign-in offers to create the account and writes no profile', async () => {
  const f = fakes({ auth: { signInWithEmail: async () => { throw firebaseError('auth/invalid-credential', 'That email and password do not match.'); } } });
  const result = await continueWithEmail('sam@example.com', 'secret1', false, f.deps);
  assert.deepEqual(result, { kind: 'offer-create', message: 'That email and password do not match.' });
  assert.equal(f.profiles.length, 0);
});

test('creating an account for an email already in use says the password is wrong', async () => {
  const f = fakes({ auth: { createAccount: async () => { throw firebaseError('auth/email-already-in-use', 'There is already an account.'); } } });
  const result = await createWithEmail('sam@example.com', 'secret1', false, f.deps);
  assert.deepEqual(result, { kind: 'wrong-password', message: 'There is already an account.' });
  assert.equal(f.profiles.length, 0);
});

test('other email failures are named, with the message the person sees', async () => {
  const f = fakes({ auth: { signInWithEmail: async () => { throw firebaseError('auth/network-request-failed', 'Could not reach the sign-in service.'); } } });
  assert.deepEqual(await continueWithEmail('sam@example.com', 'secret1', true, f.deps), { kind: 'error', failure: 'offline', message: 'Could not reach the sign-in service.' });
  const g = fakes({ auth: { signInWithEmail: async () => { throw new Error('Sign-in is not set up in this build.'); } } });
  assert.deepEqual(await continueWithEmail('sam@example.com', 'secret1', true, g.deps), { kind: 'error', failure: 'other', message: 'Sign-in is not set up in this build.' });
});

test('a successful email sign-in links the licence and writes the profile for this session only when keep is false', async () => {
  const f = fakes();
  const result = await continueWithEmail('sam@example.com', 'secret1', false, f.deps);
  assert.equal(result.kind, 'signed-in');
  assert.ok(result.kind === 'signed-in');
  assert.equal(result.licence.outcome, 'pro');
  assert.deepEqual(result.licence, { outcome: 'pro', linked: null, attached: 'none' });
  assert.equal(result.session.email, 'sam@example.com');
  assert.deepEqual(f.profiles, [{ profile: { signedIn: true, displayName: 'sam', initial: 'S' }, keep: false }]);
  // Sign in first, then limit it to this session, then the profile, then the licence.
  assert.deepEqual(f.calls, ['signInWithEmail', 'keep:false', 'writeProfile', 'idToken', 'consumeLinkedMethod', 'attach:token-1', 'activate:token-1']);
});

test('the session is handed over as soon as sign-in succeeds, before the licence check', async () => {
  const f = fakes();
  let seenAt = -1;
  await continueWithEmail('sam@example.com', 'secret1', true, f.deps, () => { seenAt = f.calls.length; });
  assert.equal(f.calls[seenAt - 1], 'writeProfile');
  assert.equal(f.calls[seenAt], 'idToken');
});

test('creating an account writes the profile and does not check the licence yet', async () => {
  const f = fakes();
  const result = await createWithEmail('Sam.Lee@example.com', 'secret1', true, f.deps);
  assert.equal(result.kind, 'created');
  assert.deepEqual(f.calls, ['createAccount', 'writeProfile']); // keep = true needs no persistence call
  assert.deepEqual(f.profiles.map((p) => p.keep), [true]);
});

test('linkLicenceOutcome runs the post-sign-in steps in order and returns all of them', async () => {
  const f = fakes({
    auth: { consumeLinkedMethod: () => { f.calls.push('consumeLinkedMethod'); return 'google'; } },
    licence: { attachDeviceKeyToAccount: async (token) => { f.calls.push(`attach:${token}`); return 'attached'; }, activateFromAccount: async (token) => { f.calls.push(`activate:${token}`); return 'free'; } },
  });
  assert.deepEqual(await linkLicenceOutcome(f.deps), { outcome: 'free', linked: 'google', attached: 'attached' });
  assert.deepEqual(f.calls, ['idToken', 'consumeLinkedMethod', 'attach:token-1', 'activate:token-1']);
});

test('linkLicenceOutcome without a token says so and does nothing else', async () => {
  const f = fakes({ auth: { idToken: async () => { f.calls.push('idToken'); throw new Error('offline'); } } });
  assert.deepEqual(await linkLicenceOutcome(f.deps), { outcome: 'no_token', linked: null, attached: null });
  assert.deepEqual(f.calls, ['idToken']);
  const g = fakes({ auth: { idToken: async () => null } });
  assert.deepEqual(await linkLicenceOutcome(g.deps), { outcome: 'no_token', linked: null, attached: null });
});

test('signing in with a provider and keep = true writes the profile and links the licence, with no persistence call', async () => {
  const f = fakes({ auth: { signIn: async (provider) => { f.calls.push(`signIn:${provider}`); return session({ provider, displayName: 'Ana', email: 'x@example.com' }); } } });
  const result = await signInWithProvider('google', true, f.deps);
  assert.ok(result.kind === 'signed-in');
  assert.deepEqual(result.licence, { outcome: 'pro', linked: null, attached: 'none' });
  assert.deepEqual(f.profiles, [{ profile: { signedIn: true, displayName: 'Ana', initial: 'A' }, keep: true }]);
  // keep = true: nothing is awaited before the pop-up, and the web default already remembers.
  assert.deepEqual(f.calls, ['signIn:google', 'writeProfile', 'idToken', 'consumeLinkedMethod', 'attach:token-1', 'activate:token-1']);
});

test('keep = false with a provider: the pop-up comes first, then session-only persistence, profile, licence', async () => {
  const f = fakes();
  const result = await signInWithProvider('apple', false, f.deps);
  assert.equal(result.kind, 'signed-in');
  assert.deepEqual(f.calls, ['signIn:apple', 'keep:false', 'writeProfile', 'idToken', 'consumeLinkedMethod', 'attach:token-1', 'activate:token-1']);
  assert.deepEqual(f.profiles.map((p) => p.keep), [false]);
});

test('if the sign-in cannot be kept to this session, it is signed out on this device and nothing is remembered', async () => {
  const failing = { setKeepSignedIn: async (keep: boolean) => { f.calls.push(`keep:${keep}`); throw new Error('no session storage'); } };
  const f = fakes({ auth: failing });
  assert.deepEqual(await signInWithProvider('google', false, f.deps), { kind: 'error', message: KEEP_SESSION_FAILED });
  assert.deepEqual(f.calls, ['signIn:google', 'keep:false', 'signOut']);
  f.calls.length = 0;
  assert.deepEqual(await continueWithEmail('sam@example.com', 'secret1', false, f.deps), { kind: 'error', failure: 'other', message: KEEP_SESSION_FAILED });
  assert.deepEqual(f.calls, ['signInWithEmail', 'keep:false', 'signOut']);
  f.calls.length = 0;
  assert.deepEqual(await createWithEmail('sam@example.com', 'secret1', false, f.deps), { kind: 'error', failure: 'other', message: KEEP_SESSION_FAILED });
  assert.deepEqual(f.calls, ['createAccount', 'keep:false', 'signOut']);
  assert.equal(f.profiles.length, 0);
});

test('an account-linking refusal is returned, not thrown, and writes no profile', async () => {
  const f = fakes({ auth: { signIn: async () => { throw new LinkingError('use-existing-method'); }, signInWithEmail: async () => { throw new LinkingError('belongs-to-other-account'); } } });
  assert.deepEqual(await signInWithProvider('apple', true, f.deps), { kind: 'linking', problem: 'use-existing-method' });
  assert.deepEqual(await continueWithEmail('sam@example.com', 'secret1', true, f.deps), { kind: 'linking', problem: 'belongs-to-other-account' });
  assert.equal(f.profiles.length, 0);
});

test('other provider failures still throw their message', async () => {
  const f = fakes({ auth: { signIn: async () => { throw new Error('Sign-in was cancelled. Nothing changed.'); } } });
  await assert.rejects(signInWithProvider('google', true, f.deps), /cancelled/);
  assert.equal(f.profiles.length, 0);
});

test('signing out clears this device even when Firebase cannot be reached', async () => {
  const f = fakes({ auth: { signOut: async () => { f.calls.push('signOut'); throw firebaseError('auth/network-request-failed'); } } });
  await signOutEverywhere(f.deps);
  assert.deepEqual(f.calls, ['signOut', 'leaveAccount', 'clearProfile']);
});

test('any other sign-out failure is reported before this device changes', async () => {
  const f = fakes({ auth: { signOut: async () => { f.calls.push('signOut'); throw new Error('boom'); } } });
  await assert.rejects(signOutEverywhere(f.deps), /boom/);
  assert.deepEqual(f.calls, ['signOut']); // Pro and the profile are untouched, so Settings still truly shows signed in
  assert.equal(f.cleared(), 0);
});

test('a normal sign-out clears Pro, then the profile', async () => {
  const f = fakes();
  await signOutEverywhere(f.deps);
  assert.deepEqual(f.calls, ['signOut', 'leaveAccount', 'clearProfile']);
});

test('available providers: email everywhere, Apple and Google on the web or a configured desktop', () => {
  const on = (platform: 'web' | 'desktop' | 'ios' | 'android', apple = false, google = false) =>
    availableProviders(fakes({ auth: { signInPlatform: () => platform, isDesktopAppleConfigured: () => apple, isDesktopGoogleConfigured: () => google } }).deps);
  assert.deepEqual(on('ios', true, true), ['email']);
  assert.deepEqual(on('android', true, true), ['email']);
  assert.deepEqual(on('web'), ['apple', 'google', 'email']);
  assert.deepEqual(on('desktop'), ['email']);
  assert.deepEqual(on('desktop', true, false), ['apple', 'email']);
  assert.deepEqual(on('desktop', false, true), ['google', 'email']);
});

test('emailFailureOf reads the Firebase code, directly or on cause', () => {
  const code = (c: string) => Object.assign(new Error(c), { code: c });
  assert.equal(emailFailureOf(code('auth/invalid-credential')), 'wrong-or-unknown');
  assert.equal(emailFailureOf(code('auth/wrong-password')), 'wrong-or-unknown');
  assert.equal(emailFailureOf(firebaseError('auth/user-not-found')), 'wrong-or-unknown');
  assert.equal(emailFailureOf(firebaseError('auth/email-already-in-use')), 'in-use');
  assert.equal(emailFailureOf(firebaseError('auth/weak-password')), 'weak-password');
  assert.equal(emailFailureOf(firebaseError('auth/invalid-email')), 'invalid-email');
  assert.equal(emailFailureOf(firebaseError('auth/network-request-failed')), 'offline');
  assert.equal(emailFailureOf(firebaseError('auth/too-many-requests')), 'other');
  assert.equal(emailFailureOf(new Error('plain')), 'other');
  assert.equal(emailFailureOf('text'), 'other');
  assert.equal(emailFailureOf(null), 'other');
});
