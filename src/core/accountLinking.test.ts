import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkingError, linkingProblem, methodsFromProviderIds, methodsToAdd, signInWithHeldLink } from './accountLinking';

test('the ways an account signs in, and what can still be added', () => {
  assert.deepEqual(methodsFromProviderIds(['password', 'google.com', 'github.com']), ['google', 'password']);
  assert.deepEqual(methodsFromProviderIds([]), []);
  assert.deepEqual(methodsFromProviderIds(['microsoft.com', 'apple.com']), ['apple', 'microsoft']);
  assert.deepEqual(methodsToAdd(['google'], ['google', 'apple', 'password']), ['apple', 'password']);
  assert.deepEqual(methodsToAdd(['google', 'apple', 'password'], ['google', 'apple', 'password']), []);
});

test("Firebase's linking refusals become plain outcomes, never a silent second account", () => {
  assert.equal(linkingProblem('auth/account-exists-with-different-credential'), 'use-existing-method');
  assert.equal(linkingProblem('auth/credential-already-in-use'), 'belongs-to-other-account');
  assert.equal(linkingProblem('auth/email-already-in-use'), 'belongs-to-other-account');
  assert.equal(linkingProblem('auth/provider-already-linked'), 'already-added');
  assert.equal(linkingProblem('auth/requires-recent-login'), 'needs-recent-sign-in');
  assert.equal(linkingProblem('auth/popup-closed-by-user'), null);
  assert.equal(new LinkingError('already-added').problem, 'already-added');
});

test('signing in with a credential signs in once, then adds the held way in', async () => {
  const calls: string[] = [];
  const user = await signInWithHeldLink('google-credential', 'google', {
    signIn: async (c) => { calls.push(`signIn:${c}`); return 'user-1'; },
    afterSignIn: async (u) => { calls.push(`after:${u}`); },
    hold: () => { calls.push('hold'); },
  });
  assert.equal(user, 'user-1');
  assert.deepEqual(calls, ['signIn:google-credential', 'after:user-1']);
});

test('an email that already signs in another way holds the credential and asks for that way', async () => {
  let held: unknown = null;
  let afterRan = false;
  await assert.rejects(
    signInWithHeldLink('apple-credential', 'apple', {
      signIn: async () => { throw Object.assign(new Error('exists'), { code: 'auth/account-exists-with-different-credential' }); },
      afterSignIn: async () => { afterRan = true; },
      hold: (pending) => { held = pending; },
    }),
    (error: unknown) => error instanceof LinkingError && error.problem === 'use-existing-method',
  );
  assert.deepEqual(held, { credential: 'apple-credential', method: 'apple' });
  assert.equal(afterRan, false);
});

test('other sign-in failures pass through unchanged and hold nothing', async () => {
  let held = false;
  const failure = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
  await assert.rejects(
    signInWithHeldLink('c', 'google', { signIn: async () => { throw failure; }, afterSignIn: async () => {}, hold: () => { held = true; } }),
    (error: unknown) => error === failure,
  );
  assert.equal(held, false);
});
