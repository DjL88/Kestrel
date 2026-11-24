import test from 'node:test';
import assert from 'node:assert/strict';
import { probeControlPlane, currentReachability, HEALTH_STALE_MS } from './serviceReachability';

const signal = () => new AbortController().signal;
const response = (r: Response) => (async () => r) as typeof fetch;
test('only expected JSON liveness is reachable; no credentials or redirects', async () => {
  let called = false;
  const fetcher: typeof fetch = async (url, init) => {
    called = true;
    assert.equal(url, 'https://example.test/healthz');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  };
  assert.equal(await probeControlPlane('https://example.test', signal(), fetcher), 'reachable');
  assert.equal(called, true);
  assert.equal(await probeControlPlane('https://example.test', signal(), response(new Response('<html>Login</html>'))), 'unverified');
  assert.equal(await probeControlPlane('https://example.test', signal(), response(new Response('{"ok":false}', { headers: { 'content-type': 'application/json' } }))), 'unverified');
  assert.equal(await probeControlPlane('https://example.test', signal(), response(new Response('', {status:503}))), 'unreachable');
});
test('network errors, timeouts and cancellation do not hang or claim health', async () => {
  const fail = (async () => { throw new Error('DNS'); }) as typeof fetch;
  const hang = (() => new Promise<Response>(() => {})) as typeof fetch;
  assert.equal(await probeControlPlane('https://example.test', signal(), fail), 'unreachable');
  assert.equal(await probeControlPlane('https://example.test', signal(), hang, 5), 'unreachable');
  const controller = new AbortController();
  const result = probeControlPlane('https://example.test', controller.signal, hang);
  controller.abort();
  assert.equal(await result, 'unverified');
});
test('old and future-clock health observations expire', () => {
  assert.equal(currentReachability('reachable', 100, 100 + HEALTH_STALE_MS), 'unchecked');
  assert.equal(currentReachability('reachable', 100, 99), 'unchecked');
  assert.equal(currentReachability('reachable', 100, 101), 'reachable');
});
