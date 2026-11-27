import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiProviderSetup } from './dialogs/AiProviderSetup';
import { getOnlineHelperAccess, setOnlineHelperAccess } from '../../providers/onlineHelperState';
import { availableAiProviderKinds } from '../../providers/aiProviders';

// Owner, 27 Nov 2026: "If it's not added we shouldn't need the disable button." InFlight's own online helper is
// invite-only, so Settings › AI providers offers it only when the server says it is available to this account.
const options = (html: string) => [...html.matchAll(/<option value="(\w+)"/g)].map((m) => m[1]);

test('not available: Settings › AI providers does not offer InFlight’s own helper at all', () => {
  setOnlineHelperAccess(null);
  const html = renderToStaticMarkup(createElement(AiProviderSetup));
  assert.deepEqual(options(html), ['openai', 'gemini', 'anthropic']);
  assert.doesNotMatch(html, /online helper|invited testers/i);
  setOnlineHelperAccess('unavailable');
  assert.deepEqual(options(renderToStaticMarkup(createElement(AiProviderSetup))), ['openai', 'gemini', 'anthropic']);
});

test('available to this account: it is offered, named plainly, with no "invited testers only" line', () => {
  setOnlineHelperAccess('available');
  try {
    const html = renderToStaticMarkup(createElement(AiProviderSetup));
    assert.deepEqual(options(html), ['openai', 'gemini', 'anthropic', 'inflight']);
    assert.match(html, />InFlight’s online helper</);
    assert.doesNotMatch(html, /invited testers only/i);
  } finally { setOnlineHelperAccess(null); }
  assert.equal(getOnlineHelperAccess(), null);
});

test('the provider list follows the same rule', () => {
  assert.equal(availableAiProviderKinds().includes('inflight'), false);
  assert.equal(availableAiProviderKinds(false).includes('inflight'), false);
  assert.equal(availableAiProviderKinds(true).includes('inflight'), true);
});
