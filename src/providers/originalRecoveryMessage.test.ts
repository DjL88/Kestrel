import assert from 'node:assert/strict';
import test from 'node:test';
import { originalRecoveryMessage } from './originalRecoveryMessage';

test('unavailable NAS does not claim photographs were deleted', () => {
  const message = originalRecoveryMessage('unavailable');
  assert.equal(message.action, 'check-drive');
  assert.match(message.detail, /network/);
  assert.doesNotMatch(message.title + message.detail, /deleted/i);
});
test('permissions and moved files lead to different recovery actions', () => {
  assert.equal(originalRecoveryMessage('permission-denied').action, 'grant-access');
  assert.equal(originalRecoveryMessage('missing').action, 'locate-folder');
  assert.equal(originalRecoveryMessage('available').action, 'none');
});
