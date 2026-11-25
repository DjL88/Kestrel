import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyAuthError } from './authError.ts';

test('Firebase setup problems explain the appropriate remedy', () => {
  assert.match(friendlyAuthError({ code: 'auth/unauthorized-domain' }), /authorised/);
  assert.match(friendlyAuthError({ code: 'auth/operation-not-allowed' }), /not enabled/);
  assert.match(friendlyAuthError({ code: 'auth/invalid-api-key' }), /updated build/);
  assert.match(friendlyAuthError({ code: 'auth/user-disabled' }), /disabled/);
});

test('unexpected authentication errors do not expose raw tokens or credentials', () => {
  assert.doesNotMatch(friendlyAuthError({ message: 'private-token' }), /private-token/);
  assert.match(friendlyAuthError({ code: 'auth/network-request-failed' }), /offline/);
});
