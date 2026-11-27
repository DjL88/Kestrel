import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_CONSENT_UNASKED, CLOUD_CONSENT_VERSION, answerCloudConsent, cloudConsentGiven, parseCloudConsent } from './cloudConsent.ts';

test('nothing stored, damaged or older wording is unasked, never yes (no pre-ticked consent)', () => {
  for (const value of [undefined, null, 'yes', 1, {}, { answer: 'yes' }, { answer: 'yes', atMs: 5, version: 0 }, { answer: 'maybe', atMs: 5, version: CLOUD_CONSENT_VERSION }, { answer: 'yes', atMs: -1, version: CLOUD_CONSENT_VERSION }]) {
    assert.deepEqual(parseCloudConsent(value), CLOUD_CONSENT_UNASKED);
  }
  assert.equal(cloudConsentGiven(CLOUD_CONSENT_UNASKED), false);
});

test('a yes or a no is remembered with when it was given', () => {
  const yes = parseCloudConsent(JSON.parse(JSON.stringify(answerCloudConsent('yes', 1_000))));
  assert.deepEqual(yes, { answer: 'yes', atMs: 1_000, version: CLOUD_CONSENT_VERSION });
  assert.equal(cloudConsentGiven(yes), true);
  assert.equal(cloudConsentGiven(parseCloudConsent(answerCloudConsent('no', 2_000))), false);
});
