import assert from 'node:assert/strict';
import test from 'node:test';
import { startHarness } from './helpers.ts';

const activate = (h: Awaited<ReturnType<typeof startHarness>>, xff: string) => h.call('POST', '/v1/me/activate', {
  token: h.user.token, headers: { 'x-forwarded-for': xff },
  body: { deviceHash: 'c'.repeat(64), platform: 'web', appVersion: '1.0.0' },
});

test('on Cloud Run, rate limits are per client address, not one shared bucket for Google\'s front end', async () => {
  const h = await startHarness(null, undefined, { env: { K_SERVICE: 'kestrel-control-plane' } });
  try {
    for (let i = 0; i < 20; i++) assert.notEqual((await activate(h, '81.2.69.142')).status, 429);
    assert.equal((await activate(h, '81.2.69.142')).status, 429);
    // A client-written entry before the appended one does not let the same person escape the limit.
    assert.equal((await activate(h, '1.2.3.4, 81.2.69.142')).status, 429);
    assert.notEqual((await activate(h, '81.2.69.143')).status, 429);
  } finally { await h.close(); }
});

test('off Cloud Run, X-Forwarded-For is ignored, so it cannot be used to dodge limits', async () => {
  const h = await startHarness(null);
  try {
    for (let i = 0; i < 20; i++) await activate(h, '10.0.0.' + i);
    assert.equal((await activate(h, '10.0.0.99')).status, 429);
  } finally { await h.close(); }
});
