import test from 'node:test';
import assert from 'node:assert/strict';
import { isKestrelOfflineWorker, manageOfflineWorker } from './offlineWorker';

test('recognises only same-origin InFlight offline workers', () => {
  assert.equal(isKestrelOfflineWorker('http://tauri.localhost/offline.js', 'http://tauri.localhost/'), true);
  assert.equal(isKestrelOfflineWorker('https://example.test/sub/offline.js', 'https://example.test/sub/'), true);
  assert.equal(isKestrelOfflineWorker('https://other.test/offline.js', 'https://example.test/'), false);
  assert.equal(isKestrelOfflineWorker('https://example.test/other.js', 'https://example.test/'), false);
  assert.equal(isKestrelOfflineWorker('not a url', 'https://example.test/'), false);
});

test('desktop unregisters only its legacy worker without deleting storage or other workers', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let ownUnregistered = 0;
  let otherUnregistered = 0;
  let registered = 0;
  const own = {
    active: { scriptURL: 'http://tauri.localhost/offline.js' },
    unregister: async () => { ownUnregistered++; return true; },
  };
  const other = {
    active: { scriptURL: 'http://tauri.localhost/unrelated.js' },
    unregister: async () => { otherUnregistered++; return true; },
  };
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker: {
        getRegistrations: async () => [own, other],
        register: async () => { registered++; },
      } },
    });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://tauri.localhost/' } });
    await manageOfflineWorker(true, true);
    assert.equal(ownUnregistered, 1);
    assert.equal(otherUnregistered, 0);
    assert.equal(registered, 0);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
