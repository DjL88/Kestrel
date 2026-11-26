import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readContributorStatus, sendContributorFeedback } from './contributorFeedback';

function server(contributor: boolean, accept = true) {
  const posted: unknown[] = [];
  const fetcher = (async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/v1/auth/firebase') return json({ accessToken: 'session' });
    if (path === '/v1/me/entitlements') return json({ aiConsent: false, plans: [], contributor });
    if (path === '/v1/me/feedback') { posted.push(JSON.parse(String(options.body))); return accept ? json({ received: true }) : json({ error: 'NOT_CONTRIBUTOR' }, 403); }
    return json({}, 404);
  }) as typeof fetch;
  return { fetcher, posted };
}
const payload = { comment: 'Better word', target: 'button "Exportieren"', text: 'Exportieren', screen: 'editor', language: 'de', appVersion: 'abc' };

test('contributor status comes only from the server, and any failure reads as not a contributor', async () => {
  assert.equal(await readContributorStatus('https://control.example', 'id', server(true).fetcher), true);
  assert.equal(await readContributorStatus('https://control.example', 'id', server(false).fetcher), false);
  assert.equal(await readContributorStatus('https://control.example', null, server(true).fetcher), false, 'signed out');
  assert.equal(await readContributorStatus(null, 'id', server(true).fetcher), false, 'no control plane in this build');
  const offline = (async () => { throw new TypeError('offline'); }) as typeof fetch;
  assert.equal(await readContributorStatus('https://control.example', 'id', offline), false);
});

test('feedback sends exactly what the person saw, and a refusal is reported rather than shown as sent', async () => {
  const ok = server(true);
  await sendContributorFeedback('https://control.example', 'id', payload, ok.fetcher);
  assert.deepEqual(ok.posted, [payload]);
  await assert.rejects(sendContributorFeedback('https://control.example', 'id', payload, server(true, false).fetcher), /could not be sent/);
});
