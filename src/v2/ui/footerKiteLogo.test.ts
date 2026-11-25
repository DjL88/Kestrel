import assert from 'node:assert/strict';
import test from 'node:test';
import { footerKiteLogo } from './footerKiteLogo';

test('Free footer shows the brand pack red kite for each theme', () => {
  assert.match(footerKiteLogo('light', false), /\/inflight-kite-light\.svg$/);
  assert.match(footerKiteLogo('dark', false), /\/inflight-kite-dark\.svg$/);
});

// Owner report, 25 Nov: the footer kite never changed for Pro, although the pack has a silver Pro kite.
test('verified Pro footer shows the brand pack silver Pro kite for each theme', () => {
  assert.match(footerKiteLogo('light', true), /\/inflight-kite-pro-light\.svg$/);
  assert.match(footerKiteLogo('dark', true), /\/inflight-kite-pro-dark\.svg$/);
});

test('a missing Pro grant must not select a Pro brand mark', () => {
  assert.doesNotMatch(footerKiteLogo('dark', false), /pro-/);
  assert.doesNotMatch(footerKiteLogo('light', false), /pro-/);
});
