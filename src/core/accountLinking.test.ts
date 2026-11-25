import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkingError, linkingProblem, methodsFromProviderIds, methodsToAdd } from './accountLinking';

test('the ways an account signs in, and what can still be added', () => {
  assert.deepEqual(methodsFromProviderIds(['password', 'google.com', 'github.com']), ['google', 'password']);
  assert.deepEqual(methodsFromProviderIds([]), []);
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
