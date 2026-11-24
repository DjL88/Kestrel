import test from 'node:test';
import assert from 'node:assert/strict';
import { linkState, remoteActionsAllowed } from './connectivity';
test('offline blocks remote actions; a connected link never claims service health', () => {
  assert.equal(linkState(false), 'offline');
  assert.equal(remoteActionsAllowed(linkState(false)), false);
  assert.equal(linkState(true), 'unverified');
  assert.equal(remoteActionsAllowed(linkState(true)), true);
  assert.equal(linkState(undefined), 'unverified');
});
