import test from 'node:test';
import assert from 'node:assert/strict';
import { offeredProviderKinds, onlineHelperFromEntitlements, showOnlineHelper, usableProviderSettings } from './onlineHelperAccess';

test('only an explicit "available" from the server counts', () => {
  assert.equal(onlineHelperFromEntitlements({ onlineHelper: 'available' }), 'available');
  for (const data of [{ onlineHelper: 'unavailable' }, {}, { onlineHelper: true }, { onlineHelper: 'Available' }, null, 'available', undefined]) {
    assert.equal(onlineHelperFromEntitlements(data), 'unavailable', JSON.stringify(data));
  }
});

test('shown only when available and online; not known yet or offline is hidden', () => {
  assert.equal(showOnlineHelper('available', true), true);
  assert.equal(showOnlineHelper('available', false), false, 'offline means hidden');
  assert.equal(showOnlineHelper('unavailable', true), false);
  assert.equal(showOnlineHelper(null, true), false);
  assert.equal(showOnlineHelper(undefined, true), false);
});

test('InFlight’s own helper is offered as a provider only while shown; the others always', () => {
  const kinds = ['openai', 'gemini', 'anthropic', 'inflight'] as const;
  assert.deepEqual(offeredProviderKinds(kinds, false, 'inflight'), ['openai', 'gemini', 'anthropic']);
  assert.deepEqual(offeredProviderKinds(kinds, true, 'inflight'), [...kinds]);
});

test('a saved InFlight helper choice is not used while hidden, and comes back when access returns', () => {
  const helper = { kind: 'inflight', model: 'x' };
  const own = { kind: 'gemini', key: 'k' };
  assert.equal(usableProviderSettings(helper, false, 'inflight'), null, 'entitlement removed or switch off: stop sending');
  assert.equal(usableProviderSettings(helper, true, 'inflight'), helper);
  assert.equal(usableProviderSettings(own, false, 'inflight'), own, 'the person’s own AI is never affected');
  assert.equal(usableProviderSettings(null, true, 'inflight'), null);
});
