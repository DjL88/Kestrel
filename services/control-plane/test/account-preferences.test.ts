import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeProvider, startHarness } from './helpers.ts';

test('quick setup answers are kept with the account and read back on another sign-in', async () => {
  const h = await startHarness(fakeProvider());
  try {
    const empty = await h.call('GET', '/v1/me/preferences', { token: h.user.token });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.preferences, {});

    const saved = await h.call('POST', '/v1/me/preferences', {
      token: h.user.token,
      body: { setup: { status: 'done', language: 'de', genres: ['wildlife', 'unknown'], experience: 'pro', cloud: 'account', flightMode: 'solo', step: 'extras', photo: 'never kept', updatedAt: '2026-11-26T17:00:00Z' } },
    });
    assert.equal(saved.status, 200);
    const back = await h.call('GET', '/v1/me/preferences', { token: h.user.token });
    assert.deepEqual(back.body.preferences, { setup: { status: 'done', language: 'de', genres: ['wildlife'], experience: 'pro', cloud: 'account', flightMode: 'solo', updatedAt: '2026-11-26T17:00:00Z' } });
  } finally {
    await h.close();
  }
});

test('setup answers need a sign-in, and unreadable or unfinished answers change nothing', async () => {
  const h = await startHarness(fakeProvider());
  try {
    assert.equal((await h.call('GET', '/v1/me/preferences', {})).status, 401);
    const bad = await h.call('POST', '/v1/me/preferences', { token: h.user.token, body: { setup: { status: 'in-progress' } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'BAD_PREFERENCES');
    assert.deepEqual((await h.call('GET', '/v1/me/preferences', { token: h.user.token })).body.preferences, {});
  } finally {
    await h.close();
  }
});
