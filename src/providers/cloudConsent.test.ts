import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_CONSENT_KEY, readCloudConsent, saveCloudConsent } from './cloudConsent.ts';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map };
};

test('asked once: a yes is kept on this device until the person changes it', () => {
  const store = memory();
  assert.equal(readCloudConsent(store).answer, 'unasked');
  assert.equal(saveCloudConsent('yes', 10, store).answer, 'yes');
  assert.equal(readCloudConsent(store).answer, 'yes');
  assert.equal(saveCloudConsent('no', 20, store).answer, 'no');
  assert.equal(saveCloudConsent('ask', 30, store).answer, 'unasked');
  assert.equal(store.map.has(CLOUD_CONSENT_KEY), false);
});

test('a yes that cannot be saved is not in force, and unreadable storage is unasked', () => {
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); }, removeItem: () => undefined };
  assert.equal(saveCloudConsent('yes', 10, broken).answer, 'unasked');
  assert.equal(readCloudConsent(broken).answer, 'unasked');
  assert.equal(readCloudConsent(null).answer, 'unasked');
});

test('a legacy implicit answer without an explicit timestamp never grants permission', () => {
  const store = memory();
  store.map.set(CLOUD_CONSENT_KEY, JSON.stringify({ answer: 'yes', version: 1 }));
  assert.equal(readCloudConsent(store).answer, 'unasked');
  saveCloudConsent('no', 5, store);
  assert.equal(readCloudConsent(store).answer, 'no');
  saveCloudConsent('yes', 6, store);
  assert.equal(readCloudConsent(store).answer, 'yes');
  saveCloudConsent('ask', 7, store);
  assert.equal(readCloudConsent(store).answer, 'unasked');
});
