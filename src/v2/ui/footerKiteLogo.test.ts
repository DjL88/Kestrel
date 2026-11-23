import assert from 'node:assert/strict';
import test from 'node:test';
import { footerKiteLogo } from './footerKiteLogo';

test('Basic footer displays the supplied red/orange kite for both themes', () => {
  assert.equal(footerKiteLogo('light', false), '/v2-logos/inflight-kite-light.svg');
  assert.equal(footerKiteLogo('dark', false), '/v2-logos/inflight-kite-dark.svg');
});

test('verified Pro footer displays the supplied monochrome kite for each theme', () => {
  assert.equal(footerKiteLogo('light', true), '/v2-logos/inflight-kite-pro-light.svg');
  assert.equal(footerKiteLogo('dark', true), '/v2-logos/inflight-kite-pro-dark.svg');
});

test('a missing Pro grant must not select a Pro brand mark', () => {
  assert.doesNotMatch(footerKiteLogo('dark', false), /pro-/);
});
