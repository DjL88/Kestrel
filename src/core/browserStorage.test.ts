import assert from 'node:assert/strict';
import test from 'node:test';
import { canAskBrowser, readBrowserStorage, requestBrowserStorage } from './browserStorage';

test('reading the state never asks the browser for anything', async () => {
  let asked = 0;
  const storage = { persisted: async () => false, persist: async () => { asked += 1; return true; } };
  assert.equal(await readBrowserStorage(storage), 'standard');
  assert.equal(asked, 0);
  assert.equal(await readBrowserStorage({ persisted: async () => true, persist: async () => true }), 'persistent');
});

test('asking reports exactly what the browser answered', async () => {
  assert.equal(await requestBrowserStorage({ persisted: async () => false, persist: async () => true }), 'persistent');
  assert.equal(await requestBrowserStorage({ persisted: async () => false, persist: async () => false }), 'declined');
});

test('storage the browser already keeps is not asked again', async () => {
  let asked = 0;
  const state = await requestBrowserStorage({ persisted: async () => true, persist: async () => { asked += 1; return true; } });
  assert.equal(state, 'persistent');
  assert.equal(asked, 0);
});

test('a browser without the API, or one that throws, is reported as unavailable, never as kept', async () => {
  assert.equal(await readBrowserStorage(undefined), 'unavailable');
  assert.equal(await requestBrowserStorage({}), 'unavailable');
  assert.equal(await requestBrowserStorage({ persisted: async () => false, persist: async () => { throw new Error('no'); } }), 'unavailable');
  assert.equal(await readBrowserStorage({ persisted: async () => { throw new Error('no'); }, persist: async () => true }), 'unavailable');
});

test('a request is offered only while the browser could still agree', () => {
  assert.equal(canAskBrowser('standard'), true);
  assert.equal(canAskBrowser('declined'), true);
  for (const state of ['checking', 'requesting', 'persistent', 'unavailable'] as const) assert.equal(canAskBrowser(state), false);
});
